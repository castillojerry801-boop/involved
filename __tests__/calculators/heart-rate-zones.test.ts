import { describe, test, expect } from 'vitest'
import {
  estimateMaxHR,
  calcHRZonesFromAge,
  calcHRZonesAdvanced,
} from '@/lib/calculators/heart-rate-zones'

// ─── Tanaka formula ───────────────────────────────────────────────────────────

describe('estimateMaxHR — Tanaka formula (208 − 0.7 × age)', () => {
  test('age 30 → 208 − 21 = 187', () => expect(estimateMaxHR(30)).toBe(187))
  test('age 40 → 208 − 28 = 180', () => expect(estimateMaxHR(40)).toBe(180))
  test('age 20 → 208 − 14 = 194', () => expect(estimateMaxHR(20)).toBe(194))
  test('age 50 → 208 − 35 = 173', () => expect(estimateMaxHR(50)).toBe(173))
  test('age 65 → 208 − 45.5 = 162.5 → rounds to 163', () => {
    expect(estimateMaxHR(65)).toBe(163)
  })
  test('age 10 → 208 − 7 = 201', () => expect(estimateMaxHR(10)).toBe(201))
})

// ─── Basic mode (age-based) ───────────────────────────────────────────────────

describe('calcHRZonesFromAge — ok result', () => {
  const result = calcHRZonesFromAge(30) // maxHR = 187

  test('ok is true for valid age', () => expect(result.ok).toBe(true))

  test('method is age_estimated', () => {
    if (result.ok) expect(result.method).toBe('age_estimated')
  })

  test('maxHR matches Tanaka for age 30', () => {
    if (result.ok) expect(result.maxHR).toBe(187)
  })

  test('restingHR is null (not provided)', () => {
    if (result.ok) expect(result.restingHR).toBeNull()
  })

  test('returns exactly 5 zones', () => {
    if (result.ok) expect(result.zones.length).toBe(5)
  })

  test('zones are numbered 1 through 5', () => {
    if (result.ok) {
      result.zones.forEach((z, i) => expect(z.zone).toBe(i + 1))
    }
  })

  test('Zone 1 min = round(0.50 × 187) = 94', () => {
    if (result.ok) expect(result.zones[0].minBpm).toBe(94)
  })

  test('Zone 1 max = round(0.60 × 187) = 112', () => {
    if (result.ok) expect(result.zones[0].maxBpm).toBe(112)
  })

  test('Zone 5 max = round(1.00 × 187) = 187', () => {
    if (result.ok) expect(result.zones[4].maxBpm).toBe(187)
  })

  test('zones are contiguous: each zone minBpm equals the previous maxBpm', () => {
    if (result.ok) {
      for (let i = 1; i < result.zones.length; i++) {
        expect(result.zones[i].minBpm).toBe(result.zones[i - 1].maxBpm)
      }
    }
  })

  test('no zone has minBpm >= maxBpm', () => {
    if (result.ok) {
      result.zones.forEach(z => expect(z.minBpm).toBeLessThan(z.maxBpm))
    }
  })
})

// ─── Basic mode — validation ──────────────────────────────────────────────────

