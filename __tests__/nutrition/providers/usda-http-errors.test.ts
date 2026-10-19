/**
 * USDA FoodData Central provider — HTTP error handling and POST request shape
 *
 * Verifies:
 *   1. HTTP 400 → provider returns [] gracefully
 *   2. HTTP 503 → provider returns [] gracefully
 *   3. Network timeout → provider returns [] gracefully
 *   4. Valid 200 response → returns mapped ExternalFoodResult array
 *   5. dataType string preserved: 'SR Legacy' (with space) → fdcDataType = 'SR Legacy'
 *   6. search() uses POST with a JSON body (not GET with comma-separated dataType)
 *   7. dataType array contains all four types including 'Survey (FNDDS)' with parens
 *   8. Multi-word queries are encoded correctly in the JSON body
 *   9. api_key is in the URL query param, not in the request body
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UsdaFoodDataProvider } from '../../../lib/nutrition/providers/usda-fooddata'

// ── Mock fetch globally ───────────────────────────────────────────────────────
const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  // Provide a fake API key so the provider doesn't early-return on !this.apiKey
  vi.stubEnv('USDA_API_KEY', 'TEST_KEY_12345678901234567890123456789')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// ── Minimal USDA food payload ─────────────────────────────────────────────────
const MINIMAL_USDA_FOOD = {
  fdcId: 748967,
  description: 'EGG, WHOLE, RAW, FRESH',
  dataType: 'SR Legacy',
  servingSize: 50,
  servingSizeUnit: 'g',
  householdServingFullText: '1 large',
  foodNutrients: [
    { nutrientId: 1008, nutrientName: 'Energy', unitName: 'kcal', value: 143 },
    { nutrientId: 1003, nutrientName: 'Protein', unitName: 'g', value: 12.6 },
    { nutrientId: 1005, nutrientName: 'Carbohydrate', unitName: 'g', value: 0.72 },
    { nutrientId: 1004, nutrientName: 'Total fat', unitName: 'g', value: 9.51 },
  ],
}

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  }
}

function makeErrorResponse(status: number) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ error: `HTTP ${status}` }),
  }
}

describe('USDA provider HTTP error handling', () => {
  const provider = new UsdaFoodDataProvider()

  it('HTTP 400 response → search returns []', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(400))
    const results = await provider.search('egg')
    expect(results).toEqual([])
  })

  it('HTTP 503 response → search returns []', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(503))
    const results = await provider.search('chicken')
    expect(results).toEqual([])
  })

  it('Network timeout (AbortError) → search returns []', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    mockFetch.mockRejectedValueOnce(abortError)
    const results = await provider.search('bacon')
    expect(results).toEqual([])
  })

  it('Network error → search returns []', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'))
    const results = await provider.search('salmon')
    expect(results).toEqual([])
  })

  it('Valid 200 response → returns mapped ExternalFoodResult array', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ foods: [MINIMAL_USDA_FOOD], totalHits: 1 })
    )
    const results = await provider.search('egg')
    expect(results).toHaveLength(1)
    expect(results[0].provider).toBe('usda_fooddata')
    expect(results[0].externalId).toBe('748967')
    expect(results[0].coreNutrients.calories).toBeGreaterThan(0)
  })

  it('fdcDataType "SR Legacy" (with space) is preserved on result', async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ foods: [MINIMAL_USDA_FOOD], totalHits: 1 })
    )
    const results = await provider.search('egg')
    expect(results[0].fdcDataType).toBe('SR Legacy')
  })

  it('empty foods array → returns []', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ foods: [], totalHits: 0 }))
    const results = await provider.search('xyzxyz')
    expect(results).toEqual([])
  })

  it('missing foods field → returns []', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ totalHits: 0 }))
    const results = await provider.search('xyzxyz')
    expect(results).toEqual([])
  })
})

// ── Helper: capture fetch call details (url + init) ─────────────────────────

function captureFetch() {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  mockFetch.mockImplementationOnce((url: string, init?: RequestInit) => {
    capturedUrl = url
    capturedInit = init
    return Promise.resolve(makeOkResponse({ foods: [], totalHits: 0 }))
  })
  return {
    get url() { return capturedUrl },
    get init() { return capturedInit },
    get body() {
      return capturedInit?.body ? JSON.parse(capturedInit.body as string) : undefined
    },
  }
}

describe('USDA provider POST request shape', () => {
  const provider = new UsdaFoodDataProvider()

  it('search uses POST method, not GET', async () => {
    const cap = captureFetch()
    await provider.search('egg')
    expect(cap.init?.method).toBe('POST')
  })

  it('request has Content-Type: application/json header', async () => {
    const cap = captureFetch()
    await provider.search('egg')
    const headers = cap.init?.headers as Record<string, string>
    expect(headers?.['Content-Type']).toBe('application/json')
  })

  it('dataType in POST body is an array containing all four USDA types', async () => {
    const cap = captureFetch()
    await provider.search('egg')
    expect(Array.isArray(cap.body?.dataType)).toBe(true)
    expect(cap.body.dataType).toContain('Foundation')
    expect(cap.body.dataType).toContain('SR Legacy')
    expect(cap.body.dataType).toContain('Survey (FNDDS)')
    expect(cap.body.dataType).toContain('Branded')
  })

  it('"Survey (FNDDS)" preserved with parentheses in body — not URL-encoded', async () => {
    const cap = captureFetch()
    await provider.search('oatmeal')
    // parentheses must survive JSON serialization intact
    expect(cap.body?.dataType).toContain('Survey (FNDDS)')
    // URL must NOT contain the type string at all (it lives in the body)
    expect(cap.url).not.toContain('Survey')
    expect(cap.url).not.toContain('FNDDS')
  })

  it('multi-word query is in the JSON body, not only URL-encoded', async () => {
    const cap = captureFetch()
    await provider.search('raw spinach')
    expect(cap.body?.query).toBe('raw spinach')
    // The URL should only contain api_key, not the query
    expect(cap.url).not.toContain('raw')
    expect(cap.url).not.toContain('spinach')
  })

  it('api_key is in the URL query param, not in the request body', async () => {
    const cap = captureFetch()
    await provider.search('egg')
    expect(cap.url).toContain('api_key=')
    // api_key must NOT appear in the body
    const bodyStr = cap.init?.body as string
    expect(bodyStr).not.toContain('api_key')
    expect(bodyStr).not.toContain('TEST_KEY')
  })

  it('query with apostrophe is sanitized before placing in body', async () => {
    const cap = captureFetch()
    await provider.search("McDonald's fries")
    // apostrophe stripped by normalizeQueryForUsda
    expect(cap.body?.query).not.toContain("'")
    expect(cap.body?.query).not.toContain('’')
    // core words preserved
    expect(cap.body?.query).toContain('McDonald')
    expect(cap.body?.query).toContain('fries')
  })

  it('dataType is NOT present in the URL query string', async () => {
    const cap = captureFetch()
    await provider.search('spinach')
    expect(cap.url).not.toContain('dataType')
    expect(cap.url).not.toContain('Foundation')
    expect(cap.url).not.toContain('%2C')
  })
})
