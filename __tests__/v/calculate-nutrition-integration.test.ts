/**
 * calculate-nutrition INTEGRATION test — mocks only at the provider level.
 *
 * Previous unit tests mocked matchIngredient and resolveIngredientFactor, which
 * hid the fdcDataType pipeline gap. This test exercises the real scorer so that
 * fdcDataType actually flows through ExternalFoodResult → FoodMatch → foodForConversion.
 *
 * Root cause being guarded: the scorer's FoodMatch construction never passed
 * fdcDataType from ExternalFoodResult through to FoodMatch, so resolveIngredientFactor
 * Step 7 (USDA Foundation/SR Legacy portion fetch) never fired. Eggs, bacon, and
 * tortilla all failed with unit_unknown even when USDA returns Foundation data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExternalFoodResult } from '../../lib/nutrition/providers/types'

// ── Mock at provider level — real matcher+scorer+factor run ───────────────────

const mockUsdaSearch = vi.fn()

vi.mock('../../lib/nutrition/providers', () => ({
  FOOD_PROVIDERS: [
    {
      providerId: 'usda_fooddata',
      name: 'USDA FoodData Central',
      search: mockUsdaSearch,
      getById: vi.fn().mockResolvedValue(null),
      searchByBarcode: vi.fn().mockResolvedValue(null),
    },
  ],
}))

// Mock Prisma — empty library cache, no stored portions
vi.mock('../../lib/prisma', () => ({
  prisma: {
    foodItem: { findMany: vi.fn().mockResolvedValue([]) },
    foodItemPortion: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert:   vi.fn().mockResolvedValue({}),
    },
  },
}))

// Mock fetchAndStoreUsdaPortions to return a large egg portion
vi.mock('../../lib/nutrition/conversion/portions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nutrition/conversion/portions')>()
  return {
    ...actual,
    lookupPortions: vi.fn().mockResolvedValue([]),
    fetchAndStoreUsdaPortions: vi.fn().mockResolvedValue([
      {
        id: 'portion-egg-1',
        portionDescription: '1 large egg',
        quantity: 1,
        unit: 'large',   // USDA stores 'large' as the count unit for eggs
        gramWeight: 50,
        fdcPortionId: 'p001',
        sourceConfidence: 'high',
        preparationState: null,
      },
    ]),
  }
})

import { scoreForIngredient } from '../../lib/nutrition/matching/scorer'
import type { FoodMatch } from '../../lib/nutrition/matching/types'

// ── Test 1: fdcDataType flows from ExternalFoodResult through scorer → FoodMatch ─

describe('fdcDataType pipeline — ExternalFoodResult → FoodMatch', () => {
  const eggResult: ExternalFoodResult = {
    provider: 'usda_fooddata',
    externalId: '748967',
    name: 'Egg, Whole, Raw, Fresh',
    servingSize: 100,
    servingUnit: 'g',
    householdUnit: 'large',
    unitsPerServing: 2,
    fdcDataType: 'Foundation',  // THIS is what was never passed through before the fix
    coreNutrients: { calories: 143, proteinG: 12.6, carbohydrateG: 0.7, fatG: 9.5 },
    isGeneric: true,
  }

  it('scoreForIngredient preserves fdcDataType from ExternalFoodResult on FoodMatch', () => {
    const baseScoreMap = new Map<string, number>([['748967', 80]])
    const scored = scoreForIngredient([eggResult], { ingredientName: 'eggs' }, baseScoreMap)

    expect(scored).toHaveLength(1)
    const match: FoodMatch = scored[0]

    // THE CRITICAL ASSERTION: fdcDataType must flow through the scorer
    expect(match.fdcDataType).toBe('Foundation')
  })

  it('scoreForIngredient leaves fdcDataType undefined when not on source result', () => {
    const resultNoFdcType: ExternalFoodResult = { ...eggResult, fdcDataType: undefined }
    const baseScoreMap = new Map<string, number>([['748967', 80]])
    const scored = scoreForIngredient([resultNoFdcType], { ingredientName: 'eggs' }, baseScoreMap)

    expect(scored[0].fdcDataType).toBeUndefined()
  })

  it('fdcDataType is present on FoodMatch for all USDA data types', () => {
    const dataTypes = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] as const
    for (const dt of dataTypes) {
      const r: ExternalFoodResult = { ...eggResult, fdcDataType: dt }
      const baseScoreMap = new Map<string, number>([['748967', 80]])
      const scored = scoreForIngredient([r], { ingredientName: 'eggs' }, baseScoreMap)
      expect(scored[0].fdcDataType).toBe(dt)
    }
  })
})

// ── Test 2: calculate-nutrition tool — size-qualifier normalization ─────────────

describe('calculate-nutrition — normalizeIngredientUnit', () => {
  // Import after mocks are set up
  let calculateNutrition: typeof import('../../lib/v/tools/calculate-nutrition').calculateNutrition

  beforeEach(async () => {
    vi.clearAllMocks()
    // A Foundation egg result with a good match score for 'eggs'
    mockUsdaSearch.mockResolvedValue([{
      provider: 'usda_fooddata',
      externalId: '748967',
      name: 'Eggs',           // simplified name so quality gate passes easily
      servingSize: 100,
      servingUnit: 'g',
      householdUnit: 'large',
      unitsPerServing: 2,
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 143, proteinG: 12.6, carbohydrateG: 0.7, fatG: 9.5 },
      isGeneric: true,
    } satisfies ExternalFoodResult])
    const mod = await import('../../lib/v/tools/calculate-nutrition')
    calculateNutrition = mod.calculateNutrition
  })

  it('passes unit=piece (not "large") to resolveIngredientFactor when V passes unit="large"', async () => {
    // The fetchAndStoreUsdaPortions mock returns a portion with unit='large'.
    // Step 7 broadened fallback picks it up because iu='piece' is a PIECE_UNIT.
    // The factored gramWeight is 50g per large egg × 3 eggs.
    const result = await calculateNutrition({
      ingredients: [{ name: 'eggs', quantity: 3, unit: 'large' }],
    })

    // userDescription preserves the original 'large' for the user
    expect(result.ingredients[0].userDescription).toMatch(/large/)

    // With the fix (fdcDataType flows through), Step 7 fires and resolution succeeds
    expect(result.completeness).not.toBe('incomplete')
    expect(result.ingredients[0].resolved).toBe(true)
    // 3 large eggs × 50g each = 150g, factor = 1.5 × 143kcal/100g ≈ 215 cal
    expect(result.ingredients[0].calories).toBeGreaterThan(0)
  })
})
