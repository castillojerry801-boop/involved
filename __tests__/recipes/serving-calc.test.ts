import { describe, it, expect } from 'vitest'
import {
  computeRecipeNutritionTotals,
  computeServingNutrition,
  type IngredientWithNutrition,
} from '../../lib/recipes/serving-calc'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIngredient(
  overrides: Partial<IngredientWithNutrition> & { id?: string },
): IngredientWithNutrition {
  return {
    id: 'ing-1',
    name: 'Chicken breast',
    quantity: 100,
    unit: 'g',
    isOptional: false,
    isToTaste: false,
    snapshotCalories: 165,
    snapshotProteinG: 31,
    snapshotCarbG: 0,
    snapshotFatG: 3.6,
    ...overrides,
  }
}

// ── computeRecipeNutritionTotals ──────────────────────────────────────────────

describe('computeRecipeNutritionTotals — completeness', () => {
  it('returns complete when all non-optional, non-negligible ingredients are resolved', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', name: 'Chicken', snapshotCalories: 165, snapshotProteinG: 31, snapshotCarbG: 0, snapshotFatG: 3.6 }),
      makeIngredient({ id: 'b', name: 'Rice', snapshotCalories: 200, snapshotProteinG: 4, snapshotCarbG: 45, snapshotFatG: 0.5 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 2)
    expect(result.completeness).toBe('complete')
    expect(result.unresolvedCount).toBe(0)
    expect(result.unresolvedNames).toHaveLength(0)
  })

  it('returns incomplete when a non-optional ingredient has null snapshot', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 165, snapshotProteinG: 31, snapshotCarbG: 0, snapshotFatG: 3.6 }),
      makeIngredient({ id: 'b', name: 'Mystery spice', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 2)
    expect(result.completeness).toBe('incomplete')
    expect(result.unresolvedCount).toBe(1)
    expect(result.unresolvedNames).toContain('Mystery spice')
  })

  it('returns estimated when all non-optional are resolved but some optional are unresolved', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 200, snapshotProteinG: 10, snapshotCarbG: 30, snapshotFatG: 5 }),
      makeIngredient({ id: 'b', name: 'Optional cheese', isOptional: true, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 2)
    expect(result.completeness).toBe('estimated')
  })

  it('returns complete when all ingredients are resolved (no empty set)', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 100, snapshotProteinG: 5, snapshotCarbG: 20, snapshotFatG: 1 }),
    ]
    expect(computeRecipeNutritionTotals(ingredients, 1).completeness).toBe('complete')
  })

  it('returns complete for empty ingredient list', () => {
    const result = computeRecipeNutritionTotals([], 4)
    expect(result.completeness).toBe('complete')
    expect(result.totalCalories).toBe(0)
  })
})

describe('computeRecipeNutritionTotals — to-taste and negligible ingredients', () => {
  it('excludes to-taste ingredients from totals', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 200, snapshotProteinG: 10, snapshotCarbG: 30, snapshotFatG: 5 }),
      makeIngredient({ id: 'b', name: 'Salt', isToTaste: true, snapshotCalories: 0, snapshotProteinG: 0, snapshotCarbG: 0, snapshotFatG: 0 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    expect(result.totalCalories).toBe(200)
    expect(result.totalProteinG).toBe(10)
  })

  it('excludes unresolved to-taste ingredients without marking as incomplete', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 200, snapshotProteinG: 10, snapshotCarbG: 30, snapshotFatG: 5 }),
      makeIngredient({ id: 'b', name: 'Salt', isToTaste: true, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    // to-taste unresolved → estimated at most (core is resolved)
    expect(result.completeness).not.toBe('incomplete')
    expect(result.totalCalories).toBe(200)
  })

  it('treats pinch unit as negligible — excludes from totals', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 300, snapshotProteinG: 15, snapshotCarbG: 40, snapshotFatG: 8 }),
      makeIngredient({ id: 'b', name: 'Pepper', unit: 'pinch', isToTaste: false, snapshotCalories: 2, snapshotProteinG: 0.1, snapshotCarbG: 0.4, snapshotFatG: 0 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    expect(result.totalCalories).toBe(300)
  })

  it('treats dash unit as negligible — excludes from totals', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 300, snapshotProteinG: 15, snapshotCarbG: 40, snapshotFatG: 8 }),
      makeIngredient({ id: 'b', name: 'Hot sauce', unit: 'dash', isToTaste: false, snapshotCalories: 1, snapshotProteinG: 0, snapshotCarbG: 0, snapshotFatG: 0 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    expect(result.totalCalories).toBe(300)
  })

  it('unresolved negligible unit does not produce incomplete', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 300, snapshotProteinG: 15, snapshotCarbG: 40, snapshotFatG: 8 }),
      makeIngredient({ id: 'b', name: 'Spice', unit: 'pinch', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    expect(result.completeness).not.toBe('incomplete')
  })
})

