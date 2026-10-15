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

// ── Helper: build a minimal FoodForConversion ────────────────────────────────

function makeFood(overrides: {
  servingSize?: number
  servingUnit?: string
  calories?: number
  proteinG?: number
  carbohydrateG?: number
  fatG?: number
  householdUnit?: string | null
  unitsPerServing?: number | null
  sourceProvider?: string | null
  externalId?: string | null
  fdcDataType?: string | null
  name?: string
  portions?: import('../../../lib/nutrition/conversion/portions').StoredPortion[]
} = {}) {
  return {
    id: 'food-id-123',
    servingSize: (overrides.servingSize ?? 100) as unknown as Decimal,
    servingUnit: overrides.servingUnit ?? 'g',
    calories: (overrides.calories ?? 250) as unknown as Decimal,
    proteinG: (overrides.proteinG ?? 20) as unknown as Decimal,
    carbohydrateG: (overrides.carbohydrateG ?? 10) as unknown as Decimal,
    fatG: (overrides.fatG ?? 15) as unknown as Decimal,
    householdUnit: overrides.householdUnit ?? null,
    unitsPerServing: overrides.unitsPerServing != null
      ? (overrides.unitsPerServing as unknown as Decimal)
      : null,
    sourceProvider: overrides.sourceProvider ?? null,
    externalId: overrides.externalId ?? null,
    fdcDataType: overrides.fdcDataType ?? null,
    name: overrides.name,
    portions: overrides.portions,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lookupPortions).mockResolvedValue([])
  vi.mocked(fetchAndStoreUsdaPortions).mockResolvedValue([])
})

// ── Weight conversions ───────────────────────────────────────────────────────

describe('weight conversions', () => {
  it('3 lb tri-tip (100g basis) → grams≈1360.776, factor≈13.608', async () => {
    const food = makeFood({ name: 'Beef, tri-tip, raw', servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 3, 'lb')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.grams).toBeCloseTo(1360.776, 1)
    expect(result.factor).toBeCloseTo(13.60776, 3)
    expect(result.conversionSource).toBe('same_unit')
    expect(result.confidence).toBe('high')
  })

  it('8 oz dry pasta (100g basis) → grams≈226.796, factor≈2.268', async () => {
    const food = makeFood({ name: 'Pasta, dry', servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 8, 'oz')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.grams).toBeCloseTo(226.796, 1)
    expect(result.factor).toBeCloseTo(2.26796, 3)
    expect(result.conversionSource).toBe('same_unit')
  })

  it('8 oz food with "cooked" in name → includes raw weight warning note', async () => {
    const food = makeFood({ name: 'Beef, cooked, ground', servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 8, 'oz')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.notes.some(n => /cooked/i.test(n))).toBe(true)
  })

  it('8 oz food without "cooked" in name → no cooked warning', async () => {
    const food = makeFood({ name: 'Chicken breast, raw', servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 8, 'oz')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.notes.some(n => /cooked/i.test(n))).toBe(false)
  })

  it('100g → factor 1.0', async () => {
    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 100, 'g')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(1.0, 5)
    expect(result.grams).toBeCloseTo(100, 5)
  })

  it('50g on 100g-basis food → factor 0.5', async () => {
    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 50, 'g')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(0.5, 5)
  })

  it('1 lb beef (100g basis) → factor≈4.536', async () => {
    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 1, 'lb')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(453.592 / 100, 3)
  })
})

// ── Volume conversions ───────────────────────────────────────────────────────

describe('volume conversions', () => {
  it('1 tbsp olive oil (ml-basis: servingSize=13.5ml) → factor≈1.096', async () => {
    const food = makeFood({ servingSize: 13.5, servingUnit: 'ml' })
    const result = await resolveIngredientFactor(food, 1, 'tbsp')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    // 1 tbsp = 14.7868 ml; factor = 14.7868 / 13.5
    expect(result.factor).toBeCloseTo(14.7868 / 13.5, 3)
    expect(result.conversionSource).toBe('same_unit')
  })

  it('1 cup milk (ml-basis: servingSize=240ml) → factor≈0.986', async () => {
    const food = makeFood({ servingSize: 240, servingUnit: 'ml' })
    const result = await resolveIngredientFactor(food, 1, 'cup')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    // 1 cup = 236.588 ml; factor = 236.588 / 240
    expect(result.factor).toBeCloseTo(236.588 / 240, 3)
    expect(result.conversionSource).toBe('same_unit')
  })

  it('1 tsp oil (ml-basis) → factor via ml path', async () => {
    const food = makeFood({ servingSize: 5, servingUnit: 'ml' })
    const result = await resolveIngredientFactor(food, 1, 'tsp')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(4.92892 / 5, 3)
  })

  it('240ml on 240ml-basis food → factor 1.0', async () => {
    const food = makeFood({ servingSize: 240, servingUnit: 'ml' })
    const result = await resolveIngredientFactor(food, 240, 'ml')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(1.0, 5)
  })
})

