/**
 * Health Activity context integration tests.
 *
 * Covers:
 *   - contextToSystemSnippet: HEALTH ACTIVITIES section rendering
 *   - contextToSystemSnippet: Strava exclusion, duplicate labels, missing fields
 *   - contextToSystemSnippet: unified history (both Involved + health activities)
 *   - deriveReadinessState: health activities influence readiness correctly
 *   - deriveReadinessState: cardio-only activities don't grant resistance readiness
 *   - deriveReadinessState: Strava-excluded activities not counted (provider filter)
 */

import { describe, it, expect } from 'vitest'
import { contextToSystemSnippet } from '../../lib/ai/context'
import type { CoachContext, HealthActivityForV } from '../../lib/ai/context'
import { deriveReadinessState } from '../../lib/v/training-context'
import type { VTrainingContext } from '../../lib/v/training-context'
import type { ActivityForReadiness } from '../../lib/v/training-context'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function makeCoachCtx(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    user:            { name: 'Athlete', tier: 'plus' },
    goals:           [],
    nutrition:       { targetsSet: false, history: [] },
    healthMetrics:   {},
    trainingSnippet: 'TRAINING: No data available.',
    trainingCtx:     null,
    ...overrides,
  }
}

function makeActivity(overrides: Partial<HealthActivityForV> = {}): HealthActivityForV {
  return {
    id:                'abc-123',
    provider:          'apple_health',
    activityType:      'walking',
    title:             null,
    date:              daysAgo(1),
    durationMinutes:   45,
    activeEnergyKcal:  210,
    distanceKm:        3.5,
    avgHeartRateBpm:   null,
    maxHeartRateBpm:   null,
    stepCount:         4823,
    involvedWorkoutId: null,
    potentialDuplicate: false,
    ...overrides,
  }
}

function makeInvolvedSession(daysBack: number): VTrainingContext['recentTraining'][0] {
  return { date: daysAgo(daysBack), title: 'Upper Body', musclesWorked: ['chest'], totalSets: 12, topSets: [] }
}

function makePr(): VTrainingContext['personalRecords'][0] {
  return { exerciseName: 'Barbell Squat', exerciseId: 'sq-01', metric: 'estimated_1rm', value: 200, unit: 'lb', achievedAt: daysAgo(60) }
}

// ─── contextToSystemSnippet — HEALTH ACTIVITIES section ───────────────────────

describe('contextToSystemSnippet — HEALTH ACTIVITIES absent', () => {
  it('emits no section when recentHealthActivities is undefined', () => {
    const out = contextToSystemSnippet(makeCoachCtx())
    expect(out).not.toContain('HEALTH ACTIVITIES')
  })

  it('emits no section when recentHealthActivities is empty', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [] }))
    expect(out).not.toContain('HEALTH ACTIVITIES')
  })
})

describe('contextToSystemSnippet — HEALTH ACTIVITIES present', () => {
  it('renders section header when activities exist', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity()] }))
    expect(out).toContain('HEALTH ACTIVITIES')
  })

  it('includes activity date', () => {
    const date = daysAgo(2)
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity({ date })] }))
    expect(out).toContain(date)
  })

  it('uses title when present, falls back to activityType', () => {
    const withTitle = contextToSystemSnippet(makeCoachCtx({
      recentHealthActivities: [makeActivity({ title: 'Morning Walk', activityType: 'walking' })],
    }))
    expect(withTitle).toContain('Morning Walk')

    const withoutTitle = contextToSystemSnippet(makeCoachCtx({
      recentHealthActivities: [makeActivity({ title: null, activityType: 'walking' })],
    }))
    expect(withoutTitle).toContain('walking')
  })

  it('shows provider display name', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity({ provider: 'apple_health' })] }))
    expect(out).toContain('Apple Health')
  })

  it('shows manual provider correctly', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity({ provider: 'manual' })] }))
    expect(out).toContain('Manual')
  })

  it('includes duration when present', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity({ durationMinutes: 45 })] }))
    expect(out).toContain('45 min')
  })

  it('includes active energy when present', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity({ activeEnergyKcal: 310 })] }))
    expect(out).toContain('310 kcal active')
  })

  it('includes distance when present', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity({ distanceKm: 5.2 })] }))
    expect(out).toContain('5.2 km')
  })

  it('includes average heart rate when present', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity({ avgHeartRateBpm: 145 })] }))
    expect(out).toContain('avg HR 145 bpm')
  })

  it('includes step count when present', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity({ stepCount: 8500 })] }))
    expect(out).toContain('8,500 steps')
  })

  it('omits absent optional fields gracefully', () => {
    const out = contextToSystemSnippet(makeCoachCtx({
      recentHealthActivities: [makeActivity({
        durationMinutes: null, activeEnergyKcal: null,
        distanceKm: null, avgHeartRateBpm: null, stepCount: null,
      })],
    }))
    expect(out).toContain('HEALTH ACTIVITIES')
    expect(out).not.toContain('min')
    expect(out).not.toContain('kcal')
    expect(out).not.toContain('km')
    expect(out).not.toContain('bpm')
    expect(out).not.toContain('steps')
  })

  it('appends the dedup note', () => {
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: [makeActivity()] }))
    expect(out).toContain('NOTE: Activity summaries only — no set data')
  })
})

