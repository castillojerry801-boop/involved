// Tests for the YMove Nutrition provider (lib/nutrition/providers/ymove.ts).
// All network calls are mocked — no live API calls are made.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { ExternalFoodDetail } from '@/lib/nutrition/providers/types'

// ── Module setup ─────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

// Capture the global fetch mock
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Helper to build a minimal YMove food item
function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id:                 'test-uuid-1',
    displayName:        'Banana',
    shortName:          'Banana',
    name:               'Banana',
    brand:              null,
    servingSize:        118,
    servingDescription: '1 medium (7" to 7-7/8" long)',
    calories:           105,
    protein:            1.3,
    carbs:              27.0,
    fat:                0.4,
    fiber:              3.1,
    sugar:              14.4,
    sodium:             1.2,
    cholesterol:        0,
    saturatedFat:       0.1,
    barcode:            null,
    fdcId:              null,
    ...overrides,
  }
}

function mockOk(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
}

function mockNotFound() {
  return Promise.resolve(new Response('{}', { status: 404 }))
}

// ── Dynamic import after env setup ───────────────────────────────────────────

async function loadProvider(enabled = false) {
  vi.resetModules()
  process.env.YMOVE_NUTRITION_ENABLED = enabled ? 'true' : 'false'
  process.env.YMOVE_API_KEY = 'test-key'
  const mod = await import('@/lib/nutrition/providers/ymove')
  return mod
}

// ── Feature flag ─────────────────────────────────────────────────────────────

describe('isYMoveNutritionEnabled', () => {
  afterEach(() => { delete process.env.YMOVE_NUTRITION_ENABLED })

  it('returns false when env var is absent', async () => {
    delete process.env.YMOVE_NUTRITION_ENABLED
    const { isYMoveNutritionEnabled } = await loadProvider(false)
    expect(isYMoveNutritionEnabled()).toBe(false)
  })

  it('returns true when env var is "true"', async () => {
    const { isYMoveNutritionEnabled } = await loadProvider(true)
    expect(isYMoveNutritionEnabled()).toBe(true)
  })

  it('returns false when env var is "1" (not canonical "true")', async () => {
    process.env.YMOVE_NUTRITION_ENABLED = '1'
    const { isYMoveNutritionEnabled } = await loadProvider(false)
    expect(isYMoveNutritionEnabled()).toBe(false)
  })
})

// ── Provider identity ─────────────────────────────────────────────────────────

describe('YMoveNutritionProvider — identity', () => {
  it('exposes correct name and providerId', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const p = new YMoveNutritionProvider()
    expect(p.name).toBe('YMove Foods')
    expect(p.providerId).toBe('ymove')
  })
})

// ── search() ─────────────────────────────────────────────────────────────────

