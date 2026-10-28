// Pure utilities for building nutrition target payloads from calculator results.
// No imports from API layers or React — these are plain data transformations
// that can be exercised in unit tests without any framework setup.

export interface FullNutritionTarget {
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  fiberG: number | null
  sugarG: number | null
  sodiumMg: number | null
}

// Used when the user has no saved target yet.
export const FALLBACK_TARGET: FullNutritionTarget = {
  calories: 2000,
  proteinG: 150,
  carbohydrateG: 250,
  fatG: 65,
  fiberG: null,
  sugarG: null,
  sodiumMg: null,
}

/**
 * Returns the calorie total implied by macro grams (4/4/9 kcal/g),
 * and how far it deviates from the declared calorie value.
 * Tolerance is ±50 kcal to match the existing Goals Editor threshold.
 */
export function macroReconciliation(target: FullNutritionTarget): {
  impliedCalories: number
  delta: number
  withinTolerance: boolean
} {
  const impliedCalories = Math.round(
    target.proteinG * 4 + target.carbohydrateG * 4 + target.fatG * 9,
  )
  const delta = impliedCalories - target.calories
  return { impliedCalories, delta, withinTolerance: Math.abs(delta) <= 50 }
}

/**
 * Builds a payload that changes ONLY the calorie goal.
 * All macro grams and optional targets (fiber, sugar, sodium) are preserved.
 */
export function buildCaloriePayload(
  existing: FullNutritionTarget,
  newCalories: number,
): FullNutritionTarget {
  return { ...existing, calories: Math.round(newCalories) }
}

/**
 * Builds a payload that replaces all four core macro values.
 * Optional targets (fiberG, sugarG, sodiumMg) are preserved from the existing record.
 */
export function buildMacroPayload(
  existing: FullNutritionTarget,
  macros: { calories: number; proteinG: number; carbohydrateG: number; fatG: number },
): FullNutritionTarget {
  return {
    calories: macros.calories,
    proteinG: macros.proteinG,
    carbohydrateG: macros.carbohydrateG,
    fatG: macros.fatG,
    fiberG: existing.fiberG,
    sugarG: existing.sugarG,
    sodiumMg: existing.sodiumMg,
  }
}
