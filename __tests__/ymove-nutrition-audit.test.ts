// Regression tests for the four correctness concerns identified during the YMove Nutrition
// integration audit (2026-10-30):
//   1. Provider-neutral accuracy: verified barcode match must score above a provider-bonus gap
//   2. Barcode deduplication: highest-quality result wins, not first-provider result
//   3. Missing serving weights: servingSizeIsEstimated correctly set; 100g is a placeholder
//   4. Source identity: externalId is always the YMove UUID (never fdcId)

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { scoreResult, barcodeResultQuality } from '@/lib/nutrition/search-utils'
import type { ExternalFoodResult, ExternalFoodDetail } from '@/lib/nutrition/providers/types'

vi.mock('server-only', () => ({}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<ExternalFoodResult> = {}): ExternalFoodResult {
  return {
    provider: 'ymove',
    externalId: 'test-uuid-1',
    name: 'Coca-Cola Original',
    brand: 'Coca-Cola',
    servingSize: 355,
    servingUnit: 'ml',
    coreNutrients: { calories: 140, proteinG: 0, carbohydrateG: 39, fatG: 0 },
    ...overrides,
  }
}

function makeDetail(overrides: Partial<ExternalFoodDetail> = {}): ExternalFoodDetail {
  return {
    ...makeResult(),
    ...overrides,
  }
}

function mockOk(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ymove-uuid-1', displayName: 'Test Food',
    calories: 100, protein: 5, carbs: 10, fat: 2, servingSize: 100,
    ...overrides,
  }
}

async function loadYMoveProvider() {
  vi.resetModules()
  process.env.YMOVE_NUTRITION_ENABLED = 'true'
  process.env.YMOVE_API_KEY = 'test-key'
  const { YMoveNutritionProvider } = await import('@/lib/nutrition/providers/ymove')
  return new YMoveNutritionProvider()
}

// ── Concern 1 — Provider-neutral accuracy (barcode match bonus) ───────────────

describe('scoreResult — barcode match bonus (Concern 1)', () => {
  it('adds +15 when result barcode matches a barcode-format query', () => {
    const r = makeResult({ barcode: '049000042566' })
    const withMatch    = scoreResult(r, '049000042566')
    const withoutMatch = scoreResult({ ...r, barcode: undefined }, '049000042566')
    expect(withMatch - withoutMatch).toBe(15)
  })

  it('adds only +5 when result has a barcode but query is not a barcode', () => {
    const r = makeResult({ barcode: '049000042566' })
    const withBarcode    = scoreResult(r, 'coca cola')
    const withoutBarcode = scoreResult({ ...r, barcode: undefined }, 'coca cola')
    expect(withBarcode - withoutBarcode).toBe(5)
  })

  it('adds only +5 when result barcode does not match the queried barcode', () => {
    const r = makeResult({ barcode: '999999999999' })
    const withMismatch = scoreResult(r, '049000042566')
    const withNone     = scoreResult({ ...r, barcode: undefined }, '049000042566')
    expect(withMismatch - withNone).toBe(5)
  })

  it('treats EAN-13 and UPC-A as the same barcode (leading-zero bridge)', () => {
    const r = makeResult({ barcode: '0049000042566' })
    const withMatch    = scoreResult(r, '049000042566')
    const withoutMatch = scoreResult({ ...r, barcode: undefined }, '049000042566')
    expect(withMatch - withoutMatch).toBe(15)
  })

  it('YMove exact barcode match outscores FatSecret no-barcode match when query is a barcode', () => {
    const query = '049000042566'
    const ymoveBarcode = makeResult({
      provider: 'ymove',
      name: 'Coca-Cola Original',
      barcode: '049000042566',
      coreNutrients: { calories: 140, proteinG: 0, carbohydrateG: 39, fatG: 0 },
    })
    const fatsecretNoBarcode = makeResult({
      provider: 'fatsecret',
      name: 'Coca-Cola Original',
      barcode: undefined,
      coreNutrients: { calories: 140, proteinG: 0, carbohydrateG: 39, fatG: 0 },
    })
    expect(scoreResult(ymoveBarcode, query)).toBeGreaterThan(scoreResult(fatsecretNoBarcode, query))
  })
})

// ── Concern 2 — Barcode deduplication quality (barcodeResultQuality) ──────────

