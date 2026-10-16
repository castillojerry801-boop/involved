/**
 * USDA FoodData Central provider — HTTP error handling and URL encoding
 *
 * Verifies:
 *   1. HTTP 400 → provider returns [] gracefully
 *   2. HTTP 503 → provider returns [] gracefully
 *   3. Network timeout → provider returns [] gracefully
 *   4. Valid 200 response → returns mapped ExternalFoodResult array
 *   5. dataType string preserved: 'SR Legacy' (with space) → fdcDataType = 'SR Legacy'
 *   6. The URL constructed does NOT encode commas as %2C (regression guard)
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

describe('USDA provider URL encoding regression guard', () => {
  const provider = new UsdaFoodDataProvider()

  it('URL does NOT encode commas in dataType as %2C', async () => {
    let capturedUrl = ''
    mockFetch.mockImplementationOnce((url: string) => {
      capturedUrl = url
      return Promise.resolve(makeOkResponse({ foods: [], totalHits: 0 }))
    })
    await provider.search('egg')

    // The critical assertion: commas must be literal in the URL
    expect(capturedUrl).not.toContain('%2C')
    // Spaces in "SR Legacy" and "Survey (FNDDS)" must be encoded as %20 (or literal, not +)
    expect(capturedUrl).not.toContain('SR+Legacy')
    expect(capturedUrl).not.toContain('Survey+%28FNDDS%29')
    // dataType values must be present
    expect(capturedUrl).toContain('Foundation')
    expect(capturedUrl).toContain('SR')
    expect(capturedUrl).toContain('Legacy')
  })

  it('query string with apostrophe is sanitized before URL construction', async () => {
    let capturedUrl = ''
    mockFetch.mockImplementationOnce((url: string) => {
      capturedUrl = url
      return Promise.resolve(makeOkResponse({ foods: [], totalHits: 0 }))
    })
    await provider.search("McDonald's fries")
    // Apostrophe should be removed/replaced — normalizeQueryForUsda replaces ' with space
    expect(capturedUrl).not.toContain("'")
    expect(capturedUrl).not.toContain('%27')
    // Core words should still be present (apostrophe replaced with space or removed)
    expect(capturedUrl).toContain('fries')
    expect(capturedUrl).toContain('McDonald')
  })
})
