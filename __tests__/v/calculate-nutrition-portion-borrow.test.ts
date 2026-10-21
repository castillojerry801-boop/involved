/**
 * calculateNutrition — Part C-PBorrow: Portion-borrow for count units
 * calculateNutrition — Part C-BaseFallback: Base-food disclosed fallback
 * extractBaseCountFood: preparation-prefix detection
 *
 * Core guarantee: scrambled-egg (or any prepared-form) nutrition is NEVER
 * silently replaced with raw-food macros. When a USDA Survey prepared-food
 * topMatch lacks count-unit portions, the pipeline either:
 *   a) borrows ONLY the count-to-gram weight from a USDA SR Legacy/Foundation
 *      alt while retaining the prepared food's per-100g macros (PBorrow), OR
 *   b) falls back to a fresh base-food matchIngredient call with explicit
 *      disclosure that preparation-specific macros are not included (BaseFallback).
 *
 * IMPORTANT: Tests here use generic mock foods — not the six customer evaluation
 * inputs. They measure pipeline logic, not specific food database values.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MatchResult } from '../../lib/nutrition/matching/types'
import type { ConversionResult, ConversionError } from '../../lib/nutrition/conversion/types'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../lib/nutrition/matching/matcher', () => ({
  matchIngredient: vi.fn(),
}))

vi.mock('../../lib/nutrition/conversion/factor', () => ({
  resolveIngredientFactor: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    foodItem: { findFirst: vi.fn().mockResolvedValue(null) },
    foodItemPortion: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
  },
}))

vi.mock('../../lib/nutrition/providers/fatsecret', () => {
  class MockFatSecretProvider {
    name = 'FatSecret'
    providerId = 'fatsecret'
    async getById() { return null }
    async getByIdForEnrichment() { return null }
    async search() { return [] }
    async searchByBarcode() { return null }
  }
  return { FatSecretProvider: MockFatSecretProvider }
})

import { calculateNutrition, extractBaseCountFood } from '../../lib/v/tools/calculate-nutrition'
import { matchIngredient } from '../../lib/nutrition/matching/matcher'
import { resolveIngredientFactor } from '../../lib/nutrition/conversion/factor'

const mockMatchIngredient = vi.mocked(matchIngredient)
const mockResolveIngredientFactor = vi.mocked(resolveIngredientFactor)

// ── Stub builders ─────────────────────────────────────────────────────────────

/** USDA Survey food with no count-unit portion (the prepared-form topMatch). */
function makeSurveyMatch(overrides: {
  name: string
  caloriesPer100g: number
  proteinPer100g: number
  carbPer100g: number
  fatPer100g: number
  alternatives?: MatchResult['alternatives']
}): MatchResult {
  return {
    confidence: 'confident',
    topMatch: {
      provider: 'usda_fooddata',
      externalId: 'survey-001',
      name: overrides.name,
      servingSize: 100,
      servingUnit: 'g',
      householdUnit: undefined,
      unitsPerServing: undefined,
      calories: overrides.caloriesPer100g,
      proteinG: overrides.proteinPer100g,
      carbohydrateG: overrides.carbPer100g,
      fatG: overrides.fatPer100g,
      isGeneric: true,
      matchScore: 118,
      matchReasons: ['USDA Survey match'],
      fdcDataType: 'Survey (FNDDS)',
    },
    alternatives: overrides.alternatives ?? [],
    rawResults: [],
  }
}

/** USDA SR Legacy food used as a count-unit portion source in alts. */
function makeSRLegacyAlt(overrides: {
  name: string
  caloriesPer100g: number
  proteinPer100g: number
  carbPer100g: number
  fatPer100g: number
  score?: number
}) {
  return {
    provider: 'usda_fooddata' as const,
    externalId: 'sr-001',
    name: overrides.name,
    servingSize: 100,
    servingUnit: 'g',
    householdUnit: 'piece',
    unitsPerServing: 1,
    calories: overrides.caloriesPer100g,
    proteinG: overrides.proteinPer100g,
    carbohydrateG: overrides.carbPer100g,
    fatG: overrides.fatPer100g,
    isGeneric: true,
    matchScore: overrides.score ?? 40,
    matchReasons: ['SR Legacy alt'],
    fdcDataType: 'SR Legacy' as const,
  }
}

