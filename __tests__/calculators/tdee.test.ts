import { describe, test, expect } from 'vitest'
import {
  calcBMR,
  calcTDEE,
  calorieProjections,
  ACTIVITY_MULTIPLIERS,
  type CalculatorSex,
  type ActivityLevel,
} from '@/lib/calculators/tdee'

// ─── Exact formula values ─────────────────────────────────────────────────────
//
// Mifflin–St Jeor:
//   Male:   10w + 6.25h − 5a + 5
//   Female: 10w + 6.25h − 5a − 161
//
// Manually verified before writing these tests.

describe('calcBMR — formula correctness', () => {
  test('male 70 kg / 175 cm / age 30', () => {
    // 10*70 + 6.25*175 − 5*30 + 5 = 700 + 1093.75 − 150 + 5 = 1648.75 → 1649
    const result = calcBMR(70, 175, 30, 'male')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bmr).toBe(1649)
  })

  test('female 60 kg / 165 cm / age 25', () => {
    // 10*60 + 6.25*165 − 5*25 − 161 = 600 + 1031.25 − 125 − 161 = 1345.25 → 1345
    const result = calcBMR(60, 165, 25, 'female')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bmr).toBe(1345)
  })

  test('male 90 kg / 180 cm / age 40', () => {
    // 10*90 + 6.25*180 − 5*40 + 5 = 900 + 1125 − 200 + 5 = 1830
    const result = calcBMR(90, 180, 40, 'male')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bmr).toBe(1830)
  })

  test('female 55 kg / 160 cm / age 50', () => {
    // 10*55 + 6.25*160 − 5*50 − 161 = 550 + 1000 − 250 − 161 = 1139
    const result = calcBMR(55, 160, 50, 'female')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bmr).toBe(1139)
  })

  test('result carries the sex variant used', () => {
    const male   = calcBMR(70, 175, 30, 'male')
    const female = calcBMR(70, 175, 30, 'female')
    if (male.ok)   expect(male.sex).toBe('male')
    if (female.ok) expect(female.sex).toBe('female')
  })

  test('male and female BMR differ by exactly 166 kcal (5 − (−161))', () => {
    const male   = calcBMR(70, 175, 30, 'male')
    const female = calcBMR(70, 175, 30, 'female')
    // Math.round may shift by ±1; allow a tolerance of 1 kcal.
    if (male.ok && female.ok) {
      expect(Math.abs((male.bmr - female.bmr) - 166)).toBeLessThanOrEqual(1)
    }
  })
})

// ─── Boundary ages ────────────────────────────────────────────────────────────

