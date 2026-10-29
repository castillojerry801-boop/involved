import { describe, test, expect } from 'vitest'
import {
  calcWeightGoalTimeline,
  RATE_OPTIONS_KG,
  LOSS_RATE_OPTIONS_KG,
  GAIN_RATE_OPTIONS_KG,
  type WeightGoalDirection,
} from '@/lib/calculators/weight-goal'

// Fixed reference date for deterministic projection tests
const TODAY = new Date('2026-01-01T00:00:00Z')

// ─── Direction detection ──────────────────────────────────────────────────────

describe('calcWeightGoalTimeline — direction', () => {
  test('current > goal → loss', () => {
    const r = calcWeightGoalTimeline(80, 70, 0.5, TODAY)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.direction).toBe<WeightGoalDirection>('loss')
  })

  test('current < goal → gain', () => {
    const r = calcWeightGoalTimeline(60, 75, 0.5, TODAY)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.direction).toBe<WeightGoalDirection>('gain')
  })

  test('current === goal → maintain', () => {
    const r = calcWeightGoalTimeline(70, 70, 0.5, TODAY)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.direction).toBe<WeightGoalDirection>('maintain')
      expect(r.weeks).toBe(0)
    }
  })

  test('difference < 0.05 kg treated as maintain', () => {
    const r = calcWeightGoalTimeline(70, 70.03, 0.5, TODAY)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.direction).toBe('maintain')
  })
})

// ─── Week calculation ─────────────────────────────────────────────────────────

describe('calcWeightGoalTimeline — weeks', () => {
  test('10 kg diff at 0.5 kg/week → 20 weeks', () => {
    const r = calcWeightGoalTimeline(80, 70, 0.5, TODAY)
    if (r.ok) expect(r.weeks).toBe(20)
  })

  test('ceiling applied: 10.1 kg diff at 0.5 kg/week → 21 weeks', () => {
    const r = calcWeightGoalTimeline(80.1, 70, 0.5, TODAY)
    if (r.ok) expect(r.weeks).toBe(21)
  })

  test('5 kg diff at 1.0 kg/week → 5 weeks', () => {
    const r = calcWeightGoalTimeline(65, 70, 1.0, TODAY)
    if (r.ok) expect(r.weeks).toBe(5)
  })

  test('very gradual: 1 kg diff at 0.125 kg/week → 8 weeks', () => {
    const r = calcWeightGoalTimeline(80, 79, 0.125, TODAY)
    if (r.ok) expect(r.weeks).toBe(8)
  })

  test('weightDiffKg is the absolute difference', () => {
    const r = calcWeightGoalTimeline(80, 70, 0.5, TODAY)
    if (r.ok) expect(r.weightDiffKg).toBeCloseTo(10, 5)
  })

  test('weightDiffKg is absolute for gain direction too', () => {
    const r = calcWeightGoalTimeline(60, 70, 0.5, TODAY)
    if (r.ok) expect(r.weightDiffKg).toBeCloseTo(10, 5)
  })
})

// ─── Projected date ───────────────────────────────────────────────────────────

describe('calcWeightGoalTimeline — projected date', () => {
  test('20 weeks adds exactly 140 days', () => {
    const r = calcWeightGoalTimeline(80, 70, 0.5, TODAY)
    if (r.ok) {
      // Use getTime() comparison — timezone-agnostic since both sides have the same offset
      const MS_PER_DAY = 24 * 60 * 60 * 1000
      const daysDiff = Math.round((r.projectedDate.getTime() - TODAY.getTime()) / MS_PER_DAY)
      expect(daysDiff).toBe(140)
    }
  })

  test('maintain → projected date equals today', () => {
    const r = calcWeightGoalTimeline(70, 70, 0.5, TODAY)
    if (r.ok) {
      expect(r.projectedDate.getTime()).toBe(TODAY.getTime())
    }
  })
})

// ─── RATE_OPTIONS_KG ─────────────────────────────────────────────────────────

