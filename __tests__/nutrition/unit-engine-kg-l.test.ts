import { describe, test, expect } from 'vitest'
import { weightToGrams, volumeToMl } from '@/lib/nutrition/conversion/units'
import { computeIngredientFactor } from '@/lib/recipes/nutrition'

describe('weightToGrams — kg support', () => {
  test('1 kg → 1000g', () => expect(weightToGrams(1, 'kg')).toBe(1000))
  test('0.5 kg → 500g', () => expect(weightToGrams(0.5, 'kg')).toBe(500))
  test('2 kg → 2000g', () => expect(weightToGrams(2, 'kg')).toBe(2000))
  test('1 kilogram → 1000g', () => expect(weightToGrams(1, 'kilogram')).toBe(1000))
  test('1 kilograms → 1000g', () => expect(weightToGrams(1, 'kilograms')).toBe(1000))
  test('uppercase KG → 1000g (case-insensitive)', () => expect(weightToGrams(1, 'KG')).toBe(1000))
  // Existing tests still pass
  test('1 g → 1g', () => expect(weightToGrams(1, 'g')).toBe(1))
  test('1 oz → ~28.35g', () => expect(weightToGrams(1, 'oz')).toBeCloseTo(28.3495))
  test('1 lb → ~453.59g', () => expect(weightToGrams(1, 'lb')).toBeCloseTo(453.592))
  test('returns null for non-weight unit', () => expect(weightToGrams(1, 'cup')).toBeNull())
})

describe('volumeToMl — L support', () => {
  test('1 L → 1000ml', () => expect(volumeToMl(1, 'L')).toBe(1000))
  test('0.5 L → 500ml', () => expect(volumeToMl(0.5, 'L')).toBe(500))
  test('2 L → 2000ml', () => expect(volumeToMl(2, 'L')).toBe(2000))
  test('1 liter → 1000ml', () => expect(volumeToMl(1, 'liter')).toBe(1000))
  test('1 liters → 1000ml', () => expect(volumeToMl(1, 'liters')).toBe(1000))
  test('1 litre → 1000ml', () => expect(volumeToMl(1, 'litre')).toBe(1000))
  test('1 litres → 1000ml', () => expect(volumeToMl(1, 'litres')).toBe(1000))
  // Existing tests still pass
  test('1 ml → 1ml', () => expect(volumeToMl(1, 'ml')).toBe(1))
  test('1 cup → ~236.59ml', () => expect(volumeToMl(1, 'cup')).toBeCloseTo(236.588))
  test('returns null for non-volume unit', () => expect(volumeToMl(1, 'g')).toBeNull())
})

describe('computeIngredientFactor — kg and L paths', () => {
  // 1 kg on a 100g-basis food → factor 10
  test('1 kg on 100g-basis food → factor 10', () => {
    const factor = computeIngredientFactor(100, 'g', 1, 'kg')
    expect(factor).toBeCloseTo(10)
  })

  // 0.5 kg on 100g-basis food → factor 5
  test('0.5 kg on 100g-basis food → factor 5', () => {
    const factor = computeIngredientFactor(100, 'g', 0.5, 'kg')
    expect(factor).toBeCloseTo(5)
  })

  // 0.5 L on 240ml-basis food → factor ≈ 2.083
  test('0.5 L on 240ml-basis food → factor ≈ 2.08', () => {
    const factor = computeIngredientFactor(240, 'ml', 0.5, 'L')
    expect(factor).toBeCloseTo(500 / 240, 3)
  })

  // 1 L on 250ml-basis food → factor 4
  test('1 L on 250ml-basis food → factor 4', () => {
    const factor = computeIngredientFactor(250, 'ml', 1, 'L')
    expect(factor).toBeCloseTo(4)
  })

  // kg on ml-basis food → null (incompatible)
  test('kg on ml-basis food → null', () => {
    const factor = computeIngredientFactor(240, 'ml', 1, 'kg')
    expect(factor).toBeNull()
  })

  // L on g-basis food → null (incompatible)
  test('L on g-basis food → null', () => {
    const factor = computeIngredientFactor(100, 'g', 1, 'L')
    expect(factor).toBeNull()
  })
})
