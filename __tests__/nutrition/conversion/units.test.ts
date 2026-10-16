import { describe, it, expect } from 'vitest'
import {
  weightToGrams,
  volumeToMl,
  normalizeUnit,
  isHouseholdUnit,
  SLICE_UNITS,
  PIECE_UNITS,
  FOOD_COUNT_NOUNS,
} from '../../../lib/nutrition/conversion/units'

describe('weightToGrams', () => {
  it('g → grams (identity)', () => {
    expect(weightToGrams(100, 'g')).toBe(100)
    expect(weightToGrams(50, 'gram')).toBe(50)
    expect(weightToGrams(200, 'grams')).toBe(200)
    expect(weightToGrams(75, 'grm')).toBe(75)
  })

  it('oz → grams', () => {
    expect(weightToGrams(1, 'oz')).toBeCloseTo(28.3495, 3)
    expect(weightToGrams(1, 'ounce')).toBeCloseTo(28.3495, 3)
    expect(weightToGrams(1, 'ounces')).toBeCloseTo(28.3495, 3)
    expect(weightToGrams(2, 'oz')).toBeCloseTo(56.699, 2)
  })

  it('lb → grams', () => {
    expect(weightToGrams(1, 'lb')).toBeCloseTo(453.592, 3)
    expect(weightToGrams(1, 'lbs')).toBeCloseTo(453.592, 3)
    expect(weightToGrams(1, 'pound')).toBeCloseTo(453.592, 3)
    expect(weightToGrams(1, 'pounds')).toBeCloseTo(453.592, 3)
    expect(weightToGrams(3, 'lb')).toBeCloseTo(1360.776, 2)
  })

  it('unknown unit → null', () => {
    expect(weightToGrams(1, 'cup')).toBeNull()
    expect(weightToGrams(1, 'ml')).toBeNull()
    expect(weightToGrams(1, 'clove')).toBeNull()
    expect(weightToGrams(1, 'serving')).toBeNull()
    expect(weightToGrams(1, 'handful')).toBeNull()
    expect(weightToGrams(1, '')).toBeNull()
  })

  it('handles uppercase input', () => {
    expect(weightToGrams(100, 'G')).toBe(100)
    expect(weightToGrams(1, 'OZ')).toBeCloseTo(28.3495, 3)
  })
})

describe('volumeToMl', () => {
  it('ml → ml (identity)', () => {
    expect(volumeToMl(100, 'ml')).toBe(100)
    expect(volumeToMl(50, 'milliliter')).toBe(50)
    expect(volumeToMl(50, 'milliliters')).toBe(50)
    expect(volumeToMl(50, 'millilitre')).toBe(50)
    expect(volumeToMl(50, 'millilitres')).toBe(50)
  })

  it('cup → ml', () => {
    expect(volumeToMl(1, 'cup')).toBeCloseTo(236.588, 3)
    expect(volumeToMl(1, 'cups')).toBeCloseTo(236.588, 3)
    expect(volumeToMl(2, 'cup')).toBeCloseTo(473.176, 2)
  })

  it('tbsp → ml', () => {
    expect(volumeToMl(1, 'tbsp')).toBeCloseTo(14.7868, 3)
    expect(volumeToMl(1, 'tablespoon')).toBeCloseTo(14.7868, 3)
    expect(volumeToMl(1, 'tablespoons')).toBeCloseTo(14.7868, 3)
  })

  it('tsp → ml', () => {
    expect(volumeToMl(1, 'tsp')).toBeCloseTo(4.92892, 4)
    expect(volumeToMl(1, 'teaspoon')).toBeCloseTo(4.92892, 4)
    expect(volumeToMl(1, 'teaspoons')).toBeCloseTo(4.92892, 4)
  })

  it('fl oz → ml', () => {
    expect(volumeToMl(1, 'fl oz')).toBeCloseTo(29.5735, 3)
    expect(volumeToMl(1, 'floz')).toBeCloseTo(29.5735, 3)
    expect(volumeToMl(1, 'fl_oz')).toBeCloseTo(29.5735, 3)
    expect(volumeToMl(1, 'fluid oz')).toBeCloseTo(29.5735, 3)
    expect(volumeToMl(1, 'fluid ounce')).toBeCloseTo(29.5735, 3)
    expect(volumeToMl(1, 'fluid ounces')).toBeCloseTo(29.5735, 3)
  })

  it('unknown unit → null', () => {
    expect(volumeToMl(1, 'g')).toBeNull()
    expect(volumeToMl(1, 'oz')).toBeNull()
    expect(volumeToMl(1, 'lb')).toBeNull()
    expect(volumeToMl(1, 'clove')).toBeNull()
    expect(volumeToMl(1, 'serving')).toBeNull()
    expect(volumeToMl(1, 'handful')).toBeNull()
  })
})

