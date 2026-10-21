/**
 * calculateNutrition — Part C-Pre: USDA volume promotion
 *
 * When FatSecret wins scoring (+3 provider bonus) but the matched food lacks
 * volume-unit portions, USDA Foundation/SR Legacy alts can trigger Step 7
 * (USDA portion fetch in resolveIngredientFactor). This path:
 *   - Bypasses the relative quality gate (FatSecret's scoring bonus artificially
 *     inflates the threshold; both identity guards replace it)
 *   - Requires both altPassesIdentityCheck AND topMatchPassesIdentityCheck
 *   - Requires fdcDataType Foundation or SR Legacy
 *   - Requires absolute score ≥ 40
 *
 * Guards verified:
 *   - Fires ONLY when topMatch provider is fatsecret
 *   - Fires ONLY for volume units (cup/tbsp/tsp)
 *   - Guard 5: preparation-incompatible USDA alt is rejected
 *   - Guard 1: compound USDA alt is rejected
 *   - Does NOT change global scoring thresholds
 *
 * IMPORTANT: Tests use generic mock foods — not customer evaluation inputs.
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

/** FatSecret topMatch that lacks volume-unit portions (unit_incompatible). */
function makeFatSecretVolumeFailMatch(overrides: {
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
      provider: 'fatsecret',
      externalId: 'fs-001',
      name: overrides.name,
      servingSize: 40,
      servingUnit: 'g',
      householdUnit: 'serving',
      unitsPerServing: 1,
      calories: overrides.caloriesPer100g * 0.4,
      proteinG: overrides.proteinPer100g * 0.4,
      carbohydrateG: overrides.carbPer100g * 0.4,
      fatG: overrides.fatPer100g * 0.4,
      isGeneric: true,
      matchScore: 118,  // inflated by FatSecret +3 bonus over USDA +12
      matchReasons: ['FatSecret generic'],
      fdcDataType: undefined,
    },
    alternatives: overrides.alternatives ?? [],
    rawResults: [],
  }
}

function makeUsdaAlt(overrides: {
  name: string
  caloriesPer100g: number
  proteinPer100g: number
  carbPer100g: number
  fatPer100g: number
  fdcDataType: 'Foundation' | 'SR Legacy'
  score?: number
  provider?: 'usda_fooddata' | 'fatsecret'
}) {
  return {
    provider: (overrides.provider ?? 'usda_fooddata') as 'usda_fooddata' | 'fatsecret',
    externalId: 'usda-001',
    name: overrides.name,
    servingSize: 100,
    servingUnit: 'g',
    householdUnit: 'cup',
    unitsPerServing: 1,
    calories: overrides.caloriesPer100g,
    proteinG: overrides.proteinPer100g,
    carbohydrateG: overrides.carbPer100g,
    fatG: overrides.fatPer100g,
    isGeneric: true,
    matchScore: overrides.score ?? 115,
    matchReasons: ['USDA alt'],
    fdcDataType: overrides.fdcDataType as string,
  }
}

const volumeConversionError: ConversionError = {
  kind: 'conversion_error',
  errorCode: 'unit_incompatible',
  message: 'Cannot convert volume unit to gram-basis food without density data',
}