/** A ConversionResult for a count-unit resolution (factor = totalGrams / 100). */
function makeCountFactor(gramsPerUnit: number, quantity: number, desc: string): ConversionResult {
  const totalGrams = gramsPerUnit * quantity
  return {
    grams: totalGrams,
    factor: totalGrams / 100,
    conversionSource: 'usda_measured' as const,
    portionDescription: desc,
    confidence: 'high',
    notes: [],
  }
}

const countConversionError: ConversionError = {
  kind: 'conversion_error',
  errorCode: 'portion_not_found',
  message: 'No count-unit portion for this food',
}

// ── extractBaseCountFood ───────────────────────────────────────────────────────

describe('extractBaseCountFood', () => {
  it('returns null for names with no preparation prefix', () => {
    expect(extractBaseCountFood('eggs')).toBeNull()
    expect(extractBaseCountFood('chicken breast')).toBeNull()
    expect(extractBaseCountFood('oatmeal')).toBeNull()
  })

  it('"scrambled eggs" → "eggs"', () => {
    expect(extractBaseCountFood('scrambled eggs')).toBe('eggs')
  })

  it('"scrambled egg" (singular) → "egg"', () => {
    expect(extractBaseCountFood('scrambled egg')).toBe('egg')
  })

  it('"poached egg" → "egg"', () => {
    expect(extractBaseCountFood('poached egg')).toBe('egg')
  })

  it('"hard-boiled egg" → "egg"', () => {
    expect(extractBaseCountFood('hard-boiled egg')).toBe('egg')
  })

  it('"hard boiled egg" (no hyphen) → "egg"', () => {
    expect(extractBaseCountFood('hard boiled egg')).toBe('egg')
  })

  it('"soft-boiled egg" → "egg"', () => {
    expect(extractBaseCountFood('soft-boiled egg')).toBe('egg')
  })

  it('case-insensitive: "Scrambled Eggs" → "eggs"', () => {
    expect(extractBaseCountFood('Scrambled Eggs')).toBe('eggs')
  })

  it('returns null when remaining base has a compound indicator', () => {
    // "scrambled egg salad" → "egg salad" → hasCompoundIndicator("egg salad") = true
    expect(extractBaseCountFood('scrambled egg salad')).toBeNull()
  })

  it('returns null for single-word name with prefix only', () => {
    // "scrambled" alone has no base food after stripping
    expect(extractBaseCountFood('scrambled')).toBeNull()
  })
})

// ── Part C-PBorrow: prepared-food macros preserved ───────────────────────────

