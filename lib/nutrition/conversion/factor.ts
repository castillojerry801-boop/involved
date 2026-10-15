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
  CUP_UNITS,
  TBSP_UNITS,
  TSP_UNITS,
  FL_OZ_UNITS,
  CLOVE_UNITS,
  SLICE_UNITS,
  PIECE_UNITS,
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
  ...CUP_UNITS,
  ...TBSP_UNITS,
  ...TSP_UNITS,
  ...FL_OZ_UNITS,
  ...CLOVE_UNITS,
  ...SLICE_UNITS,
  ...PIECE_UNITS,
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
