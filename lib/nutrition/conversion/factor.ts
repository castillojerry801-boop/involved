import type { Decimal } from '@prisma/client/runtime/library'
import type { ConversionSource } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ConversionResult, ConversionError } from './types'
import type { StoredPortion } from './portions'
import { fetchAndStoreUsdaPortions, lookupPortions } from './portions'
import {
  SERVING_ALIASES,
  GRAM_UNITS,
  ML_UNITS,
  OZ_UNITS,
  LB_UNITS,
  KG_UNITS,
  L_UNITS,
  CUP_UNITS,
  TBSP_UNITS,
  TSP_UNITS,
  FL_OZ_UNITS,
  CLOVE_UNITS,
  SLICE_UNITS,
  PIECE_UNITS,
  FOOD_COUNT_NOUNS,
  weightToGrams,
  volumeToMl,
  normalizeUnit,
} from './units'

export interface FoodForConversion {
  id: string
  servingSize: Decimal
  servingUnit: string
  calories: Decimal
  proteinG: Decimal
  carbohydrateG: Decimal
  fatG: Decimal
  householdUnit?: string | null
  unitsPerServing?: Decimal | null
  /** Human-readable serving description from the provider (e.g. "1 strip", "3 slices", "1 large"). */
  householdServingText?: string | null
  sourceProvider?: string | null
  externalId?: string | null
  fdcDataType?: string | null
  // Pre-fetched portions — pass [] if not pre-fetched, engine will query DB
  portions?: StoredPortion[]
}

// All recognized unit sets for "unknown unit" detection.
const ALL_KNOWN_UNITS = new Set([
  ...SERVING_ALIASES,
  ...GRAM_UNITS,
  ...ML_UNITS,
  ...OZ_UNITS,
  ...LB_UNITS,
  ...KG_UNITS,
  ...L_UNITS,
  ...CUP_UNITS,
  ...TBSP_UNITS,
  ...TSP_UNITS,
  ...FL_OZ_UNITS,
  ...CLOVE_UNITS,
  ...SLICE_UNITS,
  ...PIECE_UNITS,
  ...FOOD_COUNT_NOUNS,
])

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// Check if the food name suggests cooked/prepared state.
function foodNameIsCookedOrPrepared(foodId: string, food: FoodForConversion): boolean {
  // We don't have the food name here directly, but we can check a side-channel.
  // The caller must pass the name hint — we'll check via a convention.
  // Actually FoodForConversion doesn't have `name`. We'll handle this in the caller
  // by checking a `_name` hint if provided.
  return false
}

