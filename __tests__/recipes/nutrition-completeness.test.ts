/**
 * nutrition-completeness.test.ts — Phase 4
 *
 * Tests for nutrition completeness logic in computeRecipeNutritionTotals.
 * Focuses on edge cases: mixed resolved/unresolved, to-taste, conversion sources,
 * all-optional recipes, and unresolvedNames list construction.
 */
import { describe, it, expect } from 'vitest'
import {
  computeRecipeNutritionTotals,
  type IngredientWithNutrition,
} from '../../lib/recipes/serving-calc'

function makeIng(
  partial: Partial<IngredientWithNutrition> & { id: string; name: string },
): IngredientWithNutrition {
  return {
    quantity: 100,
    unit: 'g',
    isOptional: false,
    isToTaste: false,
    snapshotCalories: 100,
    snapshotProteinG: 10,
    snapshotCarbG: 15,
    snapshotFatG: 3,
    ...partial,
  }
}

// ── USDA per-100g ingredient ──────────────────────────────────────────────────

describe('USDA per-100g ingredient conversion', () => {
  it('correctly totals macros from a USDA-resolved ingredient', () => {
    // A 100g chicken breast: 165 cal, 31g protein, 0g carb, 3.6g fat
    const ingredients: IngredientWithNutrition[] = [
      makeIng({
        id: 'usda-chicken',
        name: 'Chicken breast',
        quantity: 150,
        unit: 'g',
        conversionSource: 'usda_measured',
        snapshotCalories: 247.5,  // 165 * 1.5
        snapshotProteinG: 46.5,   // 31 * 1.5
        snapshotCarbG: 0,
        snapshotFatG: 5.4,        // 3.6 * 1.5
      }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 3)
    expect(result.totalCalories).toBeCloseTo(247.5)
    expect(result.totalProteinG).toBeCloseTo(46.5)
    expect(result.completeness).toBe('complete')
  })
})

// ── Manufacturer serving ingredient ──────────────────────────────────────────

describe('manufacturer serving ingredient', () => {
  it('correctly handles a manufacturer-declared serving', () => {
    // Olive oil: 1 tbsp = 119 cal, 0g protein, 0g carb, 13.5g fat
    const ingredients: IngredientWithNutrition[] = [
      makeIng({
        id: 'olive-oil',
        name: 'Olive oil',
        quantity: 2,
        unit: 'tbsp',
        conversionSource: 'manufacturer_declared',
        snapshotCalories: 238,    // 119 * 2
        snapshotProteinG: 0,
        snapshotCarbG: 0,
        snapshotFatG: 27,         // 13.5 * 2
      }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 4)
    expect(result.totalCalories).toBeCloseTo(238)
    expect(result.totalFatG).toBeCloseTo(27)
    expect(result.completeness).toBe('complete')
  })
})

// ── Missing snapshot → incomplete ────────────────────────────────────────────

describe('missing snapshot → incomplete', () => {
  it('marks as incomplete when a required ingredient has null snapshot', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIng({ id: 'a', name: 'Tomatoes', snapshotCalories: 35, snapshotProteinG: 1.5, snapshotCarbG: 7, snapshotFatG: 0.4 }),
      makeIng({ id: 'b', name: 'Mystery ingredient', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 2)
    expect(result.completeness).toBe('incomplete')
    expect(result.unresolvedNames).toContain('Mystery ingredient')
  })

  it('unresolvedNames only contains the cook\'s typed name (not a food DB name)', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIng({ id: 'a', name: 'Fresh basil leaves', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    expect(result.unresolvedNames[0]).toBe('Fresh basil leaves')
  })

  it('unresolvedCount is accurate with mixed resolved/unresolved', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIng({ id: 'a', name: 'Chicken', snapshotCalories: 200, snapshotProteinG: 30, snapshotCarbG: 0, snapshotFatG: 8 }),
      makeIng({ id: 'b', name: 'Unknown sauce', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
      makeIng({ id: 'c', name: 'Rice', snapshotCalories: 300, snapshotProteinG: 6, snapshotCarbG: 66, snapshotFatG: 0.5 }),
      makeIng({ id: 'd', name: 'Unknown spice', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 4)
    expect(result.unresolvedCount).toBe(2)
    expect(result.unresolvedNames).toEqual(expect.arrayContaining(['Unknown sauce', 'Unknown spice']))
  })
})

// ── to-taste ingredient → excluded, no error ─────────────────────────────────

describe('to-taste ingredient', () => {
  it('to-taste ingredient is excluded and does not cause error', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIng({ id: 'a', name: 'Pasta', snapshotCalories: 400, snapshotProteinG: 14, snapshotCarbG: 80, snapshotFatG: 2 }),
      makeIng({ id: 'b', name: 'Salt', isToTaste: true, snapshotCalories: 0, snapshotProteinG: 0, snapshotCarbG: 0, snapshotFatG: 0 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 4)
    expect(result.completeness).toBe('complete')
    expect(result.totalCalories).toBe(400)
  })

  it('to-taste ingredient with no snapshot does not cause incomplete', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIng({ id: 'a', name: 'Pasta', snapshotCalories: 400, snapshotProteinG: 14, snapshotCarbG: 80, snapshotFatG: 2 }),
      makeIng({ id: 'b', name: 'Secret spice', isToTaste: true, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 4)
    // to-taste unresolved → estimated at most (not incomplete)
    expect(result.completeness).not.toBe('incomplete')
  })
})

// ── All-optional excluded → 0 calories ───────────────────────────────────────

describe('all-optional recipe with all excluded', () => {
  it('all-optional recipe with empty optionalIncluded Set → 0 calories, complete', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIng({ id: 'a', name: 'Croutons', isOptional: true, snapshotCalories: 100, snapshotProteinG: 2, snapshotCarbG: 20, snapshotFatG: 2 }),
      makeIng({ id: 'b', name: 'Cheese', isOptional: true, snapshotCalories: 200, snapshotProteinG: 12, snapshotCarbG: 1, snapshotFatG: 16 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 2, new Set())
    expect(result.totalCalories).toBe(0)
    expect(result.totalProteinG).toBe(0)
  })
})

// ── Multiple unresolvedNames in a list ───────────────────────────────────────

describe('unresolvedNames list construction', () => {
  it('constructs list in ingredient order', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIng({ id: 'a', name: 'Alpha unresolved', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
      makeIng({ id: 'b', name: 'Broccoli', snapshotCalories: 55, snapshotProteinG: 3.7, snapshotCarbG: 11, snapshotFatG: 0.6 }),
      makeIng({ id: 'c', name: 'Beta unresolved', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    expect(result.unresolvedNames).toEqual(['Alpha unresolved', 'Beta unresolved'])
  })

  it('unresolvedNames is empty when all ingredients are resolved', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIng({ id: 'a', name: 'Chicken', snapshotCalories: 200, snapshotProteinG: 30, snapshotCarbG: 0, snapshotFatG: 8 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 2)
    expect(result.unresolvedNames).toHaveLength(0)
  })
})

// ── Partial totals shown correctly for incomplete recipes ─────────────────────

describe('partial totals for incomplete recipes', () => {
  it('sums resolved ingredients even when some are unresolved', () => {
    const ingredients: IngredientWithNutrition[] = [
      makeIng({ id: 'a', name: 'Chicken', snapshotCalories: 300, snapshotProteinG: 30, snapshotCarbG: 0, snapshotFatG: 10 }),
      makeIng({ id: 'b', name: 'Unknown herb', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }),
      makeIng({ id: 'c', name: 'Rice', snapshotCalories: 200, snapshotProteinG: 4, snapshotCarbG: 45, snapshotFatG: 0.5 }),
    ]
    const result = computeRecipeNutritionTotals(ingredients, 1)
    expect(result.completeness).toBe('incomplete')
    // Resolved ingredients still contribute partial totals
    expect(result.totalCalories).toBe(500) // 300 + 200 (unresolved contributes 0)
    expect(result.totalProteinG).toBeCloseTo(34)
  })
})