// ── Serving aliases ──────────────────────────────────────────────────────────

describe('serving aliases', () => {
  it('1 serving → factor 1', async () => {
    const food = makeFood()
    const result = await resolveIngredientFactor(food, 1, 'serving')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(1.0, 5)
    expect(result.conversionSource).toBe('same_unit')
  })

  it('2 servings → factor 2', async () => {
    const food = makeFood()
    const result = await resolveIngredientFactor(food, 2, 'servings')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(2.0, 5)
  })

  it('1 portion → factor 1', async () => {
    const food = makeFood()
    const result = await resolveIngredientFactor(food, 1, 'portion')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(1.0, 5)
  })

  it('3 portions → factor 3', async () => {
    const food = makeFood()
    const result = await resolveIngredientFactor(food, 3, 'portions')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(3.0, 5)
  })
})

// ── Household unit (via FoodItem.householdUnit/unitsPerServing) ──────────────

describe('household unit via FoodItem', () => {
  it('3 eggs: householdUnit=large egg, unitsPerServing=1, servingSize=50g → grams=150, factor=3', async () => {
    const food = makeFood({
      servingSize: 50,
      servingUnit: 'g',
      householdUnit: 'large egg',
      unitsPerServing: 1,
    })
    const result = await resolveIngredientFactor(food, 3, 'large egg')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.grams).toBeCloseTo(150, 3)
    expect(result.factor).toBeCloseTo(3.0, 5)
    expect(result.conversionSource).toBe('manufacturer_declared')
    expect(result.confidence).toBe('high')
  })

  it('1 egg → factor=1', async () => {
    const food = makeFood({
      servingSize: 50,
      servingUnit: 'g',
      householdUnit: 'large egg',
      unitsPerServing: 1,
    })
    const result = await resolveIngredientFactor(food, 1, 'large egg')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(1.0, 5)
  })
})

// ── FoodItemPortion lookup (mock DB) ─────────────────────────────────────────

describe('FoodItemPortion lookup', () => {
  it('1 clove garlic: DB returns 1 clove=3g, food 100g-basis → factor=0.03', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([
      {
        id: 'p1',
        portionDescription: '1 clove',
        quantity: 1,
        unit: 'clove',
        gramWeight: 3,
        fdcPortionId: 100,
        sourceConfidence: 'usda_measured',
        preparationState: null,
      },
    ])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 1, 'clove')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(0.03, 5)
    expect(result.conversionSource).toBe('usda_measured')
    expect(result.confidence).toBe('high')
  })

  it('2 cloves garlic → factor=0.06', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([
      {
        id: 'p1',
        portionDescription: '1 clove',
        quantity: 1,
        unit: 'clove',
        gramWeight: 3,
        fdcPortionId: 100,
        sourceConfidence: 'usda_measured',
        preparationState: null,
      },
    ])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 2, 'clove')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(0.06, 5)
  })

  it('1 cup rolled oats: DB returns 1 cup=81g, food 100g-basis → factor=0.81', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([
      {
        id: 'p2',
        portionDescription: '1 cup',
        quantity: 1,
        unit: 'cup',
        gramWeight: 81,
        fdcPortionId: 200,
        sourceConfidence: 'usda_measured',
        preparationState: null,
      },
    ])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 1, 'cup')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(0.81, 5)
    expect(result.conversionSource).toBe('usda_measured')
  })

  it('pre-fetched portions (food.portions) bypass lookupPortions call', async () => {
    const food = makeFood({
      servingSize: 100,
      servingUnit: 'g',
      portions: [
        {
          id: 'p1',
          portionDescription: '1 clove',
          quantity: 1,
          unit: 'clove',
          gramWeight: 3,
          fdcPortionId: 100,
          sourceConfidence: 'usda_measured',
          preparationState: null,
        },
      ],
    })

    const result = await resolveIngredientFactor(food, 1, 'clove')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(0.03, 5)
    // lookupPortions should NOT have been called since portions are pre-fetched
    expect(lookupPortions).not.toHaveBeenCalled()
  })
})

// ── Ambiguous preparation state ──────────────────────────────────────────────

