import { describe, test, expect } from 'vitest'
import { formatDistanceM, MI_PER_KM } from '@/lib/hooks/use-distance-unit'

describe('MI_PER_KM constant', () => {
  test('equals the specified exact value', () => {
    expect(MI_PER_KM).toBe(0.6213711922)
  })
})

describe('formatDistanceM — km mode', () => {
  test('1000 m → "1.00 km"', () => {
    expect(formatDistanceM(1000, 'km')).toBe('1.00')
  })
  test('5000 m → "5.00"', () => {
    expect(formatDistanceM(5000, 'km')).toBe('5.00')
  })
  test('1609.344 m (1 mile) → ~"1.61"', () => {
    expect(formatDistanceM(1609.344, 'km')).toBe('1.61')
  })
  test('500 m → "0.50"', () => {
    expect(formatDistanceM(500, 'km')).toBe('0.50')
  })
  test('0 m → "0.00"', () => {
    expect(formatDistanceM(0, 'km')).toBe('0.00')
  })
})

describe('formatDistanceM — mi mode', () => {
  test('1609.344 m (1 mile) → "1.00"', () => {
    // 1609.344m / 1000 * 0.6213711922 ≈ 1.000000
    const result = parseFloat(formatDistanceM(1609.344, 'mi'))
    expect(result).toBeCloseTo(1.0, 1)
  })
  test('5000 m → ~"3.11" mi', () => {
    // 5 km * 0.6213711922 = 3.1068...
    const result = parseFloat(formatDistanceM(5000, 'mi'))
    expect(result).toBeCloseTo(3.11, 1)
  })
  test('1000 m (1 km) → ~"0.62" mi', () => {
    const result = parseFloat(formatDistanceM(1000, 'mi'))
    expect(result).toBeCloseTo(MI_PER_KM, 2)
  })
  test('0 m → "0.00"', () => {
    expect(formatDistanceM(0, 'mi')).toBe('0.00')
  })
  test('result is always a 2-decimal string', () => {
    const val = formatDistanceM(3200, 'mi')
    expect(val).toMatch(/^\d+\.\d{2}$/)
  })
})

describe('formatDistanceM — conversion correctness', () => {
  test('mi output equals km divided by MI_PER_KM before rounding', () => {
    // Raw: 10 km * MI_PER_KM = 6.213711922 mi → rounds to "6.21"
    expect(formatDistanceM(10000, 'mi')).toBe('6.21')
    expect(formatDistanceM(10000, 'km')).toBe('10.00')
  })

  test('half marathon (21097.5 m) in mi', () => {
    // 21.0975 km * 0.6213711922 = 13.109... mi → "13.11"
    const result = parseFloat(formatDistanceM(21097.5, 'mi'))
    expect(result).toBeCloseTo(13.11, 1)
  })
})
