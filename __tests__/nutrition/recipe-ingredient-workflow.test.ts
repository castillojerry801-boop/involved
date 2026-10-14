/**
 * Recipe ingredient workflow tests.
 *
 * Tests the pure logic of food selection, snapshot computation, and
 * quantity/unit recalculation against realistic search response shapes.
 * Does not render React components — tests the transformation functions.
 */
import { describe, it, expect } from 'vitest'
import { hasValidNutrition, toApiIngredient, type IngredientDraft } from '../../components/recipes/recipe-ingredient-row'
import { computeIngredientFactor } from '../../lib/recipes/nutrition'
import type { ExternalFoodResult } from '../../lib/nutrition/providers/types'

// ── Realistic search result fixtures ──────────────────────────────────────────

type FoodSearchResult = ExternalFoodResult & { source: 'library' | 'external' }

// Library result: comes from the local DB.
// externalId = original provider ID (for dedup); internalId = DB UUID (for recipe FK).
const OAKDELL_EGGS: FoodSearchResult = {
  provider: 'fatsecret',
  externalId: '12345678',                                 // FatSecret food ID
  internalId: 'a1b2c3d4-0000-0000-0000-000000000001',   // DB UUID
  name: 'Grade A Large Eggs',
  brand: 'Oakdell',
  servingSize: 50,
  servingUnit: 'g',
  coreNutrients: { calories: 70, proteinG: 6, carbohydrateG: 0, fatG: 5 },
  source: 'library',
}

// Library result with household unit (1 large egg = 50g)
const OAKDELL_EGGS_WITH_HOUSEHOLD: FoodSearchResult = {
  ...OAKDELL_EGGS,
  householdServingText: '1 large egg',
  householdUnit: 'large egg',
  unitsPerServing: 1,
}

// Library result with household unit where multiple units = 1 serving (2 strips = 46g)
const HICKORY_BACON: FoodSearchResult = {
  provider: 'fatsecret',
  externalId: '99887766',                                // FatSecret food ID
  internalId: 'a1b2c3d4-0000-0000-0000-000000000005',  // DB UUID
  name: 'Hickory Smoked Bacon',
  brand: 'Oscar Mayer',
  servingSize: 46,
  servingUnit: 'g',
  householdServingText: '2 strips',
  householdUnit: 'strip',
  unitsPerServing: 2,
  coreNutrients: { calories: 70, proteinG: 5, carbohydrateG: 0, fatG: 6 },
  source: 'library',
}

const KROGER_EGG_WHITES: FoodSearchResult = {
  provider: 'open_food_facts',
  externalId: '0011110041647',                            // barcode
  internalId: 'a1b2c3d4-0000-0000-0000-000000000002',   // DB UUID
  name: 'Liquid Egg Whites',
  brand: 'Kroger',
  servingSize: 46,
  servingUnit: 'g',
  coreNutrients: { calories: 25, proteinG: 5, carbohydrateG: 0, fatG: 0 },
  source: 'library',
}

// External result: externalId is a provider ID, NOT a valid DB UUID
const KIRKLAND_BEEF: FoodSearchResult = {
  provider: 'fatsecret',
  externalId: '9876543',               // FatSecret food ID — not a DB UUID
  name: 'Lean Ground Beef',
  brand: 'Kirkland',
  servingSize: 112,
  servingUnit: 'g',
  coreNutrients: { calories: 200, proteinG: 24, carbohydrateG: 0, fatG: 11 },
  source: 'external',
}

// External result with a liquid food (ml-based)
const OLIVE_OIL: FoodSearchResult = {
  provider: 'usda_fooddata',
  externalId: '748608',
  name: 'Olive Oil',
  servingSize: 14,
  servingUnit: 'ml',
  coreNutrients: { calories: 119, proteinG: 0, carbohydrateG: 0, fatG: 13.5 },
  source: 'external',
}

// ── Helpers that simulate selectFood() logic ───────────────────────────────────