// Resolves what factor to multiply food.macros by to get this ingredient's macros.
export async function resolveIngredientFactor(
  food: FoodForConversion & { name?: string },
  quantity: number,
  unit: string,
  opts?: { preparationState?: string },
): Promise<ConversionResult | ConversionError> {
  if (quantity <= 0 || Number(food.servingSize) <= 0) {
    return {
      kind: 'conversion_error',
      errorCode: 'unit_incompatible',
      message: 'Quantity and serving size must be positive',
    }
  }

  const iu = normalizeUnit(unit)
  const fu = normalizeUnit(food.servingUnit)
  const servingSize = Number(food.servingSize)
  const notes: string[] = []

  // ── Step 1: Same unit as food.servingUnit ────────────────────────────────────
  if (fu === iu) {
    const grams = GRAM_UNITS.has(fu)
      ? quantity
      : ML_UNITS.has(fu)
      ? quantity  // ml-basis, grams = quantity (semantically it's ml but we store as "grams")
      : quantity  // serving-unit basis
    const factor = quantity / servingSize
    return {
      grams,
      factor,
      conversionSource: 'same_unit',
      portionDescription: `${quantity} ${unit}`,
      confidence: 'high',
      notes,
    }
  }

  // ── Step 2: Serving alias ────────────────────────────────────────────────────
  if (SERVING_ALIASES.has(iu)) {
    // N servings = N × base nutrition, grams = N × servingSize (if gram-basis)
    const grams = GRAM_UNITS.has(fu) ? quantity * servingSize : quantity * servingSize
    return {
      grams,
      factor: quantity,
      conversionSource: 'same_unit',
      portionDescription: `${quantity} serving${quantity !== 1 ? 's' : ''}`,
      confidence: 'high',
      notes,
    }
  }

  // ── Step 3: Weight → weight (oz/lb input, g food) ────────────────────────────
  if (GRAM_UNITS.has(fu)) {
    const grams = weightToGrams(quantity, iu)
    if (grams !== null) {
      const factor = grams / servingSize
      // Check if food name suggests cooked/prepared state
      if (food.name && /cooked|prepared/i.test(food.name)) {
        notes.push('Reference food may be cooked; raw weight used — macros may be overstated')
      }
      return {
        grams,
        factor,
        conversionSource: 'same_unit',
        portionDescription: `${quantity} ${unit} (${round3(grams)}g)`,
        confidence: 'high',
        notes,
      }
    }
  }

  // ── Step 4: Volume → volume (cup/tbsp/tsp/ml input, ml food) ─────────────────
  if (ML_UNITS.has(fu)) {
    const ml = volumeToMl(quantity, iu)
    if (ml !== null) {
      const factor = ml / servingSize
      return {
        grams: ml, // ml-basis food: "grams" field stores ml
        factor,
        conversionSource: 'same_unit',
        portionDescription: `${quantity} ${unit} (${round3(ml)}ml)`,
        confidence: 'high',
        notes,
      }
    }
  }

  // ── Step 5: householdUnit match (FoodItem.householdUnit) ─────────────────────
  if (
    food.householdUnit &&
    food.unitsPerServing != null &&
    Number(food.unitsPerServing) > 0
  ) {
    const hUnit = normalizeUnit(food.householdUnit)
    if (iu === hUnit) {
      const unitsPerServing = Number(food.unitsPerServing)
      const factor = quantity / unitsPerServing
      const grams = GRAM_UNITS.has(fu) ? factor * servingSize : factor * servingSize
      return {
        grams,
        factor,
        conversionSource: 'manufacturer_declared',
        portionDescription: `${quantity} ${unit}`,
        confidence: 'high',
        notes,
      }
    }
  }

  // ── Step 5b: householdServingText count-unit resolution (FatSecret fallback) ──
  // Fires when:
  //   - food.householdServingText is populated (typically from FatSecret detail fetch)
  //   - inputUnit is a count unit (piece/slice/strip/egg/tortilla/etc.)
  //   - the serving text contains a count word that semantically matches the input unit
  //
  // FatSecret serving descriptions look like "1 strip", "1 large", "3 slices", "2 tortillas".
  // We parse the leading "N word" and match word against the input unit.
  //
  // IMPORTANT: "1 serving" alone does NOT count as a match — the description must
  // contain a count noun so we never universally assume 1 piece = 1 serving.
  const isCountUnitInput =
    PIECE_UNITS.has(iu) || SLICE_UNITS.has(iu) || FOOD_COUNT_NOUNS.has(iu)

  if (isCountUnitInput && food.householdServingText) {
    const servingTextResult = resolveFromServingText(
      food as FoodForConversion & { householdServingText: string },
      quantity,
      iu,
      notes,
    )
    if (servingTextResult) return servingTextResult
  }

  // ── Step 6: FoodItemPortion lookup in DB ─────────────────────────────────────
  // First check pre-fetched portions, then fall back to DB query
  let dbPortions: StoredPortion[]
  if (food.portions !== undefined) {
    // Filter pre-fetched portions by unit (and optionally preparationState)
    const normalizedPortionUnit = normalizeUnit(iu)
    dbPortions = food.portions.filter((p) => normalizeUnit(p.unit) === normalizedPortionUnit)
    if (opts?.preparationState) {
      dbPortions = dbPortions.filter((p) => p.preparationState === opts.preparationState)
    }
  } else {
    dbPortions = await lookupPortions(food.id, iu, opts?.preparationState)
  }

  if (dbPortions.length > 0) {
    const result = resolveFromPortions(food, quantity, iu, dbPortions, opts?.preparationState, notes)
    if (result) return result
  }

  // ── Step 6b: Broadened count-unit DB lookup ──────────────────────────────────
  // When iu is a generic count unit ('piece', 'slice', or a food-specific noun)
  // and the exact-match DB lookup returned nothing, try fetching ALL portions for
  // this food and use any non-weight/non-volume portion. This handles the case
  // where portions are already stored in DB with food-specific unit names (e.g.
  // 'egg', 'strip', 'tortilla') from a prior USDA fetch but the user typed 'piece'
  // or 'slice'. Skipped when food.portions is pre-fetched (handled inline above).
  //
  // Safety: if multiple semantically distinct count portions exist (gramWeight
  // spread > 30%), return ConversionError(unit_unknown) listing the options
  // rather than silently picking the first.
  const _isCountUnit6 = PIECE_UNITS.has(iu) || FOOD_COUNT_NOUNS.has(iu)
  const _isSliceUnit6 = SLICE_UNITS.has(iu)
  if ((_isCountUnit6 || _isSliceUnit6) && food.portions === undefined) {
    const allPortions = await prisma.foodItemPortion.findMany({ where: { foodItemId: food.id } })
    if (allPortions.length > 0) {
      const weightUnitSet6 = new Set([...GRAM_UNITS, ...OZ_UNITS, ...LB_UNITS, ...KG_UNITS])
      const volumeUnitSet6 = new Set([...ML_UNITS, ...L_UNITS, ...CUP_UNITS, ...TBSP_UNITS, ...TSP_UNITS, ...FL_OZ_UNITS])
      const countPortions6 = allPortions.filter((p) => {
        const pu = normalizeUnit(p.unit)
        return !weightUnitSet6.has(pu) && !volumeUnitSet6.has(pu) && !SERVING_ALIASES.has(pu)
      })
      if (countPortions6.length > 0) {
        const mapped6: StoredPortion[] = countPortions6.map((p) => ({
          id: p.id,
          portionDescription: p.portionDescription,
          quantity: Number(p.quantity),
          unit: p.unit,
          gramWeight: Number(p.gramWeight),
          fdcPortionId: p.fdcPortionId,
          sourceConfidence: p.sourceConfidence,
          preparationState: p.preparationState,
        }))
        const prepFiltered6 = opts?.preparationState
          ? mapped6.filter((p) => p.preparationState === opts.preparationState)
          : mapped6
        const candidates6 = prepFiltered6.length > 0 ? prepFiltered6 : mapped6

        // Safety check: if multiple count portions have divergent gramWeights (> 30%
        // spread), they are semantically distinct and we must not silently pick one.
        if (candidates6.length > 1) {
          const gramWeights6 = candidates6.map((p) => p.gramWeight / (p.quantity || 1))
          const maxGw6 = Math.max(...gramWeights6)
          const minGw6 = Math.min(...gramWeights6)
          if (maxGw6 / minGw6 > 1.30) {
            const options6 = candidates6.map((p) => `"${p.portionDescription}" (${p.gramWeight}g)`).join(', ')
            return {
              kind: 'conversion_error',
              errorCode: 'unit_unknown',
              message: `Multiple different count portions found for "${unit}": ${options6}. Specify which you mean.`,
              suggestions: candidates6.map((p) => p.portionDescription),
            }
          }
          // All similar — use the first, add a note
          notes.push(`Using "${candidates6[0].portionDescription}" as count portion`)
        }

        const result6 = resolveFromPortions(food, quantity, iu, candidates6, opts?.preparationState, notes)
        if (result6) {
          if (candidates6.length === 1) {
            notes.push(`Matched "${unit}" to stored portion "${countPortions6[0].unit}"`)
          }
          return result6
        }
      }
    }
  }

  // ── Step 7: USDA Foundation/SR Legacy — fetch portions then retry ────────────
  if (
    food.sourceProvider === 'usda_fooddata' &&
    food.externalId &&
    (food.fdcDataType === 'Foundation' || food.fdcDataType === 'SR Legacy')
  ) {
    const fetched = await fetchAndStoreUsdaPortions(
      food.id,
      food.externalId,
      food.fdcDataType,
    )

    if (fetched.length > 0) {
      const matching = fetched.filter((p) => normalizeUnit(p.unit) === iu)
      const filtered = opts?.preparationState
        ? matching.filter((p) => p.preparationState === opts.preparationState)
        : matching
      const result = resolveFromPortions(food, quantity, iu, filtered.length > 0 ? filtered : matching, opts?.preparationState, notes)
      if (result) return result

      // ── Broadened count-unit fallback ──────────────────────────────────────
      // USDA stores household portions with food-specific unit names (e.g. "egg",
      // "tortilla", "strip") rather than the generic "piece" or "slice" the user
      // types. When iu is a count unit (piece/pieces or a FOOD_COUNT_NOUNS member)
      // or a slice unit, fall back to any non-weight/non-volume USDA portion.
      // This covers: "3 piece eggs" → USDA egg has unit="egg" → use it.
      //              "3 slice bacon" → USDA bacon has unit="strip" → use it.
      //              "1 piece tortilla" → USDA tortilla has unit="tortilla" → use it.
      //
      // Safety: if multiple semantically distinct count portions exist (gramWeight
      // spread > 30%), return ConversionError(unit_unknown) listing the options.
      const isCountUnit = PIECE_UNITS.has(iu) || FOOD_COUNT_NOUNS.has(iu)
      const isSliceUnit = SLICE_UNITS.has(iu)
      if (isCountUnit || isSliceUnit) {
        const weightUnitSet = new Set([...GRAM_UNITS, ...OZ_UNITS, ...LB_UNITS, ...KG_UNITS])
        const volumeUnitSet = new Set([...ML_UNITS, ...L_UNITS, ...CUP_UNITS, ...TBSP_UNITS, ...TSP_UNITS, ...FL_OZ_UNITS])
        const countPortions = fetched.filter((p) => {
          const pu = normalizeUnit(p.unit)
          return !weightUnitSet.has(pu) && !volumeUnitSet.has(pu) && !SERVING_ALIASES.has(pu)
        })
        if (countPortions.length > 0) {
          const prepFiltered = opts?.preparationState
            ? countPortions.filter((p) => p.preparationState === opts.preparationState)
            : countPortions
          const candidates = prepFiltered.length > 0 ? prepFiltered : countPortions

          // Safety check: divergent gramWeights → ambiguous, refuse to silently pick
          if (candidates.length > 1) {
            const gramWeights = candidates.map((p) => p.gramWeight / (p.quantity || 1))
            const maxGw = Math.max(...gramWeights)
            const minGw = Math.min(...gramWeights)
            if (maxGw / minGw > 1.30) {
              const options = candidates.map((p) => `"${p.portionDescription}" (${p.gramWeight}g)`).join(', ')
              return {
                kind: 'conversion_error',
                errorCode: 'unit_unknown',
                message: `Multiple different count portions found for "${unit}": ${options}. Specify which you mean.`,
                suggestions: candidates.map((p) => p.portionDescription),
              }
            }
            // All similar — use the first, add a note
            notes.push(`Using "${candidates[0].portionDescription}" as count portion`)
          }

          const broadResult = resolveFromPortions(food, quantity, iu, candidates, opts?.preparationState, notes)
          if (broadResult) {
            if (candidates.length === 1) {
              notes.push(`Matched "${unit}" to USDA portion "${countPortions[0].unit}"`)
            }
            return broadResult
          }
        }
      }
    }
  }

  // ── Step 8: ConversionError ──────────────────────────────────────────────────
  // Determine the best error code
  if (!ALL_KNOWN_UNITS.has(iu)) {
    return {
      kind: 'conversion_error',
      errorCode: 'unit_unknown',
      message: `Unrecognized unit: "${unit}"`,
      suggestions: ['Use a standard unit such as g, oz, lb, cup, tbsp, tsp, ml, serving'],
    }
  }

  // Volume unit for a gram-basis food with no portion data
  const isVolumeUnit = CUP_UNITS.has(iu) || TBSP_UNITS.has(iu) || TSP_UNITS.has(iu) || ML_UNITS.has(iu) || FL_OZ_UNITS.has(iu)
  if (isVolumeUnit && GRAM_UNITS.has(fu)) {
    return {
      kind: 'conversion_error',
      errorCode: 'unit_incompatible',
      message: `Cannot convert volume unit "${unit}" to gram-basis food without density data`,
      suggestions: ['Use a weight unit (g, oz, lb) or provide a portion entry for this food'],
    }
  }

  // Weight unit for a volume-basis food
  const isWeightUnit = GRAM_UNITS.has(iu) || OZ_UNITS.has(iu) || LB_UNITS.has(iu)
  if (isWeightUnit && ML_UNITS.has(fu)) {
    return {
      kind: 'conversion_error',
      errorCode: 'unit_incompatible',
      message: `Cannot convert weight unit "${unit}" to ml-basis food without density data`,
      suggestions: ['Use a volume unit (ml, cup, tbsp, tsp) or provide a portion entry for this food'],
    }
  }

  // Incompatible weight units (e.g. entering "g" for an oz-basis food, or "oz" for a gram-basis food
  // where no portion exists). These are recognized units but cannot be cross-converted without a
  // density or lookup. Distinct from unit_unknown — the unit IS valid, just incompatible with this food.
  const isFoodWeightBasis = OZ_UNITS.has(fu) || LB_UNITS.has(fu)
  if (isWeightUnit && isFoodWeightBasis) {
    const foodUnitLabel = OZ_UNITS.has(fu) ? 'oz' : 'lb'
    return {
      kind: 'conversion_error',
      errorCode: 'unit_incompatible',
      message: `This food is stored in ${foodUnitLabel} — use ${foodUnitLabel} or lb/oz directly`,
      suggestions: [`Use ${foodUnitLabel} as the unit for this food`],
    }
  }

  // Volume unit for a non-ml-basis, non-gram-basis food (e.g. oz-basis food with volume input)
  if (isVolumeUnit && isFoodWeightBasis) {
    return {
      kind: 'conversion_error',
      errorCode: 'unit_incompatible',
      message: `Cannot convert volume unit "${unit}" to ${OZ_UNITS.has(fu) ? 'oz' : 'lb'}-basis food without density data`,
      suggestions: ['Use a weight unit (oz, lb) or provide a portion entry for this food'],
    }
  }

  // Household/count unit not found
  return {
    kind: 'conversion_error',
    errorCode: 'portion_not_found',
    message: `No portion data found for unit "${unit}" and food`,
    suggestions: ['Add a portion entry for this food, or use a weight/volume unit'],
  }
}