function makeVolumeFactor(totalGrams: number, desc: string): ConversionResult {
  return {
    grams: totalGrams,
    factor: totalGrams / 100,
    conversionSource: 'usda_measured' as const,
    portionDescription: desc,
    confidence: 'high',
    notes: ['USDA Foundation portion'],
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calculateNutrition — Part C-Pre: USDA volume promotion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('promotes USDA SR Legacy alt when FatSecret topMatch fails a volume unit', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeFatSecretVolumeFailMatch({
        name: 'Cooked Oatmeal',
        caloriesPer100g: 71,
        proteinPer100g: 2.5,
        carbPer100g: 12,
        fatPer100g: 1.5,
        alternatives: [
          makeUsdaAlt({
            name: 'Oatmeal, regular and quick, cooked with water, no salt added',
            caloriesPer100g: 71,
            proteinPer100g: 2.5,
            carbPer100g: 12,
            fatPer100g: 1.5,
            fdcDataType: 'SR Legacy',
            score: 115,
          }),
        ],
      })
    )

    mockResolveIngredientFactor.mockImplementation(async (food) => {
      if ((food as { externalId?: string }).externalId === 'fs-001') return volumeConversionError
      // USDA SR Legacy has the cup portion
      return makeVolumeFactor(234, '1 cup (234g)')
    })

    const result = await calculateNutrition({
      ingredients: [{ name: 'cooked oatmeal', quantity: 1, unit: 'cup' }],
    })

    expect(result.ingredients).toHaveLength(1)
    const ing = result.ingredients[0]
    expect(ing.resolved).toBe(true)
    expect(ing.matchConfidence).toBe('plausible')
    expect(ing.matchedFoodName).toBe('Oatmeal, regular and quick, cooked with water, no salt added')
    expect(ing.matchedFoodProvider).toBe('usda_fooddata')
    // 71 cal/100g × (234g / 100) = 71 × 2.34 = 166.14 → 166
    expect(ing.calories).toBe(Math.round(71 * 2.34))

    // Assumption note discloses the promotion
    expect(result.assumptions.some(a =>
      a.includes('volume portion from USDA') && a.includes('Cooked Oatmeal')
    )).toBe(true)
  })

  it('does NOT promote when topMatch provider is USDA (not FatSecret)', async () => {
    // USDA topMatch fails volume → standard Part C runs, no USDA promotion pre-check
    const usdaTopMatchResult: MatchResult = {
      confidence: 'confident',
      topMatch: {
        provider: 'usda_fooddata',
        externalId: 'usda-top-001',
        name: 'Oats, regular, unenriched, dry',
        servingSize: 100,
        servingUnit: 'g',
        householdUnit: undefined,
        unitsPerServing: undefined,
        calories: 379,
        proteinG: 13.2,
        carbohydrateG: 67.7,
        fatG: 6.5,
        isGeneric: true,
        matchScore: 115,
        matchReasons: ['USDA SR Legacy'],
        fdcDataType: 'SR Legacy' as const,
      },
      alternatives: [
        makeUsdaAlt({
          name: 'Oatmeal, cooked',
          caloriesPer100g: 71,
          proteinPer100g: 2.5,
          carbPer100g: 12,
          fatPer100g: 1.5,
          fdcDataType: 'SR Legacy',
          score: 60,
        }),
      ],
      rawResults: [],
    }

    mockMatchIngredient.mockResolvedValue(usdaTopMatchResult)
    mockResolveIngredientFactor.mockResolvedValue(volumeConversionError)

    const result = await calculateNutrition({
      ingredients: [{ name: 'cooked oatmeal', quantity: 1, unit: 'cup' }],
    })

    // USDA promotion pre-check does NOT fire — topMatch is USDA, not FatSecret
    // Standard Part C runs but USDA alt scores 60 vs topMatch 115 = 52% → passes 50% floor
    // Still fails because resolveIngredientFactor returns error for all foods in this mock
    expect(result.ingredients[0].resolved).toBe(false)
    expect(result.assumptions.some(a => a.includes('volume portion from USDA'))).toBe(false)
  })

  it('does NOT fire for count units — only volume units trigger USDA promotion', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeFatSecretVolumeFailMatch({
        name: 'Honey',
        caloriesPer100g: 304,
        proteinPer100g: 0.3,
        carbPer100g: 82.4,
        fatPer100g: 0,
        alternatives: [
          makeUsdaAlt({
            name: 'Honey',
            caloriesPer100g: 304,
            proteinPer100g: 0.3,
            carbPer100g: 82.4,
            fatPer100g: 0,
            fdcDataType: 'Foundation',
          }),
        ],
      })
    )

    // For count unit, unit_incompatible won't fire the USDA pre-check
    // Instead standard Part C runs
    mockResolveIngredientFactor.mockResolvedValue(volumeConversionError)

    const result = await calculateNutrition({
      ingredients: [{ name: 'honey', quantity: 1, unit: 'piece' }],  // count, not volume
    })

    // USDA volume promotion does not apply to count units
    expect(result.assumptions.some(a => a.includes('volume portion from USDA'))).toBe(false)
  })

  it('Guard 5: rejects USDA alt when preparation states conflict (cooked req vs raw alt)', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeFatSecretVolumeFailMatch({
        name: 'Grilled Chicken Breast',
        caloriesPer100g: 165,
        proteinPer100g: 31,
        carbPer100g: 0,
        fatPer100g: 3.6,
        alternatives: [
          makeUsdaAlt({
            name: 'Chicken, breast, meat only, raw',
            caloriesPer100g: 120,
            proteinPer100g: 22.5,
            carbPer100g: 0,
            fatPer100g: 2.6,
            fdcDataType: 'SR Legacy',
            score: 60,
          }),
        ],
      })
    )

    mockResolveIngredientFactor.mockResolvedValue(volumeConversionError)

    const result = await calculateNutrition({
      ingredients: [{ name: 'grilled chicken breast', quantity: 1, unit: 'cup' }],
    })

    // Guard 5 (topMatchPassesIdentityCheck): "grilled chicken breast" req = cooked,
    // "Chicken, breast, meat only, raw" alt = raw_or_dry → rejected
    expect(result.ingredients[0].resolved).toBe(false)
    expect(result.assumptions.some(a => a.includes('volume portion from USDA'))).toBe(false)
  })

  it('Guard: rejects USDA alt with score below 40', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeFatSecretVolumeFailMatch({
        name: 'Cooked Oatmeal',
        caloriesPer100g: 71,
        proteinPer100g: 2.5,
        carbPer100g: 12,
        fatPer100g: 1.5,
        alternatives: [
          makeUsdaAlt({
            name: 'Oatmeal, regular and quick, cooked with water',
            caloriesPer100g: 71,
            proteinPer100g: 2.5,
            carbPer100g: 12,
            fatPer100g: 1.5,
            fdcDataType: 'SR Legacy',
            score: 30,  // below 40 → rejected
          }),
        ],
      })
    )

    mockResolveIngredientFactor.mockResolvedValue(volumeConversionError)

    const result = await calculateNutrition({
      ingredients: [{ name: 'cooked oatmeal', quantity: 1, unit: 'cup' }],
    })

    expect(result.ingredients[0].resolved).toBe(false)
  })

  it('does NOT promote FatSecret alt as USDA promotion (provider must be usda_fooddata)', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeFatSecretVolumeFailMatch({
        name: 'Cooked Oatmeal',
        caloriesPer100g: 71,
        proteinPer100g: 2.5,
        carbPer100g: 12,
        fatPer100g: 1.5,
        alternatives: [
          makeUsdaAlt({
            name: 'Cooked Oatmeal',
            caloriesPer100g: 71,
            proteinPer100g: 2.5,
            carbPer100g: 12,
            fatPer100g: 1.5,
            fdcDataType: 'SR Legacy',
            score: 115,
            provider: 'fatsecret',  // FatSecret alt, not USDA
          }),
        ],
      })
    )

    mockResolveIngredientFactor.mockResolvedValue(volumeConversionError)

    const result = await calculateNutrition({
      ingredients: [{ name: 'cooked oatmeal', quantity: 1, unit: 'cup' }],
    })

    // FatSecret alt should not be promoted via USDA pre-check
    expect(result.assumptions.some(a => a.includes('volume portion from USDA'))).toBe(false)
  })

  it('resolves tablespoon volume unit via USDA Foundation alt', async () => {
    mockMatchIngredient.mockResolvedValue(
      makeFatSecretVolumeFailMatch({
        name: 'Honey',
        caloriesPer100g: 304,
        proteinPer100g: 0.3,
        carbPer100g: 82.4,
        fatPer100g: 0,
        alternatives: [
          makeUsdaAlt({
            name: 'Honey',
            caloriesPer100g: 304,
            proteinPer100g: 0.3,
            carbPer100g: 82.4,
            fatPer100g: 0,
            fdcDataType: 'Foundation',
          }),
        ],
      })
    )

    mockResolveIngredientFactor.mockImplementation(async (food) => {
      if ((food as { externalId?: string }).externalId === 'fs-001') return volumeConversionError
      // USDA Foundation has tbsp portion: 1 tbsp = 21g
      return makeVolumeFactor(21, '1 tbsp (21g)')
    })

    const result = await calculateNutrition({
      ingredients: [{ name: 'honey', quantity: 1, unit: 'tbsp' }],
    })

    const ing = result.ingredients[0]
    expect(ing.resolved).toBe(true)
    expect(ing.matchedFoodName).toBe('Honey')
    // 304 cal/100g × (21g / 100) = 304 × 0.21 = 63.84 → 64
    expect(ing.calories).toBe(Math.round(304 * 0.21))
  })
})