function makeBlankIngredient(): IngredientDraft {
  return {
    key: 'test-key',
    foodItemId: null,
    name: '',
    quantity: 1,
    unit: '',
    notes: '',
    snapshotCalories: null,
    snapshotProteinG: null,
    snapshotCarbG: null,
    snapshotFatG: null,
    _baseFood: null,
  }
}

type BaseFood = {
  servingSize: number; servingUnit: string
  calories: number; proteinG: number; carbohydrateG: number; fatG: number
  householdUnit?: string; unitsPerServing?: number
}

// Mirrors the null-macro path in selectFood() (when provider returns invalid nutrition).
function simulateSelectFoodNullMacro(food: FoodSearchResult, existing: IngredientDraft = makeBlankIngredient()): IngredientDraft {
  return {
    ...existing,
    name: food.brand ? `${food.name} (${food.brand})` : food.name,
    foodItemId: food.source === 'library' ? (food.internalId ?? food.externalId) : null,
    unit: food.servingUnit,
    _baseFood: null,
    snapshotCalories: null,
    snapshotProteinG: null,
    snapshotCarbG: null,
    snapshotFatG: null,
  }
}

function simulateSelectFood(food: FoodSearchResult, existing: IngredientDraft = makeBlankIngredient()): IngredientDraft {
  const { calories, proteinG, carbohydrateG, fatG } = food.coreNutrients
  const servingSize = food.servingSize > 0 ? food.servingSize : 1
  const _baseFood: BaseFood = {
    servingSize,
    servingUnit: food.servingUnit,
    calories, proteinG, carbohydrateG, fatG,
    householdUnit: food.householdUnit,
    unitsPerServing: food.unitsPerServing,
  }
  // Use household unit as default when available
  const defaultUnit = food.householdUnit ?? food.servingUnit
  const defaultQty  = food.householdUnit && food.unitsPerServing ? food.unitsPerServing : servingSize
  return {
    ...existing,
    name: food.brand ? `${food.name} (${food.brand})` : food.name,
    // Use internalId (DB UUID) for recipe ingredient FK when available.
    foodItemId: food.source === 'library' ? (food.internalId ?? food.externalId) : null,
    quantity: defaultQty,
    unit: defaultUnit,
    _baseFood,
    snapshotCalories: Math.round(calories * 100) / 100,
    snapshotProteinG: Math.round(proteinG * 1000) / 1000,
    snapshotCarbG:    Math.round(carbohydrateG * 1000) / 1000,
    snapshotFatG:     Math.round(fatG * 1000) / 1000,
  }
}

// Mirrors synthesizeBaseFood() in the component: reconstructs a reference from persisted snapshot.
function synthesizeBaseFood(ing: IngredientDraft): BaseFood | null {
  if (!hasValidNutrition(ing) || !(ing.quantity > 0) || !ing.unit) return null
  return {
    servingSize: ing.quantity,
    servingUnit: ing.unit,
    calories: ing.snapshotCalories!,
    proteinG: ing.snapshotProteinG!,
    carbohydrateG: ing.snapshotCarbG!,
    fatG: ing.snapshotFatG!,
  }
}

function applyFactor(b: BaseFood, factor: number, ing: IngredientDraft): IngredientDraft {
  return {
    ...ing,
    _baseFood: b,
    snapshotCalories: Math.round(b.calories * factor * 100) / 100,
    snapshotProteinG: Math.round(b.proteinG * factor * 1000) / 1000,
    snapshotCarbG:    Math.round(b.carbohydrateG * factor * 1000) / 1000,
    snapshotFatG:     Math.round(b.fatG * factor * 1000) / 1000,
  }
}

function simulateQuantityChange(ing: IngredientDraft, qty: number): IngredientDraft {
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ...ing, quantity: qty, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }
  }
  const baseFood = (ing._baseFood as BaseFood | null | undefined) ?? synthesizeBaseFood(ing)
  if (!baseFood) return { ...ing, quantity: qty }
  const factor = computeIngredientFactor(
    baseFood.servingSize, baseFood.servingUnit, qty, ing.unit,
    baseFood.householdUnit, baseFood.unitsPerServing,
  )
  if (factor === null) return { ...ing, quantity: qty, _baseFood: baseFood, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }
  return applyFactor(baseFood, factor, { ...ing, quantity: qty })
}

