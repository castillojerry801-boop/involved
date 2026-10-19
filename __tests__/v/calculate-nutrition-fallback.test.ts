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

  describe('UUID guard regression — USDA top match with non-UUID id triggers Part C', () => {
    it('USDA top match (externalId "171513", no internalId) fails gracefully → Part C runs → FatSecret alt resolves', async () => {
      // This was the production failure: USDA 171513 has no internalId, so
      // lookupPortions('171513', 'piece') threw a Postgres UUID error, which
      // hit the catch block in calculateNutrition and skipped Part C entirely.
      // After UUID guard fix, resolveIngredientFactor returns ConversionError,
      // Part C runs, and the FatSecret alt with 'patty' serving resolves.
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: {
          provider: 'usda_fooddata' as const,
          externalId: '171513',
          internalId: undefined,  // not stored in DB — will use externalId as id
          name: 'Chicken Patty, frozen',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: undefined,
          unitsPerServing: undefined,
          householdServingText: undefined,
          calories: 216,
          proteinG: 16,
          carbohydrateG: 12,
          fatG: 11,
          isGeneric: true,
          matchScore: 72,
          matchReasons: ['SR Legacy'],
          fdcDataType: 'SR Legacy',
        },
        alternatives: [
          makeFatSecretAlt({
            externalId: 'fs-patty-good',
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
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'frozen chicken patties', quantity: 2, unit: 'piece' }],
        servings: 1,
      })

      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].matchedFoodName).toBe('Frozen Chicken Patty')
      expect(result.ingredients[0].matchConfidence).toBe('plausible')
      expect(result.ingredients[0].calories).toBe(360) // 180 × 2
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

  describe("'whole' unit normalization (Phase 2A) — maps to 'piece' for count-based serving lookup", () => {
    it("unit='whole' resolves via piece-based household serving (e.g. whole avocado)", async () => {
      // V sends unit="whole" for "half an avocado" → normalizeIngredientUnit("whole") → "piece"
      // → resolveIngredientFactor uses piece path → finds "1 avocado" serving
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-avocado',
          name: 'Avocado',
          servingSize: 201,
          calories: 320,
          proteinG: 4,
          carbohydrateG: 17,
          fatG: 29,
          householdUnit: 'avocado',
          householdServingText: '1 avocado',
          unitsPerServing: 1,
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'avocado', quantity: 0.5, unit: 'whole' }],
        servings: 1,
      })

      expect(result.ingredients[0].resolved).toBe(true)
      // 0.5 × 320 = 160 cal
      expect(result.ingredients[0].calories).toBe(160)
    })

    it("unit='whole' on a food with no piece serving returns unresolved — does not invent grams", async () => {
      // "whole" maps to "piece" — if no piece-based serving exists, pipeline returns
      // unit_incompatible. This confirms we don't fall back to guessed gram weights.
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-spinach',
          name: 'Spinach',
          servingSize: 100,
          calories: 23,
          proteinG: 2.9,
          carbohydrateG: 3.6,
          fatG: 0.4,
          // No householdUnit — spinach is typically measured by weight/cup, not whole items
        }),
      )

      const result = await calculateNutrition({
        ingredients: [{ name: 'spinach', quantity: 1, unit: 'whole' }],
        servings: 1,
      })

      // Spinach has no piece serving → unit_incompatible → unresolved (correct behavior)
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.totals.calories).toBe(0)
    })

    it("unit='whole' and unit='fruit' both route through the same piece resolution path", async () => {
      // Phase 1 added 'fruit' → PIECE_UNITS; Phase 2A adds 'whole' → SIZE_QUALIFIERS → 'piece'.
      // Both should resolve identically when a piece-based serving exists.
      const avocadoMatch = makeFatSecretMatch({
        externalId: 'fs-avo',
        name: 'Avocado',
        servingSize: 201,
        calories: 320,
        proteinG: 4,
        carbohydrateG: 17,
        fatG: 29,
        householdUnit: 'avocado',
        householdServingText: '1 avocado',
        unitsPerServing: 1,
      })

      mockMatchIngredient
        .mockResolvedValueOnce(avocadoMatch)
        .mockResolvedValueOnce(avocadoMatch)

      const [withWhole, withFruit] = await Promise.all([
        calculateNutrition({ ingredients: [{ name: 'avocado', quantity: 0.5, unit: 'whole' }] }),
        calculateNutrition({ ingredients: [{ name: 'avocado', quantity: 0.5, unit: 'fruit' }] }),
      ])

      expect(withWhole.ingredients[0].resolved).toBe(true)
      expect(withFruit.ingredients[0].resolved).toBe(true)
      expect(withWhole.ingredients[0].calories).toBe(withFruit.ingredients[0].calories)
    })
  })

  describe('Phase 2A — USDA Foundation/SR Legacy top match has no household serving', () => {
    // USDA Foundation and SR Legacy foods are always on a 100g basis and never carry
    // a household serving in mapFood (isBranded=false path). When the user requests
    // a count unit (e.g. "piece") and USDA wins the match with a high score, the
    // factor pipeline returns unit_incompatible. Part C (alternative fallback) then
    // applies the 80% relative quality gate before trying each alternative.
    //
    // Known limitation: when USDA scores much higher than available FatSecret alts
    // (e.g. Foundation food at 128 vs FatSecret at 75), the gate blocks the alt even
    // though the alt would provide the necessary serving data. This is documented
    // behavior; Phase 2B will address the volume/density gap for such cases.

    it('USDA Foundation food at high score, FatSecret alt below 50% floor → correctly unresolved (floor still blocks)', async () => {
      // USDA Foundation "Salmon, Atlantic, Wild, Raw" scores 128.
      // FatSecret alt scores 63. Phase 2B relaxed gate applies 50% floor for Foundation:
      // 63 < 128 * 0.50 = 64 → still blocked. No invented gram weight.
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: {
          provider: 'usda_fooddata' as const,
          externalId: '175168',
          internalId: undefined,           // Foundation foods not stored in DB
          name: 'Salmon, Atlantic, Wild, Raw',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: undefined,        // Foundation/SR Legacy never have household unit
          unitsPerServing: undefined,
          householdServingText: undefined,
          calories: 142,
          proteinG: 19.8,
          carbohydrateG: 0,
          fatG: 6.3,
          isGeneric: true,
          matchScore: 128,
          matchReasons: ['Foundation exact match'],
          fdcDataType: 'Foundation',
        },
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-salmon-fillet',
              name: 'Salmon Fillet',
              servingSize: 150,
              calories: 213,
              proteinG: 29.7,
              carbohydrateG: 0,
              fatG: 9.4,
              householdUnit: 'fillet',
              householdServingText: '1 fillet',
              unitsPerServing: 1,
            }),
            matchScore: 63,  // 63 < 128 * 0.50 = 64 → still blocked by 50% floor
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'salmon fillet', quantity: 1, unit: 'piece' }],
        servings: 1,
      })

      // 50% floor still blocks extremely low-scoring alts → unresolved, not substituted
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.totals.calories).toBe(0)
      expect(getByIdForEnrichmentSpy).not.toHaveBeenCalled()
    })

    it('USDA Foundation at moderate score, FatSecret alt within 80% gate → resolves via FatSecret alt', async () => {
      // USDA Foundation at score=90, FatSecret alt at score=75.
      // 75 >= 90 * 0.80 = 72.0 → gate allows alt → resolves via fillet serving.
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: {
          provider: 'usda_fooddata' as const,
          externalId: '175168',
          internalId: undefined,
          name: 'Salmon, Atlantic, Wild, Raw',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: undefined,
          unitsPerServing: undefined,
          householdServingText: undefined,
          calories: 142,
          proteinG: 19.8,
          carbohydrateG: 0,
          fatG: 6.3,
          isGeneric: true,
          matchScore: 90,
          matchReasons: ['Foundation match'],
          fdcDataType: 'Foundation',
        },
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-salmon-fillet',
              name: 'Salmon Fillet',
              servingSize: 150,
              calories: 213,
              proteinG: 29.7,
              carbohydrateG: 0,
              fatG: 9.4,
              householdUnit: 'fillet',
              householdServingText: '1 fillet',
              unitsPerServing: 1,
            }),
            matchScore: 75,  // 75 >= 90 * 0.80 = 72.0 → gate allows
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'salmon fillet', quantity: 1, unit: 'piece' }],
        servings: 1,
      })

      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].matchedFoodName).toBe('Salmon Fillet')
      expect(result.ingredients[0].matchConfidence).toBe('plausible')
      expect(result.ingredients[0].calories).toBe(213)
    })
  })

  describe('relative quality gate: alternative must score ≥ 80% of top match score (Phase 1 fix)', () => {
    it('alternative below 80% of top match score is rejected even when it can resolve', async () => {
      // top match: "Organic Raw Spinach Juice" score=91, fails conversion (unit_incompatible)
      // alt: "Raw Stuffed Chicken Breasts Artichoke, Spinach, Parmesan" score=70 — can resolve via piece
      // 70 < 91 * 0.80 = 72.8 → should be REJECTED, ingredient marked unresolved
      const badAlt = {
        ...makeFatSecretAlt({
          externalId: 'stuffed-chicken',
          name: 'Raw Stuffed Chicken Breasts Artichoke, Spinach, Parmesan',
          servingSize: 170,
          calories: 230,
          proteinG: 20,
          carbohydrateG: 5,
          fatG: 14,
          householdUnit: 'piece',
          householdServingText: '1 piece',
          unitsPerServing: 1,
        }),
        matchScore: 70,  // override default 75 from makeFatSecretAlt
      }
      const topMatchScore = 91
      const topMatch = {
        ...makeFatSecretAlt({
          externalId: 'spinach-juice',
          name: 'Organic Raw Spinach Juice',
          servingSize: 240,   // ml-based serving — incompatible with gram query
          calories: 45,
          proteinG: 1,
          carbohydrateG: 9,
          fatG: 0,
        }),
        matchScore: topMatchScore,
        servingUnit: 'ml',  // volume — cannot convert from grams
      }
      mockMatchIngredient.mockResolvedValue({
        confidence: 'confident' as const,
        topMatch: topMatch as unknown as MatchResult['topMatch'],
        alternatives: [badAlt as unknown as NonNullable<MatchResult['alternatives']>[0]],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'raw spinach', quantity: 100, unit: 'g' }],
      })
      // The bad alt (70 < 91*0.80=72.8) should be rejected — ingredient is unresolved
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.totals.calories).toBe(0)
    })

    it('alternative at exactly 80% of top match score is allowed', async () => {
      // top match score=100, alt score=80 (exactly 80%) → should be allowed
      const goodAlt = {
        ...makeFatSecretAlt({
          externalId: 'good-alt',
          name: 'Spinach, Raw',
          servingSize: 100,
          calories: 23,
          proteinG: 2.9,
          carbohydrateG: 3.6,
          fatG: 0.4,
        }),
        matchScore: 80,
      }
      const topMatch = {
        ...makeFatSecretAlt({
          externalId: 'top-juice',
          name: 'Spinach Juice',
          servingSize: 240,
          calories: 45,
          proteinG: 1,
          carbohydrateG: 9,
          fatG: 0,
        }),
        matchScore: 100,
        servingUnit: 'ml',
      }
      mockMatchIngredient.mockResolvedValue({
        confidence: 'confident' as const,
        topMatch: topMatch as unknown as MatchResult['topMatch'],
        alternatives: [goodAlt as unknown as NonNullable<MatchResult['alternatives']>[0]],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'spinach', quantity: 100, unit: 'g' }],
      })
      // 80 >= 100*0.80=80 → should resolve via the good alt
      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.totals.calories).toBe(23)
    })
  })

  describe('Phase 2B — Volume unit (cup/tbsp) enrichment and resolution', () => {
    it("unit='cup' triggers FatSecret enrichment and resolves via cup serving", async () => {
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-oatmeal',
          name: 'Old Fashioned Oats',
          servingSize: 100,
          calories: 375,
          proteinG: 13,
          carbohydrateG: 68,
          fatG: 7,
          // No household unit — search result only has 100g basis
        }),
      )

      // FatSecret detail returns a cup serving: 0.5 cup = 40g dry = 150 cal
      getByIdForEnrichmentSpy.mockResolvedValueOnce({
        provider: 'fatsecret' as const,
        externalId: 'fs-oatmeal',
        name: 'Old Fashioned Oats',
        brand: undefined,
        isGeneric: true,
        servingSize: 40,
        servingUnit: 'g',
        householdServingText: '0.5 cup dry',
        householdUnit: 'cup',
        unitsPerServing: 0.5,
        coreNutrients: { calories: 150, proteinG: 5, carbohydrateG: 27, fatG: 2.5 },
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'oatmeal', quantity: 1, unit: 'cup' }],
      })

      expect(result.ingredients[0].resolved).toBe(true)
      // factor = 1 / 0.5 = 2 → 2 × 150 = 300 cal
      expect(result.ingredients[0].calories).toBe(300)
      expect(getByIdForEnrichmentSpy).toHaveBeenCalledWith('fs-oatmeal', 'cup')
    })

    it("unit='tbsp' triggers enrichment and resolves via tablespoon serving (synonym match)", async () => {
      // FatSecret detail returns householdUnit='tablespoon' (not 'tbsp')
      // canonicalizeUnit ensures 'tbsp' === canonical('tablespoon') in Step 5
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-pb',
          name: 'Peanut Butter',
          servingSize: 100,
          calories: 590,
          proteinG: 25,
          carbohydrateG: 20,
          fatG: 50,
        }),
      )

      getByIdForEnrichmentSpy.mockResolvedValueOnce({
        provider: 'fatsecret' as const,
        externalId: 'fs-pb',
        name: 'Peanut Butter',
        brand: undefined,
        isGeneric: true,
        servingSize: 32,
        servingUnit: 'g',
        householdServingText: '2 tablespoons',
        householdUnit: 'tablespoon',
        unitsPerServing: 2,
        coreNutrients: { calories: 190, proteinG: 8, carbohydrateG: 6, fatG: 16 },
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'peanut butter', quantity: 2, unit: 'tbsp' }],
      })

      expect(result.ingredients[0].resolved).toBe(true)
      // 2 tbsp requested, serving is 2 tablespoons → factor = 2/2 = 1 → 190 cal
      expect(result.ingredients[0].calories).toBe(190)
      expect(getByIdForEnrichmentSpy).toHaveBeenCalledWith('fs-pb', 'tbsp')
    })

    it("unit='cup' for food with no cup serving → unresolved (no density invention)", async () => {
      // FatSecret detail only returns weight-based data — no cup serving
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-chicken',
          name: 'Chicken Breast, Raw',
          servingSize: 100,
          calories: 165,
          proteinG: 31,
          carbohydrateG: 0,
          fatG: 3.6,
        }),
      )

      getByIdForEnrichmentSpy.mockResolvedValueOnce({
        provider: 'fatsecret' as const,
        externalId: 'fs-chicken',
        name: 'Chicken Breast, Raw',
        brand: undefined,
        isGeneric: true,
        servingSize: 100,
        servingUnit: 'g',
        householdServingText: undefined,
        householdUnit: undefined,
        unitsPerServing: undefined,
        coreNutrients: { calories: 165, proteinG: 31, carbohydrateG: 0, fatG: 3.6 },
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'chicken breast', quantity: 1, unit: 'cup' }],
      })

      // No cup serving exists — must remain unresolved; no density invented
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.totals.calories).toBe(0)
    })

    it("unit='container' triggers enrichment and resolves via container serving", async () => {
      mockMatchIngredient.mockResolvedValue(
        makeFatSecretMatch({
          externalId: 'fs-yogurt',
          name: 'Plain Greek Yogurt',
          servingSize: 100,
          calories: 59,
          proteinG: 10,
          carbohydrateG: 3.6,
          fatG: 0.4,
        }),
      )

      getByIdForEnrichmentSpy.mockResolvedValueOnce({
        provider: 'fatsecret' as const,
        externalId: 'fs-yogurt',
        name: 'Plain Greek Yogurt',
        brand: undefined,
        isGeneric: true,
        servingSize: 227,
        servingUnit: 'g',
        householdServingText: '1 container',
        householdUnit: 'container',
        unitsPerServing: 1,
        coreNutrients: { calories: 130, proteinG: 22, carbohydrateG: 8, fatG: 0 },
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'Greek yogurt', quantity: 1, unit: 'container' }],
      })

      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].calories).toBe(130)
      expect(getByIdForEnrichmentSpy).toHaveBeenCalledWith('fs-yogurt', 'container')
    })
  })

  describe('Phase 2B — Relaxed gate for USDA Foundation/SR Legacy topMatch', () => {
    it('USDA Foundation at score 128, FatSecret fillet alt at 75 → now resolves (gate relaxed to 50%)', async () => {
      // Before: 75 < 128 × 0.80 = 102.4 → blocked
      // After: Foundation → relaxed gate → 75 >= 128 × 0.50 = 64 → allowed
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: {
          provider: 'usda_fooddata' as const,
          externalId: '175168',
          internalId: undefined,
          name: 'Salmon, Atlantic, Wild, Raw',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: undefined,
          unitsPerServing: undefined,
          householdServingText: undefined,
          calories: 142,
          proteinG: 19.8,
          carbohydrateG: 0,
          fatG: 6.3,
          isGeneric: true,
          matchScore: 128,
          matchReasons: ['Foundation exact match'],
          fdcDataType: 'Foundation',
        },
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-salmon-fillet',
              name: 'Salmon Fillet',
              servingSize: 150,
              calories: 213,
              proteinG: 29.7,
              carbohydrateG: 0,
              fatG: 9.4,
              householdUnit: 'fillet',
              householdServingText: '1 fillet',
              unitsPerServing: 1,
            }),
            matchScore: 75,
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'salmon fillet', quantity: 1, unit: 'piece' }],
      })

      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].matchedFoodName).toBe('Salmon Fillet')
      expect(result.ingredients[0].matchConfidence).toBe('plausible')
      expect(result.ingredients[0].calories).toBe(213)
    })

    it('USDA Foundation at score 128, FatSecret alt at 63 → still blocked (below 50% floor)', async () => {
      // 63 < 128 × 0.50 = 64 → still rejected
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: {
          provider: 'usda_fooddata' as const,
          externalId: '175168',
          internalId: undefined,
          name: 'Salmon, Atlantic, Wild, Raw',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: undefined,
          unitsPerServing: undefined,
          householdServingText: undefined,
          calories: 142,
          proteinG: 19.8,
          carbohydrateG: 0,
          fatG: 6.3,
          isGeneric: true,
          matchScore: 128,
          matchReasons: ['Foundation exact match'],
          fdcDataType: 'Foundation',
        },
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-random',
              name: 'Salmon with Sauce',
              servingSize: 180,
              calories: 250,
              proteinG: 22,
              carbohydrateG: 10,
              fatG: 12,
              householdUnit: 'fillet',
              householdServingText: '1 fillet',
              unitsPerServing: 1,
            }),
            matchScore: 63,
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'salmon', quantity: 1, unit: 'piece' }],
      })

      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.totals.calories).toBe(0)
    })
  })

  describe('Phase 2B — Identity safeguards (altPassesIdentityCheck)', () => {
    const makeUsdaFoundationTopMatch = (name: string, score = 90) => ({
      provider: 'usda_fooddata' as const,
      externalId: '175168',
      internalId: undefined,
      name,
      servingSize: 100,
      servingUnit: 'g',
      householdUnit: undefined,
      unitsPerServing: undefined,
      householdServingText: undefined,
      calories: 142,
      proteinG: 19.8,
      carbohydrateG: 0,
      fatG: 6.3,
      isGeneric: true,
      matchScore: score,
      matchReasons: ['Foundation'],
      fdcDataType: 'Foundation' as const,
    })

    it('compound dish alt ("Salmon and Broccoli Bowl") rejected when topMatch is standalone food', async () => {
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: makeUsdaFoundationTopMatch('Salmon, Atlantic, Wild, Raw'),
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-bowl',
              name: 'Salmon and Broccoli Bowl',
              servingSize: 340,
              calories: 420,
              proteinG: 38,
              carbohydrateG: 28,
              fatG: 14,
              householdUnit: 'bowl',
              householdServingText: '1 bowl',
              unitsPerServing: 1,
            }),
            matchScore: 75,
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'salmon', quantity: 1, unit: 'piece' }],
      })

      // Compound dish must be rejected regardless of usable serving
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.totals.calories).toBe(0)
    })

    it('cooked/smoked alt rejected when topMatch is explicitly raw', async () => {
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: makeUsdaFoundationTopMatch('Salmon, Atlantic, Wild, Raw'),
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-smoked',
              name: 'Smoked Salmon',
              servingSize: 150,
              calories: 245,
              proteinG: 26,
              carbohydrateG: 0,
              fatG: 14,
              householdUnit: 'fillet',
              householdServingText: '1 fillet',
              unitsPerServing: 1,
            }),
            matchScore: 75,
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'raw salmon', quantity: 1, unit: 'piece' }],
      })

      // Preparation-state mismatch: raw topMatch vs smoked alt → rejected
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.totals.calories).toBe(0)
    })

    it('standalone same-food alt ("Salmon Fillet") passes identity check and resolves', async () => {
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: makeUsdaFoundationTopMatch('Salmon, Atlantic, Wild'),
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-fillet',
              name: 'Salmon Fillet',
              servingSize: 150,
              calories: 213,
              proteinG: 29.7,
              carbohydrateG: 0,
              fatG: 9.4,
              householdUnit: 'fillet',
              householdServingText: '1 fillet',
              unitsPerServing: 1,
            }),
            matchScore: 75,
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'salmon', quantity: 1, unit: 'fillet' }],
      })

      // No compound indicator, no preparation-state conflict → identity check passes
      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].calories).toBe(213)
      expect(result.ingredients[0].matchedFoodName).toBe('Salmon Fillet')
    })

    it('cooked alt rejected when topMatch name contains "dry" (dry-state match)', async () => {
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: makeUsdaFoundationTopMatch('Rice, Brown, Long-Grain, Dry'),
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-cooked-rice',
              name: 'Cooked Brown Rice',
              servingSize: 195,
              calories: 216,
              proteinG: 5,
              carbohydrateG: 45,
              fatG: 1.8,
              householdUnit: 'cup',
              householdServingText: '1 cup',
              unitsPerServing: 1,
            }),
            matchScore: 75,
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'brown rice dry', quantity: 1, unit: 'cup' }],
      })

      // "dry" topMatch + "cooked" alt → preparation-state mismatch → rejected
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.totals.calories).toBe(0)
    })

    it('non-compound prepared food alt resolves when topMatch has no raw/dry qualifier', async () => {
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: makeUsdaFoundationTopMatch('Brown Rice, Long-Grain'),
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-cooked-rice2',
              name: 'Cooked Brown Rice',
              servingSize: 195,
              calories: 216,
              proteinG: 5,
              carbohydrateG: 45,
              fatG: 1.8,
              householdUnit: 'cup',
              householdServingText: '1 cup',
              unitsPerServing: 1,
            }),
            matchScore: 75,
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'brown rice', quantity: 1, unit: 'cup' }],
      })

      // topMatch has no "raw"/"dry" qualifier → preparation guard does not fire → resolves
      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].calories).toBe(216)
    })

    it('customer "grilled salmon" overrides raw topMatch: cooked alt resolves (requestedName priority)', async () => {
      // Before bidirectional fix: topMatch "raw" → reject cooked alt → unresolved
      // After fix: requestedName "grilled salmon" carries cooked state → cooked alt is compatible
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: makeUsdaFoundationTopMatch('Salmon, Atlantic, Wild, Raw', 90),
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-grilled',
              name: 'Grilled Salmon Fillet',
              servingSize: 150,
              calories: 218,
              proteinG: 30,
              carbohydrateG: 0,
              fatG: 10,
              householdUnit: 'fillet',
              householdServingText: '1 fillet',
              unitsPerServing: 1,
            }),
            matchScore: 78,
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'grilled salmon', quantity: 1, unit: 'fillet' }],
      })

      // requestedName "grilled salmon" (cooked) + alt "Grilled Salmon Fillet" (cooked) → compatible
      expect(result.ingredients[0].resolved).toBe(true)
      expect(result.ingredients[0].calories).toBe(218)
      expect(result.ingredients[0].matchedFoodName).toBe('Grilled Salmon Fillet')
    })

    it('cooked topMatch with neutral customer request: raw alt rejected (bidirectional)', async () => {
      // Bidirectional fix: topMatch has cooked state → raw alt is incompatible even when
      // the customer request itself carries no explicit preparation state.
      mockMatchIngredient.mockResolvedValue({
        confidence: 'ambiguous' as const,
        topMatch: {
          provider: 'usda_fooddata' as const,
          externalId: '171477',
          internalId: undefined,
          name: 'Chicken, Broilers, Breast, Meat Only, Cooked, Roasted',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: undefined,
          unitsPerServing: undefined,
          householdServingText: undefined,
          calories: 165,
          proteinG: 31,
          carbohydrateG: 0,
          fatG: 3.6,
          isGeneric: true,
          matchScore: 128,
          matchReasons: ['Foundation'],
          fdcDataType: 'Foundation' as const,
        },
        alternatives: [
          {
            ...makeFatSecretAlt({
              externalId: 'fs-raw-chicken',
              name: 'Chicken Breast, Raw',
              servingSize: 174,
              calories: 186,
              proteinG: 35,
              carbohydrateG: 0,
              fatG: 4,
              householdUnit: 'piece',
              householdServingText: '1 piece',
              unitsPerServing: 1,
            }),
            matchScore: 75,
          },
        ],
        rawResults: [],
      })

      const result = await calculateNutrition({
        ingredients: [{ name: 'chicken breast', quantity: 1, unit: 'piece' }],
      })

      // Customer request "chicken breast" is neutral → refPrepState falls back to topMatch "cooked"
      // alt "Chicken Breast, Raw" has raw_or_dry state → cooked ≠ raw_or_dry → REJECTED
      expect(result.ingredients[0].resolved).toBe(false)
      expect(result.totals.calories).toBe(0)
    })
  })
})
