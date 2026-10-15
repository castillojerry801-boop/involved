import { describe, it, expect } from 'vitest'
import {
  weightToGrams,
  volumeToMl,
  normalizeUnit,
  isHouseholdUnit,
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
})