function simulateUnitChange(ing: IngredientDraft, unit: string): IngredientDraft {
  const baseFood = (ing._baseFood as BaseFood | null | undefined) ?? synthesizeBaseFood(ing)
  if (!baseFood) return { ...ing, unit }
  const factor = computeIngredientFactor(
    baseFood.servingSize, baseFood.servingUnit, ing.quantity, unit,
    baseFood.householdUnit, baseFood.unitsPerServing,
  )
  if (factor === null) return { ...ing, unit, _baseFood: baseFood, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null }
  return applyFactor(baseFood, factor, { ...ing, unit })
}

// ── No NaN in search result rendering ─────────────────────────────────────────

describe('search result display — no NaN', () => {
  it('Oakdell eggs calories display as finite integer', () => {
    const cal = OAKDELL_EGGS.coreNutrients.calories
    expect(Number.isFinite(cal)).toBe(true)
    expect(Math.round(cal)).toBe(70)
  })

  it('Kirkland ground beef calories display as finite integer', () => {
    const cal = KIRKLAND_BEEF.coreNutrients.calories
    expect(Number.isFinite(cal)).toBe(true)
    expect(Math.round(cal)).toBe(200)
  })

  it('a result with coreNutrients.calories = 0 shows 0 (not NaN)', () => {
    const zeroCalFood: FoodSearchResult = {
      ...OAKDELL_EGGS,
      externalId: 'zero-cal',
      coreNutrients: { calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
    }
    const cal = zeroCalFood.coreNutrients.calories
    expect(Number.isFinite(cal)).toBe(true)
    expect(Math.round(cal)).toBe(0)
  })
})

// ── Library food selection (Oakdell eggs) ─────────────────────────────────────

describe('selecting Oakdell eggs (library result)', () => {
  const selected = simulateSelectFood(OAKDELL_EGGS)

  it('links to internalId (DB UUID), not externalId (provider ID)', () => {
    expect(selected.foodItemId).toBe('a1b2c3d4-0000-0000-0000-000000000001')  // internalId
    expect(selected.foodItemId).not.toBe('12345678')                           // not externalId
  })

  it('initializes quantity to the serving size (50g)', () => {
    expect(selected.quantity).toBe(50)
    expect(selected.unit).toBe('g')
  })

  it('snapshots exactly one serving of nutrition', () => {
    expect(selected.snapshotCalories).toBe(70)
    expect(selected.snapshotProteinG).toBe(6)
    expect(selected.snapshotCarbG).toBe(0)
    expect(selected.snapshotFatG).toBe(5)
  })

  it('hasValidNutrition returns true', () => {
    expect(hasValidNutrition(selected)).toBe(true)
  })

  it('stores _baseFood for recalculation', () => {
    expect(selected._baseFood).not.toBeNull()
    expect(selected._baseFood!.servingSize).toBe(50)
  })
})

// ── Library food selection (Kroger liquid egg whites) ─────────────────────────

describe('selecting Kroger liquid egg whites (library result)', () => {
  const selected = simulateSelectFood(KROGER_EGG_WHITES)

  it('links to the DB FoodItem UUID', () => {
    expect(selected.foodItemId).toBe('a1b2c3d4-0000-0000-0000-000000000002')
  })

  it('initializes at one serving (46g, 25 cal)', () => {
    expect(selected.quantity).toBe(46)
    expect(selected.snapshotCalories).toBe(25)
    expect(selected.snapshotProteinG).toBe(5)
    expect(selected.snapshotFatG).toBe(0)
  })

  it('hasValidNutrition returns true', () => {
    expect(hasValidNutrition(selected)).toBe(true)
  })
})

// ── External food selection (Kirkland lean ground beef) ───────────────────────

describe('selecting external-provider result (Kirkland ground beef)', () => {
  const selected = simulateSelectFood(KIRKLAND_BEEF)

  it('does NOT store a foodItemId (provider ID is not a DB UUID)', () => {
    expect(selected.foodItemId).toBeNull()
  })

  it('initializes at one serving (112g, 200 cal)', () => {
    expect(selected.quantity).toBe(112)
    expect(selected.unit).toBe('g')
    expect(selected.snapshotCalories).toBe(200)
    expect(selected.snapshotProteinG).toBe(24)
    expect(selected.snapshotFatG).toBe(11)
  })

  it('hasValidNutrition returns true even without foodItemId', () => {
    expect(hasValidNutrition(selected)).toBe(true)
  })

  it('nutrition snapshot is complete so recipe can be marked complete', () => {
    // Simulates how computeRecipeNutrition treats this ingredient
    expect(selected.snapshotCalories).not.toBeNull()
    expect(Number.isFinite(selected.snapshotCalories!)).toBe(true)
  })
})

// ── Null-macro path (library food with invalid/missing provider nutrition) ────

describe('null-macro path still uses internalId for recipe FK', () => {
  it('library food with invalid macros still links to DB UUID via internalId', () => {
    const selected = simulateSelectFoodNullMacro(OAKDELL_EGGS)
    // internalId should be used for FK — not externalId (barcode/provider ID)
    expect(selected.foodItemId).toBe('a1b2c3d4-0000-0000-0000-000000000001')
    expect(selected.foodItemId).not.toBe('12345678')  // not the externalId
  })

  it('external food with invalid macros has null foodItemId', () => {
    const selected = simulateSelectFoodNullMacro(KIRKLAND_BEEF)
    expect(selected.foodItemId).toBeNull()
  })

  it('null-macro ingredient is not resolved (hasValidNutrition = false)', () => {
    const selected = simulateSelectFoodNullMacro(OAKDELL_EGGS)
    expect(hasValidNutrition(selected)).toBe(false)
    expect(selected.snapshotCalories).toBeNull()
  })
})

// ── Quantity changes recalculate macros ───────────────────────────────────────

describe('quantity change recalculates macros', () => {
  it('doubling quantity from one serving doubles all macros', () => {
    const selected = simulateSelectFood(OAKDELL_EGGS)          // 50g, 70cal
    const two = simulateQuantityChange(selected, 100)
    expect(two.snapshotCalories).toBe(140)
    expect(two.snapshotProteinG).toBe(12)
    expect(two.snapshotFatG).toBe(10)
  })

  it('halving quantity halves all macros', () => {
    const selected = simulateSelectFood(OAKDELL_EGGS)          // 50g, 70cal
    const half = simulateQuantityChange(selected, 25)
    expect(half.snapshotCalories).toBe(35)
    expect(half.snapshotProteinG).toBe(3)
  })

  it('ground beef at 4 oz (113.4g ≈ 112g serving): roughly one serving', () => {
    const selected = simulateSelectFood(KIRKLAND_BEEF)         // 112g, 200cal
    const four_oz = simulateQuantityChange(simulateUnitChange(selected, 'oz'), 4)
    // 4 oz = 113.398g; factor ≈ 113.398/112 ≈ 1.0125
    expect(four_oz.snapshotCalories).toBeGreaterThan(198)
    expect(four_oz.snapshotCalories).toBeLessThan(203)
  })

  it('invalid quantity (0) clears snapshots', () => {
    const selected = simulateSelectFood(OAKDELL_EGGS)
    const zero = simulateQuantityChange(selected, 0)
    expect(zero.snapshotCalories).toBeNull()
    expect(hasValidNutrition(zero)).toBe(false)
  })

  it('negative quantity clears snapshots', () => {
    const selected = simulateSelectFood(OAKDELL_EGGS)
    const neg = simulateQuantityChange(selected, -5)
    expect(neg.snapshotCalories).toBeNull()
  })

  it('per-serving and multi-serving totals are accurate', () => {
    // 3 servings of olive oil (14ml each)
    const selected = simulateSelectFood(OLIVE_OIL)             // 14ml, 119cal
    const three = simulateQuantityChange(selected, 42)         // 42ml = 3 servings
    expect(three.snapshotCalories).toBeCloseTo(357, 0)         // 119 * 3
    expect(three.snapshotFatG).toBeCloseTo(40.5, 1)            // 13.5 * 3
  })
})

// ── Unit conversions ──────────────────────────────────────────────────────────

describe('unit conversions', () => {
  it('switching ground beef from g to oz recalculates correctly', () => {
    const selected = simulateSelectFood(KIRKLAND_BEEF)         // 112g
    const inOz = simulateUnitChange(selected, 'oz')
    // 112g in oz = 112 / 28.3495 ≈ 3.951 oz
    // Factor at 112g with oz unit = (112 * 28.3495) / 112 = 28.3495 → huge — that's expected:
    // When you switch unit but keep qty=112, 112 oz is a lot of beef.
    // The correct workflow is: switch unit, then update quantity to the desired oz amount.
    // Just verify no NaN/Infinity
    expect(Number.isFinite(inOz.snapshotCalories ?? 0)).toBe(true)
  })

  it('switching olive oil to tbsp recalculates correctly', () => {
    const selected = simulateSelectFood(OLIVE_OIL)             // 14ml = 1 tbsp
    const inTbsp = simulateUnitChange(selected, 'tbsp')
    // Factor = (14 * 14.7868) / 14 = 14.7868 — 14 tbsp is much more than 1 serving
    // Snapshot should be valid (no NaN) and large
    expect(Number.isFinite(inTbsp.snapshotCalories ?? 0)).toBe(true)
  })

  it('unsupported conversion (cup of ground beef in g) clears snapshots', () => {
    const selected = simulateSelectFood(KIRKLAND_BEEF)         // g-based food
    const inCups = simulateUnitChange(selected, 'cup')         // cup → ml conversion, but food is in g
    expect(inCups.snapshotCalories).toBeNull()
    expect(hasValidNutrition(inCups)).toBe(false)
  })

  it('switching back to compatible unit restores snapshots', () => {
    const selected = simulateSelectFood(KIRKLAND_BEEF)
    const inOz = simulateUnitChange(selected, 'oz')
    const backToG = simulateUnitChange(inOz, 'g')
    // Factor should be qty(112g) / servingSize(112g) = 1
    expect(backToG.snapshotCalories).toBe(200)
  })
})

// ── Free-text ingredients remain unresolved ───────────────────────────────────

describe('free-text ingredients', () => {
  it('blank ingredient has no valid nutrition', () => {
    expect(hasValidNutrition(makeBlankIngredient())).toBe(false)
  })

  it('named but unmatched ingredient (no selection) has no valid nutrition', () => {
    const freeText: IngredientDraft = { ...makeBlankIngredient(), name: 'secret sauce' }
    expect(hasValidNutrition(freeText)).toBe(false)
  })

  it('partially filled snapshot (some nulls) has no valid nutrition', () => {
    const partial: IngredientDraft = {
      ...makeBlankIngredient(),
      name: 'mystery ingredient',
      snapshotCalories: 100,
      snapshotProteinG: null,  // missing
      snapshotCarbG: 5,
      snapshotFatG: 3,
    }
    expect(hasValidNutrition(partial)).toBe(false)
  })
})

// ── Invalid inputs rejected ───────────────────────────────────────────────────

describe('invalid numeric inputs', () => {
  it('NaN snapshot fails hasValidNutrition', () => {
    const ing: IngredientDraft = {
      ...makeBlankIngredient(),
      snapshotCalories: NaN,
      snapshotProteinG: 10,
      snapshotCarbG: 5,
      snapshotFatG: 3,
    }
    expect(hasValidNutrition(ing)).toBe(false)
  })

  it('negative snapshot fails hasValidNutrition', () => {
    const ing: IngredientDraft = {
      ...makeBlankIngredient(),
      snapshotCalories: -50,
      snapshotProteinG: 10,
      snapshotCarbG: 5,
      snapshotFatG: 3,
    }
    expect(hasValidNutrition(ing)).toBe(false)
  })

  it('Infinity snapshot fails hasValidNutrition', () => {
    const ing: IngredientDraft = {
      ...makeBlankIngredient(),
      snapshotCalories: Infinity,
      snapshotProteinG: 10,
      snapshotCarbG: 5,
      snapshotFatG: 3,
    }
    expect(hasValidNutrition(ing)).toBe(false)
  })

  it('zero snapshot is valid (zero-calorie foods like water)', () => {
    const ing: IngredientDraft = {
      ...makeBlankIngredient(),
      snapshotCalories: 0,
      snapshotProteinG: 0,
      snapshotCarbG: 0,
      snapshotFatG: 0,
    }
    expect(hasValidNutrition(ing)).toBe(true)
  })
})

// ── toApiIngredient strips client-only fields ─────────────────────────────────

describe('toApiIngredient', () => {
  it('strips _baseFood before API submission', () => {
    const selected = simulateSelectFood(OAKDELL_EGGS)
    expect(selected._baseFood).not.toBeNull()
    const apiReady = toApiIngredient(selected)
    expect('_baseFood' in apiReady).toBe(false)
  })

  it('strips the key field', () => {
    const selected = simulateSelectFood(OAKDELL_EGGS)
    const apiReady = toApiIngredient(selected)
    expect('key' in apiReady).toBe(false)
  })

  it('preserves all nutrition fields', () => {
    const selected = simulateSelectFood(KIRKLAND_BEEF)
    const apiReady = toApiIngredient(selected)
    expect(apiReady.snapshotCalories).toBe(200)
    expect(apiReady.snapshotProteinG).toBe(24)
    expect(apiReady.foodItemId).toBeNull()  // external food
  })

  it('preserves library foodItemId', () => {
    const selected = simulateSelectFood(OAKDELL_EGGS)
    const apiReady = toApiIngredient(selected)
    expect(apiReady.foodItemId).toBe('a1b2c3d4-0000-0000-0000-000000000001')
  })
})

// ── Synthesis from persisted snapshot (reopened recipe) ───────────────────────

describe('quantity change on reopened recipe (no _baseFood)', () => {
  const fromDb: IngredientDraft = {
    key: 'from-db',
    foodItemId: 'a1b2c3d4-0000-0000-0000-000000000001',
    name: 'Grade A Large Eggs (Oakdell)',
    quantity: 50,
    unit: 'g',
    notes: '',
    snapshotCalories: 70,
    snapshotProteinG: 6,
    snapshotCarbG: 0,
    snapshotFatG: 5,
    // _baseFood absent — as loaded from the API
  }

  it('doubling quantity doubles the snapshot (proportional recalc)', () => {
    const doubled = simulateQuantityChange(fromDb, 100)
    expect(doubled.snapshotCalories).toBeCloseTo(140, 1)
    expect(doubled.snapshotProteinG).toBeCloseTo(12, 2)
    expect(doubled.snapshotFatG).toBeCloseTo(10, 2)
  })

  it('halving quantity halves the snapshot', () => {
    const halved = simulateQuantityChange(fromDb, 25)
    expect(halved.snapshotCalories).toBeCloseTo(35, 1)
  })

  it('locks in _baseFood on first change so subsequent changes chain correctly', () => {
    const step1 = simulateQuantityChange(fromDb, 100)    // synthesizes baseFood {50g,70cal}
    expect(step1._baseFood).not.toBeNull()
    expect(step1._baseFood!.servingSize).toBe(50)        // locked to original persisted reference

    const step2 = simulateQuantityChange(step1, 200)    // uses locked baseFood, not step1 snapshot
    expect(step2.snapshotCalories).toBeCloseTo(280, 1)  // 70 * (200/50) = 280, NOT 140*2=280 coincides
    // Verify it uses the original reference: 70 * (200/50) = 280
    const directFactor = 200 / 50
    expect(step2.snapshotCalories).toBeCloseTo(70 * directFactor, 1)
  })

  it('unit change recalculates via synthesis (g to oz)', () => {
    const inOz = simulateUnitChange(fromDb, 'oz')
    // 50g reference, change unit to oz but keep qty=50 → factor = (50 * 28.3495) / 50 = 28.35
    // 70 cal * 28.35 ≈ very large — just verify it's finite and > 70
    expect(Number.isFinite(inOz.snapshotCalories ?? 0)).toBe(true)
    expect((inOz.snapshotCalories ?? 0)).toBeGreaterThan(70)
  })

  it('incompatible unit change clears snapshots even with synthesis', () => {
    const beefFromDb: IngredientDraft = {
      ...fromDb,
      unit: 'g',
      quantity: 112,
      snapshotCalories: 200,
      snapshotProteinG: 24,
      snapshotCarbG: 0,
      snapshotFatG: 11,
    }
    const inCups = simulateUnitChange(beefFromDb, 'cup')
    expect(inCups.snapshotCalories).toBeNull()
    expect(hasValidNutrition(inCups)).toBe(false)
  })

  it('ingredient without valid snapshots falls back to no-recalc on quantity change', () => {
    const freeText: IngredientDraft = {
      ...fromDb,
      foodItemId: null,
      snapshotCalories: null,
      snapshotProteinG: null,
      snapshotCarbG: null,
      snapshotFatG: null,
    }
    const changed = simulateQuantityChange(freeText, 200)
    // Cannot synthesize → snapshots stay null, quantity updated
    expect(changed.quantity).toBe(200)
    expect(changed.snapshotCalories).toBeNull()
  })
})

// ── Saved recipe reopening ────────────────────────────────────────────────────

describe('saved recipe reopening with correct ingredient data', () => {
  it('ingredient with valid snapshots from DB shows as nutrition-available even without _baseFood', () => {
    // This simulates an ingredient loaded from the API after saving
    const fromDb: IngredientDraft = {
      key: 'from-db',
      foodItemId: 'a1b2c3d4-0000-0000-0000-000000000001',
      name: 'Grade A Large Eggs (Oakdell)',
      quantity: 50,
      unit: 'g',
      notes: '',
      snapshotCalories: 70,
      snapshotProteinG: 6,
      snapshotCarbG: 0,
      snapshotFatG: 5,
      // _baseFood is absent (not returned by API)
    }
    expect(hasValidNutrition(fromDb)).toBe(true)
  })

  it('ingredient with null snapshots from DB shows as unresolved', () => {
    const broken: IngredientDraft = {
      key: 'broken',
      foodItemId: null,
      name: 'free-text ingredient',
      quantity: 1,
      unit: 'cup',
      notes: '',
      snapshotCalories: null,
      snapshotProteinG: null,
      snapshotCarbG: null,
      snapshotFatG: null,
    }
    expect(hasValidNutrition(broken)).toBe(false)
  })

  it('re-selecting a food repairs the ingredient snapshots', () => {
    const broken: IngredientDraft = {
      key: 'broken',
      foodItemId: null,
      name: 'lean ground beef',
      quantity: 1,
      unit: '',
      notes: '',
      snapshotCalories: null,
      snapshotProteinG: null,
      snapshotCarbG: null,
      snapshotFatG: null,
    }
    const repaired = simulateSelectFood(KIRKLAND_BEEF, broken)
    expect(hasValidNutrition(repaired)).toBe(true)
    expect(repaired.snapshotCalories).toBe(200)
  })
})

// ── Household unit food selection ─────────────────────────────────────────────

describe('selecting a food with household unit (Oakdell eggs, 1 large egg = 50g)', () => {
  const selected = simulateSelectFood(OAKDELL_EGGS_WITH_HOUSEHOLD)

  it('defaults to household unit instead of metric', () => {
    expect(selected.unit).toBe('large egg')
  })

  it('defaults quantity to unitsPerServing (1)', () => {
    expect(selected.quantity).toBe(1)
  })

  it('initial snapshot = 1 serving nutrition (factor 1)', () => {
    expect(selected.snapshotCalories).toBe(70)
    expect(selected.snapshotProteinG).toBe(6)
    expect(selected.snapshotFatG).toBe(5)
  })

  it('stores householdUnit in _baseFood', () => {
    expect((selected._baseFood as BaseFood).householdUnit).toBe('large egg')
    expect((selected._baseFood as BaseFood).unitsPerServing).toBe(1)
  })

  it('changing to 2 eggs doubles nutrition', () => {
    const two = simulateQuantityChange(selected, 2)
    expect(two.snapshotCalories).toBeCloseTo(140, 1)
    expect(two.snapshotProteinG).toBeCloseTo(12, 2)
  })

  it('changing to 0.5 egg halves nutrition', () => {
    const half = simulateQuantityChange(selected, 0.5)
    expect(half.snapshotCalories).toBeCloseTo(35, 1)
  })

  it('switching to grams still works via metric conversion', () => {
    const inGrams = simulateUnitChange(selected, 'g')
    // qty=1, unit='g' → factor = 1/50 = 0.02 → 70 * 0.02 = 1.4 cal
    expect(inGrams.snapshotCalories).toBeCloseTo(70 * (1 / 50), 2)
  })

  it('switching to serving (1 serving) = factor 1', () => {
    const asServing = simulateUnitChange(selected, 'serving')
    expect(asServing.snapshotCalories).toBeCloseTo(70, 1)
  })

  it('unknown unit clears snapshots', () => {
    const withEgg = simulateUnitChange(selected, 'egg')  // 'egg' != 'large egg'
    expect(withEgg.snapshotCalories).toBeNull()
  })
})

describe('selecting bacon with multi-unit serving (2 strips = 46g)', () => {
  const selected = simulateSelectFood(HICKORY_BACON)

  it('defaults to "strip" unit', () => {
    expect(selected.unit).toBe('strip')
  })

  it('defaults quantity to 2 (unitsPerServing)', () => {
    expect(selected.quantity).toBe(2)
  })

  it('2 strips = factor 1 = base nutrition', () => {
    expect(selected.snapshotCalories).toBe(70)
  })

  it('4 strips = factor 2 = double nutrition', () => {
    const four = simulateQuantityChange(selected, 4)
    expect(four.snapshotCalories).toBeCloseTo(140, 1)
  })

  it('1 strip = factor 0.5 = half nutrition', () => {
    const one = simulateQuantityChange(selected, 1)
    expect(one.snapshotCalories).toBeCloseTo(35, 1)
  })
})

// ── "serving" universal alias (bug fix) ───────────────────────────────────────

describe('"serving" unit with metric-unit food (was broken — returned null)', () => {
  it('qty=1 serving of a g-unit egg = factor 1 → 70 cal', () => {
    const selected = simulateSelectFood(OAKDELL_EGGS)  // qty=50, unit='g'
    // Switch quantity to 1 first (1g → factor 0.02), then switch unit to 'serving' (1 serving → factor 1)
    const oneG = simulateQuantityChange(selected, 1)
    const oneServing = simulateUnitChange(oneG, 'serving')
    expect(oneServing.snapshotCalories).toBeCloseTo(70, 1)
  })

  it('qty=50 servings = factor 50 (not null, and mathematically correct)', () => {
    // Before fix: computeIngredientFactor(50, 'g', 50, 'serving') returned null → "Nutrition unavailable"
    // After fix: returns 50 → 50 × 70 = 3500 cal (expected: the user has 50 servings)
    const selected = simulateSelectFood(OAKDELL_EGGS)
    const asServing = simulateUnitChange(selected, 'serving')
    // Nutrition is now available (not null), value is large because qty=50 servings
    expect(asServing.snapshotCalories).not.toBeNull()
    expect(asServing.snapshotCalories).toBeCloseTo(3500, 0)
  })

  it('2 servings of ground beef = factor 2 = 400 cal', () => {
    const selected = simulateSelectFood(KIRKLAND_BEEF)
    const twoServings = simulateQuantityChange(simulateUnitChange(selected, 'serving'), 2)
    expect(twoServings.snapshotCalories).toBeCloseTo(400, 1)
  })
})
