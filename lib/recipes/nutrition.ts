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

export function computeRecipeNutrition(
  ingredients: IngredientNutrition[],
  servings: number,
): RecipeNutritionResult {
  const total = ingredients.length
  const unresolved = ingredients.filter(
    (i) =>
      i.foodItemId === null ||
      i.snapshotCalories === null ||
      i.snapshotProteinG === null ||
      i.snapshotCarbG === null ||
      i.snapshotFatG === null,
  ).length

  if (unresolved > 0 || total === 0) {
    return { complete: false, unresolvedCount: unresolved, totalCount: total, calPerServing: null, proteinGPerServing: null, carbGPerServing: null, fatGPerServing: null }
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
  const foodUnit = food.servingUnit.toLowerCase().trim()
  const ingUnit = ingredientUnit.toLowerCase().trim()
  const servingSize = Number(food.servingSize)

  if (servingSize <= 0) return null

  // Same unit (or "serving" / "portion" aliases)
  const SERVING_ALIASES = new Set(['serving', 'servings', 'portion', 'portions'])
  const sameUnit =
    foodUnit === ingUnit ||
    (SERVING_ALIASES.has(foodUnit) && SERVING_ALIASES.has(ingUnit))

  // Gram/ml equivalents
  const GRAM_UNITS = new Set(['g', 'gram', 'grams'])
  const ML_UNITS = new Set(['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'])
  const OZ_UNITS = new Set(['oz', 'ounce', 'ounces'])
  const LB_UNITS = new Set(['lb', 'lbs', 'pound', 'pounds'])
  const CUP_UNITS = new Set(['cup', 'cups'])
  const TBSP_UNITS = new Set(['tbsp', 'tablespoon', 'tablespoons'])
  const TSP_UNITS = new Set(['tsp', 'teaspoon', 'teaspoons'])

  let factor: number | null = null

  if (sameUnit) {
    factor = ingredientQty / servingSize
  } else if (GRAM_UNITS.has(ingUnit) && GRAM_UNITS.has(foodUnit)) {
    factor = ingredientQty / servingSize
  } else if (ML_UNITS.has(ingUnit) && ML_UNITS.has(foodUnit)) {
    factor = ingredientQty / servingSize
  } else if (OZ_UNITS.has(ingUnit) && GRAM_UNITS.has(foodUnit)) {
    factor = (ingredientQty * 28.3495) / servingSize
  } else if (LB_UNITS.has(ingUnit) && GRAM_UNITS.has(foodUnit)) {
    factor = (ingredientQty * 453.592) / servingSize
  } else if (CUP_UNITS.has(ingUnit) && ML_UNITS.has(foodUnit)) {
    factor = (ingredientQty * 236.588) / servingSize
  } else if (TBSP_UNITS.has(ingUnit) && ML_UNITS.has(foodUnit)) {
    factor = (ingredientQty * 14.7868) / servingSize
  } else if (TSP_UNITS.has(ingUnit) && ML_UNITS.has(foodUnit)) {
    factor = (ingredientQty * 4.92892) / servingSize
  }

  if (factor === null) return null

  return {
    calories: round2(Number(food.calories) * factor),
    proteinG: round3(Number(food.proteinG) * factor),
    carbG:    round3(Number(food.carbohydrateG) * factor),
    fatG:     round3(Number(food.fatG) * factor),
  }
}
