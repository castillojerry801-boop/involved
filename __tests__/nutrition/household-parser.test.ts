/**
 * Unit tests for the shared household serving parser.
 *
 * Covers:
 *  - parseHouseholdText: basic count nouns, plural normalization, fraction support
 *  - parseHouseholdText: skip metric weight units (g, oz, lb)
 *  - parseHouseholdText: volume units (cup, tablespoon, tsp) retained as household nouns
 *  - parseHouseholdText: invalid inputs return null
 *  - enrichWithFoodNoun: size adjective enrichment with USDA description
 *  - enrichWithFoodNoun: non-adjective units pass through unchanged
 */
import { describe, it, expect } from 'vitest'
import { parseHouseholdText, enrichWithFoodNoun } from '../../lib/nutrition/providers/household-parser'

// ── parseHouseholdText: count nouns ──────────────────────────────────────────

describe('parseHouseholdText — count nouns', () => {
  it('"1 tortilla" → tortilla / 1', () => {
    expect(parseHouseholdText('1 tortilla')).toEqual({ householdUnit: 'tortilla', unitsPerServing: 1 })
  })

  it('"2 strips" → strip / 2 (plural normalized)', () => {
    expect(parseHouseholdText('2 strips')).toEqual({ householdUnit: 'strip', unitsPerServing: 2 })
  })

  it('"1 bar" → bar / 1', () => {
    expect(parseHouseholdText('1 bar')).toEqual({ householdUnit: 'bar', unitsPerServing: 1 })
  })

  it('"2 slices" → slice / 2', () => {
    expect(parseHouseholdText('2 slices')).toEqual({ householdUnit: 'slice', unitsPerServing: 2 })
  })

  it('"1 patties" → patty / 1 (-ies plural)', () => {
    expect(parseHouseholdText('1 patties')).toEqual({ householdUnit: 'patty', unitsPerServing: 1 })
  })

  it('"1 large egg" → large egg / 1 (multi-word noun preserved)', () => {
    expect(parseHouseholdText('1 large egg')).toEqual({ householdUnit: 'large egg', unitsPerServing: 1 })
  })

  it('"3 eggs" → egg / 3', () => {
    expect(parseHouseholdText('3 eggs')).toEqual({ householdUnit: 'egg', unitsPerServing: 3 })
  })
})

// ── parseHouseholdText: volume units ─────────────────────────────────────────

describe('parseHouseholdText — volume units retained for gram-based packaged foods', () => {
  it('"3 tablespoons" → tablespoon / 3', () => {
    expect(parseHouseholdText('3 tablespoons')).toEqual({ householdUnit: 'tablespoon', unitsPerServing: 3 })
  })

  it('"2 teaspoons" → teaspoon / 2', () => {
    expect(parseHouseholdText('2 teaspoons')).toEqual({ householdUnit: 'teaspoon', unitsPerServing: 2 })
  })

  it('"1 cup" → cup / 1', () => {
    expect(parseHouseholdText('1 cup')).toEqual({ householdUnit: 'cup', unitsPerServing: 1 })
  })

  it('"2 cups" → cup / 2', () => {
    expect(parseHouseholdText('2 cups')).toEqual({ householdUnit: 'cup', unitsPerServing: 2 })
  })
})

// ── parseHouseholdText: fraction support ─────────────────────────────────────

describe('parseHouseholdText — fraction quantities', () => {
  it('"1/4 cup" → cup / 0.25', () => {
    expect(parseHouseholdText('1/4 cup')).toEqual({ householdUnit: 'cup', unitsPerServing: 0.25 })
  })

  it('"1/2 cup" → cup / 0.5', () => {
    expect(parseHouseholdText('1/2 cup')).toEqual({ householdUnit: 'cup', unitsPerServing: 0.5 })
  })

  it('"3/4 cup" → cup / 0.75', () => {
    expect(parseHouseholdText('3/4 cup')).toEqual({ householdUnit: 'cup', unitsPerServing: 0.75 })
  })

  it('"1/3 tablespoon" → tablespoon / 0.333...', () => {
    const result = parseHouseholdText('1/3 tablespoon')
    expect(result).not.toBeNull()
    expect(result!.householdUnit).toBe('tablespoon')
    expect(result!.unitsPerServing).toBeCloseTo(1 / 3)
  })

  it('"0.5 cup" → cup / 0.5 (decimal also works)', () => {
    expect(parseHouseholdText('0.5 cup')).toEqual({ householdUnit: 'cup', unitsPerServing: 0.5 })
  })
})

