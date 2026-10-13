import type { Decimal } from '@prisma/client/runtime/library'

export interface IngredientNutrition {
  foodItemId: string | null
  quantity: Decimal
  unit: string
  snapshotCalories: Decimal | null
  snapshotProteinG: Decimal | null
  snapshotCarbG: Decimal | null
  snapshotFatG: Decimal | null
}

export interface RecipeNutritionResult {
  complete: boolean
  unresolvedCount: number
  totalCount: number
  // null when any ingredient is unresolved
  calPerServing: number | null
  proteinGPerServing: number | null
  carbGPerServing: number | null
  fatGPerServing: number | null
}

// A macro snapshot value is valid when it is a finite, non-negative number.
// Null means the snapshot was never populated.
function isValidMacro(v: Decimal | null): boolean {
  if (v === null) return false
  const n = Number(v)
  return Number.isFinite(n) && n >= 0
}

// Whether an ingredient has a complete, usable nutrition snapshot.
// foodItemId is intentionally NOT checked — an ingredient sourced from an
// external provider (no DB link) with valid snapshot macros IS resolved.
export function isIngredientResolved(
  ing: Pick<IngredientNutrition, 'snapshotCalories' | 'snapshotProteinG' | 'snapshotCarbG' | 'snapshotFatG'>,
): boolean {
  return (
    isValidMacro(ing.snapshotCalories) &&
    isValidMacro(ing.snapshotProteinG) &&
    isValidMacro(ing.snapshotCarbG) &&
    isValidMacro(ing.snapshotFatG)
  )
}

export function computeRecipeNutrition(
  ingredients: IngredientNutrition[],
  servings: number,
): RecipeNutritionResult {
  const total = ingredients.length
  const unresolved = ingredients.filter((i) => !isIngredientResolved(i)).length

  if (unresolved > 0 || total === 0) {
    return {
      complete: false,
      unresolvedCount: unresolved,
      totalCount: total,
      calPerServing: null,
      proteinGPerServing: null,
      carbGPerServing: null,
      fatGPerServing: null,
    }
  }

  const safeServings = servings > 0 ? servings : 1

  let cal = 0, pro = 0, carb = 0, fat = 0
  for (const ing of ingredients) {
    cal  += Number(ing.snapshotCalories!)
    pro  += Number(ing.snapshotProteinG!)
    carb += Number(ing.snapshotCarbG!)
    fat  += Number(ing.snapshotFatG!)
  }

  return {
    complete: true,
    unresolvedCount: 0,
    totalCount: total,
    calPerServing:      round2(cal  / safeServings),
    proteinGPerServing: round3(pro  / safeServings),
    carbGPerServing:    round3(carb / safeServings),
    fatGPerServing:     round3(fat  / safeServings),
  }
}

function round2(n: number) { return Math.round(n * 100) / 100 }
function round3(n: number) { return Math.round(n * 1000) / 1000 }

// ── Unit conversion sets (shared between server and client helpers) ────────────

const SERVING_ALIASES = new Set(['serving', 'servings', 'portion', 'portions'])
const GRAM_UNITS      = new Set(['g', 'gram', 'grams'])
const ML_UNITS        = new Set(['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'])
const OZ_UNITS        = new Set(['oz', 'ounce', 'ounces'])
const LB_UNITS        = new Set(['lb', 'lbs', 'pound', 'pounds'])
const CUP_UNITS       = new Set(['cup', 'cups'])
const TBSP_UNITS      = new Set(['tbsp', 'tablespoon', 'tablespoons'])
const TSP_UNITS       = new Set(['tsp', 'teaspoon', 'teaspoons'])

// Computes the multiplicative factor to scale a food's per-serving nutrition
// by the given ingredient quantity and unit. Returns null for unsupported
// or incompatible unit combinations — never guesses.
// This is pure (no Decimal dependency) so it can be used on the client too.
export function computeIngredientFactor(
  servingSize: number,
  servingUnit: string,
  quantity: number,
  unit: string,
): number | null {
  if (servingSize <= 0 || quantity <= 0) return null

  const fu = servingUnit.toLowerCase().trim()
  const iu = unit.toLowerCase().trim()

  const sameUnit =
    fu === iu ||
    (SERVING_ALIASES.has(fu) && SERVING_ALIASES.has(iu))

  if (sameUnit) return quantity / servingSize
  if (GRAM_UNITS.has(iu) && GRAM_UNITS.has(fu))    return quantity / servingSize
  if (ML_UNITS.has(iu)   && ML_UNITS.has(fu))      return quantity / servingSize
  if (OZ_UNITS.has(iu)   && GRAM_UNITS.has(fu))    return (quantity * 28.3495)  / servingSize
  if (LB_UNITS.has(iu)   && GRAM_UNITS.has(fu))    return (quantity * 453.592)  / servingSize
  if (CUP_UNITS.has(iu)  && ML_UNITS.has(fu))      return (quantity * 236.588)  / servingSize
  if (TBSP_UNITS.has(iu) && ML_UNITS.has(fu))      return (quantity * 14.7868)  / servingSize
  if (TSP_UNITS.has(iu)  && ML_UNITS.has(fu))      return (quantity * 4.92892)  / servingSize

  return null
}

// Compute per-ingredient contribution given a FoodItem's nutrition and
// the ingredient's quantity/unit relative to the food item's serving.
// Returns { calories, proteinG, carbG, fatG } or null if unit is unknown.
export interface FoodItemServing {
  calories: Decimal
  proteinG: Decimal
  carbohydrateG: Decimal
  fatG: Decimal
  servingSize: Decimal
  servingUnit: string
}

export function ingredientNutritionFromFood(
  food: FoodItemServing,
  ingredientQty: number,
  ingredientUnit: string,
): { calories: number; proteinG: number; carbG: number; fatG: number } | null {
  const factor = computeIngredientFactor(
    Number(food.servingSize),
    food.servingUnit,
    ingredientQty,
    ingredientUnit,
  )
  if (factor === null) return null

  return {
    calories: round2(Number(food.calories)       * factor),
    proteinG: round3(Number(food.proteinG)        * factor),
    carbG:    round3(Number(food.carbohydrateG)   * factor),
    fatG:     round3(Number(food.fatG)            * factor),
  }
}