// Size qualifiers that appear in FatSecret's serving_description but are not count nouns.
// e.g. "1 large" means 1 unit (where the size is baked into the serving size).
const SIZE_QUALIFIER_WORDS = new Set([
  'large', 'medium', 'small', 'xl', 'jumbo', 'extra large', 'extra-large',
  'mini', 'regular', 'standard',
])

// Blacklisted non-count serving words that must not be treated as count units.
// e.g. "1 serving" → cannot infer unit type.
const NON_COUNT_WORDS = new Set([
  'serving', 'servings', 'portion', 'portions',
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons',
  'tsp', 'teaspoon', 'teaspoons', 'oz', 'ounce', 'ounces',
  'g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters',
  'lb', 'lbs', 'pound', 'pounds',
])

/**
 * Normalize a unit string for serving-description matching.
 * Strips trailing 's' for plural handling: "strips" → "strip", "slices" → "slice".
 * Only strips if the result is still >= 3 chars (prevents "eggs" → "egg" → "eg" etc.).
 * Final step is normalizeUnit (lowercase + trim).
 */
function normForServingMatch(w: string): string {
  const lower = w.toLowerCase().trim()
  // Strip trailing 's' for common plurals if result stays >= 3 chars
  if (lower.endsWith('s') && lower.length > 3) {
    return normalizeUnit(lower.slice(0, -1))
  }
  return normalizeUnit(lower)
}