// ── parseHouseholdText: skip metric weight units ──────────────────────────────

describe('parseHouseholdText — skip metric weight units', () => {
  it('"1 oz" → null (already handled by oz→gram conversion)', () => {
    expect(parseHouseholdText('1 oz')).toBeNull()
  })

  it('"8 OZA" → null (USDA fluid-oz abbreviation)', () => {
    expect(parseHouseholdText('8 OZA')).toBeNull()
  })

  it('"28 g" → null', () => {
    expect(parseHouseholdText('28 g')).toBeNull()
  })

  it('"2 grams" → null', () => {
    expect(parseHouseholdText('2 grams')).toBeNull()
  })

  it('"0.5 lb" → null', () => {
    expect(parseHouseholdText('0.5 lb')).toBeNull()
  })

  it('"1 pound" → null', () => {
    expect(parseHouseholdText('1 pound')).toBeNull()
  })

  it('"100 grams" → null (plural form)', () => {
    expect(parseHouseholdText('100 grams')).toBeNull()
  })

  it('"3 ounces" → null (plural form)', () => {
    expect(parseHouseholdText('3 ounces')).toBeNull()
  })

  it('"250 ml" → null (volume metric unit)', () => {
    expect(parseHouseholdText('250 ml')).toBeNull()
  })

  it('"1 liter" → null', () => {
    expect(parseHouseholdText('1 liter')).toBeNull()
  })
})

// ── parseHouseholdText: invalid inputs ───────────────────────────────────────

describe('parseHouseholdText — invalid inputs', () => {
  it('empty string → null', () => {
    expect(parseHouseholdText('')).toBeNull()
  })

  it('"large" alone → null (no leading quantity)', () => {
    expect(parseHouseholdText('large')).toBeNull()
  })

  it('"1" alone → null (no noun)', () => {
    expect(parseHouseholdText('1')).toBeNull()
  })

  it('"0 cups" → null (zero quantity)', () => {
    expect(parseHouseholdText('0 cups')).toBeNull()
  })

  it('whitespace only → null', () => {
    expect(parseHouseholdText('   ')).toBeNull()
  })
})

// ── enrichWithFoodNoun ────────────────────────────────────────────────────────

describe('enrichWithFoodNoun — size adjective gets food noun from USDA description', () => {
  it('"large" + egg description → "large egg"', () => {
    expect(enrichWithFoodNoun('large', 'EGGS, LARGE, GRADE A, RAW')).toBe('large egg')
  })

  it('"large" + description starting with "LARGE EGGS" → "large egg"', () => {
    expect(enrichWithFoodNoun('large', 'LARGE EGGS, CAGE FREE')).toBe('large egg')
  })

  it('"medium" + apple description → "medium apple"', () => {
    expect(enrichWithFoodNoun('medium', 'Apple, raw, with skin')).toBe('medium apple')
  })

  it('"small" + banana description → "small banana"', () => {
    expect(enrichWithFoodNoun('small', 'Banana, raw')).toBe('small banana')
  })

  it('"jumbo" + egg description → "jumbo egg"', () => {
    expect(enrichWithFoodNoun('jumbo', 'EGGS, JUMBO, GRADE AA')).toBe('jumbo egg')
  })
})

describe('enrichWithFoodNoun — non-adjective units pass through unchanged', () => {
  it('"cup" is not a size adjective — no enrichment', () => {
    expect(enrichWithFoodNoun('cup', 'Oatmeal, dry')).toBe('cup')
  })

  it('"tablespoon" passes through', () => {
    expect(enrichWithFoodNoun('tablespoon', 'Peanut Butter, smooth style')).toBe('tablespoon')
  })

  it('"tortilla" passes through', () => {
    expect(enrichWithFoodNoun('tortilla', 'Tortilla, ready-to-cook')).toBe('tortilla')
  })

  it('"large egg" already has noun — passes through', () => {
    expect(enrichWithFoodNoun('large egg', 'Eggs, whole, raw')).toBe('large egg')
  })
})

describe('enrichWithFoodNoun — edge cases', () => {
  it('short description returns original unit', () => {
    expect(enrichWithFoodNoun('medium', 'X')).toBe('medium')
  })

  it('description with only skip words returns original unit', () => {
    // All words are in SKIP or DESC_WORDS — nothing to enrich with
    expect(enrichWithFoodNoun('large', 'WHOLE, RAW, FRESH, ORGANIC')).toBe('large')
  })
})
