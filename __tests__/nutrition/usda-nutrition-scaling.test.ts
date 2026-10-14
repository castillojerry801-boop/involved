/**
 * USDA FoodData Central — nutrition scaling correctness tests.
 *
 * Background: USDA foodNutrients.value is always per 100g, regardless of food type
 * or whether the result comes from the search or detail endpoint. For branded foods
 * the manufacturer's serving size is frequently ≠ 100g (e.g., 44g for eggs). The
 * mapper must scale nutrients by servingSize/100 before storing.
 *
 * Covers:
 *  - Branded food with servingSize < 100g: nutrients scaled down
 *  - Branded food with servingSize > 100g: nutrients scaled up
 *  - Branded food with servingSize = 100g: no change (factor = 1)
 *  - Non-branded food (Foundation/SR Legacy): always 100g, no scaling
 *  - Extended nutrients (fiber, sodium, etc.) also scaled
 *  - Edge case: malformed servingSize=0 defaults to 100g (no zeroing)
 *  - getById (detail endpoint) applies same scaling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UsdaFoodDataProvider } from '../../lib/nutrition/providers/usda-fooddata'

const { mockFetch } = vi.hoisted(() => {
  const mockFetch = vi.fn()
  return { mockFetch }
})

vi.stubGlobal('fetch', mockFetch)

const provider = new UsdaFoodDataProvider()

beforeEach(() => {
  vi.clearAllMocks()
  process.env.USDA_API_KEY = 'test-key'
})

// Build a USDA detail-endpoint food record with per-100g nutrients
function makeUsdaFood(opts: {
  dataType?: string
  servingSize?: number
  servingSizeUnit?: string
  description?: string
  kcalPer100g?: number
  proteinPer100g?: number
  carbsPer100g?: number
  fatPer100g?: number
  fiberPer100g?: number
  sodiumPer100g?: number
} = {}) {
  return {
    fdcId: 9999,
    description: opts.description ?? 'Test Food',
    dataType: opts.dataType ?? 'Branded',
    brandName: 'TestBrand',
    servingSize: opts.servingSize,
    servingSizeUnit: opts.servingSizeUnit ?? 'g',
    foodNutrients: [
      { nutrientId: 1008, nutrientName: 'Energy', unitName: 'kcal', value: opts.kcalPer100g ?? 136 },
      { nutrientId: 1003, nutrientName: 'Protein', unitName: 'g', value: opts.proteinPer100g ?? 13.6 },
      { nutrientId: 1005, nutrientName: 'Carbohydrate', unitName: 'g', value: opts.carbsPer100g ?? 0.7 },
      { nutrientId: 1004, nutrientName: 'Total Fat', unitName: 'g', value: opts.fatPer100g ?? 9.5 },
      { nutrientId: 1079, nutrientName: 'Fiber', unitName: 'g', value: opts.fiberPer100g ?? 0 },
      { nutrientId: 1093, nutrientName: 'Sodium', unitName: 'mg', value: opts.sodiumPer100g ?? 142 },
    ],
  }
}

// ── Branded food with servingSize < 100g ─────────────────────────────────────

describe('USDA nutrition scaling — branded food, servingSize=44g (egg scenario)', () => {
  it('calories are scaled from per-100g to per-serving (136 × 0.44 = ~60)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 44, kcalPer100g: 136 }),
    })

    const result = await provider.getById('9999')
    expect(result).not.toBeNull()
    // 136 * 0.44 = 59.84 → rounds to 60
    expect(result!.coreNutrients.calories).toBe(60)
  })

  it('protein scaled: 13.6/100g × 0.44 = 6.0g per serving', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 44, proteinPer100g: 13.6 }),
    })

    const result = await provider.getById('9999')
    // 13.6 * 0.44 = 5.984 → Math.round(5.984 * 10) / 10 = 60/10 = 6.0
    expect(result!.coreNutrients.proteinG).toBe(6)
  })

  it('fat scaled: 9.5/100g × 0.44 = 4.2g per serving', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 44, fatPer100g: 9.5 }),
    })

    const result = await provider.getById('9999')
    // 9.5 * 0.44 = 4.18 → Math.round(4.18 * 10) / 10 = 42/10 = 4.2
    expect(result!.coreNutrients.fatG).toBe(4.2)
  })

  it('extended nutrient sodium scaled: 142mg/100g × 0.44 = 62mg per serving', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 44, sodiumPer100g: 142 }),
    })

    const result = await provider.getById('9999')
    // 142 * 0.44 = 62.48 → mineral(62.48) = 62.48 (mineral returns value if > 0)
    expect(result!.extendedNutrients?.sodiumMg).toBeCloseTo(62.48, 1)
  })

  it('servingSize is stored as 44 (unchanged)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 44 }),
    })

    const result = await provider.getById('9999')
    expect(result!.servingSize).toBe(44)
  })
})

// ── Branded food with servingSize = 100g ─────────────────────────────────────

describe('USDA nutrition scaling — branded food, servingSize=100g (no scaling needed)', () => {
  it('calories unchanged: 300kcal/100g × 1.0 = 300kcal per serving', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 100, kcalPer100g: 300 }),
    })

    const result = await provider.getById('9999')
    expect(result!.coreNutrients.calories).toBe(300)
  })

  it('protein unchanged: 25g/100g = 25g per serving', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 100, proteinPer100g: 25 }),
    })

    const result = await provider.getById('9999')
    expect(result!.coreNutrients.proteinG).toBe(25)
  })
})

// ── Branded food with servingSize > 100g ─────────────────────────────────────

describe('USDA nutrition scaling — branded food, servingSize=240ml (beverage)', () => {
  it('calories scaled up: 42kcal/100ml × 2.4 = ~101kcal per serving (Sprite-like)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 240, servingSizeUnit: 'ml', kcalPer100g: 42, proteinPer100g: 0, carbsPer100g: 10.6, fatPer100g: 0 }),
    })

    const result = await provider.getById('9999')
    // 42 * 2.4 = 100.8 → rounds to 101
    expect(result!.coreNutrients.calories).toBe(101)
    // 10.6 * 2.4 = 25.44 → Math.round(25.44 * 10) / 10 = 25.4
    expect(result!.coreNutrients.carbohydrateG).toBe(25.4)
  })
})

// ── Non-branded food (Foundation, SR Legacy, Survey) — no scaling ─────────────

describe('USDA nutrition scaling — non-branded food (Foundation), always per 100g', () => {
  it('Foundation food: calories NOT scaled (servingSize normalized to 100g)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({
        dataType: 'Foundation',
        servingSize: 100,  // always 100g for Foundation
        kcalPer100g: 165,
        proteinPer100g: 31.0,
        carbsPer100g: 0,
        fatPer100g: 3.6,
      }),
    })

    const result = await provider.getById('9999')
    expect(result!.coreNutrients.calories).toBe(165)
    expect(result!.coreNutrients.proteinG).toBe(31)
    expect(result!.coreNutrients.fatG).toBe(3.6)
    expect(result!.servingSize).toBe(100)
  })

  it('SR Legacy food: calories NOT scaled', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({
        dataType: 'SR Legacy',
        servingSize: 100,
        kcalPer100g: 89,
        proteinPer100g: 1.1,
        carbsPer100g: 22.8,
        fatPer100g: 0.3,
      }),
    })

    const result = await provider.getById('9999')
    expect(result!.coreNutrients.calories).toBe(89)
  })
})

// ── search() endpoint also scales ─────────────────────────────────────────────

describe('USDA nutrition scaling — search results also scaled', () => {
  it('search result for branded 44g food is scaled the same way as getById', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [makeUsdaFood({ servingSize: 44, kcalPer100g: 136, proteinPer100g: 13.6, fatPer100g: 9.5 })],
      }),
    })

    const results = await provider.search('eggs')
    expect(results).toHaveLength(1)
    expect(results[0].coreNutrients.calories).toBe(60)
    expect(results[0].coreNutrients.proteinG).toBe(6)
    expect(results[0].coreNutrients.fatG).toBe(4.2)
  })
})

// ── Edge case: servingSize=0 (malformed USDA data) ────────────────────────────

describe('USDA nutrition scaling — edge cases', () => {
  it('branded food with servingSize=0 defaults to 100g (nutrients not zeroed)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 0, kcalPer100g: 200 }),
    })

    const result = await provider.getById('9999')
    // nutritionFactor = 100/100 = 1, stored as per-100g
    expect(result!.coreNutrients.calories).toBe(200)
    expect(result!.servingSize).toBe(100)  // defaulted
  })

  it('branded food with no servingSize (undefined) defaults to 100g', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: undefined, kcalPer100g: 150 }),
    })

    const result = await provider.getById('9999')
    expect(result!.coreNutrients.calories).toBe(150)
    expect(result!.servingSize).toBe(100)
  })

  it('extended nutrients absent when per-100g value is 0 (zero fiber)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 44, fiberPer100g: 0 }),
    })

    const result = await provider.getById('9999')
    // mineral(0 * 0.44) = mineral(0) = undefined
    expect(result!.extendedNutrients?.fiberG).toBeUndefined()
  })

  it('extended nutrients present and scaled when per-100g value is non-zero', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeUsdaFood({ servingSize: 44, fiberPer100g: 2.0 }),
    })

    const result = await provider.getById('9999')
    // mineral(2.0 * 0.44) = mineral(0.88) = 0.88
    expect(result!.extendedNutrients?.fiberG).toBeCloseTo(0.88, 2)
  })
})
