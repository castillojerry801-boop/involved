import { describe, test, expect } from 'vitest'
import {
  suggestMacros,
  validateMacroSplit,
  macrosFromSplit,
  macroCalorieConsistency,
  KCAL_PER_PROTEIN,
  KCAL_PER_CARB,
  KCAL_PER_FAT,
  type MacroGoal,
} from '@/lib/calculators/macros'

// ─── Energy constant exports ──────────────────────────────────────────────────

describe('energy density constants', () => {
  test('KCAL_PER_PROTEIN is 4', () => expect(KCAL_PER_PROTEIN).toBe(4))
  test('KCAL_PER_CARB is 4',    () => expect(KCAL_PER_CARB).toBe(4))
  test('KCAL_PER_FAT is 9',     () => expect(KCAL_PER_FAT).toBe(9))
})

// ─── Preset macro splits — exact gram values ──────────────────────────────────
//
// Worked examples at 2 000 kcal (manually verified):
//
// weight_loss (35 P / 30 F / 35 C):
//   protein = round(2000*0.35/4) = round(175)   = 175
//   fat     = round(2000*0.30/9) = round(66.67)  = 67
//   carbCal = 2000 − 175*4 − 67*9 = 2000−700−603 = 697
//   carbs   = round(697/4)        = round(174.25) = 174
//
// maintenance (30 P / 30 F / 40 C):
//   protein = round(2000*0.30/4) = round(150)   = 150
//   fat     = round(2000*0.30/9) = round(66.67)  = 67
//   carbCal = 2000−600−603 = 797
//   carbs   = round(797/4) = round(199.25) = 199
//
// muscle_gain (30 P / 25 F / 45 C):
//   protein = round(2000*0.30/4) = round(150)   = 150
//   fat     = round(2000*0.25/9) = round(55.56)  = 56
//   carbCal = 2000−600−504 = 896
//   carbs   = round(896/4) = round(224) = 224
//
// endurance (20 P / 25 F / 55 C):
//   protein = round(2000*0.20/4) = round(100)   = 100
//   fat     = round(2000*0.25/9) = round(55.56)  = 56
//   carbCal = 2000−400−504 = 1096
//   carbs   = round(1096/4) = round(274) = 274

describe('suggestMacros — weight_loss at 2000 kcal', () => {
  const result = suggestMacros(2000, 'weight_loss')

  test('ok is true', () => expect(result.ok).toBe(true))

  test('protein 175 g', () => {
    if (result.ok) expect(result.targets.proteinG).toBe(175)
  })
  test('fat 67 g', () => {
    if (result.ok) expect(result.targets.fatG).toBe(67)
  })
  test('carbohydrate 174 g (absorbs rounding slack)', () => {
    if (result.ok) expect(result.targets.carbohydrateG).toBe(174)
  })
  test('stored calorie value is the input', () => {
    if (result.ok) expect(result.targets.calories).toBe(2000)
  })
})

describe('suggestMacros — maintenance at 2000 kcal', () => {
  const result = suggestMacros(2000, 'maintenance')

  test('ok is true', () => expect(result.ok).toBe(true))
  test('protein 150 g', () => {
    if (result.ok) expect(result.targets.proteinG).toBe(150)
  })
  test('fat 67 g', () => {
    if (result.ok) expect(result.targets.fatG).toBe(67)
  })
  test('carbohydrate 199 g', () => {
    if (result.ok) expect(result.targets.carbohydrateG).toBe(199)
  })
})

describe('suggestMacros — muscle_gain at 2000 kcal', () => {
  const result = suggestMacros(2000, 'muscle_gain')

  test('ok is true', () => expect(result.ok).toBe(true))
  test('protein 150 g', () => {
    if (result.ok) expect(result.targets.proteinG).toBe(150)
  })
  test('fat 56 g', () => {
    if (result.ok) expect(result.targets.fatG).toBe(56)
  })
  test('carbohydrate 224 g', () => {
    if (result.ok) expect(result.targets.carbohydrateG).toBe(224)
  })
})