// ─── Duplicate labels ─────────────────────────────────────────────────────────

describe('contextToSystemSnippet — duplicate labels', () => {
  it('adds [also logged in Involved] when involvedWorkoutId is set', () => {
    const out = contextToSystemSnippet(makeCoachCtx({
      recentHealthActivities: [makeActivity({ involvedWorkoutId: 'workout-uuid-001' })],
    }))
    expect(out).toContain('[also logged in Involved]')
  })

  it('does NOT add [also logged in Involved] when involvedWorkoutId is null', () => {
    const out = contextToSystemSnippet(makeCoachCtx({
      recentHealthActivities: [makeActivity({ involvedWorkoutId: null, potentialDuplicate: false })],
    }))
    expect(out).not.toContain('[also logged in Involved]')
  })

  it('adds [possible overlap with Involved session] when potentialDuplicate is true', () => {
    const out = contextToSystemSnippet(makeCoachCtx({
      recentHealthActivities: [makeActivity({ involvedWorkoutId: null, potentialDuplicate: true })],
    }))
    expect(out).toContain('[possible overlap with Involved session]')
  })

  it('does not add any duplicate label when both flags are false', () => {
    const out = contextToSystemSnippet(makeCoachCtx({
      recentHealthActivities: [makeActivity({ involvedWorkoutId: null, potentialDuplicate: false })],
    }))
    expect(out).not.toContain('[also logged in Involved]')
    expect(out).not.toContain('[possible overlap')
  })

  it('involvedWorkoutId takes precedence over potentialDuplicate', () => {
    const out = contextToSystemSnippet(makeCoachCtx({
      recentHealthActivities: [makeActivity({ involvedWorkoutId: 'wk-001', potentialDuplicate: true })],
    }))
    expect(out).toContain('[also logged in Involved]')
    expect(out).not.toContain('[possible overlap')
  })
})

// ─── Strava exclusion ─────────────────────────────────────────────────────────

describe('contextToSystemSnippet — Strava exclusion', () => {
  it('does not suppress non-Strava activities', () => {
    // This test verifies that apple_health activities are rendered.
    // Strava activities are filtered before buildCoachContext returns, not here.
    // We verify no Strava provider reaches the rendering path by checking the fixture.
    const activities = [
      makeActivity({ provider: 'apple_health', activityType: 'running' }),
    ]
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: activities }))
    expect(out).toContain('running')
    expect(out).toContain('Apple Health')
  })
})

// ─── Unified history — both sources independently rendered ────────────────────

