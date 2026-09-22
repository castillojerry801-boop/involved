import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FOOD_PROVIDERS } from '@/lib/nutrition/providers'
import { prisma } from '@/lib/prisma'
import type { ExternalFoodResult } from '@/lib/nutrition/providers/types'

// ── Supplement gate ───────────────────────────────────────────────────────────

const SUPPLEMENT_KEYWORDS = [
  'protein', 'creatine', 'vitamin', 'supplement', 'pre workout', 'preworkout',
  'bcaa', 'amino acid', 'whey', 'casein', 'isolate', 'mass gainer',
  'multivitamin', 'fish oil', 'omega 3', 'magnesium', 'zinc supplement',
  'collagen', 'greens powder', 'electrolyte', 'probiotic', 'gummy vitamin',
  'post workout', 'beta alanine', 'glutamine', 'citrulline',
]

function isSupplementQuery(query: string): boolean {
  const lower = query.toLowerCase()
  return SUPPLEMENT_KEYWORDS.some(kw => lower.includes(kw))
}

// ── Token helpers ─────────────────────────────────────────────────────────────

// Strip apostrophes/possessives from a token.
function normalizeToken(t: string): string {
  return t.replace(/[''']/g, '').toLowerCase()
}

// Generate plural/singular/possessive variants so "blueberries"↔"blueberry",
// "banana"↔"bananas", "cane's"↔"canes"↔"cane" all match each other.
function tokenVariants(raw: string): string[] {
  const t = normalizeToken(raw)
  const v = new Set([t])
  if (t.endsWith('ies') && t.length > 5) v.add(t.slice(0, -3) + 'y')  // berries→berry
  if (t.endsWith('es')  && t.length > 5) v.add(t.slice(0, -2))         // tomatoes→tomat
  if (t.endsWith('s')   && t.length > 4) v.add(t.slice(0, -1))         // bananas→banana
  if (!t.endsWith('s')  && t.length >= 4) v.add(t + 's')               // banana→bananas
  return [...v].filter(s => s.length >= 3)
}

// Returns true if any variant of `token` appears as a substring in `text`.
// Both the text and each variant are apostrophe-normalized before comparison.
function tokenHitsText(token: string, text: string): boolean {
  const normText = normalizeToken(text)
  return tokenVariants(token).some(v => normText.includes(v))
}

// ── Quality gate ──────────────────────────────────────────────────────────────
//
// Applied AFTER aggregation, scoring, and deduplication.
// Rejects results that have no meaningful textual relationship to the query.
//
// Rules:
//  1. Hard-reject placeholder names ("Unknown product") with no identifying brand.
//  2. Barcode-format queries pass through any result that has a matching barcode.
//  3. Full query appears in combined name+brand → pass.
//  4. Brand exactly equals query → pass (e.g. "Fairlife" brand for "Fairlife" query).
//  5. Extract significant query tokens (≥3 chars after punctuation stripping).
//     - Single-token query: that token must hit name or brand.
//     - Multi-token query: FIRST token must hit AND at least ceil(n/2) tokens must hit.
//       The "first token must hit" rule prevents "Sugar Cane, Raw" from passing
//       for "Raising Cane's" (the first significant token "raising" is absent).

function passesQualityGate(result: ExternalFoodResult, query: string): boolean {
  // Hard-reject: unnamed or placeholder product with no brand
  const nameTrimmed = result.name.trim()
  if (!nameTrimmed && !result.brand) return false
  if (/^unknown\s*product$/i.test(nameTrimmed) && !result.brand) return false

  // Barcode-format query: any result with a barcode passes (barcode route handles exact lookup)
  if (/^\d{8,14}$/.test(query) && result.barcode) return true

  const combined = [result.name, result.brand].filter(Boolean).join(' ')
  const qNorm = normalizeToken(query)
  const combinedNorm = normalizeToken(combined)

  // Full (apostrophe-normalized) query appears in combined name+brand
  if (combinedNorm.includes(qNorm)) return true

  // Brand exactly matches query
  if (result.brand && normalizeToken(result.brand) === qNorm) return true

  // Extract significant tokens: strip punctuation, keep ≥3 chars
  const qTokens = query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/['''`.,!?;:()\[\]{}]/g, ''))
    .filter(t => t.length >= 3)

  if (qTokens.length === 0) return true  // nothing left after stripping — don't gate

  const hits = qTokens.filter(t => tokenHitsText(t, combined))

  if (qTokens.length === 1) return hits.length >= 1

  // Multi-token: first significant token must match AND ≥ ceil(total/2) must match.
  return tokenHitsText(qTokens[0], combined) && hits.length >= Math.ceil(qTokens.length / 2)
}

// ── Scoring ───────────────────────────────────────────────────────────────────

// Score how well a result matches the query. Higher = show first.
// Uses tokenHitsText for word coverage so plural/possessive variants count.
function scoreResult(r: ExternalFoodResult, query: string): number {
  let score = 0
  const qNorm = normalizeToken(query)
  const nameNorm = normalizeToken(r.name)
  const brandNorm = normalizeToken(r.brand ?? '')
  const combinedNorm = `${nameNorm} ${brandNorm}`.trim()

  // Name/combined match quality
  if (combinedNorm === qNorm || nameNorm === qNorm) score += 100
  else if (combinedNorm.startsWith(qNorm + ' ') || combinedNorm.startsWith(qNorm + ',')) score += 80
  else if (combinedNorm.includes(qNorm)) score += 60
  else {
    // Word coverage via variant-aware matching
    const qTokens = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2)
    if (qTokens.length > 0) {
      const matched = qTokens.filter(t => tokenHitsText(t, r.name + ' ' + (r.brand ?? '')))
      score += Math.round((matched.length / qTokens.length) * 40)
    }
  }

  // Brand is part of the query
  if (brandNorm && qNorm.includes(brandNorm)) score += 15
  if (brandNorm && brandNorm.includes(qNorm)) score += 10

  // Provider baseline quality
  const providerBonus: Record<string, number> = {
    fatsecret: 15, usda_fooddata: 12, nih_dsld: 8, open_food_facts: 5,
  }
  score += providerBonus[r.provider] ?? 0

  // Data completeness
  const n = r.coreNutrients
  if (n.calories > 0 && n.proteinG > 0 && n.carbohydrateG > 0 && n.fatG > 0) score += 8

  // Barcode present
  if (r.barcode) score += 5

  return score
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function normDedup(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const query = req.nextUrl.searchParams.get('q')?.trim()
  if (!query || query.length < 2) return NextResponse.json({ results: [] })

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
    externalId: f.id,
    name: f.name,
    brand: f.brand ?? undefined,
    barcode: f.barcode ?? undefined,
    servingSize: Number(f.servingSize),
    servingUnit: f.servingUnit,
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

  // 3. Drop zero-nutrition results (except DSLD stubs — their nutrition is detail-only)
  const withNutrition = providerResults.filter(r => {
    if (r.provider === 'nih_dsld') return true
    const n = r.coreNutrients
    return n.calories > 0 || n.proteinG > 0 || n.carbohydrateG > 0 || n.fatG > 0
  })

  // 4. Score and sort
  const scored = withNutrition
    .map(r => ({ r, score: scoreResult(r, query) }))
    .sort((a, b) => b.score - a.score)

  // 5. Deduplicate: barcode-first, then normalized name+brand
  const seenBarcodes  = new Set<string>()
  const seenNameBrand = new Set<string>()
  const deduped = scored.filter(({ r }) => {
    if (r.barcode) {
      if (seenBarcodes.has(r.barcode)) return false
      seenBarcodes.add(r.barcode)
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

  // 7. Skip items already covered by the local cache
  const cachedBarcodes  = new Set(cachedResults.map(r => r.barcode).filter(Boolean))
  const cachedNameBrand = new Set(cachedResults.map(r =>
    `${normDedup(r.name)}|${normDedup(r.brand ?? '')}`
  ))
  const external = relevant.filter(r => {
    if (r.barcode && cachedBarcodes.has(r.barcode)) return false
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
  const results = await FOOD_PROVIDERS[0].search(query, { limit: 20 })
  return NextResponse.json({ results })
}