describe('suggestMacros — endurance at 2000 kcal', () => {
  const result = suggestMacros(2000, 'endurance')

  test('ok is true', () => expect(result.ok).toBe(true))
  test('protein 100 g', () => {
    if (result.ok) expect(result.targets.proteinG).toBe(100)
  })
  test('fat 56 g', () => {
    if (result.ok) expect(result.targets.fatG).toBe(56)
  })
  test('carbohydrate 274 g', () => {
    if (result.ok) expect(result.targets.carbohydrateG).toBe(274)
  })
})

// ─── Macro calorie consistency across all presets at 2000 kcal ───────────────

describe('macroCalorieConsistency — all presets', () => {
  const goals: MacroGoal[] = ['weight_loss', 'maintenance', 'muscle_gain', 'endurance']

  goals.forEach(goal => {
    test(`${goal}: implied calories within ±10 kcal of 2000`, () => {
      const result = suggestMacros(2000, goal)
      if (result.ok) {
        const { withinTolerance } = macroCalorieConsistency(result.targets)
        expect(withinTolerance).toBe(true)
      }
    })
  })

  test('reports implied calories correctly', () => {
    const result = suggestMacros(2000, 'muscle_gain')
    if (result.ok) {
      // protein=150 fat=56 carb=224 → 150*4 + 224*4 + 56*9 = 600+896+504 = 2000
      const { impliedCalories } = macroCalorieConsistency(result.targets)
      expect(impliedCalories).toBe(2000)
    }
  })
})

// ─── Preset percentage preservation ──────────────────────────────────────────

describe('suggestMacros — preset percentages in output', () => {
  test('weight_loss stores 35/30/35 split', () => {
    const result = suggestMacros(2000, 'weight_loss')
    if (result.ok) {
      expect(result.targets.proteinPct).toBe(35)
      expect(result.targets.fatPct).toBe(30)
      expect(result.targets.carbPct).toBe(35)
    }
  })

  test('endurance stores 20/25/55 split', () => {
    const result = suggestMacros(2000, 'endurance')
    if (result.ok) {
      expect(result.targets.proteinPct).toBe(20)
      expect(result.targets.fatPct).toBe(25)
      expect(result.targets.carbPct).toBe(55)
    }
  })
})

// ─── suggestMacros — invalid calorie inputs ───────────────────────────────────

describe('suggestMacros — invalid inputs', () => {
  test('zero calories returns error', () => {
    const result = suggestMacros(0, 'maintenance')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_calories')
  })

  test('negative calories returns error', () => {
    const result = suggestMacros(-500, 'maintenance')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_calories')
  })

  test('NaN calories returns error', () => {
    const result = suggestMacros(NaN, 'weight_loss')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_calories')
  })

  test('Infinity calories returns error', () => {
    const result = suggestMacros(Infinity, 'maintenance')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_calories')
  })

  test('-Infinity calories returns error', () => {
    const result = suggestMacros(-Infinity, 'muscle_gain')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_calories')
  })

  test('calories below 400 returns calories_too_low', () => {
    const result = suggestMacros(399, 'maintenance')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('calories_too_low')
  })

  test('calories exactly 400 are valid', () => {
    const result = suggestMacros(400, 'maintenance')
    expect(result.ok).toBe(true)
  })

  test('calories above 15000 returns calories_too_high', () => {
    const result = suggestMacros(15001, 'maintenance')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('calories_too_high')
  })

  test('calories exactly 15000 are valid', () => {
    const result = suggestMacros(15000, 'maintenance')
    expect(result.ok).toBe(true)
  })
})

// ─── No NaN or Infinity in output ────────────────────────────────────────────

