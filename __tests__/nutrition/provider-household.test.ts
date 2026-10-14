/**
 * Provider household unit extraction tests.
 *
 * Covers:
 *  - USDA mapFood: branded foods extract householdUnit from householdServingFullText
 *  - USDA mapFood: non-branded foods do NOT extract household units (100g serving mismatch)
 *  - USDA mapFood: size adjective enriched with food noun from description
 *  - Open Food Facts mapProduct/resolveServing: count nouns extracted
 *  - Open Food Facts: volume units retained for packaged gram-based foods
 *  - Open Food Facts: metric weight units skipped
 *  - FatSecret: existing household extraction still works (regression)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── USDA provider direct unit tests ──────────────────────────────────────────

// We test the mapFood function via the search route (which calls provider.search()).
// Since mapFood is not exported, we test via a mocked fetch that returns controlled
// USDA API responses and inspect the final search result.

const { mockFetch } = vi.hoisted(() => {
  const mockFetch = vi.fn()
  return { mockFetch }
})

vi.stubGlobal('fetch', mockFetch)

// Build a minimal USDA food response for mapFood
function makeUsdaFood(overrides: {
  fdcId?: number
  description?: string
  dataType?: string
  brandName?: string
  servingSize?: number
  servingSizeUnit?: string
  householdServingFullText?: string
} = {}) {
  return {
    fdcId: overrides.fdcId ?? 1662945,
    description: overrides.description ?? 'EGGS, LARGE, GRADE A',
    dataType: overrides.dataType ?? 'Branded',
    brandName: overrides.brandName ?? 'Oakdell',
    servingSize: overrides.servingSize ?? 44,
    servingSizeUnit: overrides.servingSizeUnit ?? 'g',
    householdServingFullText: overrides.householdServingFullText,
    foodNutrients: [
      { nutrientId: 1008, nutrientName: 'Energy', unitName: 'kcal', value: 143 },
      { nutrientId: 1003, nutrientName: 'Protein', unitName: 'g', value: 12.6 },
      { nutrientId: 1005, nutrientName: 'Carbohydrate, by difference', unitName: 'g', value: 0.7 },
      { nutrientId: 1004, nutrientName: 'Total lipid (fat)', unitName: 'g', value: 9.5 },
    ],
  }
}

import { UsdaFoodDataProvider } from '../../lib/nutrition/providers/usda-fooddata'

describe('USDA mapFood — household unit extraction', () => {
  const provider = new UsdaFoodDataProvider()

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.USDA_API_KEY = 'test-key'
  })

  it('branded egg food with "1 large" → householdUnit="large egg", unitsPerServing=1', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [makeUsdaFood({ householdServingFullText: '1 large' })],
      }),
    })

    const results = await provider.search('eggs')
    expect(results).toHaveLength(1)
    expect(results[0].householdUnit).toBe('large egg')
    expect(results[0].unitsPerServing).toBe(1)
    expect(results[0].householdServingText).toBe('1 large')
  })

  it('branded apple food with "1 medium" → householdUnit="medium apple"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [makeUsdaFood({
          description: 'Apple, raw, with skin',
          householdServingFullText: '1 medium',
          servingSize: 182,
        })],
      }),
    })

    const results = await provider.search('apple')
    expect(results[0].householdUnit).toBe('medium apple')
    expect(results[0].unitsPerServing).toBe(1)
  })

  it('branded food with household "1 cup" (not a size adj) → householdUnit="cup", unitsPerServing=1', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [makeUsdaFood({
          description: 'Oatmeal, rolled, dry',
          householdServingFullText: '1 cup',
          servingSize: 81,
        })],
      }),
    })

    const results = await provider.search('oatmeal')
    expect(results[0].householdUnit).toBe('cup')
    expect(results[0].unitsPerServing).toBe(1)
  })

  it('non-branded food (Foundation) does NOT extract household unit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [makeUsdaFood({
          dataType: 'Foundation',
          description: 'Egg, whole, raw, fresh',
          servingSize: 100,  // normalized to 100g for non-branded
          householdServingFullText: '1 large',  // but this refers to ~50g, not 100g
        })],
      }),
    })

    const results = await provider.search('egg')
    expect(results[0].householdUnit).toBeUndefined()
    expect(results[0].unitsPerServing).toBeUndefined()
    // householdServingText is still shown as a label, just not used for unit conversion
    expect(results[0].householdServingText).toBe('1 large')
  })

  it('branded food with no householdServingFullText → no household unit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [makeUsdaFood({ householdServingFullText: undefined })],
      }),
    })

    const results = await provider.search('eggs')
    expect(results[0].householdUnit).toBeUndefined()
    expect(results[0].unitsPerServing).toBeUndefined()
  })

  it('branded food with householdServingFullText="1 oz" → no household unit (metric weight)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [makeUsdaFood({
          householdServingFullText: '1 oz',
          servingSize: 28,
        })],
      }),
    })

    const results = await provider.search('test')
    expect(results[0].householdUnit).toBeUndefined()
  })

  it('branded food with "2 strips" → householdUnit="strip", unitsPerServing=2', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [makeUsdaFood({
          description: 'Bacon, cured, pan-fried',
          householdServingFullText: '2 strips',
          servingSize: 46,
        })],
      }),
    })

    const results = await provider.search('bacon')
    expect(results[0].householdUnit).toBe('strip')
    expect(results[0].unitsPerServing).toBe(2)
  })
})

// ── Open Food Facts provider tests ───────────────────────────────────────────

import { OpenFoodFactsProvider } from '../../lib/nutrition/providers/open-food-facts'

function makeOffProduct(overrides: {
  code?: string
  product_name?: string
  brands?: string
  serving_size?: string
  serving_quantity?: number | null
} = {}) {
  return {
    code: overrides.code ?? '0044946190364',
    product_name: overrides.product_name ?? 'Ready-to-Cook Flour Tortillas',
    brands: overrides.brands ?? 'Tortilla Land',
    serving_size: overrides.serving_size,
    serving_quantity: overrides.serving_quantity,
    nutriments: {
      'energy-kcal_100g': 310,
      'proteins_100g': 7,
      'carbohydrates_100g': 55,
      'fat_100g': 6,
    },
  }
}

describe('Open Food Facts — household unit extraction from serving_size', () => {
  const provider = new OpenFoodFactsProvider()

  beforeEach(() => vi.clearAllMocks())

  it('"1 tortilla (47g)" → householdUnit="tortilla", unitsPerServing=1', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: makeOffProduct({ serving_size: '1 tortilla (47g)', serving_quantity: 47 }) }),
    })

    const result = await provider.searchByBarcode('0044946190364')
    expect(result).not.toBeNull()
    expect(result!.householdUnit).toBe('tortilla')
    expect(result!.unitsPerServing).toBe(1)
    expect(result!.householdServingText).toBe('1 tortilla')
  })

  it('"3 tablespoons (46g)" → householdUnit="tablespoon", unitsPerServing=3', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: makeOffProduct({
        product_name: 'Liquid Egg Whites',
        serving_size: '3 tablespoons (46g)',
        serving_quantity: 46,
      }) }),
    })

    const result = await provider.searchByBarcode('0011110041647')
    expect(result).not.toBeNull()
    expect(result!.householdUnit).toBe('tablespoon')
    expect(result!.unitsPerServing).toBe(3)
  })

  it('"1/4 cup (28g)" → householdUnit="cup", unitsPerServing=0.25', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: makeOffProduct({
        product_name: 'Shredded Cheese',
        serving_size: '1/4 cup (28g)',
        serving_quantity: 28,
      }) }),
    })

    const result = await provider.searchByBarcode('0001111061100')
    expect(result).not.toBeNull()
    expect(result!.householdUnit).toBe('cup')
    expect(result!.unitsPerServing).toBeCloseTo(0.25)
  })

  it('"1 bar (65g)" → householdUnit="bar", unitsPerServing=1', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: makeOffProduct({ serving_size: '1 bar (65g)', serving_quantity: 65 }) }),
    })

    const result = await provider.searchByBarcode('0001234567890')
    expect(result!.householdUnit).toBe('bar')
    expect(result!.unitsPerServing).toBe(1)
  })

  it('"2 slices (42g)" → householdUnit="slice", unitsPerServing=2', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: makeOffProduct({ serving_size: '2 slices (42g)', serving_quantity: 42 }) }),
    })

    const result = await provider.searchByBarcode('0001234567891')
    expect(result!.householdUnit).toBe('slice')
    expect(result!.unitsPerServing).toBe(2)
  })

  it('"28g" serving_size → no household unit (no label)', () => {
    // No parenthesized gram/ml pattern with label before it
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: makeOffProduct({ serving_size: '28g', serving_quantity: 28 }) }),
    })

    return provider.searchByBarcode('0001234567892').then(result => {
      expect(result!.householdUnit).toBeUndefined()
      expect(result!.householdServingText).toBeUndefined()
    })
  })

  it('"1 oz (28g)" → no household unit (oz is a metric weight unit)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: makeOffProduct({ serving_size: '1 oz (28g)', serving_quantity: 28 }) }),
    })

    const result = await provider.searchByBarcode('0001234567893')
    // householdServingText = "1 oz" but parseHouseholdText("1 oz") returns null
    expect(result!.householdUnit).toBeUndefined()
    expect(result!.unitsPerServing).toBeUndefined()
  })

  it('no serving_size field → no household unit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: makeOffProduct({ serving_size: undefined, serving_quantity: null }) }),
    })

    const result = await provider.searchByBarcode('0001234567894')
    expect(result!.householdUnit).toBeUndefined()
  })
})

// ── FatSecret regression: existing household extraction still works ───────────
// Note: FatSecret has module-level token caching. We route mock responses by
// URL to avoid the token mock being consumed by the search call (or vice versa).

import { FatSecretProvider } from '../../lib/nutrition/providers/fatsecret'

function makeFsSearchResponse(foods: unknown[]) {
  return { ok: true, json: async () => ({ foods: { food: foods } }) }
}

const FS_TOKEN_RESPONSE = {
  ok: true,
  json: async () => ({ access_token: 'mock-token', expires_in: 3600 }),
}

function stubFsWithSearch(searchBody: unknown[]) {
  mockFetch.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('oauth.fatsecret.com')) {
      return FS_TOKEN_RESPONSE
    }
    return makeFsSearchResponse(searchBody)
  })
}

describe('FatSecret — household extraction regression', () => {
  const provider = new FatSecretProvider()

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FATSECRET_CLIENT_ID = 'test-id'
    process.env.FATSECRET_CLIENT_SECRET = 'test-secret'
  })

  it('search result "Per 1 patty (100g)" → householdUnit="patty", unitsPerServing=1', async () => {
    stubFsWithSearch([{
      food_id: '45188012',
      food_name: 'Hash Brown Patty',
      brand_name: 'Cavendish',
      food_description: 'Per 1 patty (100g) - Calories: 150kcal | Fat: 7g | Carbs: 20g | Protein: 2g',
    }])

    const results = await provider.search('hash brown')
    expect(results).toHaveLength(1)
    expect(results[0].householdUnit).toBe('patty')
    expect(results[0].unitsPerServing).toBe(1)
  })

  it('search result "Per 100g" → no householdUnit', async () => {
    stubFsWithSearch([{
      food_id: '12345',
      food_name: 'Chicken Breast',
      food_description: 'Per 100g - Calories: 165kcal | Fat: 3.6g | Carbs: 0g | Protein: 31g',
    }])

    const results = await provider.search('chicken')
    expect(results).toHaveLength(1)
    expect(results[0].householdUnit).toBeUndefined()
    expect(results[0].unitsPerServing).toBeUndefined()
  })
})
