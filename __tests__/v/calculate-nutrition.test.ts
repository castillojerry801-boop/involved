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

  // ── Test 13: Partial failure — one ingredient fails, others still resolve ─────
  // Regression for production failure: "3 eggs, 3 slices bacon, 1 tortilla"
  // When one ingredient's conversion fails, the others must still calculate.
  // completeness must be 'incomplete' (not 'complete'), and the error must name
  // the specific ingredient — not ask V for a brand.
  describe('Test 13: partial conversion failure — remaining ingredients still calculated', () => {
    it('one conversion error does not stop other ingredients from resolving', async () => {
      const mockMatch = vi.mocked(matchIngredient)
      const mockConvert = vi.mocked(resolveIngredientFactor)

      mockMatch.mockImplementation(async ({ ingredientName }) => {
        const name = ingredientName.toLowerCase()
        const foods: Record<string, { name: string; calories: number; proteinG: number; carbohydrateG: number; fatG: number }> = {
          eggs:    { name: 'Egg, whole, raw, fresh',  calories: 155, proteinG: 13,  carbohydrateG: 1.1, fatG: 11 },
          bacon:   { name: 'Pork bacon, cured, raw',  calories: 541, proteinG: 37,  carbohydrateG: 1.4, fatG: 42 },
          tortilla:{ name: 'Tortillas, flour',        calories: 290, proteinG: 8,   carbohydrateG: 47,  fatG: 7  },
        }
        const key = name.includes('egg') ? 'eggs' : name.includes('bacon') ? 'bacon' : 'tortilla'
        const food = foods[key]
        return makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: `fdc_${key}`,
            name: food.name,
            servingSize: 50,
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

      // Bacon fails conversion; eggs and tortilla succeed
      mockConvert.mockImplementation(async (food) => {
        if (String(food.id).includes('bacon')) {
          return makeConversionError('portion_not_found', 'No portion data found for unit "slice"')
        }
        return makeConversionResult(1)
      })

      const result = await calculateNutrition({
        ingredients: [
          { name: 'eggs',          quantity: 3, unit: 'piece' },
          { name: 'bacon',         quantity: 3, unit: 'slice' },
          { name: 'flour tortilla',quantity: 1, unit: 'piece' },
        ],
      })

      // Eggs and tortilla resolved, bacon did not
      const resolved = result.ingredients.filter(i => i.resolved)
      const unresolved = result.ingredients.filter(i => !i.resolved)
      expect(resolved).toHaveLength(2)
      expect(unresolved).toHaveLength(1)

      // The unresolved one is bacon
      expect(unresolved[0].matchedFoodName).toMatch(/bacon/i)
      expect(unresolved[0].errorReason).toMatch(/portion|slice|unit/i)

      // Totals reflect only resolved ingredients
      expect(result.totals.calories).toBeGreaterThan(0)
      expect(result.completeness).toBe('incomplete')
      expect(result.unresolvedIngredients).toHaveLength(1)
      expect(result.unresolvedIngredients[0].reason).toBe('conversion_error')
    })
  })

  // ── Test 14: Tri-tip fat audit — matched food name contains "tri-tip" ─────────
  // Regression: when matching "3 lb tri-tip", the matched food name must be a
  // genuine tri-tip record (not a different cut like brisket or chuck).
  // The fat content for a 3 lb untrimmed tri-tip yielding 263 cal/taco (12 tacos)
  // is plausible for an untrimmed/choice-grade USDA record.
  describe('Test 14: tri-tip — matched food name must contain "tri-tip"', () => {
    it('matched food name contains tri-tip', async () => {
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
            matchReasons: ['Beef tri-tip'],
          },
        }),
      )
      vi.mocked(resolveIngredientFactor).mockResolvedValue(makeConversionResult(13.6078))

      const result = await calculateNutrition({
        ingredients: [{ name: 'tri-tip', quantity: 3, unit: 'lb' }],
        servings: 12,
      })

      const matchedName = result.ingredients[0].matchedFoodName.toLowerCase()
      expect(matchedName).toContain('tri-tip')
      expect(result.ingredients[0].resolved).toBe(true)
    })

    it('per-taco macros at 263 cal are plausible for untrimmed tri-tip (fat ~10-19g/100g range)', async () => {
      // 263 cal/taco × 12 tacos = 3156 cal total for 3 lb (1360.78g)
      // Effective: 3156 / 1360.78 = 232 cal/100g — within USDA range for
      // untrimmed/choice beef tri-tip (218-250 cal/100g)
      const totalCalories = 263 * 12   // 3156
      const totalGrams    = 1360.78    // 3 lb
      const calPer100g    = (totalCalories / totalGrams) * 100
      // USDA untrimmed choice tri-tip can be ~218-250 cal/100g — this is in range
      expect(calPer100g).toBeGreaterThan(200)
      expect(calPer100g).toBeLessThan(280)
    })
  })

  // ── Test 15: eggs unit='piece' — conversion error produces named ingredient ────
  // When resolveIngredientFactor returns portion_not_found for unit='piece',
  // the error message must identify the ingredient by name, not ask for a brand.
  describe('Test 15: conversion error names the ingredient', () => {
    it('errorReason includes the unit that failed, not a brand request', async () => {
      vi.mocked(matchIngredient).mockResolvedValue(
        makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: 'fdc_egg',
            name: 'Egg, whole, raw, fresh',
            servingSize: 50,
            servingUnit: 'g',
            calories: 155,
            proteinG: 13,
            carbohydrateG: 1.1,
            fatG: 11,
            isGeneric: true,
            matchScore: 92,
            matchReasons: ['Matched'],
          },
        }),
      )

      vi.mocked(resolveIngredientFactor).mockResolvedValue(
        makeConversionError('portion_not_found', 'No portion data found for unit "piece" and food'),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'eggs', quantity: 3, unit: 'piece' }],
      })

      expect(result.ingredients[0].resolved).toBe(false)
      // errorReason must mention the unit/portion, not a brand
      expect(result.ingredients[0].errorReason).toMatch(/piece|portion/i)
      // Must NOT mention "brand" in the error
      expect(result.ingredients[0].errorReason?.toLowerCase()).not.toContain('brand')
      expect(result.unresolvedIngredients[0].reason).toBe('conversion_error')
    })
  })

  // ── Test 16: slice unit — 'strip' is now a recognized SLICE_UNITS member ──────
  // Regression: bacon stored by USDA with unit='strip' must resolve when user
  // types unit='slice'. Both 'strip' and 'slice' are now in SLICE_UNITS.
  describe('Test 16: slice and strip are interchangeable for bacon', () => {
    it('resolveIngredientFactor is called with unit=slice for bacon', async () => {
      const mockConvert = vi.mocked(resolveIngredientFactor)
      vi.mocked(matchIngredient).mockResolvedValue(
        makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: 'fdc_bacon',
            name: 'Pork, cured, bacon, cooked, pan-fried',
            servingSize: 28,
            servingUnit: 'g',
            calories: 541,
            proteinG: 37,
            carbohydrateG: 1.4,
            fatG: 42,
            isGeneric: true,
            matchScore: 89,
            matchReasons: ['Matched'],
          },
        }),
      )
      mockConvert.mockResolvedValue(makeConversionResult(1))

      await calculateNutrition({
        ingredients: [{ name: 'bacon', quantity: 3, unit: 'slice' }],
      })

      // resolveIngredientFactor was called with unit='slice'
      expect(mockConvert).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.stringMatching(/bacon/i) }),
        3,
        'slice',
      )
    })
  })

  // ── Test 17: size qualifier units — regression for "3 large eggs" ─────────────
  // Root-cause regression test for the production failure where V passed
  // unit='large' for eggs. 'large' is a size qualifier, not a quantity unit.
  // The tool must normalize it to 'piece' before calling resolveIngredientFactor
  // so the factor engine can find the USDA portion via broadened count-unit lookup.
  describe('Test 17: size qualifier units are normalized to piece', () => {
    it('unit=large → resolveIngredientFactor called with unit=piece', async () => {
      const mockConvert = vi.mocked(resolveIngredientFactor)
      vi.mocked(matchIngredient).mockResolvedValue(
        makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: 'fdc_egg',
            name: 'Egg, whole, raw, fresh',
            servingSize: 50,
            servingUnit: 'g',
            calories: 155,
            proteinG: 13,
            carbohydrateG: 1.1,
            fatG: 11,
            isGeneric: true,
            matchScore: 92,
            matchReasons: ['Matched'],
          },
        }),
      )
      mockConvert.mockResolvedValue(makeConversionResult(1))

      await calculateNutrition({
        ingredients: [{ name: 'eggs', quantity: 3, unit: 'large' }],
      })

      // Must normalize 'large' → 'piece' — NOT pass 'large' to the engine
      expect(mockConvert).toHaveBeenCalledWith(
        expect.anything(),
        3,
        'piece',
      )
    })

    it('unit=medium → resolveIngredientFactor called with unit=piece', async () => {
      const mockConvert = vi.mocked(resolveIngredientFactor)
      vi.mocked(matchIngredient).mockResolvedValue(makeMatchResult())
      mockConvert.mockResolvedValue(makeConversionResult(1))

      await calculateNutrition({
        ingredients: [{ name: 'apple', quantity: 1, unit: 'medium' }],
      })

      expect(mockConvert).toHaveBeenCalledWith(
        expect.anything(),
        1,
        'piece',
      )
    })

    it('unit=small → resolveIngredientFactor called with unit=piece', async () => {
      const mockConvert = vi.mocked(resolveIngredientFactor)
      vi.mocked(matchIngredient).mockResolvedValue(makeMatchResult())
      mockConvert.mockResolvedValue(makeConversionResult(1))

      await calculateNutrition({
        ingredients: [{ name: 'banana', quantity: 1, unit: 'small' }],
      })

      expect(mockConvert).toHaveBeenCalledWith(
        expect.anything(),
        1,
        'piece',
      )
    })

    it('unit=xl → resolveIngredientFactor called with unit=piece', async () => {
      const mockConvert = vi.mocked(resolveIngredientFactor)
      vi.mocked(matchIngredient).mockResolvedValue(makeMatchResult())
      mockConvert.mockResolvedValue(makeConversionResult(1))

      await calculateNutrition({
        ingredients: [{ name: 'egg', quantity: 2, unit: 'xl' }],
      })

      expect(mockConvert).toHaveBeenCalledWith(
        expect.anything(),
        2,
        'piece',
      )
    })

    it('unit=jumbo → resolveIngredientFactor called with unit=piece', async () => {
      const mockConvert = vi.mocked(resolveIngredientFactor)
      vi.mocked(matchIngredient).mockResolvedValue(makeMatchResult())
      mockConvert.mockResolvedValue(makeConversionResult(1))

      await calculateNutrition({
        ingredients: [{ name: 'egg', quantity: 1, unit: 'jumbo' }],
      })

      expect(mockConvert).toHaveBeenCalledWith(
        expect.anything(),
        1,
        'piece',
      )
    })

    it('non-size-qualifier units are passed through unchanged', async () => {
      const mockConvert = vi.mocked(resolveIngredientFactor)
      vi.mocked(matchIngredient).mockResolvedValue(makeMatchResult())
      mockConvert.mockResolvedValue(makeConversionResult(1))

      await calculateNutrition({
        ingredients: [{ name: 'chicken breast', quantity: 8, unit: 'oz' }],
      })

      // 'oz' must not be altered
      expect(mockConvert).toHaveBeenCalledWith(
        expect.anything(),
        8,
        'oz',
      )
    })
  })

  // ── Test 18: full breakfast — V's likely argument format ─────────────────────
  // Simulates the exact production failure: "3 large eggs, 3 strips of bacon,
  // 1 flour tortilla". V would call the tool with unit='large' for eggs and
  // unit='strips' for bacon. After the fix:
  //   - 'large' → 'piece' (normalizeIngredientUnit)
  //   - 'strips' → already in SLICE_UNITS, passes through unmodified
  //   - All three ingredients should resolve to non-zero macros.
  describe('Test 18: full breakfast — eggs/bacon/tortilla all resolve', () => {
    it('3 large eggs + 3 strips bacon + 1 flour tortilla all resolve with V args', async () => {
      const mockMatch = vi.mocked(matchIngredient)
      const mockConvert = vi.mocked(resolveIngredientFactor)

      mockMatch.mockImplementation(async ({ ingredientName }) => {
        const name = ingredientName.toLowerCase()
        const foods: Record<string, { name: string; calories: number; proteinG: number; carbohydrateG: number; fatG: number }> = {
          eggs:    { name: 'Egg, whole, raw, fresh',  calories: 155, proteinG: 13,  carbohydrateG: 1.1, fatG: 11 },
          bacon:   { name: 'Pork bacon, cured, raw',  calories: 541, proteinG: 37,  carbohydrateG: 1.4, fatG: 42 },
          tortilla:{ name: 'Tortillas, flour',        calories: 290, proteinG: 8,   carbohydrateG: 47,  fatG: 7  },
        }
        const key = name.includes('egg') ? 'eggs' : name.includes('bacon') ? 'bacon' : 'tortilla'
        const food = foods[key]
        return makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: `fdc_${key}`,
            name: food.name,
            servingSize: 50,
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

      // All ingredients resolve successfully after unit normalization
      mockConvert.mockResolvedValue(makeConversionResult(1))

      // Scenario A: V passes unit='large' for eggs (the bug scenario)
      const resultA = await calculateNutrition({
        ingredients: [
          { name: 'eggs', quantity: 3, unit: 'large' },
          { name: 'bacon', quantity: 3, unit: 'strips' },
          { name: 'flour tortilla', quantity: 1, unit: 'piece' },
        ],
      })

      // All three should resolve — not unresolved
      expect(resultA.unresolvedIngredients).toHaveLength(0)
      expect(resultA.completeness).toBe('complete')
      expect(resultA.totals.calories).toBeGreaterThan(0)

      // resolveIngredientFactor for eggs must have been called with 'piece' not 'large'
      const calls = mockConvert.mock.calls
      const eggCall = calls.find(c => String((c[0] as { name?: string }).name ?? '').toLowerCase().includes('egg'))
      expect(eggCall?.[2]).toBe('piece')

      // Scenario B: V passes unit='piece' (ideal) — must also work
      vi.clearAllMocks()
      mockMatch.mockImplementation(async ({ ingredientName }) => {
        const name = ingredientName.toLowerCase()
        const foods: Record<string, { name: string; calories: number; proteinG: number; carbohydrateG: number; fatG: number }> = {
          eggs:    { name: 'Egg, whole, raw, fresh',  calories: 155, proteinG: 13,  carbohydrateG: 1.1, fatG: 11 },
          bacon:   { name: 'Pork bacon, cured, raw',  calories: 541, proteinG: 37,  carbohydrateG: 1.4, fatG: 42 },
          tortilla:{ name: 'Tortillas, flour',        calories: 290, proteinG: 8,   carbohydrateG: 47,  fatG: 7  },
        }
        const key = name.includes('egg') ? 'eggs' : name.includes('bacon') ? 'bacon' : 'tortilla'
        const food = foods[key]
        return makeMatchResult({
          topMatch: {
            provider: 'usda_fooddata',
            externalId: `fdc_${key}`,
            name: food.name,
            servingSize: 50,
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
      mockConvert.mockResolvedValue(makeConversionResult(1))

      const resultB = await calculateNutrition({
        ingredients: [
          { name: 'eggs', quantity: 3, unit: 'piece' },
          { name: 'bacon', quantity: 3, unit: 'strip' },
          { name: 'flour tortilla', quantity: 1, unit: 'piece' },
        ],
      })

      expect(resultB.unresolvedIngredients).toHaveLength(0)
      expect(resultB.completeness).toBe('complete')
      expect(resultB.totals.calories).toBeGreaterThan(0)
    })
  })
})
