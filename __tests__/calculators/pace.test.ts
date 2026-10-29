import { describe, test, expect } from 'vitest'
import {
  hmsToSeconds,
  secondsToHms,
  formatPace,
  formatTime,
  calcPace,
  calcFinishTime,
  projectRaceTimes,
  STANDARD_DISTANCES,
  MI_PER_KM,
} from '@/lib/calculators/pace'

// ─── Constants ────────────────────────────────────────────────────────────────

describe('MI_PER_KM constant', () => {
  test('matches canonical value from use-distance-unit', () => {
    expect(MI_PER_KM).toBe(0.6213711922)
  })
})

describe('STANDARD_DISTANCES', () => {
  test('includes 6 entries (5 races + custom)', () => {
    expect(STANDARD_DISTANCES.length).toBe(6)
  })

  test('marathon is 42195 m', () => {
    const m = STANDARD_DISTANCES.find(d => d.key === 'marathon')
    expect(m?.meters).toBe(42195)
  })

  test('half marathon is 21097.5 m', () => {
    const hm = STANDARD_DISTANCES.find(d => d.key === 'half')
    expect(hm?.meters).toBe(21097.5)
  })

  test('1 mile is 1609.344 m', () => {
    const mi = STANDARD_DISTANCES.find(d => d.key === '1mi')
    expect(mi?.meters).toBe(1609.344)
  })

  test('custom entry has meters = 0', () => {
    const custom = STANDARD_DISTANCES.find(d => d.key === 'custom')
    expect(custom?.meters).toBe(0)
  })
})

// ─── hmsToSeconds ─────────────────────────────────────────────────────────────

describe('hmsToSeconds', () => {
  test('0:25:00 → 1500', () => expect(hmsToSeconds(0, 25, 0)).toBe(1500))
  test('1:00:00 → 3600', () => expect(hmsToSeconds(1, 0, 0)).toBe(3600))
  test('1:30:45 → 5445', () => expect(hmsToSeconds(1, 30, 45)).toBe(5445))
  test('0:00:30 → 30',   () => expect(hmsToSeconds(0, 0, 30)).toBe(30))
})

// ─── secondsToHms ─────────────────────────────────────────────────────────────

describe('secondsToHms', () => {
  test('1500 → 0:25:00', () => expect(secondsToHms(1500)).toEqual({ h: 0, m: 25, s: 0 }))
  test('3661 → 1:01:01', () => expect(secondsToHms(3661)).toEqual({ h: 1, m: 1, s: 1 }))
  test('60 → 0:01:00',   () => expect(secondsToHms(60)).toEqual({ h: 0, m: 1, s: 0 }))
  test('0 → 0:00:00',    () => expect(secondsToHms(0)).toEqual({ h: 0, m: 0, s: 0 }))

  test('round-trip: hmsToSeconds → secondsToHms', () => {
    const original = { h: 2, m: 34, s: 56 }
    const sec = hmsToSeconds(original.h, original.m, original.s)
    expect(secondsToHms(sec)).toEqual(original)
  })
})

// ─── formatPace ───────────────────────────────────────────────────────────────

describe('formatPace', () => {
  test('300 sec/km → "5:00"', () => expect(formatPace(300)).toBe('5:00'))
  test('302 sec/km → "5:02"', () => expect(formatPace(302)).toBe('5:02'))
  test('480 sec/km (8:00/km) → "8:00"', () => expect(formatPace(480)).toBe('8:00'))
  test('0 or negative → "—"', () => {
    expect(formatPace(0)).toBe('—')
    expect(formatPace(-1)).toBe('—')
  })
  test('Infinity → "—"', () => expect(formatPace(Infinity)).toBe('—'))
})

// ─── formatTime ──────────────────────────────────────────────────────────────

describe('formatTime', () => {
  test('1500 → "25:00"', () => expect(formatTime(1500)).toBe('25:00'))
  test('3661 → "1:01:01"', () => expect(formatTime(3661)).toBe('1:01:01'))
  test('3600 → "1:00:00"', () => expect(formatTime(3600)).toBe('1:00:00'))
  test('59 → "0:59"', () => expect(formatTime(59)).toBe('0:59'))
  test('negative → "—"', () => expect(formatTime(-1)).toBe('—'))
})

// ─── calcPace — 5 K in 25:00 ─────────────────────────────────────────────────
//
// Reference:
//   distanceKm = 5.0
//   distanceMi = 5.0 × 0.6213711922 = 3.10686…
//   totalSec   = 1500
//   pace/km    = 1500 / 5.0           = 300.0 sec/km  (5:00/km)
//   pace/mi    = 1500 / 3.10686       ≈ 482.8 sec/mi  (~8:02/mi)
//   speed km/h = 5.0 / (1500/3600)   = 12.0 km/h
//   speed mph  = 3.10686 / (1500/3600) ≈ 7.456 mph

