import { describe, it, expect } from 'vitest'
import {
  computeRecipeNutrition,
  ingredientNutritionFromFood,
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
    expect(result.calPerServing).toBe(300) // (400 + 200) / 2
    expect(result.proteinGPerServing).toBe(30) // (40 + 20) / 2
    expect(result.carbGPerServing).toBe(20)
    expect(result.fatGPerServing).toBe(12)
  })

  it('uses servings=1 safely when recipe has 0 servings', () => {
    const ingredients = [makeIngredient({ snapshotCalories: d(300), snapshotProteinG: d(10), snapshotCarbG: d(5), snapshotFatG: d(3) })]
    const result = computeRecipeNutrition(ingredients, 0)
    expect(result.calPerServing).toBe(300)
  })
})

describe('computeRecipeNutrition — unresolved ingredients', () => {
  it('is incomplete when foodItemId is null', () => {
    const ingredients = [
      makeIngredient(),
      makeIngredient({ foodItemId: null }),
    ]
    const result = computeRecipeNutrition(ingredients, 1)
    expect(result.complete).toBe(false)
    expect(result.unresolvedCount).toBe(1)
    expect(result.calPerServing).toBeNull()
  })

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
    // Must NOT return a partial sum
    expect(result.calPerServing).toBeNull()
    expect(result.proteinGPerServing).toBeNull()
  })

  it('counts all four null fields as unresolved', () => {
    const ingredients = [
      makeIngredient({ snapshotCalories: d(100), snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
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