describe('computeRecipeNutritionTotals — optional ingredient handling', () => {
  it('includes optional ingredients in totals by default (optionalIncluded=undefined)', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 200, snapshotProteinG: 10, snapshotCarbG: 30, snapshotFatG: 5 }),
      makeIngredient({ id: 'b', name: 'Parmesan', isOptional: true, snapshotCalories: 100, snapshotProteinG: 8, snapshotCarbG: 1, snapshotFatG: 7 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    expect(result.totalCalories).toBe(300)
    expect(result.totalProteinG).toBeCloseTo(18)
  })

  it('excludes optional ingredient when its ID is absent from optionalIncluded Set', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 200, snapshotProteinG: 10, snapshotCarbG: 30, snapshotFatG: 5 }),
      makeIngredient({ id: 'b', name: 'Parmesan', isOptional: true, snapshotCalories: 100, snapshotProteinG: 8, snapshotCarbG: 1, snapshotFatG: 7 }),
    ]
    // Pass empty Set → all optional excluded
    const result = computeRecipeNutritionTotals(ingredients, 1, new Set())
    expect(result.totalCalories).toBe(200)
  })

  it('includes optional ingredient when its ID is present in optionalIncluded Set', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 200, snapshotProteinG: 10, snapshotCarbG: 30, snapshotFatG: 5 }),
      makeIngredient({ id: 'b', name: 'Parmesan', isOptional: true, snapshotCalories: 100, snapshotProteinG: 8, snapshotCarbG: 1, snapshotFatG: 7 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1, new Set(['b']))
    expect(result.totalCalories).toBe(300)
  })

  it('all-optional recipe with all excluded → 0 calories, complete', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', name: 'Cheese', isOptional: true, snapshotCalories: 100, snapshotProteinG: 8, snapshotCarbG: 1, snapshotFatG: 7 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1, new Set())
    expect(result.totalCalories).toBe(0)
  })
})

describe('computeRecipeNutritionTotals — per-serving math', () => {
  it('divides totals by servings count to get per-serving values', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 400, snapshotProteinG: 20, snapshotCarbG: 60, snapshotFatG: 10 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 4)
    expect(result.perServingCalories).toBe(100)
    expect(result.perServingProteinG).toBe(5)
    expect(result.perServingCarbG).toBe(15)
    expect(result.perServingFatG).toBe(2.5)
    expect(result.servings).toBe(4)
  })

  it('handles servings=0 gracefully (no divide by zero — treats as 1)', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 300, snapshotProteinG: 15, snapshotCarbG: 40, snapshotFatG: 8 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 0)
    expect(result.perServingCalories).toBe(300)
    expect(result.servings).toBe(1)
  })

  it('servings=1 → per-serving equals total', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 500, snapshotProteinG: 25, snapshotCarbG: 50, snapshotFatG: 20 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    expect(result.perServingCalories).toBe(result.totalCalories)
    expect(result.perServingProteinG).toBe(result.totalProteinG)
  })

  it('changing servings count recalculates per-serving correctly', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 1000, snapshotProteinG: 50, snapshotCarbG: 100, snapshotFatG: 40 }),
    ]
    const result2 = computeRecipeNutritionTotals(ingredients, 2)
    const result4 = computeRecipeNutritionTotals(ingredients, 4)

    expect(result2.perServingCalories).toBe(500)
    expect(result4.perServingCalories).toBe(250)
    // Totals are the same regardless of serving count
    expect(result2.totalCalories).toBe(result4.totalCalories)
  })

  it('multi-ingredient totals sum correctly before dividing', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIngredient({ id: 'a', snapshotCalories: 300, snapshotProteinG: 30, snapshotCarbG: 0, snapshotFatG: 15 }),
      makeIngredient({ id: 'b', name: 'Rice', snapshotCalories: 700, snapshotProteinG: 14, snapshotCarbG: 150, snapshotFatG: 1.4 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 2)
    expect(result.totalCalories).toBe(1000)
    expect(result.perServingCalories).toBe(500)
    expect(result.totalProteinG).toBeCloseTo(44)
    expect(result.perServingProteinG).toBeCloseTo(22)
  })
})

// ── computeServingNutrition ───────────────────────────────────────────────────

describe('computeServingNutrition', () => {
  const baseTotals = computeRecipeNutritionTotals(
    [makeIngredient({ id: 'a', snapshotCalories: 800, snapshotProteinG: 40, snapshotCarbG: 100, snapshotFatG: 20 })],
    4,
  )
  // perServingCalories = 200, perServingProteinG = 10, perServingCarbG = 25, perServingFatG = 5

  it('servingAmount=1 → returns per-serving values unchanged', () => {
    const result = computeServingNutrition(baseTotals, 1)
    expect(result.calories).toBe(200)
    expect(result.proteinG).toBe(10)
    expect(result.carbG).toBe(25)
    expect(result.fatG).toBe(5)
  })

  it('servingAmount=0.5 → half of per-serving values', () => {
    const result = computeServingNutrition(baseTotals, 0.5)
    expect(result.calories).toBe(100)
    expect(result.proteinG).toBe(5)
    expect(result.carbG).toBeCloseTo(12.5)
    expect(result.fatG).toBe(2.5)
  })

  it('servingAmount=2 → double per-serving values', () => {
    const result = computeServingNutrition(baseTotals, 2)
    expect(result.calories).toBe(400)
    expect(result.proteinG).toBe(20)
    expect(result.carbG).toBe(50)
    expect(result.fatG).toBe(10)
  })

  it('servingAmount=0 treated as 1 (no divide by zero)', () => {
    const result = computeServingNutrition(baseTotals, 0)
    expect(result.calories).toBe(200)
  })

  it('fractional serving 1.5 → 1.5× per-serving', () => {
    const result = computeServingNutrition(baseTotals, 1.5)
    expect(result.calories).toBe(300)
    expect(result.proteinG).toBe(15)
  })
})
