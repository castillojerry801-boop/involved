/**
 * calculate-nutrition — breakfast with FatSecret detail enrichment (HTTP-level mock)
 *
 * Reproduces the production failure scenario where:
 *   - FatSecret search returns stubs WITHOUT household serving data (ids 1517, 2076643, 3742)
 *   - calculate-nutrition calls FatSecret.getById() for count-unit ingredients
 *   - Detail responses include "1 strip", "1 large", "1 tortilla" serving descriptions
 *   - All three ingredients resolve with correct macros
 *
 * Mock boundary: fetch() is mocked at HTTP level (not matcher/resolver).
 * Token+API URL routing is used to avoid token caching state between tests.
 * This validates the full pipeline: matchIngredient → enrichFatSecretMatch → getById →
 * mapFoodDetail → resolveIngredientFactor.
 *
 * Fixtures are based on actual FatSecret production data (confirmed in production logs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock DB ───────────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    foodItem: {
      findFirst: vi.fn().mockResolvedValue(null),
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

// Mock matchIngredient to return FatSecret stubs WITHOUT household data
vi.mock('../../lib/nutrition/matching/matcher', () => ({
  matchIngredient: vi.fn(),
}))

// ── fetch mock ────────────────────────────────────────────────────────────────
// Route by URL to avoid token caching state leaking between tests.
const TOKEN_URL_PART = 'oauth.fatsecret.com'
const API_URL_PART = 'platform.fatsecret.com'
const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  vi.stubEnv('FATSECRET_CLIENT_ID', 'TEST_CLIENT')
  vi.stubEnv('FATSECRET_CLIENT_SECRET', 'TEST_SECRET')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

import { calculateNutrition } from '../../lib/v/tools/calculate-nutrition'
import { matchIngredient } from '../../lib/nutrition/matching/matcher'
import type { MatchResult } from '../../lib/nutrition/matching/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Set up fetch routing: token URL → always returns a fresh token, API URL → routed by food_id */
function setupFetchRouter(detailsByFoodId: Record<string, object | null>) {
  mockFetch.mockImplementation((url: string) => {
    const urlStr = String(url)

    // Token endpoint
    if (urlStr.includes(TOKEN_URL_PART)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'test-tok', expires_in: 86400 }),
        text: () => Promise.resolve(''),
      })
    }

    // API endpoint — route by food_id param
    if (urlStr.includes(API_URL_PART)) {
      const foodIdMatch = urlStr.match(/food_id=([^&]+)/)
      const foodId = foodIdMatch ? decodeURIComponent(foodIdMatch[1]) : null

      if (foodId && foodId in detailsByFoodId) {
        const food = detailsByFoodId[foodId]
        if (food === null) {
          // Simulate HTTP 500
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({}),
            text: () => Promise.resolve('Internal Server Error'),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ food }),
          text: () => Promise.resolve(''),
        })
      }

      // Unknown food_id — return empty
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      })
    }

    return Promise.reject(new Error(`Unexpected URL: ${urlStr}`))
  })
}

/** FatSecret search-stub match — no householdServingText (simulates no-detail search result) */
function makeBareMatch(overrides: {
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
      matchScore: 90,
      matchReasons: ['FatSecret generic'],
      fdcDataType: undefined,
    },
    alternatives: [],
    rawResults: [],
  }
}

// ── FatSecret detail API fixtures (based on production data) ─────────────────

const FS_BACON_DETAIL = {
  food_id: '1517',
  food_name: 'Bacon',
  food_type: 'Generic',
  servings: {
    serving: [
      {
        serving_id: '1001',
        serving_description: '1 strip',
        measurement_description: 'strip',
        number_of_units: '1.000',
        metric_serving_amount: '8.000',
        metric_serving_unit: 'g',
        calories: '43',
        protein: '3.00',
        carbohydrate: '0.10',
        fat: '3.30',
      },
      {
        serving_id: '1002',
        serving_description: '100g',
        measurement_description: 'g',
        number_of_units: '100.000',
        metric_serving_amount: '100.000',
        metric_serving_unit: 'g',
        calories: '541',
        protein: '37.00',
        carbohydrate: '1.28',
        fat: '41.78',
      },
    ],
  },
}

const FS_EGG_DETAIL = {
  food_id: '2076643',
  food_name: 'Egg',
  food_type: 'Generic',
  servings: {
    serving: [
      {
        serving_id: '2001',
        serving_description: '1 large',
        measurement_description: 'large',
        number_of_units: '1.000',
        metric_serving_amount: '50.000',
        metric_serving_unit: 'g',
        calories: '72',
        protein: '6.30',
        carbohydrate: '0.36',
        fat: '4.76',
      },
      {
        serving_id: '2002',
        serving_description: '100g',
        measurement_description: 'g',
        number_of_units: '100.000',
        metric_serving_amount: '100.000',
        metric_serving_unit: 'g',
        calories: '143',
        protein: '12.60',
        carbohydrate: '0.72',
        fat: '9.51',
      },
    ],
  },
}

