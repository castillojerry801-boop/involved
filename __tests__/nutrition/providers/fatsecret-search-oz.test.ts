/**
 * FatSecret provider — parseDescription oz-parenthetical regression
 *
 * Root cause (2026-10-16): when FatSecret's food_description says
 * "Per 1 bar (2.07 oz) - Calories: 280kcal | ...", parseDescription() only
 * tried to extract grams or ml from the parenthetical. It had no oz handler,
 * so servingSize defaulted to 100 while calories represented a per-bar (58.7g)
 * value. A 52.7g (1.86 oz) input then computed:
 *   factor = 52.7 / 100 = 0.527   →   280 × 0.527 = 148 cal   ✗
 * Correct:
 *   servingSize = 2.07 oz × 28.3495 g/oz = 58.7g
 *   factor = 52.7 / 58.7 = 0.898  →   280 × 0.898 = 251 cal   ✓
 *
 * Scenarios:
 *  1.  oz parenthetical → servingSize converted to grams, nutrition scaled correctly
 *  2.  gram parenthetical → unchanged (regression guard)
 *  3.  ml parenthetical → unchanged (regression guard)
 *  4.  "Per 100g" → servingSize = 100 (regression guard)
 *  5.  No parenthetical at all → servingSize stays 100 (can't do better without gram data)
 *  6.  "Per 1 bar (1.55 oz)" — small snack bar conversion
 *  7.  oz conversion accurate to 1 decimal place
 *  8.  end-to-end: 52.7g → ~251 cal (not 148) — exact Snickers regression
 *  9.  all four macros (cal/protein/carbs/fat) scale correctly via oz-corrected servingSize
 * 10.  "Per 1 bag (1 oz)" format — single oz serving
 * 11.  description with both grams and oz: gram takes priority (no double-conversion)
 * 12.  "Per 1 bar (2.07 oz)" householdText still extracted as "1 bar"
 * 13.  Snickers 1.86 oz → ~251 cal (full macro set verification)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FatSecretProvider } from '../../../lib/nutrition/providers/fatsecret'

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token'
const API_URL   = 'https://platform.fatsecret.com/rest/server.api'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  vi.stubEnv('FATSECRET_CLIENT_ID',     'TEST_ID')
  vi.stubEnv('FATSECRET_CLIENT_SECRET', 'TEST_SECRET')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

function setupSearchMock(foods: object[]) {
  mockFetch.mockImplementation((url: string) => {
    if (String(url).startsWith(TOKEN_URL)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'tok', expires_in: 86400 }),
        text: () => Promise.resolve(''),
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        foods: { food: foods.length === 1 ? foods[0] : foods },
      }),
      text: () => Promise.resolve(''),
    })
  })
}

// ─── oz parenthetical conversion ─────────────────────────────────────────────

describe('FatSecret parseDescription — oz parenthetical fix', () => {
  const provider = new FatSecretProvider()

  // Test 1: oz parenthetical → servingSize converted to grams
  it('oz parenthetical: "Per 1 bar (2.07 oz)" → servingSize ≈ 58.7g, NOT 100', async () => {
    setupSearchMock([{
      food_id: '98765',
      food_name: 'Snickers Bar (2.07 oz)',
      food_type: 'Brand',
      brand_name: 'Mars',
      food_description: 'Per 1 bar (2.07 oz) - Calories: 280kcal | Fat: 12.00g | Carbs: 35.00g | Protein: 4.00g',
    }])

    const results = await provider.search('Snickers bar')
    expect(results).toHaveLength(1)

    const food = results[0]
    expect(food.servingUnit).toBe('g')
    // 2.07 oz × 28.3495 = 58.683… rounded to 1 decimal = 58.7
    expect(food.servingSize).toBeCloseTo(58.7, 0)
    // Calories must represent the per-bar value (280), not per-100g
    expect(food.coreNutrients.calories).toBe(280)
  })

  // Test 2: gram parenthetical — regression guard, unchanged behavior
  it('gram parenthetical "Per 1 bar (58.7g)" → servingSize = 58.7', async () => {
    setupSearchMock([{
      food_id: '11111',
      food_name: 'Snickers Bar',
      food_type: 'Brand',
      brand_name: 'Mars',
      food_description: 'Per 1 bar (58.7g) - Calories: 280kcal | Fat: 12.00g | Carbs: 35.00g | Protein: 4.00g',
    }])

    const results = await provider.search('Snickers bar')
    expect(results[0].servingSize).toBeCloseTo(58.7, 1)
    expect(results[0].servingUnit).toBe('g')
    expect(results[0].coreNutrients.calories).toBe(280)
  })

  // Test 3: ml parenthetical — regression guard
  it('ml parenthetical "Per 1 can (355ml)" → servingSize = 355, unit = ml', async () => {
    setupSearchMock([{
      food_id: '22222',
      food_name: 'Cola',
      food_type: 'Brand',
      food_description: 'Per 1 can (355ml) - Calories: 150kcal | Fat: 0.00g | Carbs: 39.00g | Protein: 0.00g',
    }])

    const results = await provider.search('cola')
    expect(results[0].servingSize).toBeCloseTo(355, 0)
    expect(results[0].servingUnit).toBe('ml')
    expect(results[0].coreNutrients.calories).toBe(150)
  })

  // Test 4: "Per 100g" — regression guard
  it('"Per 100g" → servingSize = 100, unit = g', async () => {
    setupSearchMock([{
      food_id: '33333',
      food_name: 'Oats, dry',
      food_type: 'Generic',
      food_description: 'Per 100g - Calories: 379kcal | Fat: 6.90g | Carbs: 67.70g | Protein: 13.20g',
    }])

    const results = await provider.search('oats')
    expect(results[0].servingSize).toBe(100)
    expect(results[0].servingUnit).toBe('g')
    expect(results[0].coreNutrients.calories).toBe(379)
  })

  // Test 5: no parenthetical — servingSize stays 100 (no gram data available)
  it('no parenthetical "Per 1 bar" → servingSize defaults to 100 (unavoidable without metric data)', async () => {
    setupSearchMock([{
      food_id: '44444',
      food_name: 'Mystery Bar',
      food_type: 'Brand',
      food_description: 'Per 1 bar - Calories: 200kcal | Fat: 8.00g | Carbs: 28.00g | Protein: 2.00g',
    }])

    const results = await provider.search('mystery bar')
    expect(results[0].servingSize).toBe(100)
    expect(results[0].servingUnit).toBe('g')
    // Note: householdText should still be extracted
    expect(results[0].householdServingText).toBe('1 bar')
  })

  // Test 6: oz parenthetical with small size (snack bar 1.55 oz)
  it('"Per 1 bar (1.55 oz)" → servingSize ≈ 43.9g', async () => {
    setupSearchMock([{
      food_id: '55555',
      food_name: 'Kit Kat Bar (1.55 oz)',
      food_type: 'Brand',
      brand_name: 'Nestle',
      food_description: 'Per 1 bar (1.55 oz) - Calories: 218kcal | Fat: 11.00g | Carbs: 27.00g | Protein: 3.00g',
    }])

    const results = await provider.search('kit kat')
    // 1.55 × 28.3495 = 43.94… ≈ 43.9
    expect(results[0].servingSize).toBeCloseTo(43.9, 0)
    expect(results[0].coreNutrients.calories).toBe(218)
  })

  // Test 7: oz conversion accuracy — 2.07 oz → 58.7g (1 decimal)
  it('oz conversion is accurate to 1 decimal place', async () => {
    setupSearchMock([{
      food_id: '66666',
      food_name: 'Candy Bar (2.07 oz)',
      food_type: 'Brand',
      food_description: 'Per 1 bar (2.07 oz) - Calories: 280kcal | Fat: 12.00g | Carbs: 35.00g | Protein: 4.00g',
    }])

    const results = await provider.search('candy bar')
    // 2.07 × 28.3495 = 58.6834… → rounds to 58.7
    const expectedGrams = Math.round(2.07 * 28.3495 * 10) / 10
    expect(results[0].servingSize).toBe(expectedGrams)
  })

  // Test 8: end-to-end factor — "52.7g of Snickers Bar (2.07 oz)" → ~251 cal, NOT 148
  it('end-to-end: 52.7g of an oz-described food produces correct calories (~251 not ~148)', async () => {
    setupSearchMock([{
      food_id: '98765',
      food_name: 'Snickers Bar (2.07 oz)',
      food_type: 'Brand',
      brand_name: 'Mars',
      food_description: 'Per 1 bar (2.07 oz) - Calories: 280kcal | Fat: 12.00g | Carbs: 35.00g | Protein: 4.00g',
    }])

    const results = await provider.search('Snickers bar')
    const food = results[0]

    // Simulate what resolveIngredientFactor does for 52.7g:
    // Step 3 (weight→weight): fu='g', iu='g' → factor = quantity / servingSize
    const servingSize = food.servingSize // should be ~58.7 after fix
    const factor = 52.7 / servingSize
    const calories = Math.round(food.coreNutrients.calories * factor)

    // With the fix: factor = 52.7/58.7 = 0.898 → 280 * 0.898 ≈ 251
    // Without the fix: factor = 52.7/100 = 0.527 → 280 * 0.527 ≈ 148
    expect(calories).toBeGreaterThanOrEqual(245)
    expect(calories).toBeLessThanOrEqual(260)
    expect(calories).not.toBe(148) // explicit regression guard
  })

  // Test 9: ALL four macros scale correctly through the oz-corrected servingSize
  it('all four macros scale correctly for 52.7g via oz-corrected servingSize', async () => {
    setupSearchMock([{
      food_id: '98765',
      food_name: 'Snickers Bar (2.07 oz)',
      food_type: 'Brand',
      brand_name: 'Mars',
      // Real Snickers 2.07 oz: 280 cal, 4g protein, 35g carbs, 12g fat
      food_description: 'Per 1 bar (2.07 oz) - Calories: 280kcal | Fat: 12.00g | Carbs: 35.00g | Protein: 4.00g',
    }])

    const results = await provider.search('Snickers bar')
    const food = results[0]

    expect(food.servingSize).toBeCloseTo(58.7, 0)
    const factor = 52.7 / food.servingSize

    // All macros use same factor — each must scale correctly
    const calories = Math.round(food.coreNutrients.calories * factor)
    const proteinG = Math.round(food.coreNutrients.proteinG * factor * 10) / 10
    const carbG    = Math.round(food.coreNutrients.carbohydrateG * factor * 10) / 10
    const fatG     = Math.round(food.coreNutrients.fatG * factor * 10) / 10

    // Expected values for 52.7g of a 58.7g/280cal bar (factor ≈ 0.898):
    expect(calories).toBeGreaterThanOrEqual(245)   // ~251
    expect(calories).toBeLessThanOrEqual(260)
    expect(proteinG).toBeGreaterThanOrEqual(3.0)   // ~3.6
    expect(proteinG).toBeLessThanOrEqual(4.5)
    expect(carbG).toBeGreaterThanOrEqual(29)       // ~31.4
    expect(carbG).toBeLessThanOrEqual(34)
    expect(fatG).toBeGreaterThanOrEqual(9.5)       // ~10.8
    expect(fatG).toBeLessThanOrEqual(12)
  })

  // Test 10: "Per 1 bag (1 oz)" — common chip/snack format
  it('"Per 1 bag (1 oz)" → servingSize ≈ 28.3g', async () => {
    setupSearchMock([{
      food_id: '77777',
      food_name: 'Potato Chips (1 oz bag)',
      food_type: 'Brand',
      food_description: 'Per 1 bag (1 oz) - Calories: 150kcal | Fat: 9.00g | Carbs: 15.00g | Protein: 2.00g',
    }])

    const results = await provider.search('potato chips')
    // 1 oz × 28.3495 = 28.3g
    expect(results[0].servingSize).toBeCloseTo(28.3, 0)
    expect(results[0].servingUnit).toBe('g')
    expect(results[0].coreNutrients.calories).toBe(150)
  })

  // Test 11: description with BOTH grams and oz — gram takes priority (no double-conversion)
  it('description with both "58.7g" and "2.07 oz" — gram takes priority, oz ignored', async () => {
    setupSearchMock([{
      food_id: '88888',
      food_name: 'Dual Unit Bar',
      food_type: 'Brand',
      food_description: 'Per 1 bar (58.7g / 2.07 oz) - Calories: 280kcal | Fat: 12.00g | Carbs: 35.00g | Protein: 4.00g',
    }])

    const results = await provider.search('dual unit bar')
    // gram takes priority in the if/else if chain: servingSize = 58.7, NOT 2.07oz→58.7 again
    expect(results[0].servingSize).toBeCloseTo(58.7, 1)
    expect(results[0].servingUnit).toBe('g')
  })

  // Test 12: oz parenthetical householdText still extracted as the human-readable label
  it('"Per 1 bar (2.07 oz)" → householdText = "1 bar"', async () => {
    setupSearchMock([{
      food_id: '98765',
      food_name: 'Snickers Bar (2.07 oz)',
      food_type: 'Brand',
      food_description: 'Per 1 bar (2.07 oz) - Calories: 280kcal | Fat: 12.00g | Carbs: 35.00g | Protein: 4.00g',
    }])

    const results = await provider.search('Snickers bar')
    expect(results[0].householdServingText).toBe('1 bar')
  })

  // Test 13: exact Snickers production scenario — 1.86 oz input → ~251 cal
  it('Snickers: 1.86 oz (52.7g) of "Per 1 bar (2.07 oz)" at 280 cal → ~251 cal, ~3.6g protein, ~31g carbs, ~10.8g fat', async () => {
    setupSearchMock([{
      food_id: '98765',
      food_name: 'Snickers Bar (2.07 oz)',
      food_type: 'Brand',
      brand_name: 'Mars',
      food_description: 'Per 1 bar (2.07 oz) - Calories: 280kcal | Fat: 12.00g | Carbs: 35.00g | Protein: 4.00g',
    }])

    const results = await provider.search('Snickers bar 1.86 oz')
    const food = results[0]

    // 1.86 oz = 52.7g (V converts oz → g before calling calculate_nutrition)
    const inputGrams = Math.round(1.86 * 28.3495 * 10) / 10  // 52.7g
    const factor = inputGrams / food.servingSize

    const calories  = Math.round(food.coreNutrients.calories      * factor)
    const proteinG  = Math.round(food.coreNutrients.proteinG      * factor * 10) / 10
    const carbG     = Math.round(food.coreNutrients.carbohydrateG * factor * 10) / 10
    const fatG      = Math.round(food.coreNutrients.fatG          * factor * 10) / 10

    // Verified reference: 280 cal × (52.7/58.7) = 251 cal
    expect(calories).toBe(251)
    expect(proteinG).toBeCloseTo(3.6, 0)
    expect(carbG).toBeCloseTo(31.4, 0)
    expect(fatG).toBeCloseTo(10.8, 0)

    // Explicit regression guard — the pre-fix value
    expect(calories).not.toBe(148)
  })
})

// ─── servingSizeIsEstimated flag ──────────────────────────────────────────────
// Tests that parseDescription correctly signals when servingSize defaulted to 100
// because no gram/ml/oz parenthetical was present in the description.

describe('FatSecret parseDescription — servingSizeIsEstimated flag', () => {
  const provider = new FatSecretProvider()

  it('"Per 1 pack" (no metric parenthetical) → servingSizeIsEstimated: true, servingSize = 100', async () => {
    setupSearchMock([{
      food_id: '11111',
      food_name: "M&M's 100 Calories Pack",
      food_type: 'Brand',
      food_description: "Per 1 pack - Calories: 100kcal | Fat: 4.00g | Carbs: 14.00g | Protein: 1.00g",
    }])
    const results = await provider.search("m&ms")
    const food = results[0]
    expect(food.servingSize).toBe(100)
    expect((food as unknown as { servingSizeIsEstimated: boolean }).servingSizeIsEstimated).toBe(true)
    // householdText still extracted despite no metric parenthetical
    expect(food.householdServingText).toBe('1 pack')
  })

  it('"Per 1 bar (2.07 oz)" → servingSizeIsEstimated: false (oz converted to grams)', async () => {
    setupSearchMock([{
      food_id: '22222',
      food_name: 'Snickers Bar',
      food_type: 'Brand',
      food_description: 'Per 1 bar (2.07 oz) - Calories: 280kcal | Fat: 14.00g | Carbs: 35.00g | Protein: 4.30g',
    }])
    const results = await provider.search("snickers")
    expect((results[0] as unknown as { servingSizeIsEstimated: boolean }).servingSizeIsEstimated).toBe(false)
  })

  it('"Per 1 serving (65g)" → servingSizeIsEstimated: false (gram was found)', async () => {
    setupSearchMock([{
      food_id: '33333',
      food_name: 'Peanut Butter',
      food_type: 'Generic',
      food_description: 'Per 1 serving (65g) - Calories: 390kcal | Fat: 32.00g | Carbs: 14.00g | Protein: 15.00g',
    }])
    const results = await provider.search("peanut butter")
    expect((results[0] as unknown as { servingSizeIsEstimated: boolean }).servingSizeIsEstimated).toBe(false)
  })

  it('"Per 100g" normalized → servingSizeIsEstimated: false (explicit 100g)', async () => {
    setupSearchMock([{
      food_id: '44444',
      food_name: 'Plain Oats',
      food_type: 'Generic',
      food_description: 'Per 100g - Calories: 389kcal | Fat: 6.90g | Carbs: 66.30g | Protein: 17.00g',
    }])
    const results = await provider.search("oats")
    expect((results[0] as unknown as { servingSizeIsEstimated: boolean }).servingSizeIsEstimated).toBe(false)
  })
})