describe('normalizeUnit', () => {
  it('lowercases', () => {
    expect(normalizeUnit('G')).toBe('g')
    expect(normalizeUnit('CUP')).toBe('cup')
    expect(normalizeUnit('Tbsp')).toBe('tbsp')
  })

  it('strips leading/trailing whitespace', () => {
    expect(normalizeUnit('  g  ')).toBe('g')
    expect(normalizeUnit(' cup ')).toBe('cup')
  })

  it('lowercases and trims combined', () => {
    expect(normalizeUnit('  Grams  ')).toBe('grams')
  })
})

describe('isHouseholdUnit', () => {
  it('clove/cloves → true', () => {
    expect(isHouseholdUnit('clove')).toBe(true)
    expect(isHouseholdUnit('cloves')).toBe(true)
    expect(isHouseholdUnit('CLOVE')).toBe(true)
  })

  it('slice/slices → true', () => {
    expect(isHouseholdUnit('slice')).toBe(true)
    expect(isHouseholdUnit('slices')).toBe(true)
  })

  it('piece/pieces → true', () => {
    expect(isHouseholdUnit('piece')).toBe(true)
    expect(isHouseholdUnit('pieces')).toBe(true)
  })

  it('weight/volume units → false', () => {
    expect(isHouseholdUnit('g')).toBe(false)
    expect(isHouseholdUnit('oz')).toBe(false)
    expect(isHouseholdUnit('lb')).toBe(false)
    expect(isHouseholdUnit('cup')).toBe(false)
    expect(isHouseholdUnit('ml')).toBe(false)
    expect(isHouseholdUnit('tbsp')).toBe(false)
    expect(isHouseholdUnit('tsp')).toBe(false)
  })

  it('serving → false (serving aliases are not household units)', () => {
    expect(isHouseholdUnit('serving')).toBe(false)
  })

  // Regression: strip/rasher are now in SLICE_UNITS for bacon
  it('strip/strips/rasher/rashers → true (slice synonyms for bacon)', () => {
    expect(isHouseholdUnit('strip')).toBe(true)
    expect(isHouseholdUnit('strips')).toBe(true)
    expect(isHouseholdUnit('rasher')).toBe(true)
    expect(isHouseholdUnit('rashers')).toBe(true)
  })
})

// ── SLICE_UNITS includes bacon synonyms ──────────────────────────────────────
// Regression guard: USDA stores bacon portions as unit='strip'. When a user
// types unit='slice', the engine must recognise both as equivalent slice units.

describe('SLICE_UNITS — bacon synonym coverage', () => {
  it('contains slice and slices', () => {
    expect(SLICE_UNITS.has('slice')).toBe(true)
    expect(SLICE_UNITS.has('slices')).toBe(true)
  })

  it('contains strip and strips (USDA bacon unit)', () => {
    expect(SLICE_UNITS.has('strip')).toBe(true)
    expect(SLICE_UNITS.has('strips')).toBe(true)
  })

  it('contains rasher and rashers (British English for bacon slice)', () => {
    expect(SLICE_UNITS.has('rasher')).toBe(true)
    expect(SLICE_UNITS.has('rashers')).toBe(true)
  })
})

// ── PIECE_UNITS is unchanged ──────────────────────────────────────────────────
describe('PIECE_UNITS', () => {
  it('contains piece and pieces', () => {
    expect(PIECE_UNITS.has('piece')).toBe(true)
    expect(PIECE_UNITS.has('pieces')).toBe(true)
  })
})

// ── FOOD_COUNT_NOUNS — common food-specific count unit names ─────────────────
// These are the unit strings USDA stores for whole-food portions (e.g. 'egg',
// 'tortilla'). The broadened count-unit match in factor.ts uses this set to
// resolve 'piece' input to a food-specific portion.

describe('FOOD_COUNT_NOUNS', () => {
  it('contains egg/eggs (USDA stores egg portions as unit="egg")', () => {
    expect(FOOD_COUNT_NOUNS.has('egg')).toBe(true)
    expect(FOOD_COUNT_NOUNS.has('eggs')).toBe(true)
  })

  it('contains tortilla/tortillas (USDA stores tortilla portions as unit="tortilla")', () => {
    expect(FOOD_COUNT_NOUNS.has('tortilla')).toBe(true)
    expect(FOOD_COUNT_NOUNS.has('tortillas')).toBe(true)
  })

  it('contains common produce nouns', () => {
    expect(FOOD_COUNT_NOUNS.has('apple')).toBe(true)
    expect(FOOD_COUNT_NOUNS.has('banana')).toBe(true)
    expect(FOOD_COUNT_NOUNS.has('avocado')).toBe(true)
  })

  it('contains protein food nouns', () => {
    expect(FOOD_COUNT_NOUNS.has('patty')).toBe(true)
    expect(FOOD_COUNT_NOUNS.has('nugget')).toBe(true)
    expect(FOOD_COUNT_NOUNS.has('sausage')).toBe(true)
  })
})
