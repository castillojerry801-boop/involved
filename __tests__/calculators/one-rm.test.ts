import { describe, test, expect } from 'vitest'
import {
  calcOneRM,
  trainingPercentages,
  kgToLbs,
  lbsToKg,
  KG_TO_LBS,
  LBS_TO_KG,
  // Re-exported from lib/training/one-rm — verifies reuse, not re-implementation
  estimated1RM,
  isValid1RMEstimate,
} from '@/lib/calculators/one-rm'

// ─── Unit conversion ──────────────────────────────────────────────────────────

describe('unit conversion constants', () => {
  test('KG_TO_LBS is 2.20462', () => expect(KG_TO_LBS).toBe(2.20462))
  test('LBS_TO_KG × KG_TO_LBS ≈ 1 (round-trip)', () => {
    expect(LBS_TO_KG * KG_TO_LBS).toBeCloseTo(1, 10)
  })
})

describe('kgToLbs', () => {
  test('100 kg = 220.5 lbs (rounded to 1 dp)', () => expect(kgToLbs(100)).toBe(220.5))
  test('70 kg ≈ 154.3 lbs',  () => expect(kgToLbs(70)).toBe(154.3))
  test('0 kg = 0 lbs',       () => expect(kgToLbs(0)).toBe(0))
})

describe('lbsToKg', () => {
  test('225 lbs ≈ 102.06 kg', () => expect(lbsToKg(225)).toBeCloseTo(102.06, 1))
  test('100 lbs ≈ 45.36 kg',  () => expect(lbsToKg(100)).toBeCloseTo(45.36, 1))
})

// ─── estimated1RM — verifying existing lib/training/one-rm behaviour ─────────
//
// These tests confirm that the function imported from lib/training/one-rm
// behaves as documented BEFORE the calculator wraps it.

describe('estimated1RM (imported from lib/training/one-rm)', () => {
  test('100 kg × 5 reps → 116.67 kg', () => {
    // 100 × (1 + 5/30) = 100 × 1.16667 = 116.667 → rounded to 116.67
    expect(estimated1RM(100, 5)).toBe(116.67)
  })

  test('80 kg × 10 reps → 106.67 kg', () => {
    // 80 × (1 + 10/30) = 80 × 1.3333 = 106.667 → 106.67
    expect(estimated1RM(80, 10)).toBe(106.67)
  })

  test('60 kg × 3 reps → 66 kg', () => {
    // 60 × (1 + 3/30) = 60 × 1.1 = 66 → 66
    expect(estimated1RM(60, 3)).toBe(66)
  })

  // ── Critical: 1 rep is NOT extrapolated upward ──────────────────────────────
  // When a user lifts weight for exactly 1 rep, that observed weight IS the
  // 1RM. The Epley formula must not inflate it beyond the observed value.

  test('1 rep returns the lifted weight unchanged (no upward extrapolation)', () => {
    expect(estimated1RM(100, 1)).toBe(100)
    expect(estimated1RM(142.5, 1)).toBe(142.5)
    expect(estimated1RM(60, 1)).toBe(60)
  })

  test('zero or negative weight returns 0', () => {
    expect(estimated1RM(0, 5)).toBe(0)
    expect(estimated1RM(-10, 5)).toBe(0)
  })

  test('zero or negative reps returns 0', () => {
    expect(estimated1RM(100, 0)).toBe(0)
    expect(estimated1RM(100, -1)).toBe(0)
  })
})

describe('isValid1RMEstimate (imported from lib/training/one-rm)', () => {
  test('reps 1–12 are valid', () => {
    for (let r = 1; r <= 12; r++) expect(isValid1RMEstimate(r)).toBe(true)
  })
  test('rep 0 is invalid',  () => expect(isValid1RMEstimate(0)).toBe(false))
  test('rep 13 is invalid', () => expect(isValid1RMEstimate(13)).toBe(false))
  test('rep 100 is invalid', () => expect(isValid1RMEstimate(100)).toBe(false))
})

// ─── calcOneRM — full calculator ──────────────────────────────────────────────

describe('calcOneRM — kg input', () => {
  test('100 kg × 5 reps produces 1RM in both units', () => {
    const result = calcOneRM({ weight: 100, unit: 'kg', reps: 5 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.oneRMKg).toBe(116.67)
      expect(result.oneRMLbs).toBe(kgToLbs(116.67))
    }
  })

  test('1 rep produces 1RM equal to the lifted weight (not inflated)', () => {
    const result = calcOneRM({ weight: 140, unit: 'kg', reps: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.oneRMKg).toBe(140)
      expect(result.oneRMLbs).toBe(kgToLbs(140))
    }
  })
})

