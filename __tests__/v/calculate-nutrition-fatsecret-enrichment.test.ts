/**
 * calculate-nutrition — FatSecret detail enrichment flow
 *
 * Tests the Part B enrichment logic in calculateNutrition:
 *   1. FatSecret match without household unit + count input → enrichFatSecretMatch() called → resolves
 *   2. FatSecret match WITH household unit + count input → enrichment skipped
 *   3. FatSecret match + weight unit → enrichment skipped
 *   4. Detail fetch fails → original match used, ingredient unresolved (no crash)
 *   5. Multiple ingredients: one already has household unit, two need enrichment
 *   6. "1 serving" from detail → ingredient remains unresolved (non-count serving)
 *
 * Mocking strategy:
 *   - matchIngredient is mocked to inject specific FoodMatch stubs
 *   - FatSecretProvider.getById is mocked via vi.mock on the module
 *   - DB/portions are mocked (no DB in test env)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MatchResult } from '../../lib/nutrition/matching/types'
import type { ExternalFoodDetail } from '../../lib/nutrition/providers/types'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/nutrition/matching/matcher', () => ({
  matchIngredient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    foodItem: {
      findFirst: vi.fn().mockResolvedValue(null), // no library entry → no cache write
    },
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

// Mock FatSecretProvider using a class mock.
// getById is defined as a prototype method (not a class field) so vi.spyOn works on it.
// The spy is obtained after import and set up per-test via mockResolvedValueOnce.
vi.mock('../../lib/nutrition/providers/fatsecret', () => {
  class MockFatSecretProvider {
    name = 'FatSecret'
    providerId = 'fatsecret'
    // Prototype methods (not class fields) — vi.spyOn can intercept these
    async getById(_id: string) { return null }
    async getByIdForEnrichment(_id: string, _inputUnit: string) { return null }
    async search() { return [] }
    async searchByBarcode() { return null }
    async autocomplete() { return [] }
  }
  return { FatSecretProvider: MockFatSecretProvider }
})

import { calculateNutrition } from '../../lib/v/tools/calculate-nutrition'
import { matchIngredient } from '../../lib/nutrition/matching/matcher'
import { FatSecretProvider } from '../../lib/nutrition/providers/fatsecret'
import { prisma } from '@/lib/prisma'

// Spy on the prototype so ALL instances (including the singleton in calculate-nutrition)
// use this spy. Must be set up before each test.
// enrichFatSecretMatch calls getByIdForEnrichment (with inputUnit) when inputUnit is provided.
let getByIdSpy: ReturnType<typeof vi.spyOn>

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A FatSecret match stub WITHOUT household unit (as returned from search stubs for bacon) */
function makeFatSecretMatchNoHousehold(overrides: {
  name: string
  externalId: string
  servingSize: number
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
}): MatchResult {
  return {
    confidence: 'confident',
    topMatch: {
      provider: 'fatsecret',
      externalId: overrides.externalId,
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
      isGeneric: true,
      matchScore: 88,
      matchReasons: ['FatSecret generic'],
      fdcDataType: undefined,
    },
    alternatives: [],
    rawResults: [],
  }
}

/** A FatSecret match stub with a generic "1 serving" householdServingText (non-count, should NOT skip enrichment) */
function makeFatSecretMatchWithServingText(overrides: {
  name: string
  externalId: string
  householdServingText: string
  householdUnit: string
}): MatchResult {
  return {
    confidence: 'confident',
    topMatch: {
      provider: 'fatsecret',
      externalId: overrides.externalId,
      name: overrides.name,
      servingSize: 100,
      servingUnit: 'g',
      householdUnit: overrides.householdUnit,
      unitsPerServing: 1,
      householdServingText: overrides.householdServingText,
      calories: 200,
      proteinG: 10,
      carbohydrateG: 20,
      fatG: 8,
      isGeneric: true,
      matchScore: 80,
      matchReasons: ['FatSecret generic'],
      fdcDataType: undefined,
    },
    alternatives: [],
    rawResults: [],
  }
}