/**
 * Resolve a count unit from a FatSecret-style householdServingText.
 *
 * Returns a ConversionResult when:
 *   1. servingText starts with "N word" or "N words"
 *   2. `word` (after plural-stripping) matches `iu` (after plural-stripping), OR
 *      `word` is a size qualifier (large/medium/small/etc.) AND `iu` is a
 *      generic count unit (piece/pieces or a FOOD_COUNT_NOUNS member), OR
 *      `iu` is a generic count unit (piece/each) AND the serving word is a food
 *      count noun in FOOD_COUNT_NOUNS (e.g. "piece" + "tortilla" → match).
 *
 * Returns null when the serving text cannot be matched — e.g. "1 serving",
 * "100g", "1/4 cup" — allowing the pipeline to continue to Step 6.
 */
function resolveFromServingText(
  food: FoodForConversion & { householdServingText: string },
  quantity: number,
  iu: string,
  notes: string[],
): ConversionResult | null {
  const servingText = food.householdServingText.trim()

  // Parse leading "N word" pattern (integer or decimal, including fractions like 1/4)
  const match = servingText.match(/^(\d+(?:[./]\d+)?)\s+(.+)$/)
  if (!match) return null

  const servingCountStr = match[1]
  const servingWordRaw = match[2].toLowerCase().trim()

  // Resolve fractional notation like "1/4"
  let servingCount: number
  if (servingCountStr.includes('/')) {
    const [num, den] = servingCountStr.split('/')
    servingCount = parseFloat(num) / parseFloat(den)
  } else {
    servingCount = parseFloat(servingCountStr)
  }
  if (!servingCount || servingCount <= 0) return null

  // For multi-word descriptions, check if the FIRST word is blacklisted.
  // e.g. "serving of oats" → first word "serving" is blacklisted → reject.
  // Single-word check is done below as before.
  const words = servingWordRaw.split(/\s+/)
  const firstWord = words[0]
  const lastWord  = words[words.length - 1]
  if (NON_COUNT_WORDS.has(firstWord)) return null

  // Reject non-count words immediately (single-word case)
  if (NON_COUNT_WORDS.has(servingWordRaw)) return null

  // Normalize both sides using the same plural-aware normalizer
  const normWord     = normForServingMatch(servingWordRaw)
  const normIu       = normForServingMatch(iu)
  const normFirstWord = normForServingMatch(firstWord)
  const normLastWord  = normForServingMatch(lastWord)
  const isSizeQualifier = SIZE_QUALIFIER_WORDS.has(servingWordRaw)

  // Match condition 1: direct unit match (e.g. "strip" input vs "1 strip" description)
  const isDirectMatch = normIu === normWord

  // Match condition 2: size qualifier + generic count input (single-word)
  // e.g. "1 large" + inputUnit='piece' → treat as 1 piece = 1 serving
  const isPieceUnit = PIECE_UNITS.has(normIu) || normIu === 'piece'
  const isSizeMatch = isSizeQualifier && (isPieceUnit || FOOD_COUNT_NOUNS.has(normIu))

  // Match condition 3: generic count input (piece) + serving word is a food count noun (single-word)
  // e.g. 'piece' + "2 tortillas" → piece matches because 'tortilla' ∈ FOOD_COUNT_NOUNS
  // This enables "1 piece tortilla" to resolve via "2 tortillas" serving description.
  const isFoodNounServing =
    (FOOD_COUNT_NOUNS.has(normWord) || FOOD_COUNT_NOUNS.has(servingWordRaw)) &&
    (isPieceUnit || SLICE_UNITS.has(normIu))

  // Match condition 4 (multi-word): last word is a food count noun, and either:
  //   a) last word matches input unit (e.g. "2 flour tortillas" + iu='tortilla')
  //   b) input is a generic count unit (piece/each) + last word is any food noun
  //      (e.g. "1 large egg" + iu='piece')
  const lastWordMatchesIu = normLastWord === normIu || lastWord === iu.toLowerCase().trim()
  const isMultiWordFoodNoun = words.length > 1 && (
    FOOD_COUNT_NOUNS.has(normLastWord) || FOOD_COUNT_NOUNS.has(lastWord)
  ) && (lastWordMatchesIu || isPieceUnit || SLICE_UNITS.has(normIu))

  // Match condition 5 (multi-word with "of"): first word of phrase matches input unit
  // e.g. "3 slices of bacon" + inputUnit='slice' → "slice" matches first word "slices"
  const isFirstWordMatch = words.length > 1 && normIu === normFirstWord

  if (!isDirectMatch && !isSizeMatch && !isFoodNounServing && !isMultiWordFoodNoun && !isFirstWordMatch) return null

  // For match-reason labeling
  const isMultiWordMatch = isMultiWordFoodNoun || isFirstWordMatch

  const servingSize = Number(food.servingSize)
  if (servingSize <= 0) return null

  // servingCount units = 1 serving
  // inputQuantity units = (inputQuantity / servingCount) servings
  const factor = quantity / servingCount
  const grams = factor * servingSize

  let matchReason: string
  if (isDirectMatch) {
    matchReason = `"${servingWordRaw}" matches input unit "${iu}"`
  } else if (isSizeMatch) {
    matchReason = `size qualifier "${servingWordRaw}" matched to count unit "${iu}"`
  } else if (isFirstWordMatch) {
    matchReason = `first word "${firstWord}" of "${servingWordRaw}" matches input unit "${iu}"`
  } else if (isMultiWordMatch) {
    matchReason = `food noun "${lastWord}" (in "${servingWordRaw}") matched to generic count unit "${iu}"`
  } else {
    matchReason = `food noun "${servingWordRaw}" matched to generic count unit "${iu}"`
  }

  notes.push(`Resolved via serving description: "${servingText}" (${matchReason})`)

  return {
    grams,
    factor,
    conversionSource: 'manufacturer_declared',
    portionDescription: `${quantity} ${iu} via "${servingText}"`,
    confidence: 'medium',
    notes,
  }
}

