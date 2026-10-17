// Semantic scoring layer on top of the base search score.
// Applies ingredient-specific bonuses/penalties to re-rank results for recipe ingredient matching.

import type { ExternalFoodResult } from '@/lib/nutrition/providers/types'
import type { FoodMatch, MatchRequest } from './types'

// Stopwords excluded from word matching
const STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'with', 'without', 'for', 'of', 'in', 'on', 'at', 'to', 'by',
])

// Size-diminutive words in a food result name that conflict with a non-diminutive query.
// When the result name contains one of these words but the query does NOT, the result
// is a materially smaller product (different calories, different portion) and should be
// strongly penalized. Example: "Snickers Minis" vs query "snickers bar".
const SIZE_DIMINUTIVE_WORDS = new Set([
  'minis', 'mini', 'miniatures',
  'fun size', 'fun-size',
  'bite size', 'bite-size', 'bites',
  'snack size', 'snack-size',
  'treat size', 'treat-size',
  'snack pack', 'snack-pack',
])

// Negative keyword pairs: if query contains word A, penalize foods containing word B
const NEGATIVE_PAIRS: [string, string[]][] = [
  ['breast',  ['thigh', 'nugget', 'wing', 'drumstick', 'ground', 'rotisserie', 'dark']],
  ['thigh',   ['breast', 'nugget', 'wing', 'drumstick', 'white']],
  ['ground',  ['roast', 'steak', 'breast', 'strip', 'fillet']],
  ['greek',   []],  // placeholder — "greek yogurt" vs "yogurt" handled by word match
  ['plain',   ['flavored', 'vanilla', 'strawberry', 'blueberry', 'cherry', 'peach', 'honey']],
  ['skim',    ['whole', '2%', 'reduced']],
  ['whole',   ['skim', 'nonfat', 'reduced']],
  ['dry',     ['cooked', 'prepared']],  // "dry pasta" vs "cooked pasta"
  ['raw',     ['cooked', 'roasted', 'fried', 'baked', 'grilled', 'smoked']],
  ['smoked',  ['raw', 'fresh']],
]

// Words that are preparation or cut modifiers — not penalized as "extra" words in the food name
const PREP_MODIFIER_WORDS = new Set([
  'raw', 'cooked', 'roasted', 'fried', 'baked', 'grilled', 'smoked', 'boiled', 'steamed',
  'frozen', 'fresh', 'dried', 'canned', 'organic', 'boneless', 'skinless', 'lean',
  'whole', 'ground', 'chopped', 'diced', 'sliced', 'minced', 'shredded',
  'large', 'medium', 'small', 'extra', 'broilers', 'fryers', 'roasters',
  'and', 'or', 'with', 'without', 'not', 'added', 'salt',
])

/** Extract significant words from a string (≥3 chars, not stopwords, lowercase) */
function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
}

/** Check if a word (or close variant) appears in the text */
function wordInText(word: string, text: string): boolean {
  const normText = text.toLowerCase()
  const normWord = word.toLowerCase()
  // Direct substring match
  if (normText.includes(normWord)) return true
  // Common plural/singular
  if (normWord.endsWith('s') && normText.includes(normWord.slice(0, -1))) return true
  if (!normWord.endsWith('s') && normText.includes(normWord + 's')) return true
  return false
}

/**
 * Apply ingredient-specific semantic scoring to search results.
 * Input: existing scored ExternalFoodResult array (already sorted by base score).
 * Output: re-scored FoodMatch array, sorted descending by matchScore.
 */
