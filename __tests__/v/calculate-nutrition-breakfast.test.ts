/**
 * calculate-nutrition — breakfast scenario with FatSecret fallback
 *
 * Simulates the production failure scenario:
 *   - USDA is down (matchIngredient returns FatSecret results)
 *   - FatSecret search stubs carry householdServingText
 *   - resolveIngredientFactor Step 5b resolves count units from serving description
 *
 * The test uses real resolveIngredientFactor (no mock) but mocks matchIngredient
 * to inject FatSecret-style results. This validates the full factor pipeline
 * works end-to-end with FatSecret data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MatchResult } from '../../lib/nutrition/matching/types'

// ── Mock matchIngredient (inject FatSecret stubs) ────────────────────────────
vi.mock('../../lib/nutrition/matching/matcher', () => ({
  matchIngredient: vi.fn(),
}))

// ── Mock DB and USDA portions (no DB in test env) ───────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    foodItemPortion: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      upsert: vi.fn(),
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

import { calculateNutrition } from '../../lib/v/tools/calculate-nutrition'
import { matchIngredient } from '../../lib/nutrition/matching/matcher'

// ── Realistic FatSecret-style FoodMatch records ──────────────────────────────

function makeFatSecretMatch(overrides: {
  name: string
  servingSize: number
  servingUnit: string
  householdServingText: string
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  externalId: string
}): MatchResult {
  return {
    confidence: 'confident',
    topMatch: {
      provider: 'fatsecret',
      externalId: overrides.externalId,
      name: overrides.name,
      servingSize: overrides.servingSize,
      servingUnit: overrides.servingUnit,
      householdServingText: overrides.householdServingText,
      householdUnit: undefined,
      unitsPerServing: undefined,
      calories: overrides.calories,
      proteinG: overrides.proteinG,
      carbohydrateG: overrides.carbohydrateG,
      fatG: overrides.fatG,
      isGeneric: true,
      matchScore: 92,
      matchReasons: ['FatSecret generic food'],
      fdcDataType: undefined,
    },
    alternatives: [],
    rawResults: [],
  }
}

// FatSecret-style fixtures representing realistic production data

// Egg: 1 large egg = 50g, nutrition per 50g serving
const EGG_MATCH = makeFatSecretMatch({
  name: 'Egg (Whole)',
  externalId: 'fs-301',
  servingSize: 50,
  servingUnit: 'g',
  householdServingText: '1 large',   // size qualifier — matches 'piece'/'egg'
  calories: 72,
  proteinG: 6.3,
  carbohydrateG: 0.4,
  fatG: 4.8,
})

// Bacon strip: 1 strip = 8g, nutrition per 8g serving
const BACON_MATCH = makeFatSecretMatch({
  name: 'Bacon',
  externalId: 'fs-1517',
  servingSize: 8,
  servingUnit: 'g',
  householdServingText: '1 strip',   // direct match for 'strip'
  calories: 43,
  proteinG: 3.0,
  carbohydrateG: 0.1,
  fatG: 3.3,
})

// Flour tortilla: 2 tortillas = 45g, nutrition per 45g serving
const TORTILLA_MATCH = makeFatSecretMatch({
  name: 'Flour Tortilla',
  externalId: 'fs-8886',
  servingSize: 45,
  servingUnit: 'g',
  householdServingText: '2 tortillas',  // 2 units per serving; 'piece' maps to count unit
  calories: 146,
  proteinG: 3.9,
  carbohydrateG: 24.7,
  fatG: 3.5,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('breakfast calculation — FatSecret fallback when USDA is down', () => {
  it('resolves all 3 breakfast ingredients via serving description', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch
      .mockResolvedValueOnce(EGG_MATCH)      // large eggs
      .mockResolvedValueOnce(BACON_MATCH)    // bacon strips
      .mockResolvedValueOnce(TORTILLA_MATCH) // flour tortilla

    const result = await calculateNutrition({
      ingredients: [
        { name: 'large eggs', quantity: 3, unit: 'piece' },
        { name: 'bacon strips', quantity: 3, unit: 'strip' },
        { name: 'flour tortilla', quantity: 1, unit: 'piece' },
      ],
    })

    // All three should resolve
    expect(result.ingredients.filter(i => i.resolved)).toHaveLength(3)
    expect(result.unresolvedIngredients).toHaveLength(0)
    expect(result.completeness).toBe('complete')

    // Macros sanity check for 3 eggs + 3 strips bacon + 0.5 serving tortilla
    // Eggs: 3 * 72 = 216 kcal
    // Bacon: 3 * 43 = 129 kcal (3 strips = 3 servings of 1-strip serving)
    // Tortilla: 0.5 * 146 = 73 kcal (1 piece = 0.5 of 2-tortilla serving)
    // Total ≈ 418 kcal
    expect(result.totals.calories).toBeGreaterThan(350)
    expect(result.totals.calories).toBeLessThan(600)
    expect(result.totals.proteinG).toBeGreaterThan(20)

    // Verify per-ingredient resolution details
    const eggs = result.ingredients[0]
    expect(eggs.resolved).toBe(true)
    expect(eggs.calories).toBeCloseTo(216, -1)  // within 10 kcal
    expect(eggs.proteinG).toBeCloseTo(18.9, 0)

    const bacon = result.ingredients[1]
    expect(bacon.resolved).toBe(true)
    expect(bacon.calories).toBeCloseTo(129, -1)
    expect(bacon.proteinG).toBeCloseTo(9.0, 0)

    const tortilla = result.ingredients[2]
    expect(tortilla.resolved).toBe(true)
    expect(tortilla.calories).toBeCloseTo(73, -1)
  })

  it('egg with size-qualifier unit "large" → normalized to piece, still resolves', async () => {
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(EGG_MATCH)

    const result = await calculateNutrition({
      ingredients: [
        { name: 'eggs', quantity: 2, unit: 'large' },  // V sometimes passes size as unit
      ],
    })

    // 'large' is a size qualifier → normalized to 'piece' by calculate-nutrition
    // Step 5b then matches 'piece' against "1 large" serving description
    expect(result.ingredients[0].resolved).toBe(true)
    expect(result.ingredients[0].calories).toBeCloseTo(144, -1)  // 2 * 72
  })

  it('when serving text has no count word, ingredient falls through to unresolved', async () => {
    const noCountMatch = makeFatSecretMatch({
      name: 'Generic Food',
      externalId: 'fs-9999',
      servingSize: 100,
      servingUnit: 'g',
      householdServingText: '1 serving',   // non-count word, must not auto-resolve
      calories: 200,
      proteinG: 10,
      carbohydrateG: 20,
      fatG: 8,
    })

    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(noCountMatch)

    const result = await calculateNutrition({
      ingredients: [{ name: 'generic food', quantity: 2, unit: 'piece' }],
    })

    expect(result.ingredients[0].resolved).toBe(false)
    expect(result.completeness).toBe('incomplete')
  })

  it('USDA 400 scenario: matchIngredient returns FatSecret, factor pipeline resolves', async () => {
    // This models the production failure:
    // USDA search returned [] (due to 400), FatSecret returned a result with
    // serving description. The factor pipeline must resolve via Step 5b.
    const mockMatch = vi.mocked(matchIngredient)
    mockMatch.mockResolvedValueOnce(BACON_MATCH)

    const result = await calculateNutrition({
      ingredients: [{ name: 'crispy bacon', quantity: 4, unit: 'strip' }],
    })

    expect(result.ingredients[0].resolved).toBe(true)
    // 4 strips * 43 kcal/strip = 172 kcal
    expect(result.ingredients[0].calories).toBeCloseTo(172, -1)
    expect(result.completeness).toBe('complete')
  })
})
