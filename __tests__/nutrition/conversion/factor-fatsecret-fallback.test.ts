/**
 * resolveIngredientFactor — Step 5b: FatSecret householdServingText fallback
 *
 * Tests the serving-description count-unit resolver that fires when:
 *   - food.householdServingText is populated (FatSecret detail)
 *   - inputUnit is a count unit (piece/slice/strip/egg/tortilla/etc.)
 *   - the serving description contains a count word matching the input
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Decimal } from '@prisma/client/runtime/library'
import { resolveIngredientFactor } from '../../../lib/nutrition/conversion/factor'
import { isConversionError } from '../../../lib/nutrition/conversion/types'

// ── Mock prisma and portions module ─────────────────────────────────────────

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

vi.mock('../../../lib/nutrition/conversion/portions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/nutrition/conversion/portions')>()
  return {
    ...actual,
    fetchAndStoreUsdaPortions: vi.fn().mockResolvedValue([]),
    lookupPortions: vi.fn().mockResolvedValue([]),
  }
})

import { lookupPortions, fetchAndStoreUsdaPortions } from '../../../lib/nutrition/conversion/portions'

// ── Helpers ──────────────────────────────────────────────────────────────────

function asDecimal(n: number): Decimal {
  return n as unknown as Decimal
}

// FatSecret-style food for bacon — macros per 8g (1 strip)
const FATSECRET_BACON = {
  id: 'fs-1517',
  servingSize: asDecimal(8),
  servingUnit: 'g',
  calories: asDecimal(43),
  proteinG: asDecimal(3.0),
  carbohydrateG: asDecimal(0.1),
  fatG: asDecimal(3.3),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: '1 strip',
  sourceProvider: 'fatsecret',
  externalId: '1517',
  fdcDataType: null,
}

// FatSecret-style food for large eggs — macros per 50g (1 large egg)
const FATSECRET_EGG = {
  id: 'fs-301',
  servingSize: asDecimal(50),
  servingUnit: 'g',
  calories: asDecimal(72),
  proteinG: asDecimal(6.3),
  carbohydrateG: asDecimal(0.4),
  fatG: asDecimal(4.8),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: '1 large',
  sourceProvider: 'fatsecret',
  externalId: '301',
  fdcDataType: null,
}

// FatSecret-style food for flour tortilla — macros per 45g (2 tortillas)
const FATSECRET_TORTILLA = {
  id: 'fs-8886',
  servingSize: asDecimal(45),
  servingUnit: 'g',
  calories: asDecimal(146),
  proteinG: asDecimal(3.9),
  carbohydrateG: asDecimal(24.7),
  fatG: asDecimal(3.5),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: '2 tortillas',
  sourceProvider: 'fatsecret',
  externalId: '8886',
  fdcDataType: null,
}

// FatSecret-style food for sliced turkey bacon — macros per 24g (3 slices)
const FATSECRET_TURKEY_BACON = {
  id: 'fs-2201',
  servingSize: asDecimal(24),
  servingUnit: 'g',
  calories: asDecimal(70),
  proteinG: asDecimal(8.0),
  carbohydrateG: asDecimal(1.0),
  fatG: asDecimal(3.5),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: '3 slices',
  sourceProvider: 'fatsecret',
  externalId: '2201',
  fdcDataType: null,
}

// FatSecret-style food with non-count serving description
const FATSECRET_GENERIC_NO_COUNT = {
  id: 'fs-9999',
  servingSize: asDecimal(100),
  servingUnit: 'g',
  calories: asDecimal(200),
  proteinG: asDecimal(10),
  carbohydrateG: asDecimal(20),
  fatG: asDecimal(8),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: '1 serving',
  sourceProvider: 'fatsecret',
  externalId: '9999',
  fdcDataType: null,
}

// Multi-word serving descriptions — "1 large egg"
const FATSECRET_EGG_MULTIWORD = {
  id: 'fs-302',
  servingSize: asDecimal(50),
  servingUnit: 'g',
  calories: asDecimal(72),
  proteinG: asDecimal(6.3),
  carbohydrateG: asDecimal(0.4),
  fatG: asDecimal(4.8),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: '1 large egg',
  sourceProvider: 'fatsecret',
  externalId: '302',
  fdcDataType: null,
}

// Multi-word serving descriptions — "2 flour tortillas"
const FATSECRET_TORTILLA_MULTIWORD = {
  id: 'fs-8887',
  servingSize: asDecimal(45),
  servingUnit: 'g',
  calories: asDecimal(146),
  proteinG: asDecimal(3.9),
  carbohydrateG: asDecimal(24.7),
  fatG: asDecimal(3.5),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: '2 flour tortillas',
  sourceProvider: 'fatsecret',
  externalId: '8887',
  fdcDataType: null,
}

// Multi-word with "of" — "3 slices of bacon"
const FATSECRET_BACON_SLICES_OF = {
  id: 'fs-1518',
  servingSize: asDecimal(24),
  servingUnit: 'g',
  calories: asDecimal(100),
  proteinG: asDecimal(8.0),
  carbohydrateG: asDecimal(0.3),
  fatG: asDecimal(7.0),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: '3 slices of bacon',
  sourceProvider: 'fatsecret',
  externalId: '1518',
  fdcDataType: null,
}

// Multi-word with blacklisted first word — "1 serving of oats"
const FATSECRET_OATS_SERVING_OF = {
  id: 'fs-5555',
  servingSize: asDecimal(40),
  servingUnit: 'g',
  calories: asDecimal(150),
  proteinG: asDecimal(5),
  carbohydrateG: asDecimal(27),
  fatG: asDecimal(3),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: '1 serving of oats',
  sourceProvider: 'fatsecret',
  externalId: '5555',
  fdcDataType: null,
}

// FatSecret-style food with no householdServingText
const FATSECRET_NO_HOUSEHOLD = {
  id: 'fs-1234',
  servingSize: asDecimal(100),
  servingUnit: 'g',
  calories: asDecimal(150),
  proteinG: asDecimal(5),
  carbohydrateG: asDecimal(30),
  fatG: asDecimal(2),
  householdUnit: null,
  unitsPerServing: null,
  householdServingText: null,
  sourceProvider: 'fatsecret',
  externalId: '1234',
  fdcDataType: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookupPortions).mockResolvedValue([])
  vi.mocked(fetchAndStoreUsdaPortions).mockResolvedValue([])
})

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Step 5b: FatSecret serving description fallback', () => {

  describe('direct unit match — "1 strip"', () => {
    it('3 strips of bacon → factor = 3, resolved via serving description', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON, 3, 'strip')
      expect(isConversionError(result)).toBe(false)
      const r = result as Awaited<ReturnType<typeof resolveIngredientFactor>> & { factor: number }
      if (isConversionError(r)) return
      expect(r.factor).toBeCloseTo(3, 3)           // 3/1 = 3 servings
      expect(r.grams).toBeCloseTo(24, 1)           // 3 * 8g = 24g
      expect(r.conversionSource).toBe('manufacturer_declared')
      expect(r.confidence).toBe('medium')
      expect(r.notes.some(n => n.includes('1 strip'))).toBe(true)
    })

    it('1 strip of bacon → factor = 1', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON, 1, 'strip')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
    })

    it('plural "strips" also resolves via "1 strip"', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON, 3, 'strips')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(3, 3)
    })
  })

  describe('size qualifier match — "1 large"', () => {
    it('3 piece eggs with "1 large" serving → factor = 3', async () => {
      const result = await resolveIngredientFactor(FATSECRET_EGG, 3, 'piece')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(3, 3)
      expect(result.grams).toBeCloseTo(150, 1)     // 3 * 50g = 150g
      expect(result.conversionSource).toBe('manufacturer_declared')
      expect(result.notes.some(n => n.includes('1 large'))).toBe(true)
    })

    it('1 piece egg with "1 large" → factor = 1', async () => {
      const result = await resolveIngredientFactor(FATSECRET_EGG, 1, 'piece')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
    })

    it('FOOD_COUNT_NOUNS member "egg" also matches size qualifier "1 large"', async () => {
      const result = await resolveIngredientFactor(FATSECRET_EGG, 2, 'egg')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(2, 3)
    })
  })

  describe('serving description has count > 1 — "2 tortillas"', () => {
    it('1 piece tortilla → factor = 0.5 (half a serving)', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TORTILLA, 1, 'piece')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(0.5, 3)   // 1 / 2 = 0.5 servings
      expect(result.grams).toBeCloseTo(22.5, 1)   // 0.5 * 45g = 22.5g
    })

    it('2 piece tortillas → factor = 1 (exactly 1 serving)', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TORTILLA, 2, 'piece')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
    })

    it('tortilla count noun also resolves', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TORTILLA, 2, 'tortilla')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
    })
  })

  describe('plural count in serving description — "3 slices"', () => {
    it('3 slices turkey bacon → factor = 1 (exactly 1 serving)', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TURKEY_BACON, 3, 'slice')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
      expect(result.grams).toBeCloseTo(24, 1)
    })

    it('6 slices turkey bacon → factor = 2 (two servings)', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TURKEY_BACON, 6, 'slice')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(2, 3)
    })

    it('"slices" plural input matches "3 slices" description', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TURKEY_BACON, 3, 'slices')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
    })
  })

  describe('non-count serving descriptions — must NOT resolve', () => {
    it('"1 serving" with piece unit → falls through to portion_not_found', async () => {
      const result = await resolveIngredientFactor(FATSECRET_GENERIC_NO_COUNT, 1, 'piece')
      // Should NOT be resolved by serving text — "serving" is blacklisted
      expect(isConversionError(result)).toBe(true)
      if (!isConversionError(result)) return
      expect(result.errorCode).toBe('portion_not_found')
    })

    it('null householdServingText → no fallback, falls through', async () => {
      const result = await resolveIngredientFactor(FATSECRET_NO_HOUSEHOLD, 2, 'piece')
      expect(isConversionError(result)).toBe(true)
      if (!isConversionError(result)) return
      expect(result.errorCode).toBe('portion_not_found')
    })
  })

  describe('weight and volume units bypass Step 5b entirely', () => {
    it('grams input for gram-basis food resolves via Step 1 (same unit)', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON, 16, 'g')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.conversionSource).toBe('same_unit')
      expect(result.factor).toBeCloseTo(2, 3)       // 16g / 8g per serving = 2
    })

    it('oz input for gram-basis food resolves via weight conversion', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON, 1, 'oz')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.conversionSource).toBe('same_unit')
      expect(result.grams).toBeCloseTo(28.3495, 1)
    })
  })

  describe('Step 5 (householdUnit) takes priority over Step 5b', () => {
    it('when householdUnit matches, Step 5 resolves before Step 5b', async () => {
      const foodWithBoth = {
        ...FATSECRET_BACON,
        householdUnit: 'strip',
        unitsPerServing: asDecimal(1),
      }
      const result = await resolveIngredientFactor(foodWithBoth, 3, 'strip')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      // Step 5 resolves with 'manufacturer_declared' and high confidence
      expect(result.conversionSource).toBe('manufacturer_declared')
      expect(result.confidence).toBe('high')   // Step 5 gives high, Step 5b gives medium
      expect(result.factor).toBeCloseTo(3, 3)
    })
  })

  describe('multi-word serving descriptions', () => {
    it('"1 large egg" with piece → resolves factor = 1 (last word "egg" ∈ FOOD_COUNT_NOUNS)', async () => {
      const result = await resolveIngredientFactor(FATSECRET_EGG_MULTIWORD, 1, 'piece')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
      expect(result.grams).toBeCloseTo(50, 1)
      expect(result.conversionSource).toBe('manufacturer_declared')
      expect(result.confidence).toBe('medium')
    })

    it('"1 large egg" with egg → resolves factor = 1', async () => {
      const result = await resolveIngredientFactor(FATSECRET_EGG_MULTIWORD, 2, 'egg')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(2, 3)
      expect(result.grams).toBeCloseTo(100, 1)
    })

    it('"2 flour tortillas" with piece → factor = 0.5 per piece', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TORTILLA_MULTIWORD, 1, 'piece')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(0.5, 3)
      expect(result.grams).toBeCloseTo(22.5, 1)
    })

    it('"2 flour tortillas" with tortilla → factor = 0.5 per tortilla', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TORTILLA_MULTIWORD, 2, 'tortilla')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
    })

    it('"3 slices of bacon" with slice → factor = 1 for 3 slices', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON_SLICES_OF, 3, 'slice')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
      expect(result.grams).toBeCloseTo(24, 1)
    })

    it('"3 slices of bacon" with slice → factor = 2 for 6 slices', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON_SLICES_OF, 6, 'slice')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(2, 3)
    })

    it('"1 serving of oats" with piece → must NOT resolve (first word "serving" is blacklisted)', async () => {
      const result = await resolveIngredientFactor(FATSECRET_OATS_SERVING_OF, 1, 'piece')
      expect(isConversionError(result)).toBe(true)
      if (!isConversionError(result)) return
      expect(result.errorCode).toBe('portion_not_found')
    })
  })

  describe('parenthetical qualifiers in FatSecret serving descriptions', () => {
    // Regression: FatSecret detail for bacon 1517 returns
    // measurement_description = "thin slice (yield after cooking)" (5g).
    // The parenthetical made lastWord = "cooking)" which is not in any unit set,
    // causing all match conditions to fail and bacon to always be unresolved.
    const FATSECRET_BACON_PARENTHETICAL = {
      id: 'fs-1517-detail',
      servingSize: asDecimal(5),
      servingUnit: 'g',
      calories: asDecimal(27),
      proteinG: asDecimal(2.1),
      carbohydrateG: asDecimal(0.0),
      fatG: asDecimal(2.1),
      householdUnit: null,
      unitsPerServing: null,
      householdServingText: '1 thin slice (yield after cooking)',
      sourceProvider: 'fatsecret',
      externalId: '1517',
      fdcDataType: null,
    }

    // FatSecret detail for tortilla 3742 returns "1 tortilla (approx 4" dia)" (13g).
    const FATSECRET_TORTILLA_PARENTHETICAL = {
      id: 'fs-3742-detail',
      servingSize: asDecimal(13),
      servingUnit: 'g',
      calories: asDecimal(40),
      proteinG: asDecimal(1.0),
      carbohydrateG: asDecimal(7.5),
      fatG: asDecimal(0.8),
      householdUnit: null,
      unitsPerServing: null,
      householdServingText: '1 tortilla (approx 4" dia)',
      sourceProvider: 'fatsecret',
      externalId: '3742',
      fdcDataType: null,
    }

    it('"1 thin slice (yield after cooking)" with strip → resolves factor = 3 for 3 strips', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON_PARENTHETICAL, 3, 'strip')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(3, 3)
      expect(result.grams).toBeCloseTo(15, 1)
    })

    it('"1 thin slice (yield after cooking)" with slice → resolves factor = 3 for 3 slices', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON_PARENTHETICAL, 3, 'slice')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(3, 3)
    })

    it('"1 thin slice (yield after cooking)" with piece → resolves factor = 1 for 1 piece', async () => {
      const result = await resolveIngredientFactor(FATSECRET_BACON_PARENTHETICAL, 1, 'piece')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
    })

    it('"1 tortilla (approx 4\\" dia)" with piece → resolves factor = 1 for 1 tortilla', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TORTILLA_PARENTHETICAL, 1, 'piece')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
      expect(result.grams).toBeCloseTo(13, 1)
    })

    it('"1 tortilla (approx 4\\" dia)" with tortilla → resolves factor = 1', async () => {
      const result = await resolveIngredientFactor(FATSECRET_TORTILLA_PARENTHETICAL, 1, 'tortilla')
      expect(isConversionError(result)).toBe(false)
      if (isConversionError(result)) return
      expect(result.factor).toBeCloseTo(1, 3)
    })

    it('"1 serving (cooked)" must NOT resolve — "serving" is blacklisted even with parenthetical', async () => {
      const food = {
        ...FATSECRET_BACON_PARENTHETICAL,
        householdServingText: '1 serving (cooked)',
      }
      const result = await resolveIngredientFactor(food, 1, 'piece')
      expect(isConversionError(result)).toBe(true)
      if (!isConversionError(result)) return
      expect(result.errorCode).toBe('portion_not_found')
    })
  })
})