describe('suggestMacros — output never produces NaN or Infinity', () => {
  const goals: MacroGoal[] = ['weight_loss', 'maintenance', 'muscle_gain', 'endurance']
  const calorieCases = [500, 1000, 2000, 3000, 5000, 15000]

  calorieCases.forEach(cal => {
    goals.forEach(goal => {
      test(`${goal} at ${cal} kcal produces finite gram values`, () => {
        const result = suggestMacros(cal, goal)
        if (result.ok) {
          expect(isFinite(result.targets.proteinG)).toBe(true)
          expect(isFinite(result.targets.fatG)).toBe(true)
          expect(isFinite(result.targets.carbohydrateG)).toBe(true)
          expect(result.targets.proteinG).toBeGreaterThanOrEqual(0)
          expect(result.targets.fatG).toBeGreaterThanOrEqual(0)
          expect(result.targets.carbohydrateG).toBeGreaterThanOrEqual(0)
        }
      })
    })
  })
})

// ─── validateMacroSplit ───────────────────────────────────────────────────────

describe('validateMacroSplit', () => {
  test('30/30/40 returns true', () => expect(validateMacroSplit(30, 30, 40)).toBe(true))
  test('35/30/35 returns true', () => expect(validateMacroSplit(35, 30, 35)).toBe(true))
  test('0/0/100 returns true',  () => expect(validateMacroSplit(0, 0, 100)).toBe(true))
  test('100/0/0 returns true',  () => expect(validateMacroSplit(100, 0, 0)).toBe(true))

  test('99/0/0 returns false (does not total 100)', () => {
    expect(validateMacroSplit(99, 0, 0)).toBe(false)
  })
  test('34/33/34 returns false (totals 101)', () => {
    expect(validateMacroSplit(34, 33, 34)).toBe(false)
  })
  test('negative values return false', () => {
    expect(validateMacroSplit(-5, 30, 75)).toBe(false)
  })
  test('NaN values return false', () => {
    expect(validateMacroSplit(NaN, 30, 70)).toBe(false)
  })
  test('Infinity returns false', () => {
    expect(validateMacroSplit(Infinity, 0, 0)).toBe(false)
  })
})

// ─── macrosFromSplit (custom split) ──────────────────────────────────────────

describe('macrosFromSplit', () => {
  test('valid custom split 40/25/35 at 2000 kcal', () => {
    // protein = round(2000*0.40/4) = round(200) = 200
    // fat     = round(2000*0.25/9) = round(55.56) = 56
    // carbCal = 2000−200*4−56*9 = 2000−800−504 = 696
    // carbs   = round(696/4) = round(174) = 174
    const result = macrosFromSplit(2000, 40, 25, 35)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.targets.proteinG).toBe(200)
      expect(result.targets.fatG).toBe(56)
      expect(result.targets.carbohydrateG).toBe(174)
    }
  })

  test('invalid split returns error', () => {
    const result = macrosFromSplit(2000, 40, 30, 35) // totals 105
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_split')
  })

  test('valid split with invalid calories returns error', () => {
    const result = macrosFromSplit(0, 30, 30, 40)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_calories')
  })

  test('output is consistent with macroCalorieConsistency', () => {
    const result = macrosFromSplit(2000, 25, 30, 45)
    if (result.ok) {
      const { withinTolerance } = macroCalorieConsistency(result.targets)
      expect(withinTolerance).toBe(true)
    }
  })
})

// ─── Rounding — carbs absorb slack, never produce negative ───────────────────

describe('rounding — carbohydrate slack absorption', () => {
  test('carbohydrate is never negative even for extreme fat+protein splits', () => {
    // 50% protein + 50% fat at 2000 kcal (leaves near-zero carbs)
    const result = macrosFromSplit(2000, 50, 50, 0)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.targets.carbohydrateG).toBeGreaterThanOrEqual(0)
  })

  test('carbohydrate is non-negative at 0% carb split', () => {
    const result = macrosFromSplit(1000, 60, 40, 0)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.targets.carbohydrateG).toBeGreaterThanOrEqual(0)
  })
})
