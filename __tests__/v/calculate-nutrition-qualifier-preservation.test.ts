/**
 * Qualifier preservation and portion-size conflict guards.
 *
 * Guarantees verified here:
 *   1. portionSizeConflict() detects explicit size-antonym conflicts (e.g. "thin"
 *      in portion description vs "thick" in ingredient name).
 *   2. When the topMatch resolves but its portion description conflicts with the
 *      ingredient's size qualifier, the result is treated as a conversion error
 *      and falls through to Part C.
 *   3. When a Part C-Standard alternative also resolves with a conflicting portion,
 *      it is skipped — the ingredient remains unresolved rather than returning
 *      wrong macros.
 *   4. Multi-ingredient calls preserve every original ingredient description in
 *      the userDescription field regardless of whether they resolve.
 *   5. When all portion options conflict, completeness is 'incomplete' and the
 *      unresolved list is populated with a clear reason.
 *
 * IMPORTANT: Tests use generic mock foods, not customer evaluation inputs.
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

import { calculateNutrition } from '../../lib/v/tools/calculate-nutrition'
import { matchIngredient } from '../../lib/nutrition/matching/matcher'
import { resolveIngredientFactor } from '../../lib/nutrition/conversion/factor'

const mockMatchIngredient = vi.mocked(matchIngredient)
const mockResolveIngredientFactor = vi.mocked(resolveIngredientFactor)

// ── Stub builders ─────────────────────────────────────────────────────────────

function makeFatSecretSliceMatch(overrides: {
  name: string
  caloriesPer100g: number
  proteinPer100g: number
  carbPer100g: number
  fatPer100g: number
  matchScore?: number
  alternatives?: MatchResult['alternatives']
}): MatchResult {
  return {
    confidence: 'confident',
    topMatch: {
      provider: 'fatsecret',
      externalId: 'fs-001',
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
      matchScore: overrides.matchScore ?? 142,
      matchReasons: ['FatSecret generic'],
      fdcDataType: undefined,
    },
    alternatives: overrides.alternatives ?? [],
    rawResults: [],
  }
}

function makeThinSliceResult(sliceGrams: number): ConversionResult {
  return {
    grams: sliceGrams,
    factor: sliceGrams / 100,
    conversionSource: 'usda_measured' as const,
    portionDescription: `1 thin slice (yield after cooking)`,
    confidence: 'high' as const,
    notes: [],
  }
}

function makeThickSliceResult(sliceGrams: number): ConversionResult {
  return {
    grams: sliceGrams * 3,
    factor: (sliceGrams * 3) / 100,
    conversionSource: 'usda_measured' as const,
    portionDescription: `3 thick slices`,
    confidence: 'high' as const,
    notes: [],
  }
}

function makeWeightResult(totalGrams: number): ConversionResult {
  return {
    grams: totalGrams,
    factor: totalGrams / 100,
    conversionSource: 'usda_measured' as const,
    portionDescription: `${totalGrams}g`,
    confidence: 'high' as const,
    notes: [],
  }
}

const noPortionError: ConversionError = {
  kind: 'conversion_error',
  errorCode: 'portion_not_found',
  message: 'No serving size found for unit "slice"',
}

// ── portionSizeConflict unit tests ────────────────────────────────────────────

// Import the internal helper (exported for testing)
import { extractBaseCountFood } from '../../lib/v/tools/calculate-nutrition'

// Note: portionSizeConflict is not exported. We test it indirectly via the
// full pipeline. Direct behaviour is verified by the integration tests below.

// ── Tests: portion-size conflict guard ───────────────────────────────────────

describe('calculateNutrition — portion-size conflict guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects topMatch resolved with thin-slice portion when ingredient says thick-cut', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeFatSecretSliceMatch({
        name: 'Bacon',
        caloriesPer100g: 541,
        proteinPer100g: 37,
        carbPer100g: 1.4,
        fatPer100g: 42,
      })
    )

    // topMatch resolves but with a thin-slice portion — conflicts with "thick-cut"
    mockResolveIngredientFactor.mockResolvedValue(makeThinSliceResult(5))

    const result = await calculateNutrition({
      ingredients: [{ name: 'thick-cut bacon', quantity: 3, unit: 'slice' }],
    })

    // Portion conflict detected → remains unresolved rather than returning 81 cal
    expect(result.ingredients[0].resolved).toBe(false)
    expect(result.completeness).toBe('incomplete')
    expect(result.unresolvedIngredients).toHaveLength(1)
  })

  it('skips Part C-Standard alternative that also has thin-slice portion for thick-cut request', async () => {
    const mockAlt = {
      provider: 'usda_fooddata' as const,
      externalId: 'usda-001',
      name: 'Pork, cured, bacon, cooked',
      servingSize: 100,
      servingUnit: 'g',
      householdUnit: undefined,
      unitsPerServing: undefined,
      calories: 541,
      proteinG: 37,
      carbohydrateG: 1.4,
      fatG: 42,
      isGeneric: true,
      matchScore: 120,
      matchReasons: ['USDA alt'],
      fdcDataType: 'SR Legacy' as const,
    }

    mockMatchIngredient.mockResolvedValue({
      confidence: 'confident',
      topMatch: {
        provider: 'fatsecret' as const,
        externalId: 'fs-001',
        name: 'Bacon',
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: undefined,
        unitsPerServing: undefined,
        calories: 541,
        proteinG: 37,
        carbohydrateG: 1.4,
        fatG: 42,
        isGeneric: true,
        matchScore: 142,
        matchReasons: ['FatSecret generic'],
        fdcDataType: undefined,
      },
      alternatives: [mockAlt],
      rawResults: [],
    })

    // Both topMatch AND alt resolve with a thin-slice portion
    mockResolveIngredientFactor.mockResolvedValue(makeThinSliceResult(5))

    const result = await calculateNutrition({
      ingredients: [{ name: 'thick-cut bacon', quantity: 3, unit: 'slice' }],
    })

    // Alt also conflicts → still unresolved
    expect(result.ingredients[0].resolved).toBe(false)
    expect(result.unresolvedIngredients[0].name).toBe('thick-cut bacon')
  })

  it('accepts a weight-based resolution even when the ingredient says thick-cut', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeFatSecretSliceMatch({
        name: 'Bacon',
        caloriesPer100g: 541,
        proteinPer100g: 37,
        carbPer100g: 1.4,
        fatPer100g: 42,
      })
    )

    // Weight-based portion — no "thin" conflict word
    mockResolveIngredientFactor.mockResolvedValue(makeWeightResult(105))

    const result = await calculateNutrition({
      ingredients: [{ name: 'thick-cut bacon', quantity: 3, unit: 'slice' }],
    })

    expect(result.ingredients[0].resolved).toBe(true)
    expect(result.ingredients[0].calories).toBe(Math.round(541 * 1.05))
  })

  it('does NOT reject when no conflicting size word appears in either name or portion', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeFatSecretSliceMatch({
        name: 'Turkey Bacon',
        caloriesPer100g: 218,
        proteinPer100g: 28,
        carbPer100g: 3.6,
        fatPer100g: 11,
      })
    )

    // Generic "1 slice" — no size antonym
    mockResolveIngredientFactor.mockResolvedValue({
      grams: 28,
      factor: 0.28,
      conversionSource: 'usda_measured' as const,
      portionDescription: '1 slice',
      confidence: 'high' as const,
      notes: [],
    })

    const result = await calculateNutrition({
      ingredients: [{ name: 'turkey bacon', quantity: 2, unit: 'slice' }],
    })

    expect(result.ingredients[0].resolved).toBe(true)
  })
})

// ── Tests: multi-ingredient description preservation ─────────────────────────

describe('calculateNutrition — ingredient description preservation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('preserves the original ingredient names in userDescription for resolved and unresolved items', async () => {
    // First ingredient resolves; second doesn't
    mockMatchIngredient
      .mockResolvedValueOnce({
        confidence: 'plausible',
        topMatch: {
          provider: 'fatsecret' as const,
          externalId: 'fs-eggs',
          name: 'Scrambled Eggs',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: 'serving',
          unitsPerServing: 1,
          calories: 155,
          proteinG: 11,
          carbohydrateG: 1.6,
          fatG: 11,
          isGeneric: true,
          matchScore: 115,
          matchReasons: [],
          fdcDataType: undefined,
        },
        alternatives: [],
        rawResults: [],
      })
      .mockResolvedValueOnce({
        confidence: 'plausible',
        topMatch: {
          provider: 'fatsecret' as const,
          externalId: 'fs-bacon',
          name: 'Thick-Cut Bacon',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: undefined,
          unitsPerServing: undefined,
          calories: 541,
          proteinG: 37,
          carbohydrateG: 1.4,
          fatG: 42,
          isGeneric: true,
          matchScore: 142,
          matchReasons: [],
          fdcDataType: undefined,
        },
        alternatives: [],
        rawResults: [],
      })

    mockResolveIngredientFactor
      .mockResolvedValueOnce({
        grams: 100,
        factor: 1.0,
        conversionSource: 'usda_measured' as const,
        portionDescription: '1 serving (100g)',
        confidence: 'high' as const,
        notes: [],
      })
      .mockResolvedValueOnce(noPortionError)

    const result = await calculateNutrition({
      ingredients: [
        { name: 'scrambled eggs', quantity: 2, unit: 'piece' },
        { name: 'thick-cut bacon', quantity: 3, unit: 'slice' },
      ],
    })

    // Original names must appear in userDescription — not simplified names
    expect(result.ingredients[0].userDescription).toContain('scrambled eggs')
    expect(result.ingredients[1].userDescription).toContain('thick-cut bacon')

    // Resolved/unresolved state
    expect(result.ingredients[0].resolved).toBe(true)
    expect(result.ingredients[1].resolved).toBe(false)

    // Partial completeness preserved — signed-token flow depends on this
    expect(result.completeness).toBe('incomplete')
    expect(result.unresolvedIngredients).toHaveLength(1)
    expect(result.unresolvedIngredients[0].name).toBe('thick-cut bacon')
  })

  it('completeness is incomplete (not estimated) when conversion error occurs', async () => {
    mockMatchIngredient.mockResolvedValue({
      confidence: 'plausible',
      topMatch: {
        provider: 'usda_fooddata' as const,
        externalId: 'usda-001',
        name: 'Oatmeal',
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: undefined,
        unitsPerServing: undefined,
        calories: 71,
        proteinG: 2.5,
        carbohydrateG: 12,
        fatG: 1.5,
        isGeneric: true,
        matchScore: 60,
        matchReasons: [],
        fdcDataType: 'Survey (FNDDS)' as const,
      },
      alternatives: [],
      rawResults: [],
    })

    mockResolveIngredientFactor.mockResolvedValue({
      kind: 'conversion_error',
      errorCode: 'unit_incompatible',
      message: 'Cannot convert volume unit "cup" to gram-basis food without density data',
    } as ConversionError)

    const result = await calculateNutrition({
      ingredients: [{ name: 'cooked oatmeal', quantity: 1, unit: 'cup' }],
    })

    expect(result.ingredients[0].resolved).toBe(false)
    // conversion_error drives 'incomplete', not 'estimated'
    expect(result.completeness).toBe('incomplete')
    expect(result.unresolvedIngredients[0].reason).toBe('conversion_error')
  })
})

// ── Tests: scrambled eggs — pipeline disclosure guarantee ─────────────────────

describe('calculateNutrition — scrambled eggs disclosure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('BaseFallback discloses that preparation macros are not included when resolving scrambled eggs as base food', async () => {
    // First call: "scrambled eggs" → Survey "Eggs, scrambled" topMatch
    const surveyScramblerFail: MatchResult = {
      confidence: 'plausible',
      topMatch: {
        provider: 'usda_fooddata' as const,
        externalId: 'usda-scrambled',
        name: 'Eggs, scrambled',
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: undefined,
        unitsPerServing: undefined,
        calories: 155,
        proteinG: 11,
        carbohydrateG: 1.6,
        fatG: 11,
        isGeneric: true,
        matchScore: 120,
        matchReasons: [],
        fdcDataType: 'Survey (FNDDS)' as const,
      },
      alternatives: [],  // no SR Legacy alt for PBorrow
      rawResults: [],
    }

    // Second call: BaseFallback → "eggs" → plain egg result
    const baseFoodMatch: MatchResult = {
      confidence: 'plausible',
      topMatch: {
        provider: 'usda_fooddata' as const,
        externalId: 'usda-egg',
        name: 'Egg, whole, raw, fresh',
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: 'large',
        unitsPerServing: 1,
        calories: 143,
        proteinG: 12.6,
        carbohydrateG: 0.7,
        fatG: 9.5,
        isGeneric: true,
        matchScore: 130,
        matchReasons: [],
        fdcDataType: 'SR Legacy' as const,
      },
      alternatives: [],
      rawResults: [],
    }

    const baseFactorResult: ConversionResult = {
      grams: 100,
      factor: 1.0,
      conversionSource: 'usda_measured' as const,
      portionDescription: '2 large (100g)',
      confidence: 'high' as const,
      notes: [],
    }

    mockMatchIngredient
      .mockResolvedValueOnce(surveyScramblerFail)   // "scrambled eggs" query
      .mockResolvedValueOnce(baseFoodMatch)          // BaseFallback → "eggs" query

    // topMatch: portion_not_found; BaseFallback's SR Legacy egg: resolves
    mockResolveIngredientFactor
      .mockResolvedValueOnce(noPortionError)          // Survey "Eggs, scrambled" fails
      .mockResolvedValueOnce(baseFactorResult)        // SR Legacy "Egg, whole, raw" succeeds

    const result = await calculateNutrition({
      ingredients: [{ name: 'scrambled eggs', quantity: 2, unit: 'piece' }],
    })

    // Resolves — BaseFallback fires
    expect(result.ingredients[0].resolved).toBe(true)

    // Macros are raw-egg macros (143 cal/100g × factor 1.0)
    expect(result.ingredients[0].calories).toBe(143)

    // Disclosure appears in assumptions — not silent
    expect(result.assumptions.some(a =>
      a.includes('scrambled eggs') &&
      a.toLowerCase().includes('macros do not include preparation')
    )).toBe(true)
  })

  it('extractBaseCountFood strips scrambled prefix and returns base food', async () => {
    expect(extractBaseCountFood('scrambled eggs')).toBe('eggs')
    expect(extractBaseCountFood('hard-boiled eggs')).toBe('eggs')
    expect(extractBaseCountFood('poached egg')).toBe('egg')
    expect(extractBaseCountFood('eggs')).toBeNull()   // no prefix to strip
    expect(extractBaseCountFood('scrambled egg salad')).toBeNull()  // compound indicator
  })
})

// ── Tests: cooked oatmeal via USDA Survey topMatch extension ──────────────────

describe('calculateNutrition — Part C-Pre: USDA Survey FNDDS topMatch extension', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fires Part C-Pre when USDA Survey FNDDS wins topMatch with unit_incompatible', async () => {
    const surveyTopMatch: MatchResult = {
      confidence: 'plausible',
      topMatch: {
        provider: 'usda_fooddata' as const,
        externalId: 'usda-survey-oatmeal',
        name: 'Oatmeal, Multigrain',
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: undefined,
        unitsPerServing: undefined,
        calories: 71,
        proteinG: 2.5,
        carbohydrateG: 12,
        fatG: 1.5,
        isGeneric: true,
        matchScore: 60,
        matchReasons: [],
        fdcDataType: 'Survey (FNDDS)' as const,
      },
      alternatives: [
        {
          provider: 'usda_fooddata' as const,
          externalId: 'usda-sr-oats',
          name: 'Cereals, oats, regular and quick, cooked with water, without salt',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: undefined,
          unitsPerServing: undefined,
          calories: 71,
          proteinG: 2.5,
          carbohydrateG: 12,
          fatG: 1.5,
          isGeneric: true,
          matchScore: 50,
          matchReasons: [],
          fdcDataType: 'SR Legacy' as const,
        },
      ],
      rawResults: [],
    }

    mockMatchIngredient.mockResolvedValue(surveyTopMatch)

    mockResolveIngredientFactor.mockImplementation(async (food) => {
      if ((food as { externalId?: string }).externalId === 'usda-survey-oatmeal') {
        return { kind: 'conversion_error', errorCode: 'unit_incompatible', message: 'Cannot convert volume unit' } as ConversionError
      }
      // SR Legacy alt resolves with a cup portion
      return {
        grams: 234,
        factor: 2.34,
        conversionSource: 'usda_measured' as const,
        portionDescription: '1 cup (234g)',
        confidence: 'high' as const,
        notes: [],
      }
    })

    const result = await calculateNutrition({
      ingredients: [{ name: 'cooked oatmeal', quantity: 1, unit: 'cup' }],
    })

    // USDA Survey extension fires → SR Legacy alt resolves the cup
    expect(result.ingredients[0].resolved).toBe(true)
    expect(result.ingredients[0].calories).toBe(Math.round(71 * 2.34))
    expect(result.ingredients[0].matchedFoodName).toBe(
      'Cereals, oats, regular and quick, cooked with water, without salt'
    )
    expect(result.assumptions.some(a =>
      a.includes('volume portion from USDA') && a.includes('Oatmeal, Multigrain')
    )).toBe(true)
  })

  it('does NOT fire Part C-Pre for USDA Branded or Foundation topMatch (only Survey FNDDS)', async () => {
    // USDA Foundation topMatch (not Survey) → Part C-Pre should NOT fire for this
    const foundationTopMatch: MatchResult = {
      confidence: 'plausible',
      topMatch: {
        provider: 'usda_fooddata' as const,
        externalId: 'usda-foundation-001',
        name: 'Rolled oats',
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: undefined,
        unitsPerServing: undefined,
        calories: 379,
        proteinG: 13,
        carbohydrateG: 68,
        fatG: 7,
        isGeneric: true,
        matchScore: 80,
        matchReasons: [],
        fdcDataType: 'Foundation' as const,
      },
      alternatives: [
        {
          provider: 'usda_fooddata' as const,
          externalId: 'usda-sr-alt',
          name: 'Cereals, oats, regular, cooked',
          servingSize: 100,
          servingUnit: 'g',
          householdUnit: undefined,
          unitsPerServing: undefined,
          calories: 71,
          proteinG: 2.5,
          carbohydrateG: 12,
          fatG: 1.5,
          isGeneric: true,
          matchScore: 55,
          matchReasons: [],
          fdcDataType: 'SR Legacy' as const,
        },
      ],
      rawResults: [],
    }

    mockMatchIngredient.mockResolvedValue(foundationTopMatch)
    // All resolveIngredientFactor calls return unit_incompatible
    mockResolveIngredientFactor.mockResolvedValue({
      kind: 'conversion_error',
      errorCode: 'unit_incompatible',
      message: 'Cannot convert volume unit',
    } as ConversionError)

    const result = await calculateNutrition({
      ingredients: [{ name: 'rolled oats', quantity: 0.5, unit: 'cup' }],
    })

    // Foundation topMatch → Part C-Pre doesn't fire, standard fallback runs
    // Standard fallback scores SR Legacy alt at ~55 vs Foundation 80 → 55/80 = 68.75% < 80% threshold
    // But topIsNonBrandedUsda = true → 50% floor → 55/80 = 68.75% ≥ 50% → alt IS tried via standard path
    // alt also fails (mocked to fail) → unresolved
    expect(result.ingredients[0].resolved).toBe(false)
    // USDA volume promotion assumption should NOT appear
    expect(result.assumptions.some(a => a.includes('volume portion from USDA'))).toBe(false)
  })
})