describe('RATE_OPTIONS_KG', () => {
  test('contains 5 options', () => {
    expect(RATE_OPTIONS_KG.length).toBe(5)
  })

  test('all values are positive and finite', () => {
    RATE_OPTIONS_KG.forEach(r => {
      expect(r).toBeGreaterThan(0)
      expect(isFinite(r)).toBe(true)
    })
  })

  test('options are in ascending order', () => {
    for (let i = 1; i < RATE_OPTIONS_KG.length; i++) {
      expect(RATE_OPTIONS_KG[i]).toBeGreaterThan(RATE_OPTIONS_KG[i - 1])
    }
  })

  test('slowest option is 0.125 kg/week', () => {
    expect(RATE_OPTIONS_KG[0]).toBe(0.125)
  })

  test('fastest option is 1.0 kg/week', () => {
    expect(RATE_OPTIONS_KG[RATE_OPTIONS_KG.length - 1]).toBe(1.0)
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('calcWeightGoalTimeline — invalid inputs', () => {
  test('zero current weight → error', () => {
    const r = calcWeightGoalTimeline(0, 70, 0.5, TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_current_weight')
  })

  test('negative current weight → error', () => {
    const r = calcWeightGoalTimeline(-5, 70, 0.5, TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_current_weight')
  })

  test('current weight > 500 kg → error', () => {
    const r = calcWeightGoalTimeline(501, 400, 0.5, TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_current_weight')
  })

  test('zero goal weight → error', () => {
    const r = calcWeightGoalTimeline(70, 0, 0.5, TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_goal_weight')
  })

  test('NaN current weight → error', () => {
    const r = calcWeightGoalTimeline(NaN, 70, 0.5, TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_current_weight')
  })

  test('NaN goal weight → error', () => {
    const r = calcWeightGoalTimeline(70, NaN, 0.5, TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_goal_weight')
  })

  test('zero rate → error', () => {
    const r = calcWeightGoalTimeline(80, 70, 0, TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_rate')
  })

  test('negative rate → error', () => {
    const r = calcWeightGoalTimeline(80, 70, -0.5, TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_rate')
  })

  test('Infinity rate → error', () => {
    const r = calcWeightGoalTimeline(80, 70, Infinity, TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_rate')
  })
})

// ─── Unit-invariant symmetry ──────────────────────────────────────────────────

describe('calcWeightGoalTimeline — symmetry', () => {
  test('loss 80→70 and gain 70→80 at same rate produce the same week count', () => {
    const loss = calcWeightGoalTimeline(80, 70, 0.5, TODAY)
    const gain = calcWeightGoalTimeline(70, 80, 0.5, TODAY)
    if (loss.ok && gain.ok) {
      expect(loss.weeks).toBe(gain.weeks)
      expect(loss.weightDiffKg).toBeCloseTo(gain.weightDiffKg, 5)
    }
  })
})

// ─── Direction-specific rate options ─────────────────────────────────────────

describe('LOSS_RATE_OPTIONS_KG', () => {
  test('RATE_OPTIONS_KG is the same reference as LOSS_RATE_OPTIONS_KG', () => {
    expect(RATE_OPTIONS_KG).toBe(LOSS_RATE_OPTIONS_KG)
  })

  test('has 5 options', () => expect(LOSS_RATE_OPTIONS_KG.length).toBe(5))

  test('max is 1.0 kg/week', () => {
    expect(LOSS_RATE_OPTIONS_KG[LOSS_RATE_OPTIONS_KG.length - 1]).toBe(1.0)
  })

  test('min is 0.125 kg/week', () => {
    expect(LOSS_RATE_OPTIONS_KG[0]).toBe(0.125)
  })

  test('all values positive and ascending', () => {
    for (let i = 1; i < LOSS_RATE_OPTIONS_KG.length; i++) {
      expect(LOSS_RATE_OPTIONS_KG[i]).toBeGreaterThan(LOSS_RATE_OPTIONS_KG[i - 1])
    }
  })
})

describe('GAIN_RATE_OPTIONS_KG', () => {
  test('max is 0.5 kg/week (gain capped)', () => {
    expect(GAIN_RATE_OPTIONS_KG[GAIN_RATE_OPTIONS_KG.length - 1]).toBe(0.5)
  })

  test('has 3 options', () => expect(GAIN_RATE_OPTIONS_KG.length).toBe(3))

  test('min is 0.125 kg/week', () => {
    expect(GAIN_RATE_OPTIONS_KG[0]).toBe(0.125)
  })

  test('no value exceeds 0.5 kg/week', () => {
    GAIN_RATE_OPTIONS_KG.forEach(r => expect(r).toBeLessThanOrEqual(0.5))
  })

  test('all values positive and ascending', () => {
    for (let i = 1; i < GAIN_RATE_OPTIONS_KG.length; i++) {
      expect(GAIN_RATE_OPTIONS_KG[i]).toBeGreaterThan(GAIN_RATE_OPTIONS_KG[i - 1])
    }
  })

  test('gain options are a subset of loss options', () => {
    GAIN_RATE_OPTIONS_KG.forEach(r => {
      expect(LOSS_RATE_OPTIONS_KG).toContain(r)
    })
  })
})