describe('calculateNutrition — Part C-PBorrow: portion-borrow for count units', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses prepared-food per-100g macros when borrowing count portion from SR Legacy alt', async () => {
    // Scenario: "2 scrambled eggs"
    //   topMatch = USDA Survey "Eggs, scrambled" (169 cal/100g) → no count portion
    //   alt = USDA SR Legacy "Egg, whole, raw" (143 cal/100g) → 1 large = 50g
    //
    // Expected: calories from PREPARED food (169) × portion factor (100g/100 = 1.0)
    // NOT raw egg calories (143) × factor (1.0) = 143
    const preparedCaloriesPer100g = 169
    const rawCaloriesPer100g = 143

    mockMatchIngredient.mockResolvedValue(
      makeSurveyMatch({
        name: 'Eggs, scrambled',
        caloriesPer100g: preparedCaloriesPer100g,
        proteinPer100g: 10.6,
        carbPer100g: 1.6,
        fatPer100g: 11.5,
        alternatives: [
          makeSRLegacyAlt({
            name: 'Egg, whole, raw',
            caloriesPer100g: rawCaloriesPer100g,
            proteinPer100g: 12.6,
            carbPer100g: 0.7,
            fatPer100g: 9.5,
            score: 40,
          }),
        ],
      })
    )

    mockResolveIngredientFactor.mockImplementation(async (food) => {
      if ((food as { fdcDataType?: string }).fdcDataType === 'Survey (FNDDS)') {
        return countConversionError
      }
      // SR Legacy alt: 1 large egg = 50g. For 2 eggs = 100g, factor = 1.0
      return makeCountFactor(50, 2, '2 large (100g)')
    })

    const result = await calculateNutrition({
      ingredients: [{ name: 'scrambled eggs', quantity: 2, unit: 'piece' }],
    })

    expect(result.ingredients).toHaveLength(1)
    const ing = result.ingredients[0]
    expect(ing.resolved).toBe(true)
    expect(ing.matchConfidence).toBe('plausible')

    // Macros must come from the PREPARED food ("Eggs, scrambled") at 169 cal/100g × 1.0
    expect(ing.calories).toBe(Math.round(preparedCaloriesPer100g * 1.0))
    // Must NOT use raw egg macros
    expect(ing.calories).not.toBe(Math.round(rawCaloriesPer100g * 1.0))

    // matchedFoodName reflects the prepared food, not the portion-source alt
    expect(ing.matchedFoodName).toBe('Eggs, scrambled')

    // Assumption note discloses the portion-borrow
    expect(result.assumptions.some(a =>
      a.includes('count-to-gram from') && a.includes('Egg, whole, raw') && a.includes('Eggs, scrambled')
    )).toBe(true)
  })

  it('resolves quantity × portion correctly (2 eggs × 50g = 100g total)', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeSurveyMatch({
        name: 'Eggs, scrambled',
        caloriesPer100g: 169,
        proteinPer100g: 10.6,
        carbPer100g: 1.6,
        fatPer100g: 11.5,
        alternatives: [
          makeSRLegacyAlt({
            name: 'Egg, whole, raw',
            caloriesPer100g: 143,
            proteinPer100g: 12.6,
            carbPer100g: 0.7,
            fatPer100g: 9.5,
          }),
        ],
      })
    )

    mockResolveIngredientFactor.mockImplementation(async (food) => {
      if ((food as { fdcDataType?: string }).fdcDataType === 'Survey (FNDDS)') return countConversionError
      return makeCountFactor(50, 2, '2 large (100g)')
    })

    const result = await calculateNutrition({
      ingredients: [{ name: 'scrambled eggs', quantity: 2, unit: 'piece' }],
    })

    const ing = result.ingredients[0]
    expect(ing.resolved).toBe(true)
    // 169 cal/100g × (2 × 50g / 100) = 169 × 1.0 = 169
    expect(ing.calories).toBe(169)
    expect(ing.proteinG).toBeCloseTo(10.6, 1)
    expect(ing.fatG).toBeCloseTo(11.5, 1)
  })

  it('portion-borrow does NOT fire for weight units (gram-weight resolves normally)', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeSurveyMatch({
        name: 'Eggs, scrambled',
        caloriesPer100g: 169,
        proteinPer100g: 10.6,
        carbPer100g: 1.6,
        fatPer100g: 11.5,
        alternatives: [],
      })
    )

    // Weight unit → resolveIngredientFactor succeeds for the topMatch directly
    mockResolveIngredientFactor.mockResolvedValue({
      grams: 150,
      factor: 1.5,
      conversionSource: 'usda_measured' as const,
      portionDescription: '150g',
      confidence: 'high',
      notes: [],
    })

    const result = await calculateNutrition({
      ingredients: [{ name: 'scrambled eggs', quantity: 150, unit: 'g' }],
    })

    const ing = result.ingredients[0]
    expect(ing.resolved).toBe(true)
    // Standard resolution: 169 × 1.5 = 253.5 → 254
    expect(ing.calories).toBe(Math.round(169 * 1.5))
    expect(result.assumptions.some(a => a.includes('count-to-gram'))).toBe(false)
  })

  it('does not fire when no SR Legacy alt with score ≥ 40 exists', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeSurveyMatch({
        name: 'Eggs, scrambled',
        caloriesPer100g: 169,
        proteinPer100g: 10.6,
        carbPer100g: 1.6,
        fatPer100g: 11.5,
        alternatives: [
          { ...makeSRLegacyAlt({ name: 'Egg, whole, raw', caloriesPer100g: 143, proteinPer100g: 12.6, carbPer100g: 0.7, fatPer100g: 9.5, score: 20 }) },
        ],
      })
    )
    mockResolveIngredientFactor.mockResolvedValue(countConversionError)

    const result = await calculateNutrition({
      ingredients: [{ name: 'scrambled eggs', quantity: 2, unit: 'piece' }],
    })

    // Alt below 40 → neither portion-borrow nor standard alt fires → unresolved
    expect(result.ingredients[0].resolved).toBe(false)
  })
})

