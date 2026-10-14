/** DSLD search quality regression tests.
 *
 * Covers:
 *  1. isSupplementQuery — false positives removed (protein smoothie, protein bar, etc.)
 *  2. isSupplementQuery — true positives preserved (protein powder, creatine, etc.)
 *  3. DSLD search stubs always have incompleteData=true and placeholder-zero nutrition
 *  4. DSLD detail: returns real nutrition when available; incompleteData absent
 *  5. DSLD detail: returns incompleteData=true when label has no parseable macros
 *  6. Search route: DSLD excluded for non-supplement queries
 *  7. Search route: zero-nutrition filter passes genuine zero-calorie non-DSLD results (none blocked)
 *     — i.e. non-DSLD zero-macro results are correctly dropped
 *  8. ExternalFoodResult type carries incompleteData at the result level (not just detail)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── 1 & 2. isSupplementQuery ──────────────────────────────────────────────────
// The function is exported from the search route for testability.
// We import it directly here.

import { isSupplementQuery } from '../../app/api/nutrition/search/route'

describe('isSupplementQuery — false positives removed', () => {
  it('"protein smoothie" → false (protein in food context)', () => {
    expect(isSupplementQuery('protein smoothie')).toBe(false)
  })

  it('"protein bar" → false', () => {
    expect(isSupplementQuery('protein bar')).toBe(false)
  })

  it('"protein pancakes" → false', () => {
    expect(isSupplementQuery('protein pancakes')).toBe(false)
  })

  it('"high protein yogurt" → false', () => {
    expect(isSupplementQuery('high protein yogurt')).toBe(false)
  })

  it('"vitamin water" → false (bare "vitamin" too broad)', () => {
    expect(isSupplementQuery('vitamin water')).toBe(false)
  })

  it('"collagen broth" → false (bare "collagen" too broad)', () => {
    expect(isSupplementQuery('collagen broth')).toBe(false)
  })

  it('"magnesium rich foods" → false (bare "magnesium" too broad)', () => {
    expect(isSupplementQuery('magnesium rich foods')).toBe(false)
  })

  it('"probiotic yogurt" → false (bare "probiotic" too broad)', () => {
    expect(isSupplementQuery('probiotic yogurt')).toBe(false)
  })

  it('"electrolyte sports drink" → false (bare "electrolyte" too broad)', () => {
    expect(isSupplementQuery('electrolyte sports drink')).toBe(false)
  })

  it('"whey bread" → false (bare "whey" too broad)', () => {
    expect(isSupplementQuery('whey bread')).toBe(false)
  })
})

describe('isSupplementQuery — true positives preserved', () => {
  it('"protein powder" → true', () => {
    expect(isSupplementQuery('protein powder')).toBe(true)
  })

  it('"protein shake" → true', () => {
    expect(isSupplementQuery('protein shake')).toBe(true)
  })

  it('"whey protein" → true', () => {
    expect(isSupplementQuery('whey protein')).toBe(true)
  })

  it('"creatine" → true', () => {
    expect(isSupplementQuery('creatine')).toBe(true)
  })

  it('"pre workout" → true', () => {
    expect(isSupplementQuery('pre workout')).toBe(true)
  })

  it('"bcaa" → true', () => {
    expect(isSupplementQuery('bcaa')).toBe(true)
  })

  it('"multivitamin" → true', () => {
    expect(isSupplementQuery('multivitamin')).toBe(true)
  })

  it('"casein protein" → true (compound form)', () => {
    expect(isSupplementQuery('casein protein')).toBe(true)
  })

  it('"mass gainer" → true', () => {
    expect(isSupplementQuery('mass gainer')).toBe(true)
  })

  it('"fish oil" → true', () => {
    expect(isSupplementQuery('fish oil')).toBe(true)
  })

  it('"greens powder" → true', () => {
    expect(isSupplementQuery('greens powder')).toBe(true)
  })

  it('"collagen powder" → true (compound form)', () => {
    expect(isSupplementQuery('collagen powder')).toBe(true)
  })

  it('"electrolyte powder" → true (compound form)', () => {
    expect(isSupplementQuery('electrolyte powder')).toBe(true)
  })

  it('"beta alanine" → true', () => {
    expect(isSupplementQuery('beta alanine')).toBe(true)
  })

  it('"glutamine" → true', () => {
    expect(isSupplementQuery('glutamine')).toBe(true)
  })

  it('"casein" → true', () => {
    expect(isSupplementQuery('casein')).toBe(true)
  })

  it('"protein isolate" → true', () => {
    expect(isSupplementQuery('protein isolate')).toBe(true)
  })

  it('"probiotic supplement" → true (compound form)', () => {
    expect(isSupplementQuery('probiotic supplement')).toBe(true)
  })

  it('"gummy vitamin" → true', () => {
    expect(isSupplementQuery('gummy vitamin')).toBe(true)
  })
})

// ── 3. DSLD search stubs ──────────────────────────────────────────────────────

const { mockFetch } = vi.hoisted(() => {
  const mockFetch = vi.fn()
  return { mockFetch }
})

vi.stubGlobal('fetch', mockFetch)

import { NihDsldProvider } from '../../lib/nutrition/providers/nih-dsld'

const dsldProvider = new NihDsldProvider()

describe('DSLD search stubs — incompleteData and placeholder zeros', () => {
  beforeEach(() => vi.clearAllMocks())

  it('search stubs always have incompleteData=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hits: [
          { _id: '101', _score: 1.5, _source: { fullName: 'Whey Protein Gold Standard', brandName: 'Optimum Nutrition' } },
          { _id: '102', _score: 1.2, _source: { fullName: 'Creatine Monohydrate', brandName: 'Bulk Supplements' } },
        ],
      }),
    })

    const results = await dsldProvider.search('whey protein')
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.incompleteData).toBe(true)
    }
  })

  it('search stubs have placeholder-zero coreNutrients', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hits: [{ _id: '101', _score: 1.5, _source: { fullName: 'Protein Powder', brandName: 'TestBrand' } }],
      }),
    })

    const results = await dsldProvider.search('protein powder')
    expect(results[0].coreNutrients.calories).toBe(0)
    expect(results[0].coreNutrients.proteinG).toBe(0)
    expect(results[0].coreNutrients.carbohydrateG).toBe(0)
    expect(results[0].coreNutrients.fatG).toBe(0)
  })

  it('search stubs set provider to nih_dsld', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hits: [{ _id: '101', _score: 1.5, _source: { fullName: 'Creatine', brandName: 'Brand' } }],
      }),
    })

    const results = await dsldProvider.search('creatine')
    expect(results[0].provider).toBe('nih_dsld')
  })
})

// ── 4. DSLD detail with real nutrition ────────────────────────────────────────

const DEFAULT_INGREDIENT_ROWS = [
  { name: 'Calories', quantity: [{ quantity: 120, unit: 'kcal' }] },
  { name: 'Protein', quantity: [{ quantity: 24, unit: 'g' }] },
  { name: 'Total Carbohydrate', quantity: [{ quantity: 3, unit: 'g' }] },
  { name: 'Total Fat', quantity: [{ quantity: 1.5, unit: 'g' }] },
]

function makeDsldLabel(opts: {
  id?: number
  fullName?: string
  brandName?: string
  servingSizes?: Array<{ minQuantity?: number; unit?: string; notes?: string }>
  ingredientRows?: Array<{ name: string; category?: string; quantity?: Array<{ quantity?: number; unit?: string }> }>
} = {}) {
  return {
    id: opts.id ?? 101,
    fullName: opts.fullName ?? 'Whey Protein Concentrate',
    brandName: opts.brandName ?? 'Optimum Nutrition',
    servingsPerContainer: 30,
    servingSizes: opts.servingSizes ?? [{ minQuantity: 30, unit: 'gram', notes: '1 scoop' }],
    // Use `in` check so explicitly-passed `undefined` is treated as "no rows",
    // distinct from omitting the key entirely (which uses the default).
    ingredientRows: 'ingredientRows' in opts ? opts.ingredientRows : DEFAULT_INGREDIENT_ROWS,
  }
}

describe('DSLD detail — real nutrition available', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getById returns correct calories/macros from ingredientRows', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDsldLabel(),
    })

    const detail = await dsldProvider.getById('101')
    expect(detail).not.toBeNull()
    expect(detail!.coreNutrients.calories).toBe(120)
    expect(detail!.coreNutrients.proteinG).toBe(24)
    expect(detail!.coreNutrients.carbohydrateG).toBe(3)
    expect(detail!.coreNutrients.fatG).toBe(1.5)
  })

  it('detail with real nutrition does NOT have incompleteData=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDsldLabel(),
    })

    const detail = await dsldProvider.getById('101')
    expect(detail!.incompleteData).toBeFalsy()
  })

  it('servingSize parsed from servingSizes[0].minQuantity', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDsldLabel({ servingSizes: [{ minQuantity: 45, unit: 'gram', notes: '1.5 scoops' }] }),
    })

    const detail = await dsldProvider.getById('101')
    expect(detail!.servingSize).toBe(45)
    expect(detail!.servingUnit).toBe('g')
    expect(detail!.householdServingText).toBe('1.5 scoops')
  })
})

// ── 5. DSLD detail — no parseable nutrition ───────────────────────────────────

describe('DSLD detail — label has no parseable macros', () => {
  beforeEach(() => vi.clearAllMocks())

  it('detail with empty ingredientRows has incompleteData=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDsldLabel({ ingredientRows: [] }),
    })

    const detail = await dsldProvider.getById('102')
    expect(detail!.incompleteData).toBe(true)
    expect(detail!.coreNutrients.calories).toBe(0)
  })

  it('detail with only herb/non-macro rows has incompleteData=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDsldLabel({
        ingredientRows: [
          // None of these map to our NUTRIENT_MAP keys
          { name: 'Ashwagandha Root Extract', quantity: [{ quantity: 500, unit: 'mg' }] },
          { name: 'Black Pepper Extract', quantity: [{ quantity: 5, unit: 'mg' }] },
        ],
      }),
    })

    const detail = await dsldProvider.getById('103')
    expect(detail!.incompleteData).toBe(true)
    expect(detail!.coreNutrients.calories).toBe(0)
  })

  it('detail with null ingredientRows has incompleteData=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDsldLabel({ ingredientRows: undefined }),
    })

    const detail = await dsldProvider.getById('104')
    expect(detail!.incompleteData).toBe(true)
  })
})

// ── 6. Search route excludes DSLD for non-supplement queries ──────────────────
// We test this through isSupplementQuery directly — the route uses it as the gate.
// A full route integration test would require mocking all providers + Prisma.

describe('DSLD exclusion — non-supplement queries', () => {
  it('ordinary food queries do not trigger DSLD', () => {
    const nonSupplementQueries = [
      'chicken breast', 'greek yogurt', 'oatmeal', 'banana',
      'protein smoothie', 'protein bar', 'protein pancakes',
      'high protein yogurt', 'eggs', 'avocado toast',
    ]
    for (const q of nonSupplementQueries) {
      expect(isSupplementQuery(q)).toBe(false)
    }
  })

  it('supplement queries do trigger DSLD', () => {
    const supplementQueries = [
      'creatine monohydrate', 'whey protein isolate', 'pre workout supplement',
      'protein powder chocolate', 'bcaa amino acids', 'casein protein',
    ]
    for (const q of supplementQueries) {
      expect(isSupplementQuery(q)).toBe(true)
    }
  })
})

// ── 7. Zero-nutrition filter — non-DSLD zero results dropped ─────────────────
// The filter logic: non-DSLD results with all-zero macros are dropped.
// We test this by checking that DSLD stubs with incompleteData pass through,
// while verifying the filter logic directly.

describe('Zero-nutrition filter', () => {
  it('non-DSLD result with all-zero macros is filtered out (incomplete food data)', () => {
    // Simulate the filter logic from search/route.ts
    function filter(r: { provider: string; coreNutrients: { calories: number; proteinG: number; carbohydrateG: number; fatG: number } }) {
      if (r.provider === 'nih_dsld') return true
      const n = r.coreNutrients
      return n.calories > 0 || n.proteinG > 0 || n.carbohydrateG > 0 || n.fatG > 0
    }

    // OFF result with zero nutrition (incomplete data from provider) — should be filtered
    const incompleteOffResult = {
      provider: 'open_food_facts',
      coreNutrients: { calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
    }
    expect(filter(incompleteOffResult)).toBe(false)
  })

  it('DSLD stub with incompleteData passes the filter (handled by UI)', () => {
    function filter(r: { provider: string; coreNutrients: { calories: number; proteinG: number; carbohydrateG: number; fatG: number } }) {
      if (r.provider === 'nih_dsld') return true
      const n = r.coreNutrients
      return n.calories > 0 || n.proteinG > 0 || n.carbohydrateG > 0 || n.fatG > 0
    }

    const dsldStub = {
      provider: 'nih_dsld',
      coreNutrients: { calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
    }
    expect(filter(dsldStub)).toBe(true)
  })

  it('non-DSLD result with only protein > 0 passes (partial data is ok for non-DSLD)', () => {
    function filter(r: { provider: string; coreNutrients: { calories: number; proteinG: number; carbohydrateG: number; fatG: number } }) {
      if (r.provider === 'nih_dsld') return true
      const n = r.coreNutrients
      return n.calories > 0 || n.proteinG > 0 || n.carbohydrateG > 0 || n.fatG > 0
    }

    const partialResult = {
      provider: 'fatsecret',
      coreNutrients: { calories: 0, proteinG: 25, carbohydrateG: 0, fatG: 0 },
    }
    expect(filter(partialResult)).toBe(true)
  })
})

// ── 8. incompleteData on ExternalFoodResult type ──────────────────────────────

import type { ExternalFoodResult } from '../../lib/nutrition/providers/types'

describe('ExternalFoodResult type carries incompleteData', () => {
  it('incompleteData is an optional boolean on ExternalFoodResult (compile-time check)', () => {
    // This test simply confirms the field is typed correctly by constructing a valid object.
    const result: ExternalFoodResult = {
      provider: 'nih_dsld',
      externalId: '101',
      name: 'Test Supplement',
      servingSize: 1,
      servingUnit: 'serving',
      coreNutrients: { calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
      incompleteData: true,
    }
    expect(result.incompleteData).toBe(true)
  })

  it('incompleteData can be omitted (undefined) for foods with complete nutrition', () => {
    const result: ExternalFoodResult = {
      provider: 'fatsecret',
      externalId: '12345',
      name: 'Chicken Breast',
      servingSize: 100,
      servingUnit: 'g',
      coreNutrients: { calories: 165, proteinG: 31, carbohydrateG: 0, fatG: 3.6 },
    }
    expect(result.incompleteData).toBeUndefined()
  })
})
