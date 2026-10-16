import { describe, test, expect } from 'vitest'
import { parseQuantity, formatQuantity } from '@/lib/utils/fractions'

describe('parseQuantity', () => {
  // Integers
  test('parses integer "2"', () => expect(parseQuantity('2')).toBe(2))
  test('parses integer "10"', () => expect(parseQuantity('10')).toBe(10))
  test('parses integer "1"', () => expect(parseQuantity('1')).toBe(1))

  // Decimals
  test('parses decimal "1.5"', () => expect(parseQuantity('1.5')).toBe(1.5))
  test('parses decimal "0.5"', () => expect(parseQuantity('0.5')).toBe(0.5))
  test('parses decimal "2.75"', () => expect(parseQuantity('2.75')).toBe(2.75))

  // Plain fractions
  test('parses fraction "1/2"', () => expect(parseQuantity('1/2')).toBeCloseTo(0.5))
  test('parses fraction "3/4"', () => expect(parseQuantity('3/4')).toBeCloseTo(0.75))
  test('parses fraction "1/3"', () => expect(parseQuantity('1/3')).toBeCloseTo(0.333, 2))
  test('parses fraction "2/3"', () => expect(parseQuantity('2/3')).toBeCloseTo(0.667, 2))

  // Mixed numbers
  test('parses mixed "1 1/2"', () => expect(parseQuantity('1 1/2')).toBeCloseTo(1.5))
  test('parses mixed "2 3/4"', () => expect(parseQuantity('2 3/4')).toBeCloseTo(2.75))
  test('parses mixed "3 1/3"', () => expect(parseQuantity('3 1/3')).toBeCloseTo(3.333, 2))

  // Unicode fractions
  test('parses unicode "½"', () => expect(parseQuantity('½')).toBeCloseTo(0.5))
  test('parses unicode "¼"', () => expect(parseQuantity('¼')).toBeCloseTo(0.25))
  test('parses unicode "¾"', () => expect(parseQuantity('¾')).toBeCloseTo(0.75))
  test('parses unicode "⅓"', () => expect(parseQuantity('⅓')).toBeCloseTo(0.333, 2))
  test('parses unicode "⅔"', () => expect(parseQuantity('⅔')).toBeCloseTo(0.667, 2))
  test('parses unicode "⅛"', () => expect(parseQuantity('⅛')).toBeCloseTo(0.125))

  // Mixed number with unicode fraction
  test('parses "1½"', () => expect(parseQuantity('1½')).toBeCloseTo(1.5))
  test('parses "2⅓"', () => expect(parseQuantity('2⅓')).toBeCloseTo(2.333, 2))
  test('parses "3¾"', () => expect(parseQuantity('3¾')).toBeCloseTo(3.75))

  // Whitespace handling
  test('handles leading/trailing whitespace " 2 "', () => expect(parseQuantity('  2  ')).toBe(2))

  // Edge cases
  test('returns null for empty string', () => expect(parseQuantity('')).toBeNull())
  test('returns null for "0"', () => expect(parseQuantity('0')).toBeNull())
  test('returns null for negative "-1"', () => expect(parseQuantity('-1')).toBeNull())
  test('returns null for text "abc"', () => expect(parseQuantity('abc')).toBeNull())
  test('returns null for "0/4" (zero fraction)', () => expect(parseQuantity('0/4')).toBeNull())
  test('returns null for "1/0" (divide by zero)', () => expect(parseQuantity('1/0')).toBeNull())
  test('returns null for mixed invalid "1 abc"', () => expect(parseQuantity('1 abc')).toBeNull())
  test('returns null for trailing non-numeric "1.5abc"', () => expect(parseQuantity('1.5abc')).toBeNull())
  test('returns null for trailing non-numeric "2kg"', () => expect(parseQuantity('2kg')).toBeNull())
})

describe('formatQuantity', () => {
  test('formats 0.5 as "½"', () => expect(formatQuantity(0.5)).toBe('½'))
  test('formats 0.25 as "¼"', () => expect(formatQuantity(0.25)).toBe('¼'))
  test('formats 0.75 as "¾"', () => expect(formatQuantity(0.75)).toBe('¾'))
  test('formats 1.5 as "1½"', () => expect(formatQuantity(1.5)).toBe('1½'))
  test('formats 2.75 as "2¾"', () => expect(formatQuantity(2.75)).toBe('2¾'))
  test('formats 1/3 ≈ 0.333 as "⅓"', () => expect(formatQuantity(1/3)).toBe('⅓'))
  test('formats 2/3 ≈ 0.667 as "⅔"', () => expect(formatQuantity(2/3)).toBe('⅔'))
  test('formats 2.333... as "2⅓"', () => expect(formatQuantity(2 + 1/3)).toBe('2⅓'))
  test('formats whole 2 as "2"', () => expect(formatQuantity(2)).toBe('2'))
  test('formats whole 1 as "1"', () => expect(formatQuantity(1)).toBe('1'))
  test('formats whole 10 as "10"', () => expect(formatQuantity(10)).toBe('10'))
  test('falls back to decimal for 0.3 (no clean fraction)', () => {
    const result = formatQuantity(0.3)
    // 0.3 doesn't match any of our fractions within tolerance
    expect(result).toMatch(/^0\.3/)
  })
  test('formats 1.25 as "1¼"', () => expect(formatQuantity(1.25)).toBe('1¼'))
  test('removes trailing zeros in decimal fallback', () => {
    // 0.1 has no clean fraction equivalent — should not end in trailing zeros
    const result = formatQuantity(0.1)
    expect(result).not.toMatch(/0+$/)
  })
})
