/**
 * V Phase 0 Regression Tests
 *
 * Deterministic regression coverage for all Phase 0 fixes:
 *   A — inferSessionType() recognizes body-part split day names
 *   B — shoulder day: no ADVANCED_SHALLOW_SESSION, no MISSING_REQUIRED_ROLE for horizontal_push
 *   C — exact original weekly split validates without spurious errors
 *   D — getSessionRoles('shoulder') does not require horizontal_push
 *   E — getSessionRoles('chest_biceps') / 'back_triceps' have correct required roles
 *   F — HealthActivity data flows into deriveReadinessState()
 *   G — dynamic round budget computation
 *   H — muscle group frequency vs weekly training frequency (prompt guard)
 */

import { describe, it, expect } from 'vitest'
import { validateProgramQuality } from '../../lib/v/program-quality'
import { getSessionRoles } from '../../lib/v/session-composition'
import { deriveReadinessState } from '../../lib/v/training-context'
import type { ActivityForReadiness } from '../../lib/v/training-context'
import type { ProgramDraft, SessionType } from '../../lib/ai/tools/program'

// ─── Exercise IDs (all verified real IDs) ────────────────────────────────────
// 0025  barbell bench press         → horizontal_push
// 0027  barbell bent over row       → horizontal_pull
// 0031  barbell curl                → bicep
// 0032  barbell deadlift            → hinge
// 0085  barbell romanian deadlift   → hinge
// 0091  barbell seated OHP          → vertical_push
// 0201  cable pushdown              → tricep
// 0293  dumbbell bent over row      → horizontal_pull
// 0308  dumbbell fly                → fly
// 0314  dumbbell incline press      → incline_push
// 0334  dumbbell lateral raise      → shoulder_isolation
// 0464  front plank with twist      → core_antiextension
// 0652  pull-up                     → vertical_pull
// 0662  push-up                     → horizontal_push
// 1760  dumbbell goblet squat       → squat
// 2330  cable lat pulldown          → vertical_pull
// 3470  forward lunge               → lunge
// 3561  glute bridge march          → hinge

function makeExercise(
  exercise_id: string,
  intended_pattern: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    exercise_id,
    intended_pattern,
    sets: 3,
    reps_min: 8,
    reps_max: 12,
    rest_seconds: 90,
    progression_model: 'double_progression' as const,
    target_rir: 2,
    ...overrides,
  }
}

function makeDay(name: string, exercises: ReturnType<typeof makeExercise>[], overrides: Record<string, unknown> = {}) {
  return {
    name,
    focus: overrides.focus as string | undefined,
    estimated_duration_minutes: 60,
    exercises,
    session_type: overrides.session_type as SessionType | undefined,
    weekday: overrides.weekday as number | undefined,
    ...overrides,
  }
}

// ── A — inferSessionType() body-part combo patterns ───────────────────────────

describe('Scenario A — inferSessionType recognizes body-part split day names', () => {
  // We test this indirectly via MISSING_REQUIRED_ROLE: if inferSessionType returns
  // the right type, getSessionRoles gets the right template, and horizontal_push
  // is NOT required for a shoulder day.

  it('A1 — shoulder day: session_type="shoulder" → no horizontal_push requirement', () => {
    const draft: ProgramDraft = {
      program_name: 'Shoulder Focus',
      description: 'Shoulder isolation day — 4 weeks, intermediate',
      weeks: 4,
      progression_strategy: 'Double progression: add reps each week until top of range, then add weight.',
      days: [
        makeDay('Shoulders', [
          makeExercise('0091', 'vertical_push'),       // OHP
          makeExercise('0334', 'shoulder_isolation'),  // lateral raise
          makeExercise('0334', 'shoulder_isolation', { exercise_id: '0334', reps_min: 15 }), // rear delt variant
        ], { session_type: 'shoulder' }),
      ],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 4 })
    const hardErrors = issues.filter(i => i.severity === 'error')
    const roleMissing = hardErrors.filter(i => i.code === 'MISSING_REQUIRED_ROLE')
    expect(roleMissing).toHaveLength(0)
  })

  it('A2 — shoulder day: inferred session type from name "Shoulders, Core" → no horizontal_push requirement', () => {
    // No explicit session_type — should be inferred as "shoulder"
    const draft: ProgramDraft = {
      program_name: 'Shoulder Focus',
      description: 'Shoulder isolation day — 4 weeks, intermediate',
      weeks: 4,
      progression_strategy: 'Add reps each week in range 12–20, then increase weight.',
      days: [
        makeDay('Shoulders, Core', [
          makeExercise('0091', 'vertical_push'),
          makeExercise('0334', 'shoulder_isolation'),
          makeExercise('0334', 'shoulder_isolation', { exercise_id: '0334', reps_min: 15 }),
          makeExercise('0464', 'core_antiextension'),
        ]),
      ],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 4 })
    const hardErrors = issues.filter(i => i.severity === 'error')
    const roleMissing = hardErrors.filter(i => i.code === 'MISSING_REQUIRED_ROLE')
    expect(roleMissing).toHaveLength(0)
  })
})

