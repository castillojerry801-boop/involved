/**
 * computeIngredientFactor — unit tests.
 *
 * Covers:
 *  - Backward-compatible metric conversions (existing behavior unchanged)
 *  - "serving" universal alias fix (works for metric-unit foods)
 *  - Household unit support (eggs, strips, slices)
 *  - Null for incompatible combinations
 */
import { describe, it, expect } from 'vitest'
import { computeIngredientFactor } from '../../lib/recipes/nutrition'

// ── Metric conversions (backward compat) ──────────────────────────────────────

describe('gram conversions', () => {
  it('g → g: direct ratio', () => {
    expect(computeIngredientFactor(100, 'g', 200, 'g')).toBeCloseTo(2)
    expect(computeIngredientFactor(100, 'g', 50, 'g')).toBeCloseTo(0.5)
  })

  it('gram → g aliases', () => {
    expect(computeIngredientFactor(100, 'grams', 200, 'gram')).toBeCloseTo(2)
  })

  it('oz → g: ounce to gram conversion', () => {
    const factor = computeIngredientFactor(100, 'g', 1, 'oz')
    expect(factor).toBeCloseTo(28.3495 / 100, 3)
  })

  it('lb → g: pound to gram conversion', () => {
    const factor = computeIngredientFactor(100, 'g', 1, 'lb')
    expect(factor).toBeCloseTo(453.592 / 100, 2)
  })
})

describe('ml conversions', () => {
  it('ml → ml: direct ratio', () => {
    expect(computeIngredientFactor(240, 'ml', 480, 'ml')).toBeCloseTo(2)
  })

  it('cup → ml', () => {
    const factor = computeIngredientFactor(240, 'ml', 1, 'cup')
    expect(factor).toBeCloseTo(236.588 / 240, 3)
  })

  it('tbsp → ml', () => {
    const factor = computeIngredientFactor(240, 'ml', 1, 'tbsp')
    expect(factor).toBeCloseTo(14.7868 / 240, 4)
  })

  it('tsp → ml', () => {
    const factor = computeIngredientFactor(15, 'ml', 1, 'tsp')
    expect(factor).toBeCloseTo(4.92892 / 15, 4)
  })
})

describe('incompatible unit combinations return null', () => {
  it('cup with gram food → null', () => {
    expect(computeIngredientFactor(100, 'g', 1, 'cup')).toBeNull()
  })

  it('oz with ml food → null', () => {
    expect(computeIngredientFactor(240, 'ml', 2, 'oz')).toBeNull()
  })

  it('servingSize=0 → null', () => {
    expect(computeIngredientFactor(0, 'g', 100, 'g')).toBeNull()
  })

  it('quantity=0 → null', () => {
    expect(computeIngredientFactor(100, 'g', 0, 'g')).toBeNull()
  })
})

// ── Serving alias fix ─────────────────────────────────────────────────────────

describe('"serving" universal alias — works for all food types', () => {
  it('1 serving of a gram-unit food = factor 1 (before fix this returned null)', () => {
    expect(computeIngredientFactor(50, 'g', 1, 'serving')).toBe(1)
  })

  it('2 servings of a gram-unit food = factor 2', () => {
    expect(computeIngredientFactor(50, 'g', 2, 'serving')).toBe(2)
  })

  it('0.5 servings of a gram-unit food = factor 0.5', () => {
    expect(computeIngredientFactor(50, 'g', 0.5, 'serving')).toBe(0.5)
  })

  it('"servings" plural alias works too', () => {
    expect(computeIngredientFactor(50, 'g', 2, 'servings')).toBe(2)
  })

  it('"portion" alias works', () => {
    expect(computeIngredientFactor(240, 'ml', 1, 'portion')).toBe(1)
  })

  it('food stored as servingUnit=serving still works', () => {
    // When a food is already stored as "1 serving", 2 servings → factor 2
    expect(computeIngredientFactor(1, 'serving', 2, 'serving')).toBe(2)
  })
})

// ── Household countable unit support ─────────────────────────────────────────

describe('household unit — eggs (1 large egg = 50g serving)', () => {
  const SERVING_SIZE  = 50
  const SERVING_UNIT  = 'g'
  const HOUSEHOLD     = 'large egg'
  const UNITS_PER_SRV = 1

  it('1 large egg = factor 1 (exactly one serving)', () => {
    expect(computeIngredientFactor(SERVING_SIZE, SERVING_UNIT, 1, 'large egg', HOUSEHOLD, UNITS_PER_SRV)).toBe(1)
  })

  it('2 large eggs = factor 2', () => {
    expect(computeIngredientFactor(SERVING_SIZE, SERVING_UNIT, 2, 'large egg', HOUSEHOLD, UNITS_PER_SRV)).toBe(2)
  })

  it('0.5 large egg = factor 0.5', () => {
    expect(computeIngredientFactor(SERVING_SIZE, SERVING_UNIT, 0.5, 'large egg', HOUSEHOLD, UNITS_PER_SRV)).toBeCloseTo(0.5)
  })

  it('unit mismatch — "egg" ≠ "large egg" → falls through to standard paths', () => {
    // 'egg' is not in any standard set and not the household unit, so null
    expect(computeIngredientFactor(SERVING_SIZE, SERVING_UNIT, 1, 'egg', HOUSEHOLD, UNITS_PER_SRV)).toBeNull()
  })

  it('metric unit still works alongside household unit', () => {
    // User can still specify grams even when a household unit is available
    expect(computeIngredientFactor(SERVING_SIZE, SERVING_UNIT, 100, 'g', HOUSEHOLD, UNITS_PER_SRV)).toBeCloseTo(2)
  })
})

describe('household unit — bacon strips (2 strips = 46g serving)', () => {
  const SERVING_SIZE  = 46
  const SERVING_UNIT  = 'g'
  const HOUSEHOLD     = 'strip'
  const UNITS_PER_SRV = 2

  it('2 strips = factor 1 (exactly 1 serving)', () => {
    expect(computeIngredientFactor(SERVING_SIZE, SERVING_UNIT, 2, 'strip', HOUSEHOLD, UNITS_PER_SRV)).toBe(1)
  })

  it('4 strips = factor 2', () => {
    expect(computeIngredientFactor(SERVING_SIZE, SERVING_UNIT, 4, 'strip', HOUSEHOLD, UNITS_PER_SRV)).toBe(2)
  })

  it('1 strip = factor 0.5 (half a serving)', () => {
    expect(computeIngredientFactor(SERVING_SIZE, SERVING_UNIT, 1, 'strip', HOUSEHOLD, UNITS_PER_SRV)).toBeCloseTo(0.5)
  })
})

describe('household unit — tortilla (1 tortilla = 45g serving)', () => {
  it('1 tortilla = factor 1', () => {
    expect(computeIngredientFactor(45, 'g', 1, 'tortilla', 'tortilla', 1)).toBe(1)
  })

  it('3 tortillas = factor 3', () => {
    expect(computeIngredientFactor(45, 'g', 3, 'tortilla', 'tortilla', 1)).toBe(3)
  })
})

describe('household unit — no householdUnit provided → no match', () => {
  it('passing no householdUnit means the household path is skipped', () => {
    // Without householdUnit, 'large egg' is unknown → null
    expect(computeIngredientFactor(50, 'g', 2, 'large egg')).toBeNull()
  })
})
