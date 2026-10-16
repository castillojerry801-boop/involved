import 'server-only'
import { FOOD_PROVIDERS } from '@/lib/nutrition/providers'
import { prisma } from '@/lib/prisma'
import type { ExternalFoodResult } from '@/lib/nutrition/providers/types'
import {
  passesQualityGate,
  scoreResult,
  normDedup,
} from '@/lib/nutrition/search-utils'
import { scoreForIngredient } from './scorer'
import { getClarificationQuestion } from './clarifications'
import type { MatchRequest, MatchResult, FoodMatch } from './types'

// ── Library cache lookup ──────────────────────────────────────────────────────

async function getLibraryCandidates(ingredientName: string): Promise<ExternalFoodResult[]> {
  const terms = ingredientName.split(/\s+/).filter(t => t.length >= 2)
  if (terms.length === 0) return []

  const termFilters = terms.map(t => ({
    OR: [
      { name: { contains: t, mode: 'insensitive' as const } },
      { brand: { contains: t, mode: 'insensitive' as const } },
    ],
  }))

  const cached = await prisma.foodItem.findMany({
    where: {
      AND: termFilters,
      visibility: { in: ['verified', 'community'] },
    },
    orderBy: [{ lastSyncedAt: 'desc' }, { name: 'asc' }],
    take: 10,
  }).catch(() => [])

  return cached.map(f => ({
    provider: f.sourceProvider ?? 'library',
    externalId: f.externalId ?? f.id,
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
    isGeneric: false,
    source: 'library' as const,
  }))
}

// ── Main matcher ──────────────────────────────────────────────────────────────

export async function matchIngredient(req: MatchRequest): Promise<MatchResult> {
  const query = req.ingredientName.trim()

  // 1. Library cache check (trusted data — +20 bonus)
  const libraryResults = await getLibraryCandidates(query).catch((): ExternalFoodResult[] => [])

  // 2. Fan out to providers (exclude DSLD — irrelevant for recipe ingredients)
  const activeProviders = FOOD_PROVIDERS.filter(p => p.providerId !== 'nih_dsld')
  const providerResults = (
    await Promise.all(
      activeProviders.map(p => p.search(query, { limit: 20 }).catch((): ExternalFoodResult[] => []))
    )
  ).flat()

  // 3. Drop zero-nutrition results
  const withNutrition = providerResults.filter(r => {
    const n = r.coreNutrients
    return n.calories > 0 || n.proteinG > 0 || n.carbohydrateG > 0 || n.fatG > 0
  })

  // 4. Apply quality gate to provider results
  const relevant = withNutrition.filter(r => passesQualityGate(r, query))

  // 5. Deduplicate provider results
  const seenBarcodes  = new Set<string>()
  const seenNameBrand = new Set<string>()

  const dedupedProvider = relevant.filter(r => {
    if (r.barcode) {
      if (seenBarcodes.has(r.barcode)) return false
      seenBarcodes.add(r.barcode)
    }
    const key = `${normDedup(r.name)}|${normDedup(r.brand ?? '')}`
    if (seenNameBrand.has(key)) return false
    seenNameBrand.add(key)
    return true
  })

  // 6. De-duplicate library hits vs provider hits
  const libBarcodes  = new Set(libraryResults.map(r => r.barcode).filter(Boolean))
  const libNameBrand = new Set(libraryResults.map(r =>
    `${normDedup(r.name)}|${normDedup(r.brand ?? '')}`
  ))
  const externalOnly = dedupedProvider.filter(r => {
    if (r.barcode && libBarcodes.has(r.barcode)) return false
    const key = `${normDedup(r.name)}|${normDedup(r.brand ?? '')}`
    return !libNameBrand.has(key)
  })

  // 7. Compute base scores
  // ── Cache-bonus safety invariant ─────────────────────────────────────────────
  // The +20 library cache bonus is added to the base score BEFORE the semantic
  // layer (scoreForIngredient) runs. The semantic layer can then apply a –30
  // negative-pair penalty (e.g. "thigh" penalized for a "breast" query).
  // Net result for a cached wrong food: base(~40) + 20 – 30 = ~30, well below the
  // 'confident' threshold of 85. This means the +20 bonus CANNOT push a semantically
  // rejected food to 'confident'. Covered by __tests__/nutrition/matching/cache-safety.test.ts.
  const allCandidates = [...libraryResults, ...externalOnly]
  const baseScoreMap = new Map<string, number>()
  for (const r of allCandidates) {
    let base = scoreResult(r, query)
    // Library cache bonus — already trusted data, but semantic penalties still apply after
    if (r.internalId) base += 20
    baseScoreMap.set(r.externalId, base)
  }

  // 8. Apply semantic scoring
  const scored = scoreForIngredient(allCandidates, req, baseScoreMap)

  // 9. Determine confidence
  // rawResults: always return top 6 scored candidates so the client can populate
  // a dropdown on no_match without making a second search request.
  const rawResults = scored.slice(0, 6)

  if (scored.length === 0) {
    return {
      confidence: 'no_match',
      topMatch: null,
      alternatives: [],
      rawResults: [],
    }
  }

  const topMatch = scored[0]
  const rest = scored.slice(1)

  // No match: top score too low
  if (topMatch.matchScore < 40) {
    return {
      confidence: 'no_match',
      topMatch: null,
      alternatives: scored.slice(0, 3),
      rawResults,
    }
  }

  const runnerUpScore = rest[0]?.matchScore ?? 0
  const gap = topMatch.matchScore - runnerUpScore

  let confidence: MatchResult['confidence']
  if (topMatch.matchScore >= 85 && gap >= 20) {
    confidence = 'confident'
  } else if (topMatch.matchScore >= 60) {
    // Check for ambiguity: multiple close scores + clarification question available
    const clarification = getClarificationQuestion(req.ingredientName, scored)
    if (clarification && gap < 20) {
      return {
        confidence: 'ambiguous',
        topMatch,
        alternatives: rest.slice(0, 3),
        clarificationQuestion: clarification,
        matchNote: `Multiple matching foods for "${req.ingredientName}"`,
        rawResults,
      }
    }
    confidence = 'plausible'
  } else {
    confidence = 'plausible'
  }

  const matchNote = topMatch.isGeneric || !topMatch.brand
    ? `Matched to generic ${topMatch.name}`
    : undefined

  return {
    confidence,
    topMatch,
    alternatives: rest.slice(0, 3),
    matchNote,
    rawResults,
  }
}