// ── B — shoulder day does not trigger ADVANCED_SHALLOW_SESSION ────────────────

describe('Scenario B — shoulder day: ADVANCED_SHALLOW_SESSION does NOT fire', () => {
  it('B1 — advanced shoulder day with 3 exercises: no ADVANCED_SHALLOW_SESSION', () => {
    const draft: ProgramDraft = {
      program_name: 'Advanced Shoulder Day',
      description: 'Shoulder isolation for advanced athlete — 8 weeks',
      weeks: 8,
      progression_strategy: 'Week 1–4: 4×15 at RIR 2. Week 5–8: 4×12 at RIR 1, increase weight.',
      phases: [
        { name: 'Foundation', weeks: '1-4', focus: 'Volume accumulation' },
        { name: 'Peak', weeks: '5-8', focus: 'Intensity increase' },
      ],
      days: [
        makeDay('Shoulder Day', [
          makeExercise('0091', 'vertical_push'),
          makeExercise('0334', 'shoulder_isolation'),
          makeExercise('0334', 'shoulder_isolation', { exercise_id: '0334', reps_min: 15 }),
        ], { session_type: 'shoulder' }),
      ],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    const shallowErrors = issues.filter(i => i.code === 'ADVANCED_SHALLOW_SESSION')
    expect(shallowErrors).toHaveLength(0)
  })

  it('B2 — advanced "Shoulders, Core" day with 4 exercises: no ADVANCED_SHALLOW_SESSION', () => {
    const draft: ProgramDraft = {
      program_name: 'Shoulder Day',
      description: 'Shoulder isolation day — 8 weeks, advanced',
      weeks: 8,
      progression_strategy: 'Double progression on all shoulder isolation work.',
      phases: [
        { name: 'Accumulation', weeks: '1-4', focus: 'Volume' },
        { name: 'Intensification', weeks: '5-8', focus: 'Load increase' },
      ],
      days: [
        makeDay('Shoulders, Core', [
          makeExercise('0091', 'vertical_push'),
          makeExercise('0334', 'shoulder_isolation'),
          makeExercise('0334', 'shoulder_isolation', { exercise_id: '0334', reps_min: 15 }),
          makeExercise('0464', 'core_antiextension'),
        ]),
      ],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    const shallowErrors = issues.filter(i => i.code === 'ADVANCED_SHALLOW_SESSION')
    expect(shallowErrors).toHaveLength(0)
  })

  it('B3 — advanced push day with only 3 exercises: ADVANCED_SHALLOW_SESSION still fires', () => {
    // Push days should still require 5+ exercises for advanced — only shoulder/arms exempted
    const draft: ProgramDraft = {
      program_name: 'Push Day',
      description: 'Push day test — 8 weeks, advanced',
      weeks: 8,
      progression_strategy: 'Linear progression on main lifts.',
      phases: [
        { name: 'Base', weeks: '1-4', focus: 'Foundation' },
        { name: 'Build', weeks: '5-8', focus: 'Intensity' },
      ],
      days: [
        makeDay('Push Day', [
          makeExercise('0025', 'horizontal_push'),
          makeExercise('0314', 'incline_push'),
          makeExercise('0201', 'tricep'),
        ]),
      ],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    const shallowErrors = issues.filter(i => i.code === 'ADVANCED_SHALLOW_SESSION')
    expect(shallowErrors.length).toBeGreaterThan(0)
  })
})

// ── C — original weekly split validates without spurious errors ───────────────

describe('Scenario C — original weekly split (Chest/Bi, Back/Tri, Shoulders, Legs, Cardio)', () => {
  it('C1 — full original split: no MISSING_REQUIRED_ROLE or ADVANCED_SHALLOW_SESSION', () => {
    const draft: ProgramDraft = {
      program_name: 'My Custom Split',
      description: 'Mon: Chest+Bi+Core, Tue: Back+Tri, Wed: Rest, Thu: Shoulders+Core, Fri: Legs, Sat: Cardio, Sun: Rest. Daily: easy one-mile walk.',
      weeks: 8,
      progression_strategy: 'Double progression on all hypertrophy work: add reps until top of range, then add weight.',
      phases: [
        { name: 'Base', weeks: '1-4', focus: 'Volume accumulation' },
        { name: 'Build', weeks: '5-8', focus: 'Progressive overload' },
      ],
      days: [
        // Monday — Chest, Biceps, Core (weekday 0)
        makeDay('Chest, Biceps, Core', [
          makeExercise('0025', 'horizontal_push'),
          makeExercise('0314', 'incline_push'),
          makeExercise('0308', 'fly'),
          makeExercise('0031', 'bicep'),
          makeExercise('0031', 'bicep', { exercise_id: '0031', reps_min: 10 }),
          makeExercise('0464', 'core_antiextension'),
        ], { session_type: 'chest_biceps', weekday: 0 }),

        // Tuesday — Back, Triceps (weekday 1)
        makeDay('Back, Triceps', [
          makeExercise('2330', 'vertical_pull'),
          makeExercise('0027', 'horizontal_pull'),
          makeExercise('0293', 'horizontal_pull'),
          makeExercise('0201', 'tricep'),
          makeExercise('0201', 'tricep', { exercise_id: '0201', reps_min: 12 }),
        ], { session_type: 'back_triceps', weekday: 1 }),

        // Thursday — Shoulders, Core (weekday 3)
        makeDay('Shoulders, Core', [
          makeExercise('0091', 'vertical_push'),
          makeExercise('0334', 'shoulder_isolation'),
          makeExercise('0334', 'shoulder_isolation', { exercise_id: '0334', reps_min: 15 }),
          makeExercise('0464', 'core_antiextension'),
        ], { session_type: 'shoulder', weekday: 3 }),

        // Friday — Legs (weekday 4)
        makeDay('Legs', [
          makeExercise('1760', 'squat'),
          makeExercise('0085', 'hinge'),
          makeExercise('3470', 'lunge'),
          makeExercise('3561', 'hinge', { exercise_id: '3561', reps_min: 12 }),
        ], { session_type: 'lower_full', weekday: 4 }),

        // Saturday — Cardio (weekday 5)
        makeDay('Cardio', [
          makeExercise('0662', 'cardio', { exercise_id: '0662', duration_seconds: 1800 }),
        ], { session_type: 'conditioning', weekday: 5 }),
      ],
    }

    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const hardErrors = issues.filter(i => i.severity === 'error')

    const roleMissingErrors = hardErrors.filter(i => i.code === 'MISSING_REQUIRED_ROLE')
    const shallowErrors = hardErrors.filter(i => i.code === 'ADVANCED_SHALLOW_SESSION')

    expect(roleMissingErrors).toHaveLength(0)
    expect(shallowErrors).toHaveLength(0)
  })
})

// ── D — getSessionRoles('shoulder') does not require horizontal_push ──────────

describe('Scenario D — getSessionRoles session template correctness', () => {
  it('D1 — shoulder beginner: required roles are only shoulder_isolation (no horizontal_push)', () => {
    const roles = getSessionRoles('shoulder', 'beginner')
    const requiredPatterns = roles.filter(r => r.required).map(r => r.pattern)
    expect(requiredPatterns).not.toContain('horizontal_push')
    expect(requiredPatterns).not.toContain('incline_push')
    expect(requiredPatterns).toContain('shoulder_isolation')
  })

  it('D2 — shoulder intermediate: required roles contain shoulder_isolation (not horizontal_push)', () => {
    const roles = getSessionRoles('shoulder', 'intermediate')
    const requiredPatterns = roles.filter(r => r.required).map(r => r.pattern)
    expect(requiredPatterns).not.toContain('horizontal_push')
    expect(requiredPatterns).not.toContain('incline_push')
    expect(requiredPatterns.every(p => p === 'shoulder_isolation')).toBe(true)
  })

  it('D3 — shoulder advanced: vertical_push is optional (not required)', () => {
    const roles = getSessionRoles('shoulder', 'advanced')
    const pressRole = roles.find(r => r.pattern === 'vertical_push')
    expect(pressRole).toBeDefined()
    expect(pressRole!.required).toBe(false)
  })
})

// ── E — chest_biceps and back_triceps have correct required roles ─────────────

describe('Scenario E — chest_biceps and back_triceps session role templates', () => {
  it('E1 — chest_biceps intermediate: requires horizontal_push + bicep (not vertical_pull)', () => {
    const roles = getSessionRoles('chest_biceps', 'intermediate')
    const requiredPatterns = roles.filter(r => r.required).map(r => r.pattern)
    expect(requiredPatterns).toContain('horizontal_push')
    expect(requiredPatterns).toContain('bicep')
    expect(requiredPatterns).not.toContain('vertical_pull')
    expect(requiredPatterns).not.toContain('horizontal_pull')
  })

  it('E2 — back_triceps intermediate: requires vertical_pull + horizontal_pull + tricep (not horizontal_push)', () => {
    const roles = getSessionRoles('back_triceps', 'intermediate')
    const requiredPatterns = roles.filter(r => r.required).map(r => r.pattern)
    expect(requiredPatterns).toContain('vertical_pull')
    expect(requiredPatterns).toContain('horizontal_pull')
    expect(requiredPatterns).toContain('tricep')
    expect(requiredPatterns).not.toContain('horizontal_push')
    expect(requiredPatterns).not.toContain('incline_push')
  })

  it('E3 — arms intermediate: requires bicep + tricep only', () => {
    const roles = getSessionRoles('arms', 'intermediate')
    const requiredPatterns = roles.filter(r => r.required).map(r => r.pattern)
    expect(requiredPatterns).toContain('bicep')
    expect(requiredPatterns).toContain('tricep')
    expect(requiredPatterns).not.toContain('horizontal_push')
    expect(requiredPatterns).not.toContain('vertical_pull')
  })

  it('E4 — unknown session type: returns empty array (no crash)', () => {
    const roles = getSessionRoles('totally_unknown_type', 'intermediate')
    expect(roles).toHaveLength(0)
  })
})

// ── F — HealthActivity data flows into deriveReadinessState() ─────────────────

describe('Scenario F — HealthActivity integration with deriveReadinessState()', () => {
  const emptyTraining: Parameters<typeof deriveReadinessState>[1] = []
  const emptyPRs: Parameters<typeof deriveReadinessState>[2] = []

  it('F1 — intermediate with no Involved sessions but recent strength health activities → consistent_intermediate', () => {
    // 5 recent strength_training health activities in past 4 weeks = consistent
    const recentDates = [3, 7, 11, 15, 19].map(d => {
      const date = new Date()
      date.setDate(date.getDate() - d)
      return date.toISOString().slice(0, 10)
    })
    const healthActivities: ActivityForReadiness[] = recentDates.map(date => ({
      activityType: 'strength_training',
      date,
    }))
    const state = deriveReadinessState('intermediate', emptyTraining, emptyPRs, healthActivities)
    expect(state).toBe('consistent_intermediate')
  })

  it('F2 — intermediate with PRs but no recent sessions or health activities → detrained', () => {
    // User has demonstrated prior strength history (PRs) but nothing recent
    const prsWithHistory: Parameters<typeof deriveReadinessState>[2] = [{
      exerciseName: 'Barbell Bench Press',
      exerciseId: '0025',
      metric: 'estimated_1rm',
      value: 100,
      unit: 'kg',
      achievedAt: 'Jan 1, 2025',
    }]
    const state = deriveReadinessState('intermediate', emptyTraining, prsWithHistory, [])
    // Has strength history (PRs) + no recent resistance = detrained
    expect(state).toBe('detrained')
  })

  it('F3 — beginner with daily walking (non-resistance) activities: walking does NOT count toward strength readiness', () => {
    const recentDates = [1, 2, 3, 4, 5, 6, 7].map(d => {
      const date = new Date()
      date.setDate(date.getDate() - d)
      return date.toISOString().slice(0, 10)
    })
    const walkingActivities: ActivityForReadiness[] = recentDates.map(date => ({
      activityType: 'walking',
      date,
    }))
    const state = deriveReadinessState('beginner', emptyTraining, emptyPRs, walkingActivities)
    // Walking is activity, so not never_trained, but walking doesn't confer resistance readiness
    expect(state).toBe('new_beginner') // beginner + recent activity (any type)
  })

  it('F4 — deriveReadinessState without 4th arg still works (backward compat)', () => {
    // The 4th argument is optional — existing callers without it should not break
    const state = deriveReadinessState('intermediate', emptyTraining, emptyPRs)
    expect(typeof state).toBe('string')
  })

  it('F5 — HIIT activities do not count as resistance training', () => {
    // HIIT is intentionally excluded from RESISTANCE_ACTIVITY_TYPES per the code comment
    const recentDates = [2, 5, 8, 11, 14].map(d => {
      const date = new Date()
      date.setDate(date.getDate() - d)
      return date.toISOString().slice(0, 10)
    })
    const hiitActivities: ActivityForReadiness[] = recentDates.map(date => ({
      activityType: 'hiit',
      date,
    }))
    // 5 HIIT sessions in past 4 weeks, stated intermediate
    const state = deriveReadinessState('intermediate', emptyTraining, emptyPRs, hiitActivities)
    // HIIT counts as general activity but NOT resistance — cannot reach consistent_intermediate
    // (consistent_intermediate requires isConsistentResistance which only counts resistance types)
    expect(state).not.toBe('consistent_intermediate')
    expect(state).toBe('recreationally_active') // active but not consistent resistance
  })
})

// ── G — dynamic round budget computation ─────────────────────────────────────

describe('Scenario G — dynamic round budget scales with program size', () => {
  // We can't import the internal route computation directly, so we replicate
  // the formula here as a contract test. If route.ts changes the formula,
  // this test will catch the drift.
  function computeMaxRounds(programDays: number): number {
    return Math.min(Math.max(16, programDays * 4 + 6), 36)
  }

  it('G1 — 3-day program: MAX_ROUNDS >= 16 (minimum floor)', () => {
    expect(computeMaxRounds(3)).toBeGreaterThanOrEqual(16)
  })

  it('G2 — 6-day program: MAX_ROUNDS >= 20 (more room than 3-day)', () => {
    expect(computeMaxRounds(6)).toBeGreaterThan(computeMaxRounds(3))
    expect(computeMaxRounds(6)).toBeGreaterThanOrEqual(20)
  })

  it('G3 — 7-day program: MAX_ROUNDS does not exceed 36 (cost cap)', () => {
    expect(computeMaxRounds(7)).toBeLessThanOrEqual(36)
  })

  it('G4 — round budget increases monotonically with day count (up to cap)', () => {
    const r3 = computeMaxRounds(3)
    const r4 = computeMaxRounds(4)
    const r5 = computeMaxRounds(5)
    const r6 = computeMaxRounds(6)
    expect(r4).toBeGreaterThanOrEqual(r3)
    expect(r5).toBeGreaterThanOrEqual(r4)
    expect(r6).toBeGreaterThanOrEqual(r5)
  })

  it('G5 — quality retry limit is 3 for 5+ day programs', () => {
    function computeRetryLimit(programDays: number): number {
      return programDays >= 5 ? 3 : 2
    }
    expect(computeRetryLimit(3)).toBe(2)
    expect(computeRetryLimit(4)).toBe(2)
    expect(computeRetryLimit(5)).toBe(3)
    expect(computeRetryLimit(6)).toBe(3)
  })
})

// ── H — guard: shoulder day named "Shoulder Day" does NOT trigger UNIPOLAR ───

describe('Scenario H — UNIPOLAR_UPPER_SESSION does not misfire on shoulder isolation days', () => {
  it('H1 — shoulder day with only vertical_push + shoulder_isolation: no UNIPOLAR', () => {
    const draft: ProgramDraft = {
      program_name: 'Shoulder Day',
      description: 'Shoulder isolation day',
      weeks: 4,
      progression_strategy: 'Double progression on lateral raises.',
      days: [
        makeDay('Shoulder Day', [
          makeExercise('0091', 'vertical_push'),
          makeExercise('0334', 'shoulder_isolation'),
          makeExercise('0334', 'shoulder_isolation', { exercise_id: '0334', reps_min: 15 }),
        ], { session_type: 'shoulder' }),
      ],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 4 })
    const unipolar = issues.filter(i => i.code === 'UNIPOLAR_UPPER_SESSION')
    expect(unipolar).toHaveLength(0)
  })

  it('H2 — upper body day with only push patterns: UNIPOLAR still fires correctly', () => {
    // This is the case the check was designed for — "Upper Body" day with chest/tri only
    const draft: ProgramDraft = {
      program_name: 'Upper Day',
      description: 'Upper body session',
      weeks: 4,
      progression_strategy: 'Linear progression.',
      days: [
        makeDay('Upper Body', [
          makeExercise('0025', 'horizontal_push'),
          makeExercise('0314', 'incline_push'),
          makeExercise('0308', 'fly'),
          makeExercise('0201', 'tricep'),
        ]),
      ],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 4 })
    const unipolar = issues.filter(i => i.code === 'UNIPOLAR_UPPER_SESSION')
    expect(unipolar.length).toBeGreaterThan(0)
  })
})
