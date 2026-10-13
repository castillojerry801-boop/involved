import { describe, it, expect } from 'vitest'
import {
  computeRecipeNutrition,
  ingredientNutritionFromFood,
  computeIngredientFactor,
  isIngredientResolved,
  type IngredientNutrition,
  type FoodItemServing,
} from '../../lib/recipes/nutrition'
import type { Decimal } from '@prisma/client/runtime/library'

// ── helpers ────────────────────────────────────────────────────────────────────

function d(n: number) { return n as unknown as Decimal }

function makeIngredient(override?: Partial<IngredientNutrition>): IngredientNutrition {
  return {
    foodItemId: 'food-1',
    quantity: d(100),
    unit: 'g',
    snapshotCalories: d(200),
    snapshotProteinG: d(20),
    snapshotCarbG: d(15),
    snapshotFatG: d(8),
    ...override,
  }
}

// ── isIngredientResolved ───────────────────────────────────────────────────────

describe('isIngredientResolved', () => {
  it('returns true when all four snapshots are valid', () => {
    expect(isIngredientResolved(makeIngredient())).toBe(true)
  })

  it('returns true when foodItemId is null but all snapshots are valid (external food)', () => {
    expect(isIngredientResolved(makeIngredient({ foodItemId: null }))).toBe(true)
  })

  it('returns false when any snapshot is null', () => {
    expect(isIngredientResolved(makeIngredient({ snapshotCalories: null }))).toBe(false)
    expect(isIngredientResolved(makeIngredient({ snapshotProteinG: null }))).toBe(false)
    expect(isIngredientResolved(makeIngredient({ snapshotCarbG: null }))).toBe(false)
    expect(isIngredientResolved(makeIngredient({ snapshotFatG: null }))).toBe(false)
  })

  it('returns false when a snapshot is NaN (treated as invalid by Number.isFinite)', () => {
    expect(isIngredientResolved(makeIngredient({ snapshotCalories: d(NaN) }))).toBe(false)
  })

  it('returns false when a snapshot is negative', () => {
    expect(isIngredientResolved(makeIngredient({ snapshotCalories: d(-1) }))).toBe(false)
  })

  it('returns true when a macro is exactly zero (valid for zero-calorie foods)', () => {
    expect(isIngredientResolved(makeIngredient({ snapshotCalories: d(0) }))).toBe(true)
  })
})

// ── computeRecipeNutrition ─────────────────────────────────────────────────────

describe('computeRecipeNutrition — empty recipe', () => {
  it('returns incomplete for zero ingredients', () => {
    const result = computeRecipeNutrition([], 1)
    expect(result.complete).toBe(false)
    expect(result.calPerServing).toBeNull()
  })
})

describe('computeRecipeNutrition — fully matched', () => {
  it('sums and divides by servings correctly', () => {
    const ingredients = [
      makeIngredient({ snapshotCalories: d(400), snapshotProteinG: d(40), snapshotCarbG: d(30), snapshotFatG: d(16) }),
      makeIngredient({ snapshotCalories: d(200), snapshotProteinG: d(20), snapshotCarbG: d(10), snapshotFatG: d(8) }),
    ]
    const result = computeRecipeNutrition(ingredients, 2)
    expect(result.complete).toBe(true)
    expect(result.unresolvedCount).toBe(0)
    expect(result.calPerServing).toBe(300)   // (400 + 200) / 2
    expect(result.proteinGPerServing).toBe(30)
    expect(result.carbGPerServing).toBe(20)
    expect(result.fatGPerServing).toBe(12)
  })

  it('uses servings=1 safely when recipe has 0 servings', () => {
    const ingredients = [makeIngredient({ snapshotCalories: d(300), snapshotProteinG: d(10), snapshotCarbG: d(5), snapshotFatG: d(3) })]
    const result = computeRecipeNutrition(ingredients, 0)
    expect(result.calPerServing).toBe(300)
  })
})

