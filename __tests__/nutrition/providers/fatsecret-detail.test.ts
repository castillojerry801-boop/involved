/**
 * FatSecret provider — getById() and mapFoodDetail()
 *
 * Verifies the detail endpoint handling:
 *   1. Multi-serving response (array) → correct serving selected, not 100g baseline
 *   2. Single-serving response (object not array) → no crash
 *   3. "1 serving" as only serving description → returns data (factor engine rejects later)
 *   4. Egg detail "1 large" → correct householdServingText + gramWeight
 *   5. Flour tortilla detail "1 tortilla" → householdServingText set correctly
 *   6. HTTP 500 → returns null gracefully
 *   7. fetch abort (timeout) → returns null gracefully
 *   8. Non-100g serving is preferred over 100g baseline
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FatSecretProvider } from '../../../lib/nutrition/providers/fatsecret'

// ── fetch mock ────────────────────────────────────────────────────────────────
// NOTE: FatSecret uses a module-level cachedToken. We mock fetch to handle
// BOTH the token URL and the API URL in each test by routing by URL string,
// so we're robust regardless of whether the token is cached from a prior test.

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token'
const API_URL = 'https://platform.fatsecret.com/rest/server.api'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  vi.stubEnv('FATSECRET_CLIENT_ID', 'TEST_CLIENT_ID')
  vi.stubEnv('FATSECRET_CLIENT_SECRET', 'TEST_CLIENT_SECRET')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Set up mockFetch so that:
 *  - calls to TOKEN_URL return a valid token response
 *  - calls to API_URL return the provided food detail response
 * This is robust to token caching: if the token is already cached, no token call
 * happens and the API call gets the detail directly.
 */
function setupDetailMock(food: object | null, httpStatus = 200) {
  mockFetch.mockImplementation((url: string) => {
    if (String(url).startsWith(TOKEN_URL)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'test-token', expires_in: 86400 }),
        text: () => Promise.resolve(''),
      })
    }
    // API call
    if (httpStatus !== 200) {
      return Promise.resolve({
        ok: false,
        status: httpStatus,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(`HTTP ${httpStatus}`),
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(food !== null ? { food } : {}),
      text: () => Promise.resolve(''),
    })
  })
}

