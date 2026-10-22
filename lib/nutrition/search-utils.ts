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

// ── Modifier stop words ───────────────────────────────────────────────────────
//
// Trivial modifier words that are not food identifiers. Used in two places:
//   1. Quality gate: when qTokens[0] is a modifier, skip to the first non-modifier
//      token as the anchor. This lets USDA canonical names (which use "raw" not
//      "fresh") pass for customer queries like "fresh jackfruit" — "jackfruit" is
//      the identifier, "fresh" is a qualifier the database omits.
//   2. Scoring: modifiers are excluded when counting "extra" compound-dish words
//      so that "Bananas, raw" does not look like a compound dish for "banana".
const SCORING_STOP_WORDS = new Set([
  'raw', 'cooked', 'plain', 'whole', 'large', 'medium', 'small',
  'fresh', 'frozen', 'dried', 'organic', 'natural', 'low', 'fat',
])

// Common US consumer food names that USDA and other databases index under a
// different canonical term. Used in the quality gate and scoring so that
// queries like "oatmeal" can surface USDA "oats" foods, and vice versa.
// This is a vocabulary-normalization table only — no nutrition values here.
//
// NOT included: cilantro ↔ coriander. In the US, "cilantro" = fresh herb (~23 cal/100g)
// and "coriander" can refer to dried seeds (~298 cal/100g). Synonym expansion between
// them risks routing "cilantro" queries to high-density seed entries. Direct-name
// matching in FatSecret/USDA is sufficient for both terms.
export const FOOD_NAME_SYNONYMS: Map<string, string[]> = new Map([
  ['oatmeal', ['oats', 'oat']],
  ['arugula', ['rocket']],
  ['eggplant', ['aubergine']],
  ['zucchini', ['courgette']],
])

// Subset of FOOD_NAME_SYNONYMS keys where the KEY is the PREPARED/cooked form
// and the synonyms are the BASE/unprocessed ingredient form. Used by the
// preparation-form conflict guard to distinguish two fundamentally different
// synonym relationships:
//
//   Base-form (this set): "oatmeal" (cooked porridge) ↔ "oats" (dry grain).
//     Nutrition differs substantially by preparation — the guard must apply.
//
//   Same-form (not in this set): "arugula" ↔ "rocket", "eggplant" ↔ "aubergine",
//     "zucchini" ↔ "courgette". These are regional name equivalents for the same
//     preparation form — the guard must NOT apply, even when the food is "raw".
export const SYNONYM_BASE_FORM_KEYS: Set<string> = new Set(['oatmeal'])

/** Returns alternate terms for a query token, or empty array if none exist. */
export function tokenSynonyms(token: string): string[] {
  return FOOD_NAME_SYNONYMS.get(normalizeToken(token)) ?? []
}

/**
 * Like tokenHitsText, but also checks FOOD_NAME_SYNONYMS.
 * Allows "oatmeal" to match a food named "Cereals, Oats, cooked..." and
 * similar vocabulary gaps between consumer language and USDA canonical names.
 */
export function tokenHitsTextExpanded(token: string, text: string): boolean {
  if (tokenHitsText(token, text)) return true
  for (const syn of tokenSynonyms(token)) {
    if (tokenHitsText(syn, text)) return true
  }
  return false
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
//     - Multi-token query: first IDENTIFIER token must hit AND at least ceil(n/2)
//       tokens must hit. The "identifier" is the first non-stop-word token — if
//       qTokens[0] is a trivial modifier (fresh, frozen, organic, etc.), the
//       first non-modifier token is used as the anchor instead.
//       Example: "fresh jackfruit" → anchor "jackfruit" → "Jackfruit, raw" passes.
//       Brand-disambiguation is preserved: "raising" (from "Raising Cane's") is
//       not a modifier, so "Sugar Cane, Raw" still fails for "Raising Cane's".

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

  const hits = qTokens.filter(t => tokenHitsTextExpanded(t, combined))

  if (qTokens.length === 1) return hits.length >= 1

  // Multi-token: anchor (first non-modifier token) must match AND ≥ ceil(identityCount/2)
  // tokens must match, where identityCount counts only non-stop-word tokens.
  // Using identity count (not total) prevents multi-modifier queries like
  // "fresh organic spinach" (identityCount=1 → threshold=1) from failing against
  // "Spinach, raw" — the stop-word modifiers add no discriminating power to the gate.
  // tokenHitsTextExpanded: also accepts USDA canonical synonyms (e.g. "oatmeal"→"oats").
  const anchorToken = qTokens.find(t => !SCORING_STOP_WORDS.has(t)) ?? qTokens[0]
  const identityCount = qTokens.filter(t => !SCORING_STOP_WORDS.has(t)).length
  const threshold = Math.ceil(Math.max(1, identityCount) / 2)
  return tokenHitsTextExpanded(anchorToken, combined) && hits.length >= threshold
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Count meaningful words in `foodNorm` that do not appear in `queryNorm` (or its
 * plural/singular variants) and are not trivial prep-stop words.  Used to detect
 * compound dishes that happen to start with the query ingredient.
 */
function countSignificantExtraWords(foodNorm: string, queryNorm: string): number {
  const foodWords = foodNorm.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
  const queryWords = queryNorm.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
  const queryVariantSet = new Set(queryWords.flatMap(w => tokenVariants(w)))
  return foodWords.filter(w => !queryVariantSet.has(w) && !SCORING_STOP_WORDS.has(w)).length
}

/** Score how well a result matches the query. Higher = show first. */
export function scoreResult(r: ExternalFoodResult, query: string): number {
  let score = 0
  const qNorm = normalizeToken(query)
  const nameNorm = normalizeToken(r.name)
  const brandNorm = normalizeToken(r.brand ?? '')
  const combinedNorm = `${nameNorm} ${brandNorm}`.trim()

  // Name/combined match quality
  if (combinedNorm === qNorm || nameNorm === qNorm) score += 100
  else {
    // Check startsWith using plural/singular variants of the query so that
    // e.g. "Bananas, raw" correctly matches query "banana" (+80) instead of
    // falling through to contains (+60).
    const qVariants = tokenVariants(qNorm)
    const startsWithVariant = qVariants.some(
      v => combinedNorm.startsWith(v + ' ') || combinedNorm.startsWith(v + ','),
    )
    if (startsWithVariant) {
      // Guard: if the food has ≥2 significant extra words beyond the query, it is
      // likely a compound dish (e.g. "Banana Raw Almond Butter") — demote to +60
      // so a simple correct match can still win.
      const extraWords = countSignificantExtraWords(combinedNorm, qNorm)
      score += extraWords >= 2 ? 60 : 80
    } else if (combinedNorm.includes(qNorm)) {
      score += 60
    }
  }

  if (score === 0) {
    // Word coverage via variant-aware matching
    const qTokens = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2)
    if (qTokens.length > 0) {
      const matched = qTokens.filter(t => tokenHitsTextExpanded(t, r.name + ' ' + (r.brand ?? '')))
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