describe('calcBMR — age boundaries', () => {
  test('age 18 is valid (lower adult boundary)', () => {
    const result = calcBMR(70, 175, 18, 'male')
    expect(result.ok).toBe(true)
  })

  test('age 17 returns error with reason minor', () => {
    const result = calcBMR(70, 175, 17, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('minor')
  })

  test('age 0 returns error with reason minor', () => {
    const result = calcBMR(70, 175, 0, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('minor')
  })

  test('age 17.9 returns error with reason minor', () => {
    const result = calcBMR(70, 175, 17.9, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('minor')
  })

  test('age 120 is valid (upper boundary)', () => {
    const result = calcBMR(50, 155, 120, 'female')
    expect(result.ok).toBe(true)
  })

  test('age 121 returns invalid_age error', () => {
    const result = calcBMR(70, 175, 121, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_age')
  })

  test('negative age returns invalid_age error', () => {
    const result = calcBMR(70, 175, -1, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_age')
  })

  test('NaN age returns invalid_age error', () => {
    const result = calcBMR(70, 175, NaN, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_age')
  })

  test('Infinity age returns invalid_age error', () => {
    const result = calcBMR(70, 175, Infinity, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_age')
  })
})

// ─── Weight and height validation ─────────────────────────────────────────────

describe('calcBMR — weight validation', () => {
  test('weight 0 returns invalid_weight error', () => {
    const result = calcBMR(0, 175, 30, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_weight')
  })

  test('negative weight returns invalid_weight error', () => {
    const result = calcBMR(-10, 175, 30, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_weight')
  })

  test('weight 500 kg is valid (upper boundary)', () => {
    const result = calcBMR(500, 175, 30, 'male')
    expect(result.ok).toBe(true)
  })

  test('weight 501 kg returns invalid_weight error', () => {
    const result = calcBMR(501, 175, 30, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_weight')
  })

  test('NaN weight returns invalid_weight error', () => {
    const result = calcBMR(NaN, 175, 30, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_weight')
  })
})

describe('calcBMR — height validation', () => {
  test('height 0 returns invalid_height error', () => {
    const result = calcBMR(70, 0, 30, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_height')
  })

  test('negative height returns invalid_height error', () => {
    const result = calcBMR(70, -5, 30, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_height')
  })

  test('height 300 cm is valid (upper boundary)', () => {
    const result = calcBMR(70, 300, 30, 'male')
    expect(result.ok).toBe(true)
  })

  test('height 301 cm returns invalid_height error', () => {
    const result = calcBMR(70, 301, 30, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_height')
  })

  test('NaN height returns invalid_height error', () => {
    const result = calcBMR(70, NaN, 30, 'male')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_height')
  })
})

// ─── calcTDEE ─────────────────────────────────────────────────────────────────

describe('calcTDEE — activity multipliers', () => {
  const W = 70, H = 175, A = 30
  // BMR for male 70/175/30 = 1649

  test('sedentary: BMR × 1.2', () => {
    const result = calcTDEE(W, H, A, 'male', 'sedentary')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bmr).toBe(1649)
      // round(1649 × 1.2) = round(1978.8) = 1979
      expect(result.tdee).toBe(1979)
    }
  })

  test('light: BMR × 1.375', () => {
    const result = calcTDEE(W, H, A, 'male', 'light')
    expect(result.ok).toBe(true)
    if (result.ok) {
      // round(1649 × 1.375) = round(2267.375) = 2267
      expect(result.tdee).toBe(2267)
    }
  })

  test('moderate: BMR × 1.55', () => {
    const result = calcTDEE(W, H, A, 'male', 'moderate')
    expect(result.ok).toBe(true)
    if (result.ok) {
      // round(1649 × 1.55) = round(2555.95) = 2556
      expect(result.tdee).toBe(2556)
    }
  })

  test('active: BMR × 1.725', () => {
    const result = calcTDEE(W, H, A, 'male', 'active')
    expect(result.ok).toBe(true)
    if (result.ok) {
      // round(1649 × 1.725) = round(2844.525) = 2845
      expect(result.tdee).toBe(2845)
    }
  })

  test('very_active: BMR × 1.9', () => {
    const result = calcTDEE(W, H, A, 'male', 'very_active')
    expect(result.ok).toBe(true)
    if (result.ok) {
      // round(1649 × 1.9) = round(3133.1) = 3133
      expect(result.tdee).toBe(3133)
    }
  })

  test('result carries activityLevel', () => {
    const result = calcTDEE(W, H, A, 'male', 'moderate')
    if (result.ok) expect(result.activityLevel).toBe('moderate')
  })

  test('ACTIVITY_MULTIPLIERS constants are individually accessible', () => {
    expect(ACTIVITY_MULTIPLIERS.sedentary).toBe(1.2)
    expect(ACTIVITY_MULTIPLIERS.very_active).toBe(1.9)
  })
})

describe('calcTDEE — propagates BMR errors', () => {
  test('minor age propagates from calcBMR', () => {
    const result = calcTDEE(70, 175, 16, 'female', 'moderate')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('minor')
  })

  test('invalid weight propagates from calcBMR', () => {
    const result = calcTDEE(0, 175, 30, 'male', 'sedentary')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_weight')
  })
})

// ─── calorieProjections ───────────────────────────────────────────────────────

describe('calorieProjections — standard output', () => {
  const TDEE = 2500

  test('maintenance row equals TDEE', () => {
    const rows = calorieProjections(TDEE, 'male')
    const maint = rows.find(r => r.id === 'maintenance')
    expect(maint?.calories).toBe(TDEE)
    expect(maint?.floorApplied).toBe(false)
  })

  test('modest_deficit is TDEE − 250', () => {
    const rows = calorieProjections(TDEE, 'male')
    const row  = rows.find(r => r.id === 'modest_deficit')
    expect(row?.calories).toBe(2250)
    expect(row?.floorApplied).toBe(false)
  })

  test('moderate_deficit is TDEE − 500', () => {
    const rows = calorieProjections(TDEE, 'male')
    const row  = rows.find(r => r.id === 'moderate_deficit')
    expect(row?.calories).toBe(2000)
    expect(row?.floorApplied).toBe(false)
  })

  test('lean_surplus is TDEE + 250', () => {
    const rows = calorieProjections(TDEE, 'male')
    const row  = rows.find(r => r.id === 'lean_surplus')
    expect(row?.calories).toBe(2750)
    expect(row?.floorApplied).toBe(false)
  })

  test('returns exactly 4 rows', () => {
    expect(calorieProjections(TDEE, 'female').length).toBe(4)
  })
})

describe('calorieProjections — floor enforcement', () => {
  // Male floor = 1500 kcal, female floor = 1200 kcal

  test('male: deficit floored at 1500 kcal when TDEE is 1800', () => {
    // modest: 1800−250=1550 (above floor)
    // moderate: 1800−500=1300 (below 1500 floor)
    const rows = calorieProjections(1800, 'male')
    const modest   = rows.find(r => r.id === 'modest_deficit')
    const moderate = rows.find(r => r.id === 'moderate_deficit')
    expect(modest?.calories).toBe(1550)
    expect(modest?.floorApplied).toBe(false)
    expect(moderate?.calories).toBe(1500)
    expect(moderate?.floorApplied).toBe(true)
  })

  test('male: both deficits floored when TDEE is 1600', () => {
    // modest: 1600−250=1350 (below 1500 floor)
    // moderate: 1600−500=1100 (below 1500 floor)
    const rows = calorieProjections(1600, 'male')
    const modest   = rows.find(r => r.id === 'modest_deficit')
    const moderate = rows.find(r => r.id === 'moderate_deficit')
    expect(modest?.calories).toBe(1500)
    expect(modest?.floorApplied).toBe(true)
    expect(moderate?.calories).toBe(1500)
    expect(moderate?.floorApplied).toBe(true)
  })

  test('female: deficit floored at 1200 kcal', () => {
    // TDEE=1400: modest=1150 (below 1200), moderate=900 (below 1200)
    const rows = calorieProjections(1400, 'female')
    const modest   = rows.find(r => r.id === 'modest_deficit')
    const moderate = rows.find(r => r.id === 'moderate_deficit')
    expect(modest?.calories).toBe(1200)
    expect(modest?.floorApplied).toBe(true)
    expect(moderate?.calories).toBe(1200)
    expect(moderate?.floorApplied).toBe(true)
  })

  test('female: no floor when TDEE is comfortably above 1200', () => {
    const rows = calorieProjections(2000, 'female')
    rows.filter(r => r.id !== 'lean_surplus').forEach(r => {
      expect(r.floorApplied).toBe(false)
    })
  })

  test('surplus is never floored', () => {
    const rows = calorieProjections(1400, 'female')
    const surplus = rows.find(r => r.id === 'lean_surplus')
    expect(surplus?.floorApplied).toBe(false)
  })
})

describe('calorieProjections — edge inputs', () => {
  test('returns empty array for TDEE ≤ 0', () => {
    expect(calorieProjections(0, 'male')).toHaveLength(0)
    expect(calorieProjections(-100, 'female')).toHaveLength(0)
  })

  test('returns empty array for non-finite TDEE', () => {
    expect(calorieProjections(Infinity, 'male')).toHaveLength(0)
    expect(calorieProjections(NaN, 'female')).toHaveLength(0)
  })
})

// ─── Minor-path integration ───────────────────────────────────────────────────

describe('minor safeguard — end-to-end', () => {
  test('calcBMR returns minor error for age 17', () => {
    const result = calcBMR(65, 170, 17, 'female')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('minor')
      // Message should mention healthcare provider
      expect(result.message.toLowerCase()).toContain('health')
    }
  })

  test('calcTDEE returns minor error for age 15', () => {
    const result = calcTDEE(55, 165, 15, 'female', 'moderate')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('minor')
  })

  test('calorieProjections is not called with a minor result — type system enforces this', () => {
    // This test documents the intended usage: calorieProjections only receives
    // a confirmed valid TDEE number, never a TDEEResult directly.
    const tdee = calcTDEE(70, 175, 25, 'male', 'moderate')
    if (tdee.ok) {
      const rows = calorieProjections(tdee.tdee, tdee.sex)
      expect(rows.length).toBeGreaterThan(0)
    }
    // No assertion for the failure path — the function contract prevents it.
  })
})