describe('ambiguous preparation state', () => {
  it('two portions with different prepStates, no opts.preparationState → ConversionError(ambiguous_preparation)', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([
      {
        id: 'p1',
        portionDescription: '1 cup raw',
        quantity: 1,
        unit: 'cup',
        gramWeight: 100,
        fdcPortionId: 300,
        sourceConfidence: 'usda_measured',
        preparationState: 'raw',
      },
      {
        id: 'p2',
        portionDescription: '1 cup cooked',
        quantity: 1,
        unit: 'cup',
        gramWeight: 165,
        fdcPortionId: 301,
        sourceConfidence: 'usda_measured',
        preparationState: 'cooked',
      },
    ])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 1, 'cup')
    expect(isConversionError(result)).toBe(true)
    if (!isConversionError(result)) return

    expect(result.errorCode).toBe('ambiguous_preparation')
    expect(result.suggestions).toBeDefined()
    expect(result.suggestions!.some(s => s.includes('raw'))).toBe(true)
    expect(result.suggestions!.some(s => s.includes('cooked'))).toBe(true)
  })

  it('two portions with different prepStates, opts.preparationState=raw → resolves to raw', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([
      {
        id: 'p1',
        portionDescription: '1 cup raw',
        quantity: 1,
        unit: 'cup',
        gramWeight: 100,
        fdcPortionId: 300,
        sourceConfidence: 'usda_measured',
        preparationState: 'raw',
      },
    ])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 1, 'cup', { preparationState: 'raw' })
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(1.0, 5)
    expect(result.preparationState).toBe('raw')
  })

  it('single portion with prepState=null → resolves automatically', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([
      {
        id: 'p1',
        portionDescription: '1 cup',
        quantity: 1,
        unit: 'cup',
        gramWeight: 90,
        fdcPortionId: 302,
        sourceConfidence: 'usda_measured',
        preparationState: null,
      },
    ])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 1, 'cup')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(0.9, 5)
  })

  it('single portion with non-null prepState → resolves automatically (no ambiguity)', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([
      {
        id: 'p1',
        portionDescription: '1 cup cooked',
        quantity: 1,
        unit: 'cup',
        gramWeight: 165,
        fdcPortionId: 303,
        sourceConfidence: 'usda_measured',
        preparationState: 'cooked',
      },
    ])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 1, 'cup')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(1.65, 3)
    expect(result.preparationState).toBe('cooked')
  })
})

// ── Error cases ──────────────────────────────────────────────────────────────

describe('error cases', () => {
  it('cup unit on gram-basis food, no DB portions → ConversionError(unit_incompatible)', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 1, 'cup')
    expect(isConversionError(result)).toBe(true)
    if (!isConversionError(result)) return

    expect(result.errorCode).toBe('unit_incompatible')
  })

  it('"handful" unit → ConversionError(unit_unknown)', async () => {
    const food = makeFood()
    const result = await resolveIngredientFactor(food, 1, 'handful')
    expect(isConversionError(result)).toBe(true)
    if (!isConversionError(result)) return

    expect(result.errorCode).toBe('unit_unknown')
  })

  it('"pinch" unit → ConversionError(unit_unknown)', async () => {
    const food = makeFood()
    const result = await resolveIngredientFactor(food, 1, 'pinch')
    expect(isConversionError(result)).toBe(true)
    if (!isConversionError(result)) return

    expect(result.errorCode).toBe('unit_unknown')
  })

  it('"clove" unit, no DB portions, food is NOT USDA → ConversionError(portion_not_found)', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([])
    // Non-USDA food
    const food = makeFood({ sourceProvider: 'manual', externalId: null, fdcDataType: null })
    const result = await resolveIngredientFactor(food, 1, 'clove')
    expect(isConversionError(result)).toBe(true)
    if (!isConversionError(result)) return

    expect(result.errorCode).toBe('portion_not_found')
  })

  it('quantity=0 → ConversionError', async () => {
    const food = makeFood()
    const result = await resolveIngredientFactor(food, 0, 'g')
    expect(isConversionError(result)).toBe(true)
  })
})

// ── CHECK 1 supplement: same-unit step 1 (non-gram/ml serving unit) ─────────

describe('same-unit step 1 (non-gram/ml servingUnit)', () => {
  it('1 tbsp hot sauce: servingUnit=tbsp, servingSize=3 → factor=1/3≈0.333', async () => {
    // Step 1: fu='tbsp', iu='tbsp' → same unit → factor = quantity / servingSize
    const food = makeFood({ servingSize: 3, servingUnit: 'tbsp' })
    const result = await resolveIngredientFactor(food, 1, 'tbsp')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(1 / 3, 5)
    expect(result.conversionSource).toBe('same_unit')
    expect(result.confidence).toBe('high')
  })

  it('3 tbsp hot sauce: servingUnit=tbsp, servingSize=3 → factor=1.0', async () => {
    const food = makeFood({ servingSize: 3, servingUnit: 'tbsp' })
    const result = await resolveIngredientFactor(food, 3, 'tbsp')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(1.0, 5)
  })

  it('1 cup juice: servingUnit=ml, servingSize=59.15 → step 4, factor≈4.0', async () => {
    // 59.15 ml = 0.25 cup; entering 1 cup should produce factor = 236.588 / 59.15 ≈ 4.0
    const food = makeFood({ servingSize: 59.15, servingUnit: 'ml' })
    const result = await resolveIngredientFactor(food, 1, 'cup')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    // 1 cup = 236.588 ml → factor = 236.588 / 59.15
    expect(result.factor).toBeCloseTo(236.588 / 59.15, 3)
    expect(result.conversionSource).toBe('same_unit')
  })
})

