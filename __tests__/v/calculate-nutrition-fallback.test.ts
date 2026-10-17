/**
 * calculateNutrition — Part C: Alternative candidate fallback
 *
 * When the top match fails conversion (e.g., library food with no portion data,
 * or FatSecret record whose only serving is "meal"), the tool falls through to
 * match.alternatives in ranked order, applying the same enrichment logic.
 *
 * Scenarios:
 *   1. Top match is a library (ai_vision) food with no household unit → falls back to FatSecret alt → resolves
 *   2. Top FatSecret match has "meal" serving (ambiguous count) → falls back to alt with "patty" → resolves
 *   3. All alternatives also fail → ingredient recorded as unresolved (no crash, no invented macros)
 *   4. Top match resolves → alternatives never tried (no unnecessary enrichment calls)
 *   5. "frozen chicken patties" + "Hawaiian buns" — both resolve via alternatives
 *   6. Fallback result marked 'plausible' regardless of alt's original score
 *   7. Partial result: one ingredient resolves, one doesn't — partial totals reported
 *   8. Plural quantities ("two patties", "a bun with each") → quantities respected
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MatchResult } from '../../lib/nutrition/matching/types'
import type { ExternalFoodDetail } from '../../lib/nutrition/providers/types'
import { CALCULATE_NUTRITION_TOOL } from '../../app/api/coach/constants'

vi.mock('../../lib/nutrition/matching/matcher', () => ({
  matchIngredient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    foodItem: { findFirst: vi.fn().mockResolvedValue(null) },
    foodItemPortion: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
  },
}))

vi.mock('../../lib/nutrition/conversion/portions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nutrition/conversion/portions')>()
  return {
    ...actual,
    fetchAndStoreUsdaPortions: vi.fn().mockResolvedValue([]),
    lookupPortions: vi.fn().mockResolvedValue([]),
  }
})

vi.mock('../../lib/nutrition/providers/fatsecret', () => {
  class MockFatSecretProvider {
    name = 'FatSecret'
    providerId = 'fatsecret'
    async getById(_id: string) { return null }
    async getByIdForEnrichment(_id: string, _inputUnit: string) { return null }
    async search() { return [] }
    async searchByBarcode() { return null }
  }
  return { FatSecretProvider: MockFatSecretProvider }
})

import { calculateNutrition } from '../../lib/v/tools/calculate-nutrition'
import { matchIngredient } from '../../lib/nutrition/matching/matcher'
import { FatSecretProvider } from '../../lib/nutrition/providers/fatsecret'
import { isConversionError } from '../../lib/nutrition/conversion/types'

const mockMatchIngredient = vi.mocked(matchIngredient)

// ── Stub builders ─────────────────────────────────────────────────────────────

function makeFatSecretMatch(overrides: {
  externalId: string
  name: string
  servingSize: number
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  householdUnit?: string
  householdServingText?: string
  unitsPerServing?: number
  confidence?: MatchResult['confidence']
  alternatives?: MatchResult['alternatives']
}): MatchResult {
  return {
    confidence: overrides.confidence ?? 'confident',
    topMatch: {
      provider: 'fatsecret',
      externalId: overrides.externalId,
      name: overrides.name,
      servingSize: overrides.servingSize,
      servingUnit: 'g',
      householdUnit: overrides.householdUnit,
      unitsPerServing: overrides.unitsPerServing,
      householdServingText: overrides.householdServingText,
      calories: overrides.calories,
      proteinG: overrides.proteinG,
      carbohydrateG: overrides.carbohydrateG,
      fatG: overrides.fatG,
      isGeneric: true,
      matchScore: 85,
      matchReasons: ['FatSecret generic'],
      fdcDataType: undefined,
    },
    alternatives: overrides.alternatives ?? [],
    rawResults: [],
  }
}

function makeLibraryMatch(overrides: {
  internalId: string
  name: string
  servingSize: number
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  alternatives?: MatchResult['alternatives']
}): MatchResult {
  return {
    confidence: 'confident',
    topMatch: {
      provider: 'ai_vision',
      externalId: overrides.internalId,
      internalId: overrides.internalId,
      name: overrides.name,
      servingSize: overrides.servingSize,
      servingUnit: 'g',
      householdUnit: undefined,
      unitsPerServing: undefined,
      householdServingText: undefined,
      calories: overrides.calories,
      proteinG: overrides.proteinG,
      carbohydrateG: overrides.carbohydrateG,
      fatG: overrides.fatG,
      isGeneric: false,
      matchScore: 90,
      matchReasons: ['library match'],
      fdcDataType: undefined,
    },
    alternatives: overrides.alternatives ?? [],
    rawResults: [],
  }
}

// A FatSecret FoodMatch (not a full MatchResult — used inside alternatives array)
function makeFatSecretAlt(overrides: {
  externalId: string
  name: string
  servingSize: number
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  householdUnit?: string
  householdServingText?: string
  unitsPerServing?: number
}) {
  return {
    provider: 'fatsecret' as const,
    externalId: overrides.externalId,
    name: overrides.name,
    servingSize: overrides.servingSize,
    servingUnit: 'g',
    householdUnit: overrides.householdUnit,
    unitsPerServing: overrides.unitsPerServing,
    householdServingText: overrides.householdServingText,
    calories: overrides.calories,
    proteinG: overrides.proteinG,
    carbohydrateG: overrides.carbohydrateG,
    fatG: overrides.fatG,
    isGeneric: true,
    matchScore: 75,
    matchReasons: ['FatSecret alt'],
    fdcDataType: undefined,
  }
}

// FatSecret detail response stub with a clear count serving
function makeDetail(servingDesc: string, gramWeight: number, calories: number, proteinG: number, carbG: number, fatG: number): ExternalFoodDetail {
  return {
    provider: 'fatsecret',
    externalId: 'stub',
    name: 'stub',
    brand: undefined,
    isGeneric: true,
    servingSize: gramWeight,
    servingUnit: 'g',
    householdServingText: servingDesc,
    householdUnit: servingDesc.split(' ').pop()?.replace(/[^a-z]/gi, '') ?? undefined,
    unitsPerServing: 1,
    coreNutrients: { calories, proteinG, carbohydrateG: carbG, fatG },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calculateNutrition — alternative candidate fallback (Part C)', () => {
  let getByIdForEnrichmentSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    getByIdForEnrichmentSpy = vi.spyOn(
      FatSecretProvider.prototype,
      'getByIdForEnrichment',
    )
  })

  describe('library (ai_vision) food fails count-unit conversion → falls back to FatSecret alt', () => {
    it('resolves Hawaiian bun via FatSecret alt when library food has no household unit', async () => {
      // Library food matched first (library bonus), but has no household unit or portions
      // Alt: FatSecret "Hawaiian Roll" with "1 roll" = 43g
      mockMatchIngredient.mockResolvedValue(
        makeLibraryMatch({
          internalId: 'lib-bun-uuid',
          name: 'Hawaiian Hamburger Bun',
          servingSize: 100,
          calories: 280,
          proteinG: 8,
          carbohydrateG: 50,
          fatG: 4,
          alternatives: [
            makeFatSecretAlt({
              externalId: 'fs-roll-1',
              name: 'Hawaiian Roll',
              servingSize: 43,
              servingUnit: 'g',
              householdUnit: 'roll',
              householdServingText: '1 roll',
              unitsPerServing: 1,
              calories: 120,
              proteinG: 3,
              carbohydrateG: 22,
              fatG: 2,
            } as Parameters<typeof makeFatSecretAlt>[0]),
          ],
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'Hawaiian bun', quantity: 2, unit: 'piece' }],
        servings: 1,
      })

      expect(result.ingredients).toHaveLength(1)
      const ing = result.ingredients[0]
      expect(ing.resolved).toBe(true)
      // Used the alt: "Hawaiian Roll" at 43g × 2
      expect(ing.matchedFoodName).toBe('Hawaiian Roll')
      expect(ing.matchConfidence).toBe('plausible') // downgraded from 'confident'
      expect(ing.calories).toBe(240) // 120 × 2
      expect(getByIdForEnrichmentSpy).not.toHaveBeenCalled() // alt already had household unit
    })

    it('enriches FatSecret alt before resolution when alt lacks household unit', async () => {
      // Alt has no household unit — needs enrichment to get "1 patty" serving
      const altWithoutUnit = makeFatSecretAlt({
        externalId: 'fs-patty-2',
        name: 'Chicken Patty',
        servingSize: 83,
        calories: 180,
        proteinG: 12,
        carbohydrateG: 10,
        fatG: 9,
      })

      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-patty-1',
          name: 'Chicken Patties',
          servingSize: 226,
          calories: 380,
          proteinG: 27,
          carbohydrateG: 25,
          fatG: 18,
          // "meal" triggers NON_COUNT_HOUSEHOLD_WORDS → enrichment fires but returns "meal" → fails
          householdServingText: '1 meal (8 oz)',
          householdUnit: 'meal (8 oz)',
          unitsPerServing: 1,
          alternatives: [altWithoutUnit],
        }),
      )

      // Detail for alt returns a "patty" serving
      getByIdForEnrichmentSpy.mockResolvedValueOnce(
        makeDetail('1 patty', 83, 180, 12, 10, 9),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'chicken patty', quantity: 1, unit: 'piece' }],
        servings: 1,
      })

      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].matchedFoodName).toBe('Chicken Patty')
      expect(result.ingredients[0].matchConfidence).toBe('plausible')
      expect(result.ingredients[0].calories).toBe(180)
      expect(getByIdForEnrichmentSpy).toHaveBeenCalledWith('fs-patty-2', 'piece')
    })
  })

  describe('FatSecret top match fails → alternative resolves', () => {
    it('chicken patty with "meal" serving falls back to alt with "patty" serving, quantity=2', async () => {
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-2917',
          name: 'Chicken Patties (Meal)',
          servingSize: 226,
          calories: 380,
          proteinG: 27,
          carbohydrateG: 25,
          fatG: 18,
          householdServingText: '1 meal (8 oz)',
          householdUnit: 'meal (8 oz)',
          unitsPerServing: 1,
          alternatives: [
            makeFatSecretAlt({
              externalId: 'fs-patty-3',
              name: 'Frozen Chicken Patty',
              servingSize: 83,
              calories: 180,
              proteinG: 12,
              carbohydrateG: 10,
              fatG: 9,
              householdUnit: 'patty',
              householdServingText: '1 patty',
              unitsPerServing: 1,
            } as Parameters<typeof makeFatSecretAlt>[0]),
          ],
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'frozen chicken patties', quantity: 2, unit: 'piece' }],
        servings: 1,
      })

      const ing = result.ingredients[0]
      expect(ing.resolved).toBe(true)
      expect(ing.matchedFoodName).toBe('Frozen Chicken Patty')
      expect(ing.matchConfidence).toBe('plausible')
      expect(ing.calories).toBe(360) // 180 × 2
      expect(ing.proteinG).toBeCloseTo(24, 1)
      expect(getByIdForEnrichmentSpy).not.toHaveBeenCalled() // alt already had "patty" unit
    })
  })

  describe('all alternatives also fail → unresolved without crash', () => {
    it('records unresolved when topMatch and all alternatives fail conversion', async () => {
      // All three (top + 2 alts) have "serving" descriptions that won't resolve for piece
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-xx1',
          name: 'Chicken Patties Brand A',
          servingSize: 100,
          calories: 250,
          proteinG: 15,
          carbohydrateG: 20,
          fatG: 12,
          householdServingText: '1 serving',
          householdUnit: 'serving',
          alternatives: [
            makeFatSecretAlt({
              externalId: 'fs-xx2',
              name: 'Chicken Patties Brand B',
              servingSize: 100,
              calories: 240,
              proteinG: 14,
              carbohydrateG: 19,
              fatG: 12,
              householdUnit: 'serving',
              householdServingText: '1 serving',
            } as Parameters<typeof makeFatSecretAlt>[0]),
          ],
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'chicken patties', quantity: 2, unit: 'piece' }],
        servings: 1,
      })

      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.completeness).toBe('incomplete')
      expect(result.unresolvedIngredients).toHaveLength(1)
      // No invented macros
      expect(result.ingredients[0].calories).toBe(0)
    })
  })

  describe('top match succeeds → alternatives never tried', () => {
    it('does not enrich alternatives when top match resolves', async () => {
      // Top match has 'strip' serving — resolves directly
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-bacon-1',
          name: 'Bacon',
          servingSize: 8,
          calories: 43,
          proteinG: 3,
          carbohydrateG: 0.1,
          fatG: 3.3,
          householdUnit: 'strip',
          householdServingText: '1 strip',
          unitsPerServing: 1,
          alternatives: [
            makeFatSecretAlt({
              externalId: 'fs-bacon-alt',
              name: 'Turkey Bacon',
              servingSize: 8,
              calories: 35,
              proteinG: 4,
              carbohydrateG: 0.5,
              fatG: 1.5,
            }),
          ],
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'bacon', quantity: 3, unit: 'strip' }],
        servings: 1,
      })

      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].matchedFoodName).toBe('Bacon')
      expect(result.ingredients[0].matchConfidence).toBe('confident') // not downgraded
      expect(getByIdForEnrichmentSpy).not.toHaveBeenCalled()
    })
  })

  describe('partial results — one resolves, one does not', () => {
    it('reports partial totals when only one of two ingredients resolves', async () => {
      mockMatchIngredient
        // Chicken patty — top fails, alt resolves
        .mockResolvedValueOnce(
          makeFatSecretMatch({
            externalId: 'fs-patty-meal',
            name: 'Chicken Patties',
            servingSize: 226,
            calories: 380,
            proteinG: 27,
            carbohydrateG: 25,
            fatG: 18,
            householdServingText: '1 meal (8 oz)',
            householdUnit: 'meal (8 oz)',
            unitsPerServing: 1,
            alternatives: [
              makeFatSecretAlt({
                externalId: 'fs-patty-good',
                name: 'Chicken Patty',
                servingSize: 83,
                calories: 180,
                proteinG: 12,
                carbohydrateG: 10,
                fatG: 9,
                householdUnit: 'patty',
                householdServingText: '1 patty',
                unitsPerServing: 1,
              } as Parameters<typeof makeFatSecretAlt>[0]),
            ],
          }),
        )
        // Hawaiian bun — all fail (no alternatives)
        .mockResolvedValueOnce(
          makeLibraryMatch({
            internalId: 'lib-bun',
            name: 'Hawaiian Bun',
            servingSize: 100,
            calories: 280,
            proteinG: 8,
            carbohydrateG: 50,
            fatG: 4,
            alternatives: [], // no alternatives to try
          }),
        )

      const result = await calculateNutrition({
        ingredients: [
          { name: 'frozen chicken patties', quantity: 2, unit: 'piece' },
          { name: 'Hawaiian buns', quantity: 2, unit: 'piece' },
        ],
        servings: 1,
      })

      const [pattyResult, bunResult] = result.ingredients
      expect(pattyResult.resolved).toBe(true)
      expect(pattyResult.calories).toBe(360) // 180 × 2
      expect(bunResult.resolved).toBe(false)
      expect(result.completeness).toBe('incomplete')
      // Partial total reflects only resolved ingredient
      expect(result.totals.calories).toBe(360)
    })
  })

  describe('quantity interpretation for plural and "with each" phrasing', () => {
    it('"two chicken patties" → quantity 2, not 1', async () => {
      // V should extract quantity=2 before passing to the tool.
      // This test verifies the tool correctly uses that quantity (multiplication factor).
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-patty-q',
          name: 'Chicken Patty',
          servingSize: 83,
          calories: 180,
          proteinG: 12,
          carbohydrateG: 10,
          fatG: 9,
          householdUnit: 'patty',
          householdServingText: '1 patty',
          unitsPerServing: 1,
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'frozen chicken patties', quantity: 2, unit: 'piece' }],
        servings: 1,
      })

      expect(result.ingredients[0].calories).toBe(360) // 180 × 2
    })

    it('"a bun with each of two patties" → quantity 2 buns correctly multiplied', async () => {
      // "a Hawaiian bun with each [patty]" = 2 buns
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-bun-q',
          name: 'Hawaiian Roll',
          servingSize: 43,
          calories: 120,
          proteinG: 3,
          carbohydrateG: 22,
          fatG: 2,
          householdUnit: 'roll',
          householdServingText: '1 roll',
          unitsPerServing: 1,
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'Hawaiian hamburger bun', quantity: 2, unit: 'piece' }],
        servings: 1,
      })

      expect(result.ingredients[0].calories).toBe(240) // 120 × 2
    })
  })

  describe('Check 3 — tool schema requires quantity per ingredient', () => {
    it('CALCULATE_NUTRITION_TOOL schema marks quantity as required on each ingredient', () => {
      const schema = CALCULATE_NUTRITION_TOOL.function.parameters
      const itemSchema = (schema.properties.ingredients as { items: { required: string[] } }).items
      expect(itemSchema.required).toContain('quantity')
    })

    it('CALCULATE_NUTRITION_TOOL schema marks name and unit as required per ingredient', () => {
      const schema = CALCULATE_NUTRITION_TOOL.function.parameters
      const itemSchema = (schema.properties.ingredients as { items: { required: string[] } }).items
      expect(itemSchema.required).toContain('name')
      expect(itemSchema.required).toContain('unit')
    })

    it('CALCULATE_NUTRITION_TOOL quantity field is type number', () => {
      const schema = CALCULATE_NUTRITION_TOOL.function.parameters
      const props = (schema.properties.ingredients as { items: { properties: Record<string, { type: string }> } }).items.properties
      expect(props.quantity.type).toBe('number')
    })
  })

  describe('regression — existing eggs/bacon/tortilla breakfast still works', () => {
    it('3 large eggs + 3 bacon strips + 1 flour tortilla resolves completely', async () => {
      mockMatchIngredient
        .mockResolvedValueOnce(
          makeFatSecretMatch({
            externalId: 'fs-egg',
            name: 'Egg, large',
            servingSize: 50,
            calories: 72,
            proteinG: 6.3,
            carbohydrateG: 0.4,
            fatG: 4.8,
            householdUnit: 'large',
            householdServingText: '1 large',
            unitsPerServing: 1,
          }),
        )
        .mockResolvedValueOnce(
          makeFatSecretMatch({
            externalId: 'fs-bacon',
            name: 'Bacon',
            servingSize: 5,
            calories: 27,
            proteinG: 2.1,
            carbohydrateG: 0,
            fatG: 2.1,
            householdUnit: 'thin slice (yield after cooking)',
            householdServingText: '1 thin slice (yield after cooking)',
            unitsPerServing: 1,
          }),
        )
        .mockResolvedValueOnce(
          makeFatSecretMatch({
            externalId: 'fs-tortilla',
            name: 'Flour Tortilla',
            servingSize: 38,
            calories: 101,
            proteinG: 2.7,
            carbohydrateG: 18.2,
            fatG: 2,
            householdUnit: 'medium',
            householdServingText: '1 medium',
            unitsPerServing: 1,
          }),
        )

      const result = await calculateNutrition({
        ingredients: [
          { name: 'large eggs', quantity: 3, unit: 'piece' },
          { name: 'bacon strips', quantity: 3, unit: 'strip' },
          { name: 'flour tortilla', quantity: 1, unit: 'piece' },
        ],
        servings: 1,
      })

      expect(result.completeness).toBe('complete')
      expect(result.ingredients.every(i => i.resolved)).toBe(true)
      expect(result.totals.calories).toBe(3*72 + 3*27 + 101) // 216 + 81 + 101 = 398
    })
  })
})