describe('calcHRZonesFromAge — validation', () => {
  test('age 9 → error invalid_age', () => {
    const r = calcHRZonesFromAge(9)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_age')
  })

  test('age 101 → error invalid_age', () => {
    const r = calcHRZonesFromAge(101)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_age')
  })

  test('non-integer age → error', () => {
    const r = calcHRZonesFromAge(30.5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_age')
  })

  test('NaN age → error', () => {
    const r = calcHRZonesFromAge(NaN)
    expect(r.ok).toBe(false)
  })

  test('boundary age 10 → ok', () => expect(calcHRZonesFromAge(10).ok).toBe(true))
  test('boundary age 100 → ok', () => expect(calcHRZonesFromAge(100).ok).toBe(true))
})

// ─── Advanced mode — measured max HR only ────────────────────────────────────

describe('calcHRZonesAdvanced — measured max HR, no resting HR', () => {
  const result = calcHRZonesAdvanced(190)

  test('ok is true for valid maxHR', () => expect(result.ok).toBe(true))

  test('method is measured_max', () => {
    if (result.ok) expect(result.method).toBe('measured_max')
  })

  test('maxHR is preserved', () => {
    if (result.ok) expect(result.maxHR).toBe(190)
  })

  test('restingHR is null', () => {
    if (result.ok) expect(result.restingHR).toBeNull()
  })

  test('Zone 1 min = round(0.50 × 190) = 95', () => {
    if (result.ok) expect(result.zones[0].minBpm).toBe(95)
  })

  test('Zone 5 max = 190', () => {
    if (result.ok) expect(result.zones[4].maxBpm).toBe(190)
  })

  test('zones are contiguous', () => {
    if (result.ok) {
      for (let i = 1; i < result.zones.length; i++) {
        expect(result.zones[i].minBpm).toBe(result.zones[i - 1].maxBpm)
      }
    }
  })
})

// ─── Advanced mode — Karvonen (maxHR + restingHR) ─────────────────────────────

describe('calcHRZonesAdvanced — Karvonen method (maxHR 190, restingHR 60)', () => {
  // HRR = 130
  // Zone 1: 60 + 0.50×130 = 125  to  60 + 0.60×130 = 138
  // Zone 2: 138 to 60 + 0.70×130 = 151
  // Zone 5: 60 + 0.90×130 = 177 to 60 + 1.00×130 = 190
  const result = calcHRZonesAdvanced(190, 60)

  test('ok is true', () => expect(result.ok).toBe(true))

  test('method is karvonen', () => {
    if (result.ok) expect(result.method).toBe('karvonen')
  })

  test('restingHR is 60', () => {
    if (result.ok) expect(result.restingHR).toBe(60)
  })

  test('Zone 1 min = round(60 + 0.50 × 130) = 125', () => {
    if (result.ok) expect(result.zones[0].minBpm).toBe(125)
  })

  test('Zone 1 max = round(60 + 0.60 × 130) = 138', () => {
    if (result.ok) expect(result.zones[0].maxBpm).toBe(138)
  })

  test('Zone 5 max = round(60 + 1.00 × 130) = 190', () => {
    if (result.ok) expect(result.zones[4].maxBpm).toBe(190)
  })

  test('zones are contiguous', () => {
    if (result.ok) {
      for (let i = 1; i < result.zones.length; i++) {
        expect(result.zones[i].minBpm).toBe(result.zones[i - 1].maxBpm)
      }
    }
  })

  test('Karvonen zones have higher absolute bpm than direct-% zones for same maxHR', () => {
    const directResult = calcHRZonesAdvanced(190)
    if (result.ok && directResult.ok) {
      // With resting HR = 60, Karvonen zone 1 min (125) > direct zone 1 min (95)
      expect(result.zones[0].minBpm).toBeGreaterThan(directResult.zones[0].minBpm)
    }
  })
})

// ─── Advanced mode — validation ───────────────────────────────────────────────

describe('calcHRZonesAdvanced — validation', () => {
  test('maxHR 99 → error invalid_max_hr', () => {
    const r = calcHRZonesAdvanced(99)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_max_hr')
  })

  test('maxHR 231 → error invalid_max_hr', () => {
    const r = calcHRZonesAdvanced(231)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_max_hr')
  })

  test('maxHR boundary 100 → ok', () => expect(calcHRZonesAdvanced(100).ok).toBe(true))
  test('maxHR boundary 230 → ok', () => expect(calcHRZonesAdvanced(230).ok).toBe(true))

  test('restingHR 29 → error invalid_resting_hr', () => {
    const r = calcHRZonesAdvanced(180, 29)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_resting_hr')
  })

  test('restingHR 121 → error invalid_resting_hr', () => {
    const r = calcHRZonesAdvanced(180, 121)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_resting_hr')
  })

  test('restingHR equals maxHR (both 110) → error resting_exceeds_max', () => {
    const r = calcHRZonesAdvanced(110, 110)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('resting_exceeds_max')
  })

  test('restingHR > maxHR (110/115) → error resting_exceeds_max', () => {
    const r = calcHRZonesAdvanced(110, 115)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('resting_exceeds_max')
  })

  test('NaN maxHR → error', () => {
    const r = calcHRZonesAdvanced(NaN)
    expect(r.ok).toBe(false)
  })

  test('NaN restingHR → error', () => {
    const r = calcHRZonesAdvanced(180, NaN)
    expect(r.ok).toBe(false)
  })
})

// ─── Zone structure consistency ───────────────────────────────────────────────

describe('zone structure — all valid modes produce well-formed zones', () => {
  const cases: Array<() => ReturnType<typeof calcHRZonesFromAge>> = [
    () => calcHRZonesFromAge(25),
    () => calcHRZonesAdvanced(185),
    () => calcHRZonesAdvanced(185, 55),
  ]

  cases.forEach((fn, i) => {
    test(`case ${i + 1}: 5 zones, all have positive bpm range`, () => {
      const r = fn()
      if (r.ok) {
        expect(r.zones.length).toBe(5)
        r.zones.forEach(z => {
          expect(z.minBpm).toBeGreaterThan(0)
          expect(z.maxBpm).toBeGreaterThan(z.minBpm)
        })
      }
    })

    test(`case ${i + 1}: zones are contiguous (no gaps, no overlaps)`, () => {
      const r = fn()
      if (r.ok) {
        for (let j = 1; j < r.zones.length; j++) {
          expect(r.zones[j].minBpm).toBe(r.zones[j - 1].maxBpm)
        }
      }
    })
  })
})