// Resolve a factor from a set of DB portions for the given unit and quantity.
// Returns null if ambiguous preparation state (caller should handle).
function resolveFromPortions(
  food: FoodForConversion,
  quantity: number,
  iu: string,
  portions: StoredPortion[],
  requestedPrep: string | undefined,
  notes: string[],
): ConversionResult | ConversionError | null {
  if (portions.length === 0) return null

  // Check for ambiguous preparation state
  if (!requestedPrep) {
    const prepStates = new Set(portions.map((p) => p.preparationState))
    // Multiple distinct non-null prep states → ambiguous
    const nonNullPreps = [...prepStates].filter((s) => s !== null)
    if (nonNullPreps.length > 1) {
      return {
        kind: 'conversion_error',
        errorCode: 'ambiguous_preparation',
        message: `Multiple preparation states found for unit "${iu}": ${nonNullPreps.join(', ')}. Specify preparationState.`,
        suggestions: nonNullPreps.map((s) => `Specify preparationState: ${s}`),
      }
    }
  }

  // Use the best matching portion (first after sort)
  const portion = portions[0]
  const servingSize = Number(food.servingSize)
  const fu = normalizeUnit(food.servingUnit)

  // gramWeight in DB is grams per portion.quantity of the unit
  // e.g. { quantity: 1, unit: 'clove', gramWeight: 3 } → 1 clove = 3g
  const gramsPerUnit = portion.gramWeight / (portion.quantity || 1)
  const grams = gramsPerUnit * quantity

  let factor: number
  if (GRAM_UNITS.has(fu)) {
    factor = grams / servingSize
  } else if (ML_UNITS.has(fu)) {
    // For ml-basis foods, gram weight of portions is still in grams —
    // this would require density to convert. But if the portion itself is a volume unit
    // stored as gramWeight, we trust it directly.
    factor = grams / servingSize
  } else {
    factor = grams / servingSize
  }

  const sourceConfidence = portion.sourceConfidence
  let conversionSource: ConversionSource
  if (sourceConfidence === 'usda_measured') {
    conversionSource = 'usda_measured'
    notes.push('USDA portion data')
  } else if (sourceConfidence === 'manufacturer_declared') {
    conversionSource = 'manufacturer_declared'
  } else if (sourceConfidence === 'density_derived') {
    conversionSource = 'density_derived'
  } else {
    conversionSource = 'reference_table'
  }

  const confidence: 'high' | 'medium' | 'low' =
    sourceConfidence === 'usda_measured' || sourceConfidence === 'manufacturer_declared'
      ? 'high'
      : sourceConfidence === 'density_derived'
      ? 'medium'
      : 'low'

  return {
    grams,
    factor,
    conversionSource,
    portionDescription: `${quantity} ${portion.unit} (${round3(grams)}g)`,
    confidence,
    preparationState: portion.preparationState ?? undefined,
    notes,
  }
}