describe('computeRecipeNutrition — external food (foodItemId null, valid snapshots)', () => {
  it('is complete when all ingredients have valid snapshots even without foodItemId', () => {
    const ingredients = [
      makeIngredient(),
      makeIngredient({ foodItemId: null }),  // external: no DB link, valid snapshots
    ]
    const result = computeRecipeNutrition(ingredients, 2)
    expect(result.complete).toBe(true)
    expect(result.unresolvedCount).toBe(0)
    expect(result.calPerServing).toBe(200)   // (200 + 200) / 2
  })

  it('is incomplete when an ingredient has foodItemId null AND null snapshots (free-text)', () => {
    const ingredients = [
      makeIngredient(),
      makeIngredient({ foodItemId: null, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutrition(ingredients, 1)
    expect(result.complete).toBe(false)
    expect(result.unresolvedCount).toBe(1)
    expect(result.calPerServing).toBeNull()
  })
})

describe('computeRecipeNutrition — unresolved ingredients', () => {
  it('is incomplete when snapshot macros are null', () => {
    const ingredients = [
      makeIngredient({ snapshotCalories: null }),
    ]
    const result = computeRecipeNutrition(ingredients, 1)
    expect(result.complete).toBe(false)
    expect(result.calPerServing).toBeNull()
  })

  it('never presents a partial sum as a total', () => {
    const ingredients = [
      makeIngredient({ snapshotCalories: d(200), snapshotProteinG: d(20), snapshotCarbG: d(15), snapshotFatG: d(8) }),
      makeIngredient({ foodItemId: null, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutrition(ingredients, 1)
    expect(result.complete).toBe(false)
    expect(result.calPerServing).toBeNull()
    expect(result.proteinGPerServing).toBeNull()
  })

  it('counts all four null fields as unresolved', () => {
    const ingredients = [
      makeIngredient({ snapshotCalories: d(100), snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    expect(computeRecipeNutrition(ingredients, 1).complete).toBe(false)
  })

  it('treats NaN snapshot as unresolved', () => {
    const ingredients = [makeIngredient({ snapshotCalories: d(NaN) })]
    expect(computeRecipeNutrition(ingredients, 1).complete).toBe(false)
  })

  it('treats negative snapshot as unresolved', () => {
    const ingredients = [makeIngredient({ snapshotCalories: d(-100) })]
    expect(computeRecipeNutrition(ingredients, 1).complete).toBe(false)
  })
})

describe('computeRecipeNutrition — single ingredient, 1 serving', () => {
  it('returns the ingredient totals directly', () => {
    const ingredients = [
      makeIngredient({ snapshotCalories: d(150.5), snapshotProteinG: d(12.333), snapshotCarbG: d(8.1), snapshotFatG: d(5.75) }),
    ]
    const result = computeRecipeNutrition(ingredients, 1)
    expect(result.complete).toBe(true)
    expect(result.calPerServing).toBe(150.5)
    expect(result.proteinGPerServing).toBe(12.333)
  })
})

// ── computeIngredientFactor ────────────────────────────────────────────────────

describe('computeIngredientFactor — same units', () => {
  it('returns qty/servingSize for identical units', () => {
    expect(computeIngredientFactor(100, 'g', 200, 'g')).toBe(2)
    expect(computeIngredientFactor(100, 'g', 50, 'g')).toBe(0.5)
  })

  it('treats gram variants as the same unit', () => {
    expect(computeIngredientFactor(100, 'grams', 100, 'g')).toBe(1)
  })

  it('treats ml variants as the same unit', () => {
    expect(computeIngredientFactor(240, 'ml', 240, 'milliliters')).toBe(1)
  })

  it('treats serving aliases as the same unit', () => {
    expect(computeIngredientFactor(1, 'serving', 2, 'servings')).toBe(2)
    expect(computeIngredientFactor(1, 'portion', 3, 'portions')).toBe(3)
  })
})

describe('computeIngredientFactor — cross-unit conversions', () => {
  it('converts oz to g', () => {
    const factor = computeIngredientFactor(28.3495, 'g', 1, 'oz')
    expect(factor).not.toBeNull()
    expect(factor!).toBeCloseTo(1, 3)
  })

  it('converts lb to g', () => {
    const factor = computeIngredientFactor(453.592, 'g', 1, 'lb')
    expect(factor).not.toBeNull()
    expect(factor!).toBeCloseTo(1, 3)
  })

  it('converts cups to ml', () => {
    const factor = computeIngredientFactor(236.588, 'ml', 1, 'cup')
    expect(factor).not.toBeNull()
    expect(factor!).toBeCloseTo(1, 3)
  })

  it('converts tbsp to ml', () => {
    const factor = computeIngredientFactor(14.7868, 'ml', 1, 'tbsp')
    expect(factor).not.toBeNull()
    expect(factor!).toBeCloseTo(1, 3)
  })

  it('converts tsp to ml', () => {
    const factor = computeIngredientFactor(4.92892, 'ml', 1, 'tsp')
    expect(factor).not.toBeNull()
    expect(factor!).toBeCloseTo(1, 3)
  })
})

describe('computeIngredientFactor — invalid / unsupported', () => {
  it('returns null for incompatible units (cup vs g)', () => {
    expect(computeIngredientFactor(100, 'g', 1, 'cup')).toBeNull()
  })

  it('returns null for incompatible units (oz vs ml)', () => {
    expect(computeIngredientFactor(240, 'ml', 1, 'oz')).toBeNull()
  })

  it('returns null when servingSize is 0', () => {
    expect(computeIngredientFactor(0, 'g', 100, 'g')).toBeNull()
  })

  it('returns null when quantity is 0', () => {
    expect(computeIngredientFactor(100, 'g', 0, 'g')).toBeNull()
  })

  it('returns null for unknown unit', () => {
    expect(computeIngredientFactor(100, 'g', 1, 'pinch')).toBeNull()
  })
})

// ── ingredientNutritionFromFood ────────────────────────────────────────────────

function makeFood(override?: Partial<FoodItemServing>): FoodItemServing {
  return {
    calories: d(100),
    proteinG: d(10),
    carbohydrateG: d(8),
    fatG: d(4),
    servingSize: d(100),
    servingUnit: 'g',
    ...override,
  }
}

describe('ingredientNutritionFromFood — same units', () => {
  it('scales linearly with quantity', () => {
    const result = ingredientNutritionFromFood(makeFood(), 200, 'g')
    expect(result).not.toBeNull()
    expect(result!.calories).toBe(200)
    expect(result!.proteinG).toBe(20)
    expect(result!.carbG).toBe(16)
    expect(result!.fatG).toBe(8)
  })

  it('handles fractional quantities', () => {
    const result = ingredientNutritionFromFood(makeFood(), 50, 'g')
    expect(result!.calories).toBe(50)
  })

  it('uses serving aliases', () => {
    const food = makeFood({ servingUnit: 'serving', servingSize: d(1) })
    const result = ingredientNutritionFromFood(food, 2, 'servings')
    expect(result).not.toBeNull()
    expect(result!.calories).toBe(200)
  })
})

describe('ingredientNutritionFromFood — unit conversion', () => {
  it('converts oz to g when food is in g', () => {
    const food = makeFood({ servingSize: d(28.3495), servingUnit: 'g' })
    const result = ingredientNutritionFromFood(food, 1, 'oz')
    expect(result).not.toBeNull()
    expect(result!.calories).toBeCloseTo(100, 0)
  })

  it('converts cups to ml when food is in ml', () => {
    const food = makeFood({ servingSize: d(236.588), servingUnit: 'ml' })
    const result = ingredientNutritionFromFood(food, 1, 'cup')
    expect(result).not.toBeNull()
    expect(result!.calories).toBeCloseTo(100, 0)
  })

  it('returns null for incompatible units', () => {
    const food = makeFood({ servingUnit: 'g' })
    expect(ingredientNutritionFromFood(food, 1, 'cup')).toBeNull()
  })

  it('returns null when servingSize is 0', () => {
    const food = makeFood({ servingSize: d(0) })
    expect(ingredientNutritionFromFood(food, 1, 'g')).toBeNull()
  })
})