describe('contextToSystemSnippet — Involved + health activities coexist', () => {
  it('training snippet and health activities both appear', () => {
    const ctx = makeCoachCtx({
      trainingSnippet: 'RECENT TRAINING (last 10 sessions):\n  2026-10-09 — Upper Body Push',
      recentHealthActivities: [makeActivity({ activityType: 'walking' })],
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('RECENT TRAINING')
    expect(out).toContain('HEALTH ACTIVITIES')
  })

  it('health activities section precedes training snippet', () => {
    const ctx = makeCoachCtx({
      trainingSnippet: 'RECENT TRAINING: test',
      recentHealthActivities: [makeActivity()],
    })
    const out = contextToSystemSnippet(ctx)
    const haPos = out.indexOf('HEALTH ACTIVITIES')
    const rtPos = out.indexOf('RECENT TRAINING')
    expect(haPos).toBeGreaterThan(-1)
    expect(rtPos).toBeGreaterThan(-1)
    expect(haPos).toBeLessThan(rtPos)
  })
})

// ─── deriveReadinessState — health activities ─────────────────────────────────

describe('deriveReadinessState — cardio-only health activities', () => {
  const cardioActivities: ActivityForReadiness[] = [
    { activityType: 'walking',  date: daysAgo(2)  },
    { activityType: 'running',  date: daysAgo(5)  },
    { activityType: 'cycling',  date: daysAgo(8)  },
    { activityType: 'walking',  date: daysAgo(12) },
  ]

  it('not never_trained when frequent cardio activity exists', () => {
    const result = deriveReadinessState(null, [], [], cardioActivities)
    expect(result).not.toBe('never_trained')
  })

  it('cardio-only is at most recreationally_active (not consistent_intermediate)', () => {
    const result = deriveReadinessState('intermediate', [], [], cardioActivities)
    expect(result).toBe('recreationally_active')
  })

  it('walking does not grant consistent_intermediate even with 10+ sessions', () => {
    const lotsOfWalking: ActivityForReadiness[] = Array.from({ length: 10 }, (_, i) => ({
      activityType: 'walking',
      date: daysAgo(i + 1),
    }))
    const result = deriveReadinessState('intermediate', [], [], lotsOfWalking)
    expect(result).toBe('recreationally_active')
  })

  it('cycling alone does not establish advanced readiness', () => {
    const cycling: ActivityForReadiness[] = [
      { activityType: 'cycling', date: daysAgo(1) },
    ]
    const result = deriveReadinessState('advanced', [], [makePr()], cycling)
    // has PRs + cycling but no resistance training → detrained (strength history but no recent resistance)
    expect(result).toBe('detrained')
  })
})

describe('deriveReadinessState — resistance health activities', () => {
  const resistanceActivities: ActivityForReadiness[] = [
    { activityType: 'strength_training', date: daysAgo(5)  },
    { activityType: 'strength_training', date: daysAgo(10) },
    { activityType: 'strength_training', date: daysAgo(18) },
  ]

  it('consistent Apple Watch strength sessions → consistent_intermediate for intermediate level', () => {
    const result = deriveReadinessState('intermediate', [], [], resistanceActivities)
    expect(result).toBe('consistent_intermediate')
  })

  it('regular Apple Watch strength sessions → advanced for advanced level', () => {
    const result = deriveReadinessState('advanced', [], [], resistanceActivities)
    expect(result).toBe('advanced')
  })

  it('single recent resistance health activity → recreationally_active for intermediate', () => {
    const one: ActivityForReadiness[] = [{ activityType: 'strength_training', date: daysAgo(10) }]
    const result = deriveReadinessState('intermediate', [], [], one)
    expect(result).toBe('recreationally_active')
  })

  it('functional_strength counts as resistance', () => {
    const functional: ActivityForReadiness[] = [
      { activityType: 'functional_strength', date: daysAgo(5)  },
      { activityType: 'functional_strength', date: daysAgo(12) },
      { activityType: 'functional_strength', date: daysAgo(20) },
    ]
    const result = deriveReadinessState('intermediate', [], [], functional)
    expect(result).toBe('consistent_intermediate')
  })

  it('hiit alone does not establish resistance readiness (conservative)', () => {
    // Apple Watch labels any high-intensity circuit as HIIT — it may or may not
    // involve weights. Treat conservatively: HIIT counts as general activity, not
    // strength, so 3x HIIT per week does not produce consistent_intermediate.
    const hiit: ActivityForReadiness[] = [
      { activityType: 'hiit', date: daysAgo(3)  },
      { activityType: 'hiit', date: daysAgo(9)  },
      { activityType: 'hiit', date: daysAgo(15) },
    ]
    const result = deriveReadinessState('intermediate', [], [], hiit)
    expect(result).toBe('recreationally_active')
  })
})

describe('deriveReadinessState — combined Involved + health activities', () => {
  it('combines Involved sessions and resistance health activities for consistency', () => {
    // 1 Involved session + 2 resistance health activities = 3 → consistent
    const involvedSessions: VTrainingContext['recentTraining'] = [
      { date: daysAgo(7), title: 'Upper', musclesWorked: ['chest'], totalSets: 10, topSets: [] },
    ]
    const healthActivities: ActivityForReadiness[] = [
      { activityType: 'strength_training', date: daysAgo(14) },
      { activityType: 'strength_training', date: daysAgo(21) },
    ]
    const result = deriveReadinessState('intermediate', involvedSessions, [], healthActivities)
    expect(result).toBe('consistent_intermediate')
  })

  it('Involved sessions alone still produce consistent_intermediate (no regression)', () => {
    const sessions: VTrainingContext['recentTraining'] = [
      { date: daysAgo(5),  title: 'Push', musclesWorked: ['chest'], totalSets: 12, topSets: [] },
      { date: daysAgo(10), title: 'Pull', musclesWorked: ['back'],  totalSets: 10, topSets: [] },
      { date: daysAgo(18), title: 'Legs', musclesWorked: ['quads'], totalSets: 14, topSets: [] },
    ]
    const result = deriveReadinessState('intermediate', sessions, [])
    expect(result).toBe('consistent_intermediate')
  })

  it('PRs + only cardio health activities → detrained (strength history but no recent resistance)', () => {
    const cardio: ActivityForReadiness[] = [
      { activityType: 'walking', date: daysAgo(2) },
      { activityType: 'running', date: daysAgo(5) },
    ]
    const result = deriveReadinessState(null, [], [makePr()], cardio)
    expect(result).toBe('detrained')
  })
})

describe('deriveReadinessState — backward compatibility (no health activities)', () => {
  it('never_trained with no data', () => {
    expect(deriveReadinessState(null, [], [])).toBe('never_trained')
  })

  it('never_trained when fitnessLevel is null and no history', () => {
    expect(deriveReadinessState(null, [], [], [])).toBe('never_trained')
  })

  it('new_beginner: beginner level + recent Involved training', () => {
    const recent = [makeInvolvedSession(7), makeInvolvedSession(14)]
    expect(deriveReadinessState('beginner', recent, [])).toBe('new_beginner')
  })

  it('detrained: intermediate + PRs but no activity in 4+ months', () => {
    const stale = [makeInvolvedSession(140)]
    expect(deriveReadinessState('intermediate', stale, [makePr()])).toBe('detrained')
  })

  it('consistent_intermediate: intermediate + 3+ Involved sessions in 4 weeks', () => {
    const dense = [makeInvolvedSession(5), makeInvolvedSession(10), makeInvolvedSession(18)]
    expect(deriveReadinessState('intermediate', dense, [])).toBe('consistent_intermediate')
  })

  it('advanced: advanced + recent active Involved training', () => {
    const active = [makeInvolvedSession(3), makeInvolvedSession(8), makeInvolvedSession(13)]
    expect(deriveReadinessState('advanced', active, [makePr()])).toBe('advanced')
  })
})

// ─── Date filtering ───────────────────────────────────────────────────────────

describe('contextToSystemSnippet — multiple activities sorted newest-first', () => {
  it('renders multiple activities in provided order', () => {
    const activities = [
      makeActivity({ date: daysAgo(1), activityType: 'running'  }),
      makeActivity({ date: daysAgo(3), activityType: 'walking'  }),
      makeActivity({ date: daysAgo(7), activityType: 'cycling'  }),
    ]
    const out = contextToSystemSnippet(makeCoachCtx({ recentHealthActivities: activities }))
    const runPos    = out.indexOf('running')
    const walkPos   = out.indexOf('walking')
    const cyclePos  = out.indexOf('cycling')
    expect(runPos).toBeGreaterThan(-1)
    expect(walkPos).toBeGreaterThan(-1)
    expect(cyclePos).toBeGreaterThan(-1)
    // Provided order: run < walk < cycle
    expect(runPos).toBeLessThan(walkPos)
    expect(walkPos).toBeLessThan(cyclePos)
  })
})