describe('calcPace — 5K in 25:00', () => {
  const r = calcPace(5000, 0, 25, 0)

  test('ok is true', () => expect(r.ok).toBe(true))
  test('totalSeconds = 1500', () => {
    if (r.ok) expect(r.totalSeconds).toBe(1500)
  })
  test('paceSecPerKm = 300 (5:00/km)', () => {
    if (r.ok) expect(r.paceSecPerKm).toBeCloseTo(300, 2)
  })
  test('speedKmh = 12.0', () => {
    if (r.ok) expect(r.speedKmh).toBeCloseTo(12.0, 2)
  })
  test('speedMph ≈ 7.46', () => {
    if (r.ok) expect(r.speedMph).toBeCloseTo(7.456, 1)
  })
  test('paceSecPerMi ≈ 482.8', () => {
    if (r.ok) expect(r.paceSecPerMi).toBeCloseTo(482.8, 0)
  })
})

// ─── calcPace — 1 mile in 8:00 ───────────────────────────────────────────────

describe('calcPace — 1 mile in 8:00', () => {
  const r = calcPace(1609.344, 0, 8, 0)

  test('ok is true', () => expect(r.ok).toBe(true))
  test('paceSecPerMi = 480 (8:00/mi)', () => {
    if (r.ok) expect(r.paceSecPerMi).toBeCloseTo(480, 1)
  })
  test('speedMph = 7.5', () => {
    if (r.ok) expect(r.speedMph).toBeCloseTo(7.5, 1)
  })
})

// ─── calcPace — validation ────────────────────────────────────────────────────

describe('calcPace — invalid inputs', () => {
  test('zero distance → zero_distance error', () => {
    const r = calcPace(0, 0, 25, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('zero_distance')
  })

  test('negative distance → error', () => {
    expect(calcPace(-100, 0, 25, 0).ok).toBe(false)
  })

  test('zero time → zero_time error', () => {
    const r = calcPace(5000, 0, 0, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('zero_time')
  })

  test('seconds = 60 → invalid_time error', () => {
    const r = calcPace(5000, 0, 24, 60)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_time')
  })

  test('minutes = 60 → invalid_time error', () => {
    const r = calcPace(5000, 0, 60, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_time')
  })

  test('negative hours → error', () => {
    expect(calcPace(5000, -1, 25, 0).ok).toBe(false)
  })

  test('non-integer time components → error', () => {
    expect(calcPace(5000, 0, 25.5, 0).ok).toBe(false)
  })

  test('Infinity distance → error', () => {
    expect(calcPace(Infinity, 0, 25, 0).ok).toBe(false)
  })
})

// ─── calcFinishTime — 5K at 5:00/km ──────────────────────────────────────────
//
// 5K at 5:00/km = 5 × 300 = 1500 sec = 25:00

describe('calcFinishTime — 5K at 5:00/km', () => {
  const r = calcFinishTime(5000, 5, 0, 'km')

  test('ok is true', () => expect(r.ok).toBe(true))
  test('totalSeconds = 1500', () => {
    if (r.ok) expect(r.totalSeconds).toBe(1500)
  })
  test('paceSecPerKm = 300', () => {
    if (r.ok) expect(r.paceSecPerKm).toBeCloseTo(300, 2)
  })
})

// ─── calcFinishTime — marathon at 8:00/mi ─────────────────────────────────────
//
// 42195 m in miles = 42.195 / 1.609344 ≈ 26.219 mi
// totalSec = 26.219 × 480 ≈ 12585 sec ≈ 3:29:45

describe('calcFinishTime — marathon at 8:00/mi', () => {
  const r = calcFinishTime(42195, 8, 0, 'mi')

  test('ok is true', () => expect(r.ok).toBe(true))
  test('totalSeconds ≈ 12585', () => {
    if (r.ok) expect(r.totalSeconds).toBeCloseTo(12585, -1)
  })
  test('paceSecPerMi = 480', () => {
    if (r.ok) expect(r.paceSecPerMi).toBeCloseTo(480, 1)
  })
})

// ─── calcFinishTime — validation ─────────────────────────────────────────────

describe('calcFinishTime — invalid inputs', () => {
  test('zero distance → error', () => {
    expect(calcFinishTime(0, 5, 0, 'km').ok).toBe(false)
  })

  test('pace 0:00 → error', () => {
    const r = calcFinishTime(5000, 0, 0, 'km')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_pace')
  })

  test('pace seconds = 60 → error', () => {
    const r = calcFinishTime(5000, 5, 60, 'km')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_pace')
  })

  test('negative pace minutes → error', () => {
    expect(calcFinishTime(5000, -5, 0, 'km').ok).toBe(false)
  })
})

// ─── projectRaceTimes — Riegel formula ───────────────────────────────────────
//
// Reference: 5K in 25:00 (1500 sec)
// T2 = 1500 × (D2/5000)^1.06
// 10K: 1500 × 2^1.06 ≈ 1500 × 2.0842 ≈ 3126 sec ≈ 52:06
// Marathon: 1500 × (42195/5000)^1.06 ≈ 1500 × 9.59 ≈ 14385 sec ≈ 3:59:45

describe('projectRaceTimes — from 5K in 25:00', () => {
  const r = projectRaceTimes(5000, 1500)

  test('ok is true', () => expect(r.ok).toBe(true))

  test('does not include the reference distance', () => {
    if (r.ok) {
      const has5k = r.projections.some(p => Math.abs(p.meters - 5000) < 1)
      expect(has5k).toBe(false)
    }
  })

  test('does not include custom placeholder', () => {
    if (r.ok) {
      expect(r.projections.every(p => p.key !== 'custom')).toBe(true)
    }
  })

  test('includes marathon projection', () => {
    if (r.ok) {
      const m = r.projections.find(p => p.key === 'marathon')
      expect(m).toBeDefined()
    }
  })

  test('10K projection ≈ 52–53 min (Riegel 5K×2^1.06)', () => {
    if (r.ok) {
      const tenk = r.projections.find(p => p.key === '10k')
      expect(tenk).toBeDefined()
      if (tenk) {
        // 1500 × 2^1.06 ≈ 3126; allow ±5 sec for rounding
        expect(tenk.predictedSeconds).toBeCloseTo(3126, -1)
      }
    }
  })

  test('longer distance always predicts longer time', () => {
    if (r.ok) {
      const sorted = [...r.projections].sort((a, b) => a.meters - b.meters)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].predictedSeconds).toBeGreaterThan(sorted[i - 1].predictedSeconds)
      }
    }
  })
})

