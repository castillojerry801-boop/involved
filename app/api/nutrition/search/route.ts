import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FOOD_PROVIDERS } from '@/lib/nutrition/providers'
import { prisma } from '@/lib/prisma'
import { isSensitiveQuery, PRIVACY_REJECTION_MESSAGE } from '@/lib/nutrition/privacy-guard'
import {
  passesQualityGate,
  scoreResult,
  normDedup,
  normBarcodeForDedup,
} from '@/lib/nutrition/search-utils'

// ── Supplement gate ───────────────────────────────────────────────────────────
//
// Controls whether DSLD (NIH Dietary Supplement Label Database) is included in
// provider fan-out. DSLD is authoritative for supplements but returns zero-nutrition
// stubs at search time — it should only fire for searches with clear supplement intent.
//
// Rules for adding keywords:
//  ✓ Add compound forms that only appear in supplement context ("protein powder", "whey protein")
//  ✗ Don't add bare nouns that appear in food names ("protein", "vitamin", "collagen",
//    "magnesium", "probiotic") — these would surface DSLD stubs for "protein smoothie",
//    "collagen broth", "probiotic yogurt", "magnesium-rich foods".

const SUPPLEMENT_KEYWORDS = [
  // Unambiguously supplement-intent queries:
  'creatine', 'pre workout', 'preworkout', 'bcaa', 'amino acid', 'mass gainer',
  'multivitamin', 'fish oil', 'omega 3', 'zinc supplement', 'magnesium supplement',
  'greens powder', 'gummy vitamin', 'post workout', 'beta alanine', 'glutamine', 'citrulline',
  'casein',
  // Compound supplement forms (bare "protein", "vitamin", "whey" etc. are too common in food names):
  'protein powder', 'protein shake', 'protein supplement',
  'whey protein',
  'protein isolate', 'soy isolate',
  'collagen peptide', 'collagen supplement', 'collagen powder',
  'electrolyte supplement', 'electrolyte powder', 'electrolyte tablet',
  'probiotic supplement', 'probiotic capsule',
]