describe('YMoveNutritionProvider.search()', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('returns empty array for blank query', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const p = new YMoveNutritionProvider()
    const results = await p.search('  ')
    expect(results).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends request with q= parameter (not search=)', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockReturnValue(mockOk({ data: [] }))
    const p = new YMoveNutritionProvider()
    await p.search('banana', { limit: 5 })
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('q=banana')
    expect(url).toContain('limit=5')
    expect(url).not.toContain('search=')
  })

  it('sends X-API-Key header', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockReturnValue(mockOk({ data: [] }))
    const p = new YMoveNutritionProvider()
    await p.search('banana')
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('test-key')
  })

  it('maps per-serving values directly without per-100g conversion', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const item = makeItem()
    mockFetch.mockReturnValue(mockOk({ data: [item] }))
    const p = new YMoveNutritionProvider()
    const [result] = await p.search('banana')
    expect(result.coreNutrients.calories).toBe(105)
    expect(result.coreNutrients.proteinG).toBe(1.3)
    expect(result.coreNutrients.carbohydrateG).toBe(27.0)
    expect(result.coreNutrients.fatG).toBe(0.4)
    expect(result.servingSize).toBe(118)
  })

  it('prefers displayName over shortName and name', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const item = makeItem({ displayName: 'Display Name', shortName: 'Short', name: 'Raw Name' })
    mockFetch.mockReturnValue(mockOk({ data: [item] }))
    const p = new YMoveNutritionProvider()
    const [result] = await p.search('banana')
    expect(result.name).toBe('Display Name')
  })

  it('falls back to shortName when displayName is missing', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const item = makeItem({ displayName: null, shortName: 'Short Name', name: 'Raw Name' })
    mockFetch.mockReturnValue(mockOk({ data: [item] }))
    const p = new YMoveNutritionProvider()
    const [result] = await p.search('banana')
    expect(result.name).toBe('Short Name')
  })

  it('falls back to name field as last resort', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const item = makeItem({ displayName: null, shortName: null, name: 'Raw Name' })
    mockFetch.mockReturnValue(mockOk({ data: [item] }))
    const p = new YMoveNutritionProvider()
    const [result] = await p.search('banana')
    expect(result.name).toBe('Raw Name')
  })

  it('maps extended nutrients correctly', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockReturnValue(mockOk({ data: [makeItem()] }))
    const p = new YMoveNutritionProvider()
    const [result] = await p.search('banana') as ExternalFoodDetail[]
    expect(result.extendedNutrients?.fiberG).toBe(3.1)
    expect(result.extendedNutrients?.sugarG).toBe(14.4)
    expect(result.extendedNutrients?.sodiumMg).toBe(1.2)
    expect(result.extendedNutrients?.cholesterolMg).toBe(0)
    expect(result.extendedNutrients?.saturatedFatG).toBe(0.1)
  })

  it('filters out items with all-zero macros', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const zeroItem = makeItem({ calories: 0, protein: 0, carbs: 0, fat: 0 })
    mockFetch.mockReturnValue(mockOk({ data: [zeroItem, makeItem()] }))
    const p = new YMoveNutritionProvider()
    const results = await p.search('banana')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Banana')
  })

  it('filters out items with no name', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const noName = makeItem({ displayName: '', shortName: '', name: '' })
    mockFetch.mockReturnValue(mockOk({ data: [noName] }))
    const p = new YMoveNutritionProvider()
    const results = await p.search('banana')
    expect(results).toHaveLength(0)
  })

  it('always uses ymove UUID as externalId, ignoring fdcId', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const item = makeItem({ fdcId: '173944' })
    mockFetch.mockReturnValue(mockOk({ data: [item] }))
    const p = new YMoveNutritionProvider()
    const [result] = await p.search('banana')
    // YMove's getById uses /foods/:id which requires its own UUID, not an FDC ID
    expect(result.externalId).toBe('test-uuid-1')
  })

  it('uses ymove id as externalId when fdcId is null', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockReturnValue(mockOk({ data: [makeItem()] }))
    const p = new YMoveNutritionProvider()
    const [result] = await p.search('banana')
    expect(result.externalId).toBe('test-uuid-1')
  })

  it('flags servingSizeIsEstimated when servingSize is null', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const item = makeItem({ servingSize: null })
    mockFetch.mockReturnValue(mockOk({ data: [item] }))
    const p = new YMoveNutritionProvider()
    const [result] = await p.search('banana')
    expect(result.servingSizeIsEstimated).toBe(true)
    expect(result.servingSize).toBe(100)
  })

  it('returns empty array on HTTP error', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockReturnValue(Promise.resolve(new Response('', { status: 500 })))
    const p = new YMoveNutritionProvider()
    const results = await p.search('banana')
    expect(results).toEqual([])
  })

  it('returns empty array on network error', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockRejectedValue(new Error('Network error'))
    const p = new YMoveNutritionProvider()
    const results = await p.search('banana')
    expect(results).toEqual([])
  })
})

// ── getById() ─────────────────────────────────────────────────────────────────

