/**
 * calculate-nutrition tool handler — unit tests
 *
 * All external dependencies (matchIngredient, resolveIngredientFactor) are
 * mocked. These tests verify the tool handler logic only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MatchResult } from '../../lib/nutrition/matching/types'
import type { ConversionResult, ConversionError } from '../../lib/nutrition/conversion/types'

// ── Mock matchIngredient and resolveIngredientFactor BEFORE importing the module ─
vi.mock('../../lib/nutrition/matching/matcher', () => ({
  matchIngredient: vi.fn(),
}))

vi.mock('../../lib/nutrition/conversion/factor', () => ({
  resolveIngredientFactor: vi.fn(),
}))

// These imports happen AFTER the vi.mock calls
import { calculateNutrition } from '../../lib/v/tools/calculate-nutrition'
import { matchIngredient } from '../../lib/nutrition/matching/matcher'
import { resolveIngredientFactor } from '../../lib/nutrition/conversion/factor'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMatchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    confidence: 'confident',
    topMatch: {
      provider: 'usda_fooddata',
      externalId: 'fdc_12345',
      internalId: 'internal-uuid-1',
      name: 'Test Food',
      servingSize: 100,
      servingUnit: 'g',
      calories: 200,
      proteinG: 20,
      carbohydrateG: 10,
      fatG: 8,
      isGeneric: true,
      matchScore: 90,
      matchReasons: ['All query words match'],
    },
    alternatives: [],
    rawResults: [],
    ...overrides,
  }
}

function makeConversionResult(factor = 1, overrides: Partial<ConversionResult> = {}): ConversionResult {
  return {
    grams: 100 * factor,
    factor,
    conversionSource: 'same_unit',
    portionDescription: `${100 * factor}g`,
    confidence: 'high',
    notes: [],
    ...overrides,
  }
}

function makeConversionError(errorCode = 'unit_incompatible', message = 'Cannot convert'): ConversionError {
  return {
    kind: 'conversion_error',
    errorCode: errorCode as ConversionError['errorCode'],
    message,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('calculate_nutrition tool handler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ── Test 1: Three eggs, bacon, tortilla, potatoes (all resolved) ─────────────
  describe('Test 1: three eggs, bacon, tortilla, potatoes — all match', () => {
    it('returns complete result with non-zero calories per ingredient', async () => {
      const mockMatch = vi.mocked(matchIngredient)
      const mockConvert = vi.mocked(resolveIngredientFactor)

      // Each ingredient matches confidently
      mockMatch.mockImplementation(async ({ ingredientName }) => {
        const foods: Record<string, { name: string; calories: number; proteinG: number; carbohydrateG: number; fatG: number; servingSize: number }> = {
          eggs:      { name: 'Egg, whole, raw, fresh',  calories: 155, proteinG: 13,  carbohydrateG: 1.1, fatG: 11,  servingSize: 50 },
          bacon:     { name: 'Pork bacon, cured, raw',  calories: 541, proteinG: 37,  carbohydrateG: 1.4, fatG: 42,  servingSize: 28 },
          tortilla:  { name: 'Tortillas, flour',        calories: 290, proteinG: 8,   carbohydrateG: 47,  fatG: 7,   servingSize: 45 },
          potatoes:  { name: "O'Brien potatoes",        calories: 89,  proteinG: 2,   carbohydrateG: 20,  fatG: 0.1, servingSize: 150 },
        }

        const key = ingredientName.toLowerCase().includes('egg') ? 'eggs'
          : ingredientName.toLowerCase().includes('bacon') ? 'bacon'
          : ingredientName.toLowerCase().includes('tortilla') ? 'tortilla'
          : 'potatoes'

        const food = foods[key]
        return makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: `fdc_${key}`,
            name: food.name,
            servingSize: food.servingSize,
            servingUnit: 'g',
            calories: food.calories,
            proteinG: food.proteinG,
            carbohydrateG: food.carbohydrateG,
            fatG: food.fatG,
            isGeneric: true,
            matchScore: 90,
            matchReasons: ['Matched'],
          },
        })
      })

      // Conversion: each ingredient's factor maps quantity to serving fraction
      mockConvert.mockImplementation(async (_food, quantity, unit) => {
        // For test purposes, just return factor = 1
        return makeConversionResult(1, {
          portionDescription: `${quantity} ${unit}`,
        })
      })

      const result = await calculateNutrition({
        ingredients: [
          { name: 'eggs', quantity: 3, unit: 'piece' },
          { name: 'bacon', quantity: 3, unit: 'slice' },
          { name: 'flour tortilla', quantity: 1, unit: 'piece' },
          { name: "O'Brien potatoes", quantity: 1, unit: 'cup' },
        ],
      })

      expect(result.completeness).toBe('complete')
      expect(result.unresolvedIngredients).toHaveLength(0)
      expect(result.ingredients).toHaveLength(4)

      // Every ingredient should contribute non-zero calories
      for (const ing of result.ingredients) {
        expect(ing.resolved).toBe(true)
        expect(ing.calories).toBeGreaterThan(0)
      }

      // Total calories should be sum of all ingredients
      const expectedTotal = result.ingredients.reduce((sum, i) => sum + i.calories, 0)
      expect(result.totals.calories).toBe(expectedTotal)
    })
  })

  // ── Test 2: Tri-tip 12 tacos — raw beef, per-serving ─────────────────────────
  describe('Test 2: tri-tip 12 tacos', () => {
    it('returns per-serving breakdown and raw weight assumption note', async () => {
      vi.mocked(matchIngredient).mockResolvedValue(
        makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: 'fdc_tritip',
            name: 'Beef, tri-tip roast, separable lean and fat, trimmed to 0 inch fat, raw',
            servingSize: 100,
            servingUnit: 'g',
            calories: 179,
            proteinG: 21,
            carbohydrateG: 0,
            fatG: 10,
            isGeneric: true,
            matchScore: 88,
            matchReasons: ['Beef tri-tip match'],
          },
        }),
      )

      // 3 lb = 1360.78g → factor = 1360.78/100 = 13.6078
      vi.mocked(resolveIngredientFactor).mockResolvedValue(
        makeConversionResult(13.6078, {
          grams: 1360.78,
          portionDescription: '3 lb (1360.78g)',
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'tri-tip', quantity: 3, unit: 'lb' }],
        servings: 12,
        context: 'smoking a tri-tip',
      })

      expect(result.completeness).toBe('complete')
      expect(result.perServing).toBeDefined()
      expect(result.perServing!.servings).toBe(12)
      expect(result.perServing!.calories).toBeGreaterThan(0)
      expect(result.perServing!.calories).toBeLessThan(result.totals.calories)

      // Assumptions should mention raw weight and cooking
      const assumptionText = result.assumptions.join(' ')
      expect(assumptionText.toLowerCase()).toMatch(/raw|cook/)
    })
  })

  // ── Test 3: Same ingredients, 20 tacos — per-serving differs from 12-taco case ─
  describe('Test 3: 20 tacos — per-serving differs from 12-taco case', () => {
    it('divides totals by 20, producing different per-serving macros', async () => {
      vi.mocked(matchIngredient).mockResolvedValue(
        makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: 'fdc_tritip',
            name: 'Beef, tri-tip',
            servingSize: 100,
            servingUnit: 'g',
            calories: 179,
            proteinG: 21,
            carbohydrateG: 0,
            fatG: 10,
            isGeneric: true,
            matchScore: 88,
            matchReasons: [],
          },
        }),
      )
      vi.mocked(resolveIngredientFactor).mockResolvedValue(makeConversionResult(13.6078))

      const result12 = await calculateNutrition({
        ingredients: [{ name: 'tri-tip', quantity: 3, unit: 'lb' }],
        servings: 12,
      })
      const result20 = await calculateNutrition({
        ingredients: [{ name: 'tri-tip', quantity: 3, unit: 'lb' }],
        servings: 20,
      })

      // Totals should be identical
      expect(result12.totals.calories).toBe(result20.totals.calories)

      // Per-serving should differ
      expect(result12.perServing!.calories).toBeGreaterThan(result20.perServing!.calories)
      expect(result20.perServing!.servings).toBe(20)
    })
  })

  // ── Test 4: Chicken Alfredo — missing quantities ──────────────────────────────
  describe('Test 4: chicken Alfredo — pasta/yogurt/parmesan have no quantity', () => {
    it('only chicken contributes; others are unresolved; completeness is incomplete', async () => {
      const mockMatch = vi.mocked(matchIngredient)

      mockMatch.mockResolvedValue(
        makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: 'fdc_chicken',
            name: 'Chicken breast, raw',
            servingSize: 100,
            servingUnit: 'g',
            calories: 120,
            proteinG: 22,
            carbohydrateG: 0,
            fatG: 2.6,
            isGeneric: true,
            matchScore: 90,
            matchReasons: [],
          },
        }),
      )
      vi.mocked(resolveIngredientFactor).mockResolvedValue(makeConversionResult(2.267)) // 8 oz = 226.7g, factor=2.267

      const result = await calculateNutrition({
        ingredients: [
          { name: 'chicken breast', quantity: 8, unit: 'oz' },
          { name: 'pasta',          quantity: 0, unit: 'cup' },      // no quantity
          { name: 'Greek yogurt',   quantity: 0, unit: 'cup' },      // no quantity
          { name: 'Parmesan',       quantity: 0, unit: 'tbsp' },     // no quantity
        ],
      })

      // Only chicken resolved (3 with quantity=0 are unresolved)
      const resolvedCount = result.ingredients.filter(i => i.resolved).length
      expect(resolvedCount).toBe(1)
      expect(result.completeness).toBe('incomplete')
      expect(result.unresolvedIngredients).toHaveLength(3)

      // Chicken calories > 0
      const chicken = result.ingredients.find(i => i.matchedFoodName === 'Chicken breast, raw')
      expect(chicken?.resolved).toBe(true)
      expect(chicken?.calories).toBeGreaterThan(0)
    })
  })

  // ── Test 5: Ambiguous food (no_match) ─────────────────────────────────────────
  describe('Test 5: no_match for one ingredient', () => {
    it('places the no_match ingredient in unresolvedIngredients; others still resolve', async () => {
      const mockMatch = vi.mocked(matchIngredient)

      mockMatch.mockImplementation(async ({ ingredientName }) => {
        if (ingredientName.includes('mystery')) {
          return {
            confidence: 'no_match',
            topMatch: null,
            alternatives: [],
            rawResults: [],
          } as MatchResult
        }
        return makeMatchResult()
      })

      vi.mocked(resolveIngredientFactor).mockResolvedValue(makeConversionResult(1))

      const result = await calculateNutrition({
        ingredients: [
          { name: 'eggs', quantity: 2, unit: 'piece' },
          { name: 'mystery sauce', quantity: 1, unit: 'tbsp' },
        ],
      })

      expect(result.unresolvedIngredients).toHaveLength(1)
      expect(result.unresolvedIngredients[0].name).toBe('mystery sauce')
      expect(result.completeness).toBe('estimated')

      // The resolved egg should still have calories
      const egg = result.ingredients.find(i => i.userDescription.includes('eggs'))
      expect(egg?.resolved).toBe(true)
      expect(egg?.calories).toBeGreaterThan(0)
    })
  })

  // ── Test 6: Provider failure (matchIngredient throws) ─────────────────────────
  describe('Test 6: matchIngredient throws for one ingredient', () => {
    it('records the failure as unresolved; other ingredients continue; no exception', async () => {
      const mockMatch = vi.mocked(matchIngredient)

      mockMatch.mockImplementation(async ({ ingredientName }) => {
        if (ingredientName.includes('failing')) {
          throw new Error('Provider timeout')
        }
        return makeMatchResult()
      })

      vi.mocked(resolveIngredientFactor).mockResolvedValue(makeConversionResult(1))

      const result = await calculateNutrition({
        ingredients: [
          { name: 'eggs', quantity: 2, unit: 'piece' },
          { name: 'failing ingredient', quantity: 1, unit: 'g' },
        ],
      })

      // Should NOT throw
      expect(result).toBeDefined()
      expect(result.unresolvedIngredients).toHaveLength(1)
      expect(result.unresolvedIngredients[0].name).toBe('failing ingredient')

      // Eggs still resolved
      const egg = result.ingredients.find(i => i.userDescription.includes('eggs'))
      expect(egg?.resolved).toBe(true)
    })
  })

  // ── Test 7: Conversion error ──────────────────────────────────────────────────
  describe('Test 7: resolveIngredientFactor returns ConversionError', () => {
    it('places ingredient in unresolvedIngredients with conversion error reason', async () => {
      vi.mocked(matchIngredient).mockResolvedValue(makeMatchResult())
      vi.mocked(resolveIngredientFactor).mockResolvedValue(
        makeConversionError('unit_incompatible', 'Cannot convert cup to gram-basis food'),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'oats', quantity: 1, unit: 'cup' }],
      })

      expect(result.unresolvedIngredients).toHaveLength(1)
      expect(result.unresolvedIngredients[0].reason).toBe('conversion_error')
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.ingredients[0].errorReason).toMatch(/Cannot convert cup/)
      expect(result.completeness).toBe('incomplete')
    })
  })

  // ── Test 8: All unresolved ────────────────────────────────────────────────────
  describe('Test 8: all ingredients fail to match', () => {
    it('returns empty totals, incomplete completeness, all in unresolvedIngredients', async () => {
      vi.mocked(matchIngredient).mockResolvedValue({
        confidence: 'no_match',
        topMatch: null,
        alternatives: [],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [
          { name: 'food1', quantity: 1, unit: 'g' },
          { name: 'food2', quantity: 1, unit: 'g' },
        ],
      })

      expect(result.totals.calories).toBe(0)
      expect(result.totals.proteinG).toBe(0)
      expect(result.totals.carbG).toBe(0)
      expect(result.totals.fatG).toBe(0)
      expect(result.completeness).toBe('incomplete')
      expect(result.unresolvedIngredients).toHaveLength(2)
      expect(result.perServing).toBeUndefined()
    })
  })

  // ── Test 9: Per-100g food — factor doubles for 200g ───────────────────────────
  describe('Test 9: per-100g USDA food, user asks for 200g', () => {
    it('factor = 2, macros doubled from base', async () => {
      vi.mocked(matchIngredient).mockResolvedValue(
        makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: 'fdc_oats',
            name: 'Oats, raw',
            servingSize: 100,
            servingUnit: 'g',
            calories: 389,
            proteinG: 17,
            carbohydrateG: 66,
            fatG: 7,
            isGeneric: true,
            matchScore: 92,
            matchReasons: [],
          },
        }),
      )

      vi.mocked(resolveIngredientFactor).mockResolvedValue(
        makeConversionResult(2, {
          grams: 200,
          portionDescription: '200g',
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'oats', quantity: 200, unit: 'g' }],
      })

      expect(result.ingredients[0].calories).toBe(Math.round(389 * 2))
      expect(result.ingredients[0].proteinG).toBeCloseTo(17 * 2, 1)
      expect(result.completeness).toBe('complete')
    })
  })

  // ── Test 10: Manufacturer serving food — factor = 1 ─────────────────────────
  describe('Test 10: FatSecret food, user asks for 1 serving', () => {
    it('factor = 1, macros match the food record exactly', async () => {
      vi.mocked(matchIngredient).mockResolvedValue(
        makeMatchResult({
          confidence: 'confident',
          topMatch: {
            provider: 'fatsecret',
            externalId: 'fs_granola_bar',
            name: 'Nature Valley Granola Bar',
            servingSize: 50,
            servingUnit: 'g',
            calories: 220,
            proteinG: 4,
            carbohydrateG: 30,
            fatG: 9,
            isGeneric: false,
            matchScore: 91,
            matchReasons: ['Branded product match'],
          },
        }),
      )

      vi.mocked(resolveIngredientFactor).mockResolvedValue(
        makeConversionResult(1, {
          grams: 50,
          portionDescription: '1 serving (50g)',
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'Nature Valley granola bar', quantity: 1, unit: 'serving' }],
      })

      expect(result.ingredients[0].calories).toBe(220)
      expect(result.ingredients[0].proteinG).toBeCloseTo(4, 1)
      expect(result.ingredients[0].carbG).toBeCloseTo(30, 1)
      expect(result.ingredients[0].fatG).toBeCloseTo(9, 1)
      expect(result.completeness).toBe('complete')
    })
  })

  // ── Test 11: Plausible match confidence is surfaced in IngredientResult ───────
  // Regression: matchConfidence must reflect the actual match.confidence value,
  // not be hardcoded to 'confident'. If a plausible match is accepted,
  // V must be able to communicate that uncertainty to the user.
  describe('Test 11: plausible match confidence surfaces in IngredientResult', () => {
    it('matchConfidence is "plausible" when matcher returns plausible', async () => {
      vi.mocked(matchIngredient).mockResolvedValue(
        makeMatchResult({
          confidence: 'plausible',
          topMatch: {
            provider: 'usda_fooddata',
            externalId: 'fdc_potatoes',
            name: "O'Brien Potatoes",
            servingSize: 100,
            servingUnit: 'g',
            calories: 89,
            proteinG: 2,
            carbohydrateG: 20,
            fatG: 0.1,
            isGeneric: true,
            matchScore: 72,
            matchReasons: ['Plausible match'],
          },
        }),
      )

      vi.mocked(resolveIngredientFactor).mockResolvedValue(
        makeConversionResult(1.5, { grams: 150, portionDescription: '1 cup (150g)' }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: "O'Brien potatoes", quantity: 1, unit: 'cup' }],
      })

      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].matchConfidence).toBe('plausible')
      expect(result.ingredients[0].calories).toBe(Math.round(89 * 1.5))
    })

    it('matchConfidence is "confident" when matcher returns confident', async () => {
      vi.mocked(matchIngredient).mockResolvedValue(
        makeMatchResult({ confidence: 'confident' }),
      )
      vi.mocked(resolveIngredientFactor).mockResolvedValue(makeConversionResult(1))

      const result = await calculateNutrition({
        ingredients: [{ name: 'oats', quantity: 100, unit: 'g' }],
      })

      expect(result.ingredients[0].matchConfidence).toBe('confident')
    })
  })

  // ── Test 12: quantity=0 skips matchIngredient entirely ───────────────────────
  // Regression: when quantity is 0, the guard must short-circuit before calling
  // matchIngredient. A provider call for a zero-quantity ingredient wastes a round
  // trip and may return confusing results. Verify the mock is not invoked.
  describe('Test 12: quantity=0 never calls matchIngredient', () => {
    it('matchIngredient is NOT called for quantity=0 ingredient', async () => {
      const mockMatch = vi.mocked(matchIngredient)
      mockMatch.mockResolvedValue(makeMatchResult())
      vi.mocked(resolveIngredientFactor).mockResolvedValue(makeConversionResult(1))

      const result = await calculateNutrition({
        ingredients: [
          { name: 'egg', quantity: 0, unit: 'piece' },
        ],
      })

      // matchIngredient should NOT have been called for a zero-quantity ingredient
      expect(mockMatch).not.toHaveBeenCalled()

      // Ingredient is unresolved with missing_quantity reason
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.ingredients[0].errorReason).toMatch(/no quantity/i)
      expect(result.ingredients[0].calories).toBe(0)
      expect(result.unresolvedIngredients[0].reason).toBe('missing_quantity')
      expect(result.completeness).toBe('incomplete')
    })
  })
})