export function isSupplementQuery(query: string): boolean {
  const lower = query.toLowerCase()
  return SUPPLEMENT_KEYWORDS.some(kw => lower.includes(kw))
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const query = req.nextUrl.searchParams.get('q')?.trim()
  if (!query || query.length < 2) return NextResponse.json({ results: [] })

  // Recipe ingredient searches pass context=recipe to boost generic whole-food results
  // (USDA SR Legacy / FatSecret Generic) over branded products. Diary searches omit this
  // param and use unmodified scoring to avoid changing existing diary search behavior.
  const isRecipeContext = req.nextUrl.searchParams.get('context') === 'recipe'

  if (isSensitiveQuery(query)) {
    return NextResponse.json({ results: [], warning: PRIVACY_REJECTION_MESSAGE })
  }

  const isSupplement = isSupplementQuery(query)

  const terms = query.split(/\s+/).filter(t => t.length >= 2)
  const termFilters = terms.map(t => ({
    OR: [
      { name: { contains: t, mode: 'insensitive' as const } },
      { brand: { contains: t, mode: 'insensitive' as const } },
    ],
  }))

  // 1. Community library — cached items already match query via DB contains filter
  const cached = await prisma.foodItem.findMany({
    where: {
      AND: termFilters,
      visibility: { in: ['verified', 'community'] },
    },
    orderBy: [{ lastSyncedAt: 'desc' }, { name: 'asc' }],
    take: 20,
  }).catch(() => [])

  const cachedResults = cached.map(f => ({
    provider: f.sourceProvider ?? 'library',
    // externalId: original provider ID (barcode, USDA FDC ID, etc.) for log-route deduplication.
    // Falls back to the DB UUID only for foods with no original external ID (e.g. ai_vision).
    externalId: f.externalId ?? f.id,
    // internalId: the DB UUID — use this as foodItemId when linking recipe ingredients.
    internalId: f.id,
    name: f.name,
    brand: f.brand ?? undefined,
    barcode: f.barcode ?? undefined,
    servingSize: Number(f.servingSize),
    servingUnit: f.servingUnit,
    householdServingText: f.householdServingText ?? undefined,
    householdUnit: f.householdUnit ?? undefined,
    unitsPerServing: f.unitsPerServing != null ? Number(f.unitsPerServing) : undefined,
    coreNutrients: {
      calories:      Number(f.calories),
      proteinG:      Number(f.proteinG),
      carbohydrateG: Number(f.carbohydrateG),
      fatG:          Number(f.fatG),
    },
    extendedNutrients: f.nutrientsJson
      ? (f.nutrientsJson as Record<string, number | undefined>)
      : undefined,
    source: 'library' as const,
  }))

  // 2. Fan out to providers — DSLD only for supplement queries
  const activeProviders = isSupplement
    ? FOOD_PROVIDERS
    : FOOD_PROVIDERS.filter(p => p.providerId !== 'nih_dsld')

  const providerResults = (
    await Promise.all(activeProviders.map(p => p.search(query, { limit: 20 }).catch(() => [])))
  ).flat()

  // Dev logging — which providers fired and how many raw results each returned
  if (process.env.NODE_ENV === 'development') {
    const raw: Record<string, number> = {}
    for (const r of providerResults) raw[r.provider] = (raw[r.provider] ?? 0) + 1
    console.log(`[nutrition/search] q="${query}" supplement=${isSupplement}`)
    for (const p of activeProviders) {
      console.log(`  [${p.providerId}] ${raw[p.providerId] ?? 0} raw`)
    }
  }

  // 3. Drop zero-nutrition results from non-DSLD providers.
  //    DSLD search stubs always have placeholder-zero nutrition (incompleteData=true);
  //    the UI enforces a detail fetch before logging them. Other providers that return
  //    all-zero macros have genuinely incomplete data and should not be shown as loggable.
  const withNutrition = providerResults.filter(r => {
    if (r.provider === 'nih_dsld') return true   // handled via incompleteData flag in UI
    const n = r.coreNutrients
    return n.calories > 0 || n.proteinG > 0 || n.carbohydrateG > 0 || n.fatG > 0
  })

  // 4. Score and sort
  // In recipe context: boost unbranded USDA SR Legacy/Foundation (+8) and FatSecret
  // Generic results (+6) so whole-food generics surface above branded variants.
  // This boost is intentionally scoped to recipe search only — diary search is unchanged.
  const scored = withNutrition
    .map(r => {
      let score = scoreResult(r, query)
      if (isRecipeContext) {
        if (r.provider === 'usda_fooddata' && !r.brand) score += 8
        if (r.isGeneric) score += 6
      }
      return { r, score }
    })
    .sort((a, b) => b.score - a.score)

  // 5. Deduplicate: barcode-first (EAN-13/UPC-A normalized), then normalized name+brand.
  //    normBarcodeForDedup converts EAN-13 "0049000042566" → "049000042566" so that
  //    providers returning different but equivalent barcode forms for the same product
  //    are caught here rather than surfacing as two results.
  const seenBarcodes  = new Set<string>()
  const seenNameBrand = new Set<string>()
  const deduped = scored.filter(({ r }) => {
    if (r.barcode) {
      const bKey = normBarcodeForDedup(r.barcode)
      if (seenBarcodes.has(bKey)) return false
      seenBarcodes.add(bKey)
    }
    const key = `${normDedup(r.name)}|${normDedup(r.brand ?? '')}`
    if (seenNameBrand.has(key)) return false
    seenNameBrand.add(key)
    return true
  }).map(({ r }) => r)

  // 6. Quality gate — reject results with no meaningful relationship to the query.
  //    Applied to external provider results only; library/cache results are pre-qualified
  //    by the DB contains filter above.
  const relevant = deduped.filter(r => passesQualityGate(r, query))

  // 7. Skip items already covered by the local cache (same normalization as step 5)
  const cachedBarcodes  = new Set(
    cachedResults.map(r => r.barcode ? normBarcodeForDedup(r.barcode) : null).filter((b): b is string => b !== null),
  )
  const cachedNameBrand = new Set(cachedResults.map(r =>
    `${normDedup(r.name)}|${normDedup(r.brand ?? '')}`
  ))
  const external = relevant.filter(r => {
    if (r.barcode && cachedBarcodes.has(normBarcodeForDedup(r.barcode))) return false
    const key = `${normDedup(r.name)}|${normDedup(r.brand ?? '')}`
    return !cachedNameBrand.has(key)
  })

  // Dev logging — survivors at each gate and final provider breakdown
  if (process.env.NODE_ENV === 'development') {
    const finalByProvider: Record<string, number> = {}
    for (const r of external) finalByProvider[r.provider] = (finalByProvider[r.provider] ?? 0) + 1
    console.log(`  → ${withNutrition.length} with nutrition → ${relevant.length} passed quality gate → ${external.length} external (${cachedResults.length} library)`)
    for (const [p, n] of Object.entries(finalByProvider)) console.log(`    [${p}] ${n} in final`)
  }

  return NextResponse.json({
    results: [
      ...cachedResults,
      ...external.map(r => ({ ...r, source: 'external' as const })),
    ],
  })
}

// Natural language query — POST form
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { query } = await req.json() as { query: string }
  if (!query?.trim()) return NextResponse.json({ results: [] })

  if (isSensitiveQuery(query)) {
    return NextResponse.json({ results: [], warning: PRIVACY_REJECTION_MESSAGE })
  }

  const results = await FOOD_PROVIDERS[0].search(query, { limit: 20 })
  return NextResponse.json({ results })
}