// ─── projectRaceTimes — validation ───────────────────────────────────────────

describe('projectRaceTimes — invalid inputs', () => {
  test('zero distance → error', () => {
    const r = projectRaceTimes(0, 1500)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('zero_distance')
  })

  test('zero time → error', () => {
    const r = projectRaceTimes(5000, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('zero_time')
  })

  test('negative time → error', () => {
    expect(projectRaceTimes(5000, -100).ok).toBe(false)
  })

  test('Infinity distance → error', () => {
    expect(projectRaceTimes(Infinity, 1500).ok).toBe(false)
  })
})

// ─── projectRaceTimes — custom distance matches standard distance ─────────────
//
// The page converts custom UI input to meters before calling projectRaceTimes.
// Entering "5.0 km" custom → 5000 m, which must exclude the 5K standard entry,
// identical to selecting the 5K preset button.

describe('projectRaceTimes — custom distance matching standard distance', () => {
  test('custom 5000 m input excludes the 5K projection (same as 5K preset)', () => {
    const r = projectRaceTimes(5000, 1500)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.projections.some(p => p.key === '5k')).toBe(false)
    }
  })

  test('custom 21097.5 m input excludes the half-marathon projection', () => {
    const r = projectRaceTimes(21097.5, 5400)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.projections.some(p => p.key === 'half')).toBe(false)
    }
  })

  test('custom 42195 m input excludes the marathon projection', () => {
    const r = projectRaceTimes(42195, 12600)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.projections.some(p => p.key === 'marathon')).toBe(false)
    }
  })

  test('near-but-not-exact custom distance does not exclude unrelated standard distance', () => {
    // 5100 m is clearly not 5K (100 m off), so 5K should appear in projections
    const r = projectRaceTimes(5100, 1530)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.projections.some(p => p.key === '5k')).toBe(true)
    }
  })
})

// ─── Unit consistency with use-distance-unit ─────────────────────────────────

describe('pace unit consistency — MI_PER_KM matches', () => {
  test('paceSecPerMi = paceSecPerKm / MI_PER_KM', () => {
    const r = calcPace(10000, 0, 50, 0) // 10K in 50 min
    if (r.ok) {
      const derived = r.paceSecPerKm / MI_PER_KM
      expect(r.paceSecPerMi).toBeCloseTo(derived, 5)
    }
  })

  test('speed mph = speed km/h × MI_PER_KM', () => {
    const r = calcPace(10000, 0, 50, 0)
    if (r.ok) {
      expect(r.speedMph).toBeCloseTo(r.speedKmh * MI_PER_KM, 5)
    }
  })
})