describe('calcOneRM — lbs input', () => {
  test('225 lbs × 5 reps: converts to kg, computes 1RM, returns both units', () => {
    const result = calcOneRM({ weight: 225, unit: 'lbs', reps: 5 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const weightKg = lbsToKg(225)
      const expected1RMKg = estimated1RM(weightKg, 5)
      expect(result.oneRMKg).toBe(expected1RMKg)
      expect(result.oneRMLbs).toBe(kgToLbs(expected1RMKg))
    }
  })

  test('1 rep at 315 lbs returns 315 lbs equivalent in kg (not inflated)', () => {
    const result = calcOneRM({ weight: 315, unit: 'lbs', reps: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const expected = lbsToKg(315)
      expect(result.oneRMKg).toBe(expected)
    }
  })
})

describe('calcOneRM — invalid inputs', () => {
  test('weight 0 returns error', () => {
    const result = calcOneRM({ weight: 0, unit: 'kg', reps: 5 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_weight')
  })

  test('negative weight returns error', () => {
    const result = calcOneRM({ weight: -50, unit: 'lbs', reps: 5 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_weight')
  })

  test('NaN weight returns error', () => {
    const result = calcOneRM({ weight: NaN, unit: 'kg', reps: 5 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_weight')
  })

  test('Infinity weight returns error', () => {
    const result = calcOneRM({ weight: Infinity, unit: 'kg', reps: 5 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_weight')
  })

  test('reps 0 returns error', () => {
    const result = calcOneRM({ weight: 100, unit: 'kg', reps: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_reps')
  })

  test('negative reps returns error', () => {
    const result = calcOneRM({ weight: 100, unit: 'kg', reps: -3 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_reps')
  })

  test('non-integer reps returns error', () => {
    const result = calcOneRM({ weight: 100, unit: 'kg', reps: 5.5 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_reps')
  })

  test('13 reps returns reps_out_of_range error', () => {
    const result = calcOneRM({ weight: 100, unit: 'kg', reps: 13 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('reps_out_of_range')
  })

  test('100 reps returns reps_out_of_range error', () => {
    const result = calcOneRM({ weight: 100, unit: 'kg', reps: 100 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('reps_out_of_range')
  })
})

describe('calcOneRM — boundary rep counts', () => {
  test('reps 1 succeeds', () => {
    expect(calcOneRM({ weight: 100, unit: 'kg', reps: 1 }).ok).toBe(true)
  })
  test('reps 12 succeeds', () => {
    expect(calcOneRM({ weight: 100, unit: 'kg', reps: 12 }).ok).toBe(true)
  })
  test('reps 13 fails with reps_out_of_range', () => {
    const r = calcOneRM({ weight: 100, unit: 'kg', reps: 13 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('reps_out_of_range')
  })
})

// ─── trainingPercentages ──────────────────────────────────────────────────────

describe('trainingPercentages', () => {
  test('returns 9 rows for a valid 1RM', () => {
    expect(trainingPercentages(100).length).toBe(9)
  })

  test('100% row equals the 1RM', () => {
    const rows = trainingPercentages(100)
    const full = rows.find(r => r.percent === 100)
    expect(full?.weightKg).toBe(100)
    expect(full?.weightLbs).toBe(kgToLbs(100))
  })

  test('95% row is 95 kg for 1RM of 100 kg', () => {
    const rows = trainingPercentages(100)
    const row  = rows.find(r => r.percent === 95)
    expect(row?.weightKg).toBe(95)
  })

  test('70% row is 70 kg for 1RM of 100 kg', () => {
    const rows = trainingPercentages(100)
    const row  = rows.find(r => r.percent === 70)
    expect(row?.weightKg).toBe(70)
  })

  test('each row has a non-empty repRange label', () => {
    trainingPercentages(100).forEach(row => {
      expect(row.repRange.length).toBeGreaterThan(0)
    })
  })

  test('rows are ordered descending by percent', () => {
    const rows = trainingPercentages(100)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].percent).toBeLessThan(rows[i - 1].percent)
    }
  })

  test('all weight values are positive and finite', () => {
    trainingPercentages(120).forEach(row => {
      expect(isFinite(row.weightKg)).toBe(true)
      expect(row.weightKg).toBeGreaterThan(0)
      expect(isFinite(row.weightLbs)).toBe(true)
      expect(row.weightLbs).toBeGreaterThan(0)
    })
  })

  test('lbs values correspond to kg values via KG_TO_LBS conversion', () => {
    trainingPercentages(100).forEach(row => {
      expect(row.weightLbs).toBeCloseTo(row.weightKg * KG_TO_LBS, 0)
    })
  })

  test('returns empty array for 1RM of 0', () => {
    expect(trainingPercentages(0)).toHaveLength(0)
  })

  test('returns empty array for negative 1RM', () => {
    expect(trainingPercentages(-50)).toHaveLength(0)
  })

  test('returns empty array for NaN', () => {
    expect(trainingPercentages(NaN)).toHaveLength(0)
  })

  test('returns empty array for Infinity', () => {
    expect(trainingPercentages(Infinity)).toHaveLength(0)
  })
})

// ─── calcOneRM + trainingPercentages integration ──────────────────────────────

describe('calcOneRM → trainingPercentages integration', () => {
  test('pipeline from lbs input to percentage table', () => {
    const result = calcOneRM({ weight: 225, unit: 'lbs', reps: 5 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const rows = trainingPercentages(result.oneRMKg)
      expect(rows.length).toBeGreaterThan(0)
      // 100% row should be within 1 dp rounding tolerance of the computed 1RM
      // (trainingPercentages rounds to 1 dp; oneRMKg is 2 dp)
      const full = rows.find(r => r.percent === 100)
      expect(full?.weightKg).toBeCloseTo(result.oneRMKg, 0)
    }
  })

  test('1 rep pipeline: trainingPercentages 100% = original weight', () => {
    const result = calcOneRM({ weight: 200, unit: 'lbs', reps: 1 })
    if (result.ok) {
      const rows = trainingPercentages(result.oneRMKg)
      const full = rows.find(r => r.percent === 100)
      // 100% of 1RM for a 1-rep lift == the original lifted weight
      expect(full?.weightLbs).toBeCloseTo(200, 0)
    }
  })
})
