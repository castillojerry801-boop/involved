// Shared search utilities extracted from app/api/nutrition/search/route.ts.
// Import from here so that both the search route and the matching service share
// the same quality gate / scoring logic without duplication.

import type { ExternalFoodResult } from '@/lib/nutrition/providers/types'

// ── Token helpers ─────────────────────────────────────────────────────────────

/** Strip apostrophes/possessives from a token. */
export function normalizeToken(t: string): string {
  return t.replace(/[''']/g, '').toLowerCase()
}

/**
 * Generate plural/singular/possessive variants so "blueberries"↔"blueberry",
 * "banana"↔"bananas", "cane's"↔"canes"↔"cane" all match each other.
 */
export function tokenVariants(raw: string): string[] {
  const t = normalizeToken(raw)
  const v = new Set([t])
  if (t.endsWith('ies') && t.length > 5) v.add(t.slice(0, -3) + 'y')  // berries→berry
  if (t.endsWith('es')  && t.length > 5) v.add(t.slice(0, -2))         // tomatoes→tomat
  if (t.endsWith('s')   && t.length > 4) v.add(t.slice(0, -1))         // bananas→banana
  if (!t.endsWith('s')  && t.length >= 4) v.add(t + 's')               // banana→bananas
  return [...v].filter(s => s.length >= 3)
}

/**
 * Returns true if any variant of `token` appears as a substring in `text`.
 * Both the text and each variant are apostrophe-normalized before comparison.
 */
export function tokenHitsText(token: string, text: string): boolean {
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

export function passesQualityGate(result: ExternalFoodResult, query: string): boolean {
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

/** Score how well a result matches the query. Higher = show first. */
export function scoreResult(r: ExternalFoodResult, query: string): number {
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

export function normDedup(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}