/** A FatSecret match stub WITH household unit already set (from a good search result) */
function makeFatSecretMatchWithHousehold(overrides: {
  name: string
  externalId: string
  householdServingText: string
}): MatchResult {
  return {
    confidence: 'confident',
    topMatch: {
      provider: 'fatsecret',
      externalId: overrides.externalId,
      name: overrides.name,
      servingSize: 50,
      servingUnit: 'g',
      householdUnit: 'large',
      unitsPerServing: 1,
      householdServingText: overrides.householdServingText,
      calories: 72,
      proteinG: 6.3,
      carbohydrateG: 0.36,
      fatG: 4.76,
      isGeneric: true,
      matchScore: 95,
      matchReasons: ['FatSecret generic'],
      fdcDataType: undefined,
    },
    alternatives: [],
    rawResults: [],
  }
}

/** Detail response from FatSecret.getById — bacon strip */
const BACON_DETAIL: ExternalFoodDetail = {
  provider: 'fatsecret',
  externalId: '1517',
  name: 'Bacon',
  isGeneric: true,
  servingSize: 8,
  servingUnit: 'g',
  householdServingText: '1 strip',
  householdUnit: 'strip',
  unitsPerServing: 1,
  coreNutrients: {
    calories: 43,
    proteinG: 3.0,
    carbohydrateG: 0.1,
    fatG: 3.3,
  },
}

/** Detail response — tortilla */
const TORTILLA_DETAIL: ExternalFoodDetail = {
  provider: 'fatsecret',
  externalId: '3742',
  name: 'Flour Tortilla',
  isGeneric: true,
  servingSize: 45,
  servingUnit: 'g',
  householdServingText: '1 tortilla',
  householdUnit: 'tortilla',
  unitsPerServing: 1,
  coreNutrients: {
    calories: 130,
    proteinG: 3.6,
    carbohydrateG: 22.2,
    fatG: 3.2,
  },
}

/** Detail response — M&M's 100 Calories Pack (real gram weight: 22.7g per pack) */
const MAMS_100CAL_DETAIL: ExternalFoodDetail = {
  provider: 'fatsecret',
  externalId: '5521',
  name: "M&M's 100 Calories Pack",
  isGeneric: false,
  servingSize: 22.7,
  servingUnit: 'g',
  householdServingText: '1 pack',
  householdUnit: 'pack',
  unitsPerServing: 1,
  coreNutrients: {
    calories: 100,
    proteinG: 1,
    carbohydrateG: 14,
    fatG: 4,
  },
}