// ── Part C-BaseFallback: disclosed base-food fallback ─────────────────────────

describe('calculateNutrition — Part C-BaseFallback: base-food disclosed fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retries matchIngredient with base food when preparation prefix is detected and no alt resolves', async () => {
    // Scenario: topMatch has no count portion, NO SR Legacy alt exists
    // "scrambled eggs" → extractBaseCountFood → "eggs" → fresh matchIngredient
    mockMatchIngredient
      .mockResolvedValueOnce(
        makeSurveyMatch({
          name: 'Eggs, scrambled',
          caloriesPer100g: 169,
          proteinPer100g: 10.6,
          carbPer100g: 1.6,
          fatPer100g: 11.5,
          alternatives: [],  // no alts → portion-borrow can't fire
        })
      )
      .mockResolvedValueOnce({
        // Second call: matchIngredient("eggs") → SR Legacy base food
        confidence: 'confident',
        topMatch: {
          provider: 'usda_fooddata',
          externalId: 'sr-egg-001',
          name: 'Egg, whole, raw, fresh',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: 'piece',
          unitsPerServing: 1,
          calories: 143,
          proteinG: 12.6,
          carbohydrateG: 0.7,
          fatG: 9.5,
          isGeneric: true,
          matchScore: 110,
          matchReasons: ['SR Legacy base food'],
          fdcDataType: 'SR Legacy' as const,
        },
        alternatives: [],
        rawResults: [],
      })

    mockResolveIngredientFactor
      .mockResolvedValueOnce(countConversionError)  // Survey topMatch fails
      .mockResolvedValueOnce(makeCountFactor(50, 2, '2 large (100g)'))  // base-food succeeds

    const result = await calculateNutrition({
      ingredients: [{ name: 'scrambled eggs', quantity: 2, unit: 'piece' }],
    })

    expect(result.ingredients).toHaveLength(1)
    const ing = result.ingredients[0]
    expect(ing.resolved).toBe(true)
    expect(ing.matchConfidence).toBe('plausible')

    // Base-food disclosure note must be present
    expect(result.assumptions.some(a =>
      a.includes('base food') && a.includes('eggs') && a.includes('macros do not include')
    )).toBe(true)
  })

  it('does not fire for ingredient names without a recognized preparation prefix', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeSurveyMatch({
        name: 'Chicken, breast, cooked',
        caloriesPer100g: 165,
        proteinPer100g: 31,
        carbPer100g: 0,
        fatPer100g: 3.6,
        alternatives: [],
      })
    )
    mockResolveIngredientFactor.mockResolvedValue(countConversionError)

    const result = await calculateNutrition({
      ingredients: [{ name: 'chicken breast', quantity: 1, unit: 'piece' }],
    })

    // "chicken breast" has no recognized prep prefix → base-food fallback must not fire
    // matchIngredient called only once (no retry for "breast")
    expect(mockMatchIngredient).toHaveBeenCalledTimes(1)
    expect(result.ingredients[0].resolved).toBe(false)
  })

  it('base-food fallback is LAST RESORT: PBorrow fires first when an SR Legacy alt exists', async () => {
    // SR Legacy alt IS present → portion-borrow should fire, not base-food fallback
    mockMatchIngredient.mockResolvedValue(
      makeSurveyMatch({
        name: 'Eggs, scrambled',
        caloriesPer100g: 169,
        proteinPer100g: 10.6,
        carbPer100g: 1.6,
        fatPer100g: 11.5,
        alternatives: [makeSRLegacyAlt({ name: 'Egg, whole, raw', caloriesPer100g: 143, proteinPer100g: 12.6, carbPer100g: 0.7, fatPer100g: 9.5 })],
      })
    )

    mockResolveIngredientFactor.mockImplementation(async (food) => {
      if ((food as { fdcDataType?: string }).fdcDataType === 'Survey (FNDDS)') return countConversionError
      return makeCountFactor(50, 2, '2 large (100g)')
    })

    await calculateNutrition({
      ingredients: [{ name: 'scrambled eggs', quantity: 2, unit: 'piece' }],
    })

    // matchIngredient must be called ONLY ONCE — PBorrow fired, no base-food retry
    expect(mockMatchIngredient).toHaveBeenCalledTimes(1)
  })
})