// ── CHECK 2 supplement: portion quantity != 1 ────────────────────────────────

describe('FoodItemPortion — quantity != 1', () => {
  it('portion {quantity:2, unit:tbsp, gramWeight:14}: entering 1 tbsp → grams=7', async () => {
    // gramsPerUnit = 14/2 = 7; grams = 7 * 1 = 7; factor = 7/100 = 0.07
    vi.mocked(lookupPortions).mockResolvedValue([
      {
        id: 'pq2',
        portionDescription: '2 tbsp',
        quantity: 2,
        unit: 'tbsp',
        gramWeight: 14,
        fdcPortionId: 400,
        sourceConfidence: 'usda_measured',
        preparationState: null,
      },
    ])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 1, 'tbsp')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.grams).toBeCloseTo(7, 5)
    expect(result.factor).toBeCloseTo(0.07, 5)
    expect(result.conversionSource).toBe('usda_measured')
  })

  it('portion {quantity:3, unit:clove, gramWeight:9}: entering 2 cloves → grams=6, factor=0.06', async () => {
    // gramsPerUnit = 9/3 = 3; grams = 3 * 2 = 6; factor = 6/100 = 0.06
    vi.mocked(lookupPortions).mockResolvedValue([
      {
        id: 'pq3',
        portionDescription: '3 cloves',
        quantity: 3,
        unit: 'clove',
        gramWeight: 9,
        fdcPortionId: 401,
        sourceConfidence: 'usda_measured',
        preparationState: null,
      },
    ])

    const food = makeFood({ servingSize: 100, servingUnit: 'g' })
    const result = await resolveIngredientFactor(food, 2, 'clove')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.grams).toBeCloseTo(6, 5)
    expect(result.factor).toBeCloseTo(0.06, 5)
  })
})

// ── CHECK 3 supplement: oz-basis food cross-unit errors ──────────────────────

describe('oz-basis food — unit_incompatible for cross-weight conversion', () => {
  it('oz-basis food (servingUnit=oz, servingSize=1.5): entering 3 oz → factor=2.0 (same-unit step 1)', async () => {
    const food = makeFood({ servingSize: 1.5, servingUnit: 'oz' })
    const result = await resolveIngredientFactor(food, 3, 'oz')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(2.0, 5)
    expect(result.conversionSource).toBe('same_unit')
  })

  it('oz-basis food: entering g → ConversionError(unit_incompatible) not unit_unknown', async () => {
    // g IS a known unit but incompatible with oz-basis food (no cross-weight conversion)
    vi.mocked(lookupPortions).mockResolvedValue([])
    const food = makeFood({ servingSize: 1.5, servingUnit: 'oz' })
    const result = await resolveIngredientFactor(food, 100, 'g')
    expect(isConversionError(result)).toBe(true)
    if (!isConversionError(result)) return

    expect(result.errorCode).toBe('unit_incompatible')
    // Must NOT be unit_unknown — 'g' is a recognized unit
    expect(result.errorCode).not.toBe('unit_unknown')
  })

  it('oz-basis food: entering cup → ConversionError(unit_incompatible)', async () => {
    vi.mocked(lookupPortions).mockResolvedValue([])
    const food = makeFood({ servingSize: 1.5, servingUnit: 'oz' })
    const result = await resolveIngredientFactor(food, 1, 'cup')
    expect(isConversionError(result)).toBe(true)
    if (!isConversionError(result)) return

    expect(result.errorCode).toBe('unit_incompatible')
  })
})

// ── Tri-taco compound test ───────────────────────────────────────────────────

describe('tri-taco compound test', () => {
  it('3 lb beef (100g basis, 250 kcal/100g) → factor≈13.608; per-taco calories with 12 servings', async () => {
    const food = makeFood({
      servingSize: 100,
      servingUnit: 'g',
      calories: 250,
      proteinG: 26,
      carbohydrateG: 0,
      fatG: 15,
      name: 'Beef, tri-tip, raw',
    })

    const result = await resolveIngredientFactor(food, 3, 'lb')
    expect(isConversionError(result)).toBe(false)
    if (isConversionError(result)) return

    expect(result.factor).toBeCloseTo(3 * 453.592 / 100, 3)
    expect(result.grams).toBeCloseTo(1360.776, 1)

    // Total calories = 250 × factor
    const totalCalories = 250 * result.factor
    expect(totalCalories).toBeCloseTo(3401.94, 0)

    // Per taco (12 servings)
    const perTaco = totalCalories / 12
    expect(perTaco).toBeCloseTo(283.5, 0)
  })
})