const FS_TORTILLA_DETAIL = {
  food_id: '3742',
  food_name: 'Flour Tortillas',
  food_type: 'Generic',
  servings: {
    serving: {   // FatSecret single-object form (not array)
      serving_id: '3001',
      serving_description: '1 tortilla',
      measurement_description: 'tortilla',
      number_of_units: '1.000',
      metric_serving_amount: '45.000',
      metric_serving_unit: 'g',
      calories: '130',
      protein: '3.60',
      carbohydrate: '22.20',
      fat: '3.20',
    },
  },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calculateNutrition — breakfast with FatSecret detail enrichment', () => {
  it('calculates breakfast with FatSecret detail enrichment', async () => {
    const mockMatch = vi.mocked(matchIngredient)

    mockMatch
      .mockResolvedValueOnce(
        makeBareMatch({ name: 'Egg', externalId: '2076643', servingSize: 100, calories: 143, proteinG: 12.6, carbohydrateG: 0.72, fatG: 9.51 }),
      )
      .mockResolvedValueOnce(
        makeBareMatch({ name: 'Bacon', externalId: '1517', servingSize: 100, calories: 541, proteinG: 37, carbohydrateG: 1.28, fatG: 41.78 }),
      )
      .mockResolvedValueOnce(
        makeBareMatch({ name: 'Flour Tortillas', externalId: '3742', servingSize: 100, calories: 289, proteinG: 8, carbohydrateG: 49.4, fatG: 7.1 }),
      )

    setupFetchRouter({
      '2076643': FS_EGG_DETAIL,
      '1517': FS_BACON_DETAIL,
      '3742': FS_TORTILLA_DETAIL,
    })

    const result = await calculateNutrition({
      ingredients: [
        { name: 'large eggs', quantity: 3, unit: 'piece' },
        { name: 'bacon', quantity: 3, unit: 'strip' },
        { name: 'flour tortilla', quantity: 1, unit: 'piece' },
      ],
    })

    expect(result.completeness).toBe('complete')
    expect(result.ingredients.every(i => i.resolved)).toBe(true)

    // 3 eggs: 3 × 72 = 216 cal
    // 3 bacon strips: 3 × 43 = 129 cal
    // 1 tortilla: 130 cal
    // Total: ~475 cal (±20% for rounding)
    expect(result.totals.calories).toBeGreaterThan(380)
    expect(result.totals.calories).toBeLessThan(570)

    const eggs = result.ingredients[0]
    expect(eggs.resolved).toBe(true)
    expect(eggs.calories).toBeCloseTo(216, -1)  // 3 × 72

    const bacon = result.ingredients[1]
    expect(bacon.resolved).toBe(true)
    expect(bacon.calories).toBeCloseTo(129, -1)  // 3 × 43

    const tortilla = result.ingredients[2]
    expect(tortilla.resolved).toBe(true)
    expect(tortilla.calories).toBeCloseTo(130, -1)  // 1 × 130
  })

  it('enrichment is skipped for weight-unit inputs (no detail fetch needed)', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(
      makeBareMatch({ name: 'Bacon', externalId: '1517', servingSize: 100, calories: 541, proteinG: 37, carbohydrateG: 1.28, fatG: 41.78 }),
    )

    setupFetchRouter({}) // No detail responses — should not be called

    const result = await calculateNutrition({
      ingredients: [{ name: 'bacon', quantity: 100, unit: 'g' }],
    })

    // Weight unit → resolve directly from 100g serving, no enrichment
    expect(result.ingredients[0].resolved).toBe(true)
    expect(result.ingredients[0].calories).toBeCloseTo(541, -1)

    // Verify no API calls were made (no fetch at all since weight unit)
    const apiCalls = mockFetch.mock.calls.filter(call =>
      String(call[0]).includes(API_URL_PART),
    )
    expect(apiCalls).toHaveLength(0)
  })

  it('single ingredient detail fetch fails (500) → completeness is incomplete, no crash', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(
      makeBareMatch({ name: 'Bacon', externalId: '1517', servingSize: 100, calories: 541, proteinG: 37, carbohydrateG: 1.28, fatG: 41.78 }),
    )

    // 500 for this food_id → enrichment returns null → original match used
    setupFetchRouter({ '1517': null })

    const result = await calculateNutrition({
      ingredients: [{ name: 'bacon', quantity: 3, unit: 'strip' }],
    })

    expect(result.ingredients[0].resolved).toBe(false)
    expect(result.completeness).toBe('incomplete')
  })
})