/** Detail response — "1 serving" (non-count word, must NOT enable count resolution) */
const SERVING_ONLY_DETAIL: ExternalFoodDetail = {
  provider: 'fatsecret',
  externalId: '9999',
  name: 'Some Prepared Food',
  isGeneric: true,
  servingSize: 100,
  servingUnit: 'g',
  householdServingText: '1 serving',
  householdUnit: 'serving',
  unitsPerServing: 1,
  coreNutrients: {
    calories: 200,
    proteinG: 10,
    carbohydrateG: 20,
    fatG: 8,
  },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calculateNutrition — FatSecret detail enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Spy on getByIdForEnrichment — enrichFatSecretMatch calls this when inputUnit is passed
    getByIdSpy = vi.spyOn(FatSecretProvider.prototype, 'getByIdForEnrichment')
  })

  afterEach(() => {
    getByIdSpy.mockRestore()
  })

  it('match without household unit + count input unit → enrichment called, ingredient resolves', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchNoHousehold({
        name: 'Bacon',
        externalId: '1517',
        servingSize: 100,   // search result: 100g-basis (no household data)
        calories: 541,
        proteinG: 37,
        carbohydrateG: 1.28,
        fatG: 41.78,
      }),
    )
    getByIdSpy.mockResolvedValueOnce(BACON_DETAIL)

    const result = await calculateNutrition({
      ingredients: [{ name: 'bacon', quantity: 3, unit: 'strip' }],
    })

    // getByIdForEnrichment was called with externalId + inputUnit
    expect(getByIdSpy).toHaveBeenCalledWith('1517', 'strip')

    const bacon = result.ingredients[0]
    expect(bacon.resolved).toBe(true)
    // 3 strips × 43 cal/strip = 129 kcal
    expect(bacon.calories).toBeCloseTo(129, -1)
    expect(result.completeness).toBe('complete')
  })

  it('match WITH household unit + count input → enrichment NOT called', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchWithHousehold({
        name: 'Egg',
        externalId: '2076643',
        householdServingText: '1 large',
      }),
    )

    const result = await calculateNutrition({
      ingredients: [{ name: 'eggs', quantity: 2, unit: 'piece' }],
    })

    // getById should NOT be called — match already has household data
    expect(getByIdSpy).not.toHaveBeenCalled()

    const eggs = result.ingredients[0]
    expect(eggs.resolved).toBe(true)
    expect(eggs.calories).toBeCloseTo(144, -1)  // 2 × 72
  })

  it('match without household unit + weight unit input → enrichment NOT called', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchNoHousehold({
        name: 'Bacon',
        externalId: '1517',
        servingSize: 100,
        calories: 541,
        proteinG: 37,
        carbohydrateG: 1.28,
        fatG: 41.78,
      }),
    )

    const result = await calculateNutrition({
      ingredients: [{ name: 'bacon', quantity: 100, unit: 'g' }],
    })

    // Weight unit → no enrichment needed
    expect(getByIdSpy).not.toHaveBeenCalled()

    const bacon = result.ingredients[0]
    expect(bacon.resolved).toBe(true)
    expect(bacon.calories).toBeCloseTo(541, -1)  // 100g × 541 cal/100g
  })

  it('detail fetch fails (returns null) → original match used, ingredient unresolved (no crash)', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchNoHousehold({
        name: 'Bacon',
        externalId: '1517',
        servingSize: 100,
        calories: 541,
        proteinG: 37,
        carbohydrateG: 1.28,
        fatG: 41.78,
      }),
    )
    getByIdSpy.mockResolvedValueOnce(null) // detail fetch fails

    const result = await calculateNutrition({
      ingredients: [{ name: 'bacon', quantity: 3, unit: 'strip' }],
    })

    // getByIdForEnrichment was attempted
    expect(getByIdSpy).toHaveBeenCalledWith('1517', 'strip')

    // Ingredient remains unresolved (no household data, no crash)
    const bacon = result.ingredients[0]
    expect(bacon.resolved).toBe(false)
    expect(result.completeness).toBe('incomplete')
  })

  it('three ingredients: one with household unit resolves without enrichment, two without trigger enrichment', async () => {
    const mockMatch = vi.mocked(matchIngredient)

    // eggs: already has householdUnit → no enrichment
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchWithHousehold({
        name: 'Egg',
        externalId: '2076643',
        householdServingText: '1 large',
      }),
    )
    // bacon: no householdUnit → enrichment needed
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchNoHousehold({
        name: 'Bacon',
        externalId: '1517',
        servingSize: 100,
        calories: 541,
        proteinG: 37,
        carbohydrateG: 1.28,
        fatG: 41.78,
      }),
    )
    // tortilla: no householdUnit → enrichment needed
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchNoHousehold({
        name: 'Flour Tortilla',
        externalId: '3742',
        servingSize: 100,
        calories: 289,
        proteinG: 8,
        carbohydrateG: 49.4,
        fatG: 7.1,
      }),
    )

    getByIdSpy
      .mockResolvedValueOnce(BACON_DETAIL)
      .mockResolvedValueOnce(TORTILLA_DETAIL)

    const result = await calculateNutrition({
      ingredients: [
        { name: 'large eggs', quantity: 3, unit: 'piece' },
        { name: 'bacon', quantity: 3, unit: 'strip' },
        { name: 'flour tortilla', quantity: 1, unit: 'piece' },
      ],
    })

    // getByIdForEnrichment called exactly twice (bacon + tortilla), NOT for eggs
    expect(getByIdSpy).toHaveBeenCalledTimes(2)
    expect(getByIdSpy).toHaveBeenCalledWith('1517', 'strip')
    expect(getByIdSpy).toHaveBeenCalledWith('3742', 'piece')

    // All three should resolve
    expect(result.ingredients.every(i => i.resolved)).toBe(true)
    expect(result.completeness).toBe('complete')
  })

  it('"1 serving" returned from detail → ingredient remains unresolved', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchNoHousehold({
        name: 'Some Prepared Food',
        externalId: '9999',
        servingSize: 100,
        calories: 200,
        proteinG: 10,
        carbohydrateG: 20,
        fatG: 8,
      }),
    )
    getByIdSpy.mockResolvedValueOnce(SERVING_ONLY_DETAIL)

    const result = await calculateNutrition({
      ingredients: [{ name: 'prepared food', quantity: 2, unit: 'piece' }],
    })

    // Enrichment was called (no household data initially, count unit)
    expect(getByIdSpy).toHaveBeenCalled()

    // "1 serving" is not a count noun — factor engine's Step 5b will reject it
    // (NON_COUNT_WORDS set includes 'serving'), so ingredient stays unresolved
    const food = result.ingredients[0]
    expect(food.resolved).toBe(false)
  })

  // ── Regression: "1 serving" search result does NOT skip enrichment ───────────
  // Before the fix, a FatSecret search result with householdServingText='1 serving'
  // would set householdServingText, causing the old skip condition to fire and
  // skip the detail fetch. The fix: skip only when householdUnit is a countable unit.

  it('search result has householdServingText="1 serving" → enrichment still fires, detail strip resolves', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    // Search result has householdServingText='1 serving' (non-count) and householdUnit='serving'
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchWithServingText({
        name: 'Bacon',
        externalId: '1517',
        householdServingText: '1 serving',
        householdUnit: 'serving',  // non-count → must NOT skip enrichment
      }),
    )
    // Detail returns the real strip serving
    getByIdSpy.mockResolvedValueOnce(BACON_DETAIL)

    const result = await calculateNutrition({
      ingredients: [{ name: 'bacon', quantity: 3, unit: 'strip' }],
    })

    // Enrichment must have fired despite the non-count householdServingText
    expect(getByIdSpy).toHaveBeenCalled()

    // After enrichment, "1 strip" is available → resolves correctly
    const bacon = result.ingredients[0]
    expect(bacon.resolved).toBe(true)
    // 3 × 43 = 129 cal
    expect(bacon.calories).toBeCloseTo(129, -1)
  })

  it('search result has countable householdUnit="strip" → enrichment IS skipped', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    // Search result already has the strip serving — no detail fetch needed
    mockMatch.mockResolvedValueOnce({
      confidence: 'confident',
      topMatch: {
        provider: 'fatsecret',
        externalId: '1517',
        name: 'Bacon',
        servingSize: 8,
        servingUnit: 'g',
        householdUnit: 'strip',       // countable → enrichment should be skipped
        unitsPerServing: 1,
        householdServingText: '1 strip',
        calories: 43,
        proteinG: 3.0,
        carbohydrateG: 0.1,
        fatG: 3.3,
        isGeneric: true,
        matchScore: 95,
        matchReasons: ['FatSecret generic'],
        fdcDataType: undefined,
      },
      alternatives: [],
      rawResults: [],
    })

    const result = await calculateNutrition({
      ingredients: [{ name: 'bacon', quantity: 3, unit: 'strip' }],
    })

    // No enrichment call — match already has a countable householdUnit
    expect(getByIdSpy).not.toHaveBeenCalled()

    const bacon = result.ingredients[0]
    expect(bacon.resolved).toBe(true)
    expect(bacon.calories).toBeCloseTo(129, -1)  // 3 × 43
  })

  // ── Regression: idempotent FoodItemPortion cache ──────────────────────────────
  // When a FoodItem exists for the enriched food, the code does findFirst before create.
  // If findFirst returns an existing portion, no second create should be called.

  it('idempotent cache: enrichment for same food twice → findFirst consulted, no duplicate create', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    const mockedPrisma = vi.mocked(prisma, true)

    // First call: FoodItem exists, no existing portion → create is called
    mockedPrisma.foodItem.findFirst.mockResolvedValueOnce({ id: 'food-item-abc' } as never)
    mockedPrisma.foodItemPortion.findFirst.mockResolvedValueOnce(null)
    mockedPrisma.foodItemPortion.create.mockResolvedValueOnce({} as never)

    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchNoHousehold({
        name: 'Bacon',
        externalId: '1517',
        servingSize: 100,
        calories: 541,
        proteinG: 37,
        carbohydrateG: 1.28,
        fatG: 41.78,
      }),
    )
    getByIdSpy.mockResolvedValueOnce(BACON_DETAIL)

    await calculateNutrition({
      ingredients: [{ name: 'bacon', quantity: 3, unit: 'strip' }],
    })

    expect(mockedPrisma.foodItemPortion.findFirst).toHaveBeenCalledTimes(1)
    expect(mockedPrisma.foodItemPortion.create).toHaveBeenCalledTimes(1)

    // Second call: FoodItem exists, portion already present → create NOT called again
    vi.clearAllMocks()
    getByIdSpy = vi.spyOn(FatSecretProvider.prototype, 'getByIdForEnrichment')
    mockedPrisma.foodItem.findFirst.mockResolvedValueOnce({ id: 'food-item-abc' } as never)
    // findFirst returns existing portion → idempotent skip
    mockedPrisma.foodItemPortion.findFirst.mockResolvedValueOnce({ id: 'existing-portion' } as never)

    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchNoHousehold({
        name: 'Bacon',
        externalId: '1517',
        servingSize: 100,
        calories: 541,
        proteinG: 37,
        carbohydrateG: 1.28,
        fatG: 41.78,
      }),
    )
    getByIdSpy.mockResolvedValueOnce(BACON_DETAIL)

    await calculateNutrition({
      ingredients: [{ name: 'bacon', quantity: 3, unit: 'strip' }],
    })

    // findFirst was called to check for existing portion
    expect(mockedPrisma.foodItemPortion.findFirst).toHaveBeenCalledTimes(1)
    // create must NOT be called — portion already exists
    expect(mockedPrisma.foodItemPortion.create).not.toHaveBeenCalled()
  })

  it('servingSizeIsEstimated: true + weight unit → enrichment fires to get real gram weight', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    // Simulate "M&M's 100 Calories Pack" from search: servingSize=100 (default), flag set
    mockMatch.mockResolvedValueOnce({
      confidence: 'confident',
      topMatch: {
        provider: 'fatsecret',
        externalId: '5521',
        name: "M&M's 100 Calories Pack",
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: undefined,
        unitsPerServing: undefined,
        householdServingText: '1 pack',
        calories: 100,
        proteinG: 1,
        carbohydrateG: 14,
        fatG: 4,
        isGeneric: false,
        matchScore: 80,
        matchReasons: ['FatSecret branded'],
        fdcDataType: undefined,
        servingSizeIsEstimated: true,
      },
      alternatives: [],
      rawResults: [],
    })

    getByIdSpy.mockResolvedValueOnce(MAMS_100CAL_DETAIL)

    await calculateNutrition({
      ingredients: [{ name: "M&Ms", quantity: 100, unit: 'g' }],
    })

    // Enrichment MUST fire for servingSizeIsEstimated=true even though unit is 'g'
    expect(getByIdSpy).toHaveBeenCalledTimes(1)
  })

  it('servingSizeIsEstimated: true + weight unit → after enrichment, real gram weight used for calculation', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce({
      confidence: 'confident',
      topMatch: {
        provider: 'fatsecret',
        externalId: '5521',
        name: "M&M's 100 Calories Pack",
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: undefined,
        unitsPerServing: undefined,
        householdServingText: '1 pack',
        calories: 100,
        proteinG: 1,
        carbohydrateG: 14,
        fatG: 4,
        isGeneric: false,
        matchScore: 80,
        matchReasons: ['FatSecret branded'],
        fdcDataType: undefined,
        servingSizeIsEstimated: true,
      },
      alternatives: [],
      rawResults: [],
    })

    // Detail returns real 22.7g serving
    getByIdSpy.mockResolvedValueOnce(MAMS_100CAL_DETAIL)

    const result = await calculateNutrition({
      ingredients: [{ name: "M&Ms", quantity: 22.7, unit: 'g' }],
    })

    const mms = result.ingredients[0]
    expect(mms.resolved).toBe(true)
    // 22.7g / 22.7g per pack = 1 pack → 100 cal
    expect(mms.calories).toBeCloseTo(100, 0)

    // Without the fix, the old servingSize=100 default would give:
    // 22.7g / 100g = 0.227 → 100 × 0.227 = 22.7 cal (wrong)
    expect(mms.calories).not.toBeCloseTo(22.7, 0)
  })

  it('servingSizeIsEstimated: false + weight unit → enrichment NOT called (real servingSize available)', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    // Normal food with explicit 100g serving — servingSizeIsEstimated not set (undefined)
    mockMatch.mockResolvedValueOnce(
      makeFatSecretMatchNoHousehold({
        name: 'Oats',
        externalId: '8888',
        servingSize: 100,
        calories: 389,
        proteinG: 17,
        carbohydrateG: 66,
        fatG: 7,
      }),
    )

    await calculateNutrition({
      ingredients: [{ name: 'oats', quantity: 50, unit: 'g' }],
    })

    // servingSizeIsEstimated is undefined (not true) → enrichment must NOT fire
    expect(getByIdSpy).not.toHaveBeenCalled()
  })

  it('servingSizeIsEstimated: true + enrichment returns null + weight unit → ingredient unresolved (no fabricated 100g nutrition)', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce({
      confidence: 'confident',
      topMatch: {
        provider: 'fatsecret',
        externalId: '9999',
        name: 'Mystery Pack',
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: undefined,
        unitsPerServing: undefined,
        householdServingText: '1 pack',
        calories: 150,
        proteinG: 2,
        carbohydrateG: 20,
        fatG: 6,
        isGeneric: false,
        matchScore: 70,
        matchReasons: ['FatSecret branded'],
        fdcDataType: undefined,
        servingSizeIsEstimated: true,
      },
      alternatives: [],
      rawResults: [],
    })

    // Detail API returns no household data → enrichment returns null
    getByIdSpy.mockResolvedValueOnce(null)

    const result = await calculateNutrition({
      ingredients: [{ name: 'Mystery Pack', quantity: 50, unit: 'g' }],
    })

    // Enrichment was called
    expect(getByIdSpy).toHaveBeenCalledTimes(1)

    // Ingredient must be unresolved — the 100g default is fabricated
    const ing = result.ingredients[0]
    expect(ing.resolved).toBe(false)
    expect(ing.calories).toBe(0)
    expect(result.unresolvedIngredients).toHaveLength(1)

    // Regression guard: old behaviour returned 75 cal (150 × 50/100 = 75)
    expect(ing.calories).not.toBe(75)
  })
})