describe('barcodeResultQuality (Concern 2)', () => {
  it('ranks result with all macros non-zero above result missing macros', () => {
    // "complete": all four macros > 0
    const complete = makeDetail({
      provider: 'ymove',
      coreNutrients: { calories: 140, proteinG: 1, carbohydrateG: 39, fatG: 0.1 },
    })
    // "incomplete": calories only
    const incomplete = makeDetail({
      provider: 'fatsecret',
      coreNutrients: { calories: 140, proteinG: 0, carbohydrateG: 0, fatG: 0 },
    })
    expect(barcodeResultQuality(complete)).toBeGreaterThan(barcodeResultQuality(incomplete))
  })

  it('ranks result with known serving size above result with estimated serving size', () => {
    const known     = makeDetail({ servingSize: 355, servingSizeIsEstimated: undefined })
    const estimated = makeDetail({ servingSize: 100, servingSizeIsEstimated: true })
    expect(barcodeResultQuality(known)).toBeGreaterThan(barcodeResultQuality(estimated))
  })

  it('ranks result with extended nutrients above result without', () => {
    const rich = makeDetail({ extendedNutrients: { sodiumMg: 45, sugarG: 39 } })
    const bare = makeDetail({ extendedNutrients: undefined })
    expect(barcodeResultQuality(rich)).toBeGreaterThan(barcodeResultQuality(bare))
  })

  it('uses provider bonus as tiebreaker when completeness is equal', () => {
    const fatsecret = makeDetail({ provider: 'fatsecret' })
    const off       = makeDetail({ provider: 'open_food_facts' })
    expect(barcodeResultQuality(fatsecret)).toBeGreaterThan(barcodeResultQuality(off))
  })

  it('higher-completeness YMove beats lower-completeness FatSecret', () => {
    const ymoveComplete = makeDetail({
      provider: 'ymove',
      servingSize: 355,
      coreNutrients: { calories: 140, proteinG: 1, carbohydrateG: 39, fatG: 0.1 },
      extendedNutrients: { sodiumMg: 45 },
    })
    const fatsecretIncomplete = makeDetail({
      provider: 'fatsecret',
      servingSize: 100,
      servingSizeIsEstimated: true,
      coreNutrients: { calories: 140, proteinG: 0, carbohydrateG: 0, fatG: 0 },
    })
    expect(barcodeResultQuality(ymoveComplete)).toBeGreaterThan(barcodeResultQuality(fatsecretIncomplete))
  })
})

// ── Concern 3 — Missing serving weights (servingSizeIsEstimated) ──────────────

describe('YMove serving size flag (Concern 3)', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('does NOT set servingSizeIsEstimated when API provides a valid serving size', async () => {
    const p = await loadYMoveProvider()
    mockFetch.mockReturnValue(mockOk({ data: [makeItem({ servingSize: 118 })] }))
    const [result] = await p.search('food')
    expect(result.servingSizeIsEstimated).toBeUndefined()
    expect(result.servingSize).toBe(118)
  })

  it('sets servingSizeIsEstimated when API returns null servingSize', async () => {
    const p = await loadYMoveProvider()
    mockFetch.mockReturnValue(mockOk({ data: [makeItem({ servingSize: null })] }))
    const [result] = await p.search('food')
    expect(result.servingSizeIsEstimated).toBe(true)
  })

  it('sets servingSizeIsEstimated when API returns zero servingSize', async () => {
    const p = await loadYMoveProvider()
    mockFetch.mockReturnValue(mockOk({ data: [makeItem({ servingSize: 0 })] }))
    const [result] = await p.search('food')
    expect(result.servingSizeIsEstimated).toBe(true)
  })

  it('sets servingSizeIsEstimated when API returns negative servingSize', async () => {
    const p = await loadYMoveProvider()
    mockFetch.mockReturnValue(mockOk({ data: [makeItem({ servingSize: -1 })] }))
    const [result] = await p.search('food')
    expect(result.servingSizeIsEstimated).toBe(true)
  })
})

// ── Concern 4 — Source identity: externalId is always the YMove UUID ──────────

describe('YMove externalId (Concern 4)', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('uses YMove UUID as externalId even when fdcId is present', async () => {
    const p = await loadYMoveProvider()
    mockFetch.mockReturnValue(mockOk({ data: [{
      id: 'ymove-uuid-abc', fdcId: '173944',
      displayName: 'Banana', calories: 105, protein: 1.3, carbs: 27, fat: 0.4,
      servingSize: 118,
    }] }))
    const [result] = await p.search('banana')
    expect(result.externalId).toBe('ymove-uuid-abc')
    expect(result.externalId).not.toBe('173944')
  })

  it('getById routes to /foods/<ymove-uuid>, not /foods/<fdc-id>', async () => {
    const p = await loadYMoveProvider()
    mockFetch.mockReturnValue(mockOk({ data: {
      id: 'ymove-uuid-abc', fdcId: '173944',
      displayName: 'Banana', calories: 105, protein: 1.3, carbs: 27, fat: 0.4,
      servingSize: 118,
    } }))
    await p.getById('ymove-uuid-abc')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/foods/ymove-uuid-abc')
    expect(url).not.toContain('173944')
  })

  it('externalId from search round-trips correctly through getById', async () => {
    const p = await loadYMoveProvider()
    const item = {
      id: 'unique-ymove-id', fdcId: '999999',
      displayName: 'Test Food', calories: 100, protein: 5, carbs: 10, fat: 2, servingSize: 100,
    }
    mockFetch.mockReturnValueOnce(mockOk({ data: [item] }))
    const [searchResult] = await p.search('test')

    mockFetch.mockReturnValueOnce(mockOk({ data: item }))
    const detail = await p.getById(searchResult.externalId)
    const detailUrl = mockFetch.mock.calls[1][0] as string

    expect(detailUrl).toContain(`/foods/${searchResult.externalId}`)
    expect(detail).not.toBeNull()
  })
})