// ── Regression: existing partial-meal and multi-ingredient behavior ───────────

describe('calculateNutrition — portion-borrow does not regress multi-ingredient meals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves each ingredient independently: one via PBorrow, one normally', async () => {
    mockMatchIngredient
      .mockResolvedValueOnce(
        // First ingredient: scrambled eggs (Survey, portion-borrow path)
        makeSurveyMatch({
          name: 'Eggs, scrambled',
          caloriesPer100g: 169,
          proteinPer100g: 10.6,
          carbPer100g: 1.6,
          fatPer100g: 11.5,
          alternatives: [makeSRLegacyAlt({ name: 'Egg, whole, raw', caloriesPer100g: 143, proteinPer100g: 12.6, carbPer100g: 0.7, fatPer100g: 9.5 })],
        })
      )
      .mockResolvedValueOnce({
        // Second ingredient: orange juice (resolves normally)
        confidence: 'confident',
        topMatch: {
          provider: 'usda_fooddata',
          externalId: 'oj-001',
          name: 'Orange juice, raw',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: 'cup',
          unitsPerServing: 1,
          calories: 45,
          proteinG: 0.7,
          carbohydrateG: 10.4,
          fatG: 0.2,
          isGeneric: true,
          matchScore: 100,
          matchReasons: ['USDA Foundation'],
          fdcDataType: 'Foundation' as const,
        },
        alternatives: [],
        rawResults: [],
      })

    mockResolveIngredientFactor.mockImplementation(async (food) => {
      if ((food as { fdcDataType?: string }).fdcDataType === 'Survey (FNDDS)') return countConversionError
      if ((food as { name?: string }).name === 'Egg, whole, raw') return makeCountFactor(50, 2, '2 large (100g)')
      // OJ: 240g per cup × 1 cup
      return { grams: 240, factor: 2.4, conversionSource: 'usda_measured' as const, portionDescription: '1 cup (240g)', confidence: 'high' as const, notes: [] }
    })

    const result = await calculateNutrition({
      ingredients: [
        { name: 'scrambled eggs', quantity: 2, unit: 'piece' },
        { name: 'orange juice', quantity: 1, unit: 'cup' },
      ],
    })

    expect(result.ingredients).toHaveLength(2)
    expect(result.ingredients[0].resolved).toBe(true)
    expect(result.ingredients[0].matchedFoodName).toBe('Eggs, scrambled')
    expect(result.ingredients[0].calories).toBe(169)  // prepared macros

    expect(result.ingredients[1].resolved).toBe(true)
    expect(result.ingredients[1].calories).toBe(Math.round(45 * 2.4))  // 108

    expect(result.totals.calories).toBe(169 + Math.round(45 * 2.4))
    expect(result.completeness).toBe('complete')
  })
})