describe('YMoveNutritionProvider.getById()', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('calls /foods/:id and returns mapped detail', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockReturnValue(mockOk({ data: makeItem({ id: 'abc-123' }) }))
    const p = new YMoveNutritionProvider()
    const result = await p.getById('abc-123')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/foods/abc-123')
    expect(result?.name).toBe('Banana')
    expect(result?.provider).toBe('ymove')
  })

  it('returns null on 404', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockReturnValue(mockNotFound())
    const p = new YMoveNutritionProvider()
    expect(await p.getById('missing')).toBeNull()
  })

  it('returns null when data key is absent', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockReturnValue(mockOk({ error: 'not found' }))
    const p = new YMoveNutritionProvider()
    expect(await p.getById('abc')).toBeNull()
  })
})

// ── searchByBarcode() ─────────────────────────────────────────────────────────

describe('YMoveNutritionProvider.searchByBarcode()', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('calls /foods/barcode/:upc and returns mapped detail', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const item = makeItem({ barcode: '049000042566' })
    mockFetch.mockReturnValue(mockOk({ data: item }))
    const p = new YMoveNutritionProvider()
    const result = await p.searchByBarcode('049000042566')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/foods/barcode/049000042566')
    expect(result?.barcode).toBe('049000042566')
  })

  it('rejects result if returned barcode does not match queried barcode', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    const item = makeItem({ barcode: '999999999999' })
    mockFetch.mockReturnValue(mockOk({ data: item }))
    const p = new YMoveNutritionProvider()
    const result = await p.searchByBarcode('049000042566')
    expect(result).toBeNull()
  })

  it('accepts EAN-13 vs UPC-A variants (leading zero bridge)', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    // Queried as 12-digit UPC-A, returned as 13-digit EAN-13 with leading zero
    const item = makeItem({ barcode: '0049000042566' })
    mockFetch.mockReturnValue(mockOk({ data: item }))
    const p = new YMoveNutritionProvider()
    const result = await p.searchByBarcode('049000042566')
    expect(result).not.toBeNull()
  })

  it('returns null on 404', async () => {
    const { YMoveNutritionProvider } = await loadProvider()
    mockFetch.mockReturnValue(mockNotFound())
    const p = new YMoveNutritionProvider()
    expect(await p.searchByBarcode('049000042566')).toBeNull()
  })
})

// ── Integration: FOOD_PROVIDERS registry ──────────────────────────────────────

describe('FOOD_PROVIDERS registry', () => {
  afterEach(() => { delete process.env.YMOVE_NUTRITION_ENABLED })

  it('does NOT include ymove when flag is disabled', async () => {
    vi.resetModules()
    process.env.YMOVE_NUTRITION_ENABLED = 'false'
    process.env.YMOVE_API_KEY = 'test-key'
    const { FOOD_PROVIDERS } = await import('@/lib/nutrition/providers')
    expect(FOOD_PROVIDERS.some(p => p.providerId === 'ymove')).toBe(false)
  })

  it('includes ymove when flag is enabled', async () => {
    vi.resetModules()
    process.env.YMOVE_NUTRITION_ENABLED = 'true'
    process.env.YMOVE_API_KEY = 'test-key'
    const { FOOD_PROVIDERS } = await import('@/lib/nutrition/providers')
    expect(FOOD_PROVIDERS.some(p => p.providerId === 'ymove')).toBe(true)
  })

  it('inserts ymove between nih_dsld and open_food_facts', async () => {
    vi.resetModules()
    process.env.YMOVE_NUTRITION_ENABLED = 'true'
    process.env.YMOVE_API_KEY = 'test-key'
    const { FOOD_PROVIDERS } = await import('@/lib/nutrition/providers')
    const ids = FOOD_PROVIDERS.map(p => p.providerId)
    const dsldIdx = ids.indexOf('nih_dsld')
    const ymoveIdx = ids.indexOf('ymove')
    const offIdx   = ids.indexOf('open_food_facts')
    expect(dsldIdx).toBeGreaterThan(-1)
    expect(ymoveIdx).toBeGreaterThan(dsldIdx)
    expect(offIdx).toBeGreaterThan(ymoveIdx)
  })
})
