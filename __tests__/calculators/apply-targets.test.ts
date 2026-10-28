import { describe, it, expect } from 'vitest'
import {
  macroReconciliation,
  buildCaloriePayload,
  buildMacroPayload,
  FALLBACK_TARGET,
  type FullNutritionTarget,
} from '@/lib/calculators/apply-targets'

const BASE: FullNutritionTarget = {
  calories: 2000,
  proteinG: 150,
  carbohydrateG: 250,
  fatG: 65,
  fiberG: 28,
  sugarG: 50,
  sodiumMg: 2300,
}

// ── FALLBACK_TARGET ─────────────────────────────────────────────────────────────

describe('FALLBACK_TARGET', () => {
  it('matches the daily route default values', () => {
    expect(FALLBACK_TARGET.calories).toBe(2000)
    expect(FALLBACK_TARGET.proteinG).toBe(150)
    expect(FALLBACK_TARGET.carbohydrateG).toBe(250)
    expect(FALLBACK_TARGET.fatG).toBe(65)
  })

  it('has null optional fields', () => {
    expect(FALLBACK_TARGET.fiberG).toBeNull()
    expect(FALLBACK_TARGET.sugarG).toBeNull()
    expect(FALLBACK_TARGET.sodiumMg).toBeNull()
  })
})

// ── macroReconciliation ─────────────────────────────────────────────────────────

describe('macroReconciliation', () => {
  it('computes implied calories from 4/4/9 kcal/g', () => {
    // 150*4 + 250*4 + 65*9 = 600 + 1000 + 585 = 2185
    const result = macroReconciliation(BASE)
    expect(result.impliedCalories).toBe(2185)
  })

  it('returns positive delta when macros exceed declared calories', () => {
    const result = macroReconciliation(BASE)
    expect(result.delta).toBe(185)
  })

  it('returns negative delta when macros are under declared calories', () => {
    const target: FullNutritionTarget = { ...BASE, calories: 2500 }
    const result = macroReconciliation(target)
    expect(result.delta).toBe(-315)
  })

  it('withinTolerance is true when delta <= 50 kcal', () => {
    // 100*4 + 200*4 + 50*9 = 400 + 800 + 450 = 1650, declared 1620 → delta 30
    const target: FullNutritionTarget = {
      ...BASE,
      calories: 1620,
      proteinG: 100,
      carbohydrateG: 200,
      fatG: 50,
    }
    const result = macroReconciliation(target)
    expect(result.withinTolerance).toBe(true)
  })

  it('withinTolerance is false when delta > 50 kcal', () => {
    const result = macroReconciliation(BASE) // delta = 185
    expect(result.withinTolerance).toBe(false)
  })

  it('withinTolerance is true at exactly 50 kcal difference', () => {
    // implied = declared + 50 → within tolerance
    const target: FullNutritionTarget = { ...BASE, calories: 2185 - 50 }
    const result = macroReconciliation(target)
    expect(result.withinTolerance).toBe(true)
  })

  it('withinTolerance is false at 51 kcal difference', () => {
    const target: FullNutritionTarget = { ...BASE, calories: 2185 - 51 }
    const result = macroReconciliation(target)
    expect(result.withinTolerance).toBe(false)
  })

  it('rounds implied calories to the nearest integer', () => {
    // fractional gram values → implied should be rounded
    const target: FullNutritionTarget = { ...BASE, proteinG: 100, carbohydrateG: 200, fatG: 50 }
    const result = macroReconciliation(target)
    expect(Number.isInteger(result.impliedCalories)).toBe(true)
  })
})

// ── buildCaloriePayload ─────────────────────────────────────────────────────────

describe('buildCaloriePayload', () => {
  it('replaces only the calories field', () => {
    const result = buildCaloriePayload(BASE, 1750)
    expect(result.calories).toBe(1750)
    expect(result.proteinG).toBe(BASE.proteinG)
    expect(result.carbohydrateG).toBe(BASE.carbohydrateG)
    expect(result.fatG).toBe(BASE.fatG)
  })

  it('preserves all optional fields', () => {
    const result = buildCaloriePayload(BASE, 1750)
    expect(result.fiberG).toBe(28)
    expect(result.sugarG).toBe(50)
    expect(result.sodiumMg).toBe(2300)
  })

  it('preserves null optional fields', () => {
    const existing: FullNutritionTarget = { ...BASE, fiberG: null, sugarG: null, sodiumMg: null }
    const result = buildCaloriePayload(existing, 1800)
    expect(result.fiberG).toBeNull()
    expect(result.sugarG).toBeNull()
    expect(result.sodiumMg).toBeNull()
  })

  it('rounds the new calories to the nearest integer', () => {
    const result = buildCaloriePayload(BASE, 1749.7)
    expect(result.calories).toBe(1750)
    expect(Number.isInteger(result.calories)).toBe(true)
  })

  it('does not mutate the existing target', () => {
    const existing = { ...BASE }
    buildCaloriePayload(existing, 1600)
    expect(existing.calories).toBe(2000)
  })
})

// ── buildMacroPayload ───────────────────────────────────────────────────────────

describe('buildMacroPayload', () => {
  const newMacros = { calories: 1800, proteinG: 135, carbohydrateG: 225, fatG: 60 }

  it('sets all four core fields from the new macros', () => {
    const result = buildMacroPayload(BASE, newMacros)
    expect(result.calories).toBe(1800)
    expect(result.proteinG).toBe(135)
    expect(result.carbohydrateG).toBe(225)
    expect(result.fatG).toBe(60)
  })

  it('preserves optional fiberG from existing', () => {
    const result = buildMacroPayload(BASE, newMacros)
    expect(result.fiberG).toBe(28)
  })

  it('preserves optional sugarG from existing', () => {
    const result = buildMacroPayload(BASE, newMacros)
    expect(result.sugarG).toBe(50)
  })

  it('preserves optional sodiumMg from existing', () => {
    const result = buildMacroPayload(BASE, newMacros)
    expect(result.sodiumMg).toBe(2300)
  })

  it('preserves null optional fields', () => {
    const existing: FullNutritionTarget = { ...BASE, fiberG: null, sugarG: null, sodiumMg: null }
    const result = buildMacroPayload(existing, newMacros)
    expect(result.fiberG).toBeNull()
    expect(result.sugarG).toBeNull()
    expect(result.sodiumMg).toBeNull()
  })

  it('does not copy optional fields from the newMacros argument', () => {
    // buildMacroPayload should only read fiberG/sugarG/sodiumMg from existing
    const existing: FullNutritionTarget = { ...BASE, fiberG: 30 }
    const result = buildMacroPayload(existing, newMacros)
    expect(result.fiberG).toBe(30)
  })

  it('does not mutate the existing target', () => {
    const existing = { ...BASE }
    buildMacroPayload(existing, newMacros)
    expect(existing.calories).toBe(2000)
    expect(existing.proteinG).toBe(150)
  })
})