function setupAbortMock() {
  mockFetch.mockImplementation((url: string) => {
    if (String(url).startsWith(TOKEN_URL)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'test-token', expires_in: 86400 }),
        text: () => Promise.resolve(''),
      })
    }
    // API call → simulate abort
    return Promise.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
  })
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BACON_DETAIL = {
  food_id: '1517',
  food_name: 'Bacon',
  food_type: 'Generic',
  servings: {
    serving: [
      {
        serving_id: '1',
        serving_description: '1 strip',
        measurement_description: 'strip',
        number_of_units: '1.000',
        metric_serving_amount: '8.000',
        metric_serving_unit: 'g',
        calories: '43',
        protein: '3.00',
        carbohydrate: '0.10',
        fat: '3.30',
        sodium: '185',
        fiber: '0',
      },
      {
        serving_id: '2',
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

const EGG_DETAIL = {
  food_id: '2076643',
  food_name: 'Egg',
  food_type: 'Generic',
  servings: {
    serving: [
      {
        serving_id: '10',
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
        serving_id: '11',
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

// Single-object (not array) serving form — common for FatSecret foods with one serving
const TORTILLA_DETAIL = {
  food_id: '3742',
  food_name: 'Flour Tortilla',
  food_type: 'Generic',
  servings: {
    serving: {
      serving_id: '20',
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

const GENERIC_SERVING_DETAIL = {
  food_id: '9999',
  food_name: 'Some Prepared Food',
  food_type: 'Generic',
  servings: {
    serving: {
      serving_id: '30',
      serving_description: '1 serving',
      measurement_description: 'serving',
      number_of_units: '1.000',
      metric_serving_amount: '100.000',
      metric_serving_unit: 'g',
      calories: '200',
      protein: '10.00',
      carbohydrate: '20.00',
      fat: '8.00',
    },
  },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FatSecretProvider.getById()', () => {
  let provider: FatSecretProvider

  beforeEach(() => {
    provider = new FatSecretProvider()
  })

  it('bacon detail (array of servings) → picks "1 strip" as householdServingText', async () => {
    setupDetailMock(BACON_DETAIL)

    const detail = await provider.getById('1517')

    expect(detail).not.toBeNull()
    expect(detail!.externalId).toBe('1517')
    expect(detail!.name).toBe('Bacon')
    // Must prefer "1 strip" (8g, non-100g serving) over the 100g baseline
    expect(detail!.householdServingText).toBe('1 strip')
    expect(detail!.householdUnit).toBe('strip')
    expect(detail!.servingSize).toBe(8)
    expect(detail!.servingUnit).toBe('g')
    expect(detail!.coreNutrients.calories).toBe(43)
    expect(detail!.coreNutrients.proteinG).toBeCloseTo(3.0, 1)
    expect(detail!.coreNutrients.fatG).toBeCloseTo(3.3, 1)
  })

  it('flour tortilla (single-object serving, not array) → handled without crash', async () => {
    setupDetailMock(TORTILLA_DETAIL)

    const detail = await provider.getById('3742')

    expect(detail).not.toBeNull()
    expect(detail!.householdServingText).toBe('1 tortilla')
    expect(detail!.householdUnit).toBe('tortilla')
    expect(detail!.servingSize).toBe(45)
    expect(detail!.coreNutrients.calories).toBe(130)
  })

  it('"1 serving" as only serving → data is returned (factor engine rejects non-count word later)', async () => {
    setupDetailMock(GENERIC_SERVING_DETAIL)

    const detail = await provider.getById('9999')

    // Provider returns data — it's the factor engine (NON_COUNT_WORDS) that rejects "serving"
    expect(detail).not.toBeNull()
    expect(detail!.householdServingText).toBe('1 serving')
    // householdUnit = 'serving' from measurement_description — factor engine will reject it
    expect(detail!.coreNutrients.calories).toBe(200)
  })

  it('egg detail "1 large" → householdServingText = "1 large", servingSize = 50g', async () => {
    setupDetailMock(EGG_DETAIL)

    const detail = await provider.getById('2076643')

    expect(detail).not.toBeNull()
    expect(detail!.householdServingText).toBe('1 large')
    expect(detail!.householdUnit).toBe('large')
    expect(detail!.servingSize).toBe(50)
    expect(detail!.coreNutrients.calories).toBe(72)
    expect(detail!.coreNutrients.proteinG).toBeCloseTo(6.3, 1)
  })

  it('multi-serving with 100g baseline → non-100g serving is preferred', async () => {
    setupDetailMock(BACON_DETAIL)

    const detail = await provider.getById('1517')

    // pickServing prefers "1 strip" (8g) over "100g" baseline
    expect(detail!.servingSize).toBe(8)
    expect(detail!.householdServingText).not.toBe('100g')
  })

  it('HTTP 500 → returns null gracefully, no throw', async () => {
    setupDetailMock(null, 500)

    await expect(provider.getById('1517')).resolves.toBeNull()
  })

  it('fetch abort (timeout) → returns null gracefully, no throw', async () => {
    setupAbortMock()

    await expect(provider.getById('1517')).resolves.toBeNull()
  })

  it('externalId, name, and provider fields are correctly set', async () => {
    setupDetailMock(BACON_DETAIL)

    const detail = await provider.getById('1517')

    expect(detail!.externalId).toBe('1517')
    expect(detail!.provider).toBe('fatsecret')
    expect(detail!.isGeneric).toBe(true)
    expect(detail!.name).toBe('Bacon')
  })

  // ── pickServing() unit-aware scoring tests ────────────────────────────────
  // These use getByIdForEnrichment() which passes inputUnit to pickServing().

  it('multi-serving food: inputUnit="strip" → pickServing prefers "1 strip" over "1 slice"', async () => {
    // Food with two non-100g servings: "1 slice" first, "1 strip" second.
    // With inputUnit='strip', scoring must prefer "1 strip" even though it's not first.
    const multiServingFood = {
      food_id: '5555',
      food_name: 'Cured Meat',
      food_type: 'Generic',
      servings: {
        serving: [
          {
            serving_id: '100',
            serving_description: '1 slice',
            measurement_description: 'slice',
            number_of_units: '1.000',
            metric_serving_amount: '12.000',  // slice = 12g
            metric_serving_unit: 'g',
            calories: '55',
            protein: '4.00',
            carbohydrate: '0.20',
            fat: '4.10',
          },
          {
            serving_id: '101',
            serving_description: '1 strip',
            measurement_description: 'strip',
            number_of_units: '1.000',
            metric_serving_amount: '8.000',   // strip = 8g
            metric_serving_unit: 'g',
            calories: '36',
            protein: '2.80',
            carbohydrate: '0.10',
            fat: '2.80',
          },
        ],
      },
    }

    // Use getByIdForEnrichment so inputUnit is passed to pickServing
    setupDetailMock(multiServingFood)
    const detail = await provider.getByIdForEnrichment('5555', 'strip')

    expect(detail).not.toBeNull()
    // Must prefer "1 strip" (exact match) over "1 slice" (non-exact)
    expect(detail!.householdUnit).toBe('strip')
    expect(detail!.servingSize).toBe(8)
    expect(detail!.coreNutrients.calories).toBe(36)
  })

  it('getByIdForEnrichment with inputUnit="piece" → prefers natural serving over 100g', async () => {
    setupDetailMock(BACON_DETAIL)

    const detail = await provider.getByIdForEnrichment('1517', 'piece')

    // 'piece' is a generic count synonym → should still prefer "1 strip" (non-100g)
    expect(detail).not.toBeNull()
    expect(detail!.servingSize).toBe(8)
    expect(detail!.householdUnit).toBe('strip')
  })
})