export function scoreForIngredient(
  results: ExternalFoodResult[],
  req: MatchRequest,
  baseScores?: Map<string, number>,
): FoodMatch[] {
  const queryLower = req.ingredientName.toLowerCase()
  const queryWords = significantWords(req.ingredientName)
  const foodNameLower = (name: string) => name.toLowerCase()

  // Determine prep state from query or explicit field
  const prepState = req.preparationState?.toLowerCase() ?? null
  const queryMentionsRaw     = queryLower.includes('raw')    || prepState === 'raw'
  const queryMentionsCooked  = queryLower.includes('cooked') || prepState === 'cooked'

  // Build negative keyword sets from query
  const negativeWordBlacklist = new Set<string>()
  for (const [queryWord, badWords] of NEGATIVE_PAIRS) {
    if (wordInText(queryWord, req.ingredientName)) {
      for (const bad of badWords) {
        negativeWordBlacklist.add(bad)
      }
    }
  }

  const scored: FoodMatch[] = results.map(r => {
    const base = baseScores?.get(r.externalId) ?? 0
    let score = base
    const reasons: string[] = []
    const nameLower = foodNameLower(r.name)
    const foodWords = significantWords(r.name)

    // ── Bonuses ────────────────────────────────────────────────────────────────

    // All significant query words appear in food name
    if (queryWords.length > 0 && queryWords.every(w => wordInText(w, r.name))) {
      score += 25
      reasons.push('All query words match')
    }

    // Query words appear in same relative order in food name
    if (queryWords.length >= 2) {
      let lastIdx = -1
      let inOrder = true
      for (const w of queryWords) {
        const idx = nameLower.indexOf(w)
        if (idx === -1 || idx <= lastIdx) { inOrder = false; break }
        lastIdx = idx
      }
      if (inOrder) {
        score += 10
        reasons.push('Words in same order')
      }
    }

    // USDA Foundation or SR Legacy food
    if (r.provider === 'usda_fooddata' && !r.brand) {
      score += 15
      reasons.push('USDA generic food')
    }

    // FatSecret Generic food
    if (r.isGeneric) {
      score += 8
      reasons.push('Generic food')
    }

    // No brand when query has no brand indicators
    const queryHasBrand = /[A-Z]/.test(req.ingredientName.split(' ').slice(-1)[0] ?? '') ||
      req.ingredientName.includes('brand')
    if (!r.brand && !queryHasBrand) {
      score += 8
      reasons.push('Unbranded matches unbranded query')
    }

    // Preparation state alignment
    if (queryMentionsRaw && nameLower.includes('raw')) {
      score += 12
      reasons.push('Prep state: raw matches')
    } else if (queryMentionsCooked && nameLower.includes('cooked')) {
      score += 12
      reasons.push('Prep state: cooked matches')
    } else if (!queryMentionsRaw && !queryMentionsCooked && nameLower.includes('raw')) {
      // Prefer raw for unspecified queries (raw data is more useful as a base)
      score += 5
      reasons.push('Default prefer raw')
    }

    // ── Penalties ──────────────────────────────────────────────────────────────

    // Extra significant words in food name that don't appear in query AND not prep/cut modifiers
    const extraWords = foodWords.filter(
      w => !wordInText(w, req.ingredientName) && !PREP_MODIFIER_WORDS.has(w),
    )
    if (extraWords.length > 0) {
      const penalty = Math.min(extraWords.length * 2, 15)
      score -= penalty
      if (penalty > 0) reasons.push(`Extra words penalty: -${penalty}`)
    }

    // Food has a brand that is NOT mentioned in the query
    if (r.brand && !wordInText(r.brand, req.ingredientName)) {
      score -= 8
      reasons.push('Branded food not mentioned in query')
    }

    // Negative keyword: query mentions specific cut/type, food name contains conflicting word
    for (const bad of negativeWordBlacklist) {
      if (wordInText(bad, r.name)) {
        score -= 30
        reasons.push(`Negative keyword conflict: ${bad}`)
        break  // Only apply once
      }
    }

    // Size-diminutive conflict: result is a smaller product variant (minis, fun size, bites,
    // etc.) but the query does not request a diminutive form. Prevents "Snickers Minis" from
    // ranking above "Snickers Bar" when the user just asks for "snickers".
    // Multi-word phrases are checked against the full name string; single words use wordInText.
    const nameLowerForDim = nameLower
    let hasDiminutiveConflict = false
    for (const dim of SIZE_DIMINUTIVE_WORDS) {
      const dimInResult = dim.includes(' ')
        ? nameLowerForDim.includes(dim)
        : wordInText(dim, r.name)
      const dimInQuery = dim.includes(' ')
        ? queryLower.includes(dim)
        : wordInText(dim, req.ingredientName)
      if (dimInResult && !dimInQuery) {
        hasDiminutiveConflict = true
        break
      }
    }
    if (hasDiminutiveConflict) {
      score -= 25
      reasons.push('Size-diminutive conflict: result is a smaller variant not requested')
    }

    const match: FoodMatch = {
      provider: r.provider,
      externalId: r.externalId,
      internalId: r.internalId,
      name: r.name,
      brand: r.brand,
      servingSize: r.servingSize,
      servingUnit: r.servingUnit,
      householdUnit: r.householdUnit,
      unitsPerServing: r.unitsPerServing,
      householdServingText: r.householdServingText,
      calories: r.coreNutrients.calories,
      proteinG: r.coreNutrients.proteinG,
      carbohydrateG: r.coreNutrients.carbohydrateG,
      fatG: r.coreNutrients.fatG,
      isGeneric: r.isGeneric ?? false,
      fdcDataType: r.fdcDataType,
      servingSizeIsEstimated: r.servingSizeIsEstimated,
      matchScore: score,
      matchReasons: reasons,
    }

    return match
  })

  return scored.sort((a, b) => b.matchScore - a.matchScore)
}
