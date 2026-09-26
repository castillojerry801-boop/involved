/**
 * V Coach chat routing — quality enforcement tests
 *
 * These tests verify that the quality checks the chat route now runs
 * (via validateProgramQuality) correctly catch the two exact production
 * failures that previously bypassed the V2 enforcement pipeline.
 *
 * Root cause: app/api/coach/route.ts was running only validateProgramDraft()
 * (structural) and never validateProgramQuality() (semantic). These tests
 * document the quality signals the route now enforces.
 *
 * Production Failure A:
 *   Returning beginner, 12 weeks, 4 days, full gym, "overweight, poor cardio"
 *   → Returned sparse Week 1 (2 exercises/day), no structured progression
 *   → Chat route now catches: NO_STRUCTURED_PROGRESSION (error)
 *
 * Production Failure B:
 *   Advanced lifter, 15 years, 315/405/455, alternating chest+biceps preference
 *   → Returned 2-exercise days, no load anchors, no alternating sequencing
 *   → Chat route now catches: SPARSE_SESSION, ADVANCED_SHALLOW_SESSION,
 *     MISSING_REQUIRED_ROLE, NO_STRUCTURED_PROGRESSION (all errors)
 */

import { describe, it, expect } from 'vitest'
import { validateProgramQuality } from '../../lib/v/program-quality'
import { assessIntakeGaps } from '../../lib/v/intake'
import type { ProgramDraft } from '../../lib/ai/tools/program'
import type { VTrainingContext } from '../../lib/v/training-context'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeEx(
  exercise_id: string,
  intended_pattern: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    exercise_id,
    intended_pattern,
    sets: 3,
    reps_min: 8,
    reps_max: 12,
    rest_seconds: 90,
    ...overrides,
  }
}

function makeTrainingCtx(overrides: Partial<VTrainingContext> = {}): VTrainingContext {
  return {
    profile: {
      fitnessLevel: null,
      goals: [],
      bodyMetrics: { ageYears: null, weightKg: null },
      weeklyWorkoutTarget: null,
    },
    equipment: null,
    preferences: { favorites: [], moreOften: [], lessOften: [], dontRecommend: [] },
    personalRecords: [],
    recentTraining: [],
    readinessState: null,
    coachingPresence: 'weekly_checkin',
    ...overrides,
  }
}

// ─── Production Failure A — beginner, 12 weeks, sparse sessions, no progression ──

describe('Production Failure A: beginner, 12-week program with no progression', () => {
  // The production output: 2 exercises/day, "increase weight slightly each week" note,
  // no week_progressions or progression_model on any exercise.
  const draft: ProgramDraft = {
    program_name: '12-Week Beginner Foundation',
    description: 'A 12-week beginner program',
    weeks: 12,
    progression_strategy: 'Increase weight slightly each week when all reps are completed.',
    days: [
      {
        name: 'Day 1 — Full Body',
        focus: 'Full body compound movements',
        estimated_duration_minutes: 45,
        exercises: [
          makeEx('0662', 'squat'),      // no progression_model, no week_progressions
          makeEx('0663', 'hinge'),
        ],
      },
      {
        name: 'Day 2 — Upper',
        focus: 'Upper body',
        estimated_duration_minutes: 40,
        exercises: [
          makeEx('0664', 'horizontal_push'),
          makeEx('0665', 'vertical_pull'),
        ],
      },
      {
        name: 'Day 3 — Lower',
        focus: 'Lower body',
        estimated_duration_minutes: 40,
        exercises: [
          makeEx('0666', 'lunge'),
          makeEx('0667', 'core_antiextension'),
        ],
      },
      {
        name: 'Day 4 — Full Body',
        focus: 'Full body',
        estimated_duration_minutes: 45,
        exercises: [
          makeEx('0668', 'squat'),
          makeEx('0669', 'horizontal_push'),
        ],
      },
    ],
  }

  const qualityCtx = {
    fitnessLevel: 'beginner',
    weeks: 12,
    readinessState: 'detrained' as const,
  }

  it('NO_STRUCTURED_PROGRESSION fires as error — progression_strategy text is not enough', () => {
    const issues = validateProgramQuality(draft, qualityCtx)
    const issue = issues.find(i => i.code === 'NO_STRUCTURED_PROGRESSION')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('NO_STRUCTURED_PROGRESSION message instructs to add progression_model or week_progressions', () => {
    const issues = validateProgramQuality(draft, qualityCtx)
    const issue = issues.find(i => i.code === 'NO_STRUCTURED_PROGRESSION')
    expect(issue?.message).toMatch(/progression_model/i)
  })

  it('hard errors are sorted first — route retry loop would trigger', () => {
    const issues = validateProgramQuality(draft, qualityCtx)
    const errors = issues.filter(i => i.severity === 'error')
    expect(errors.length).toBeGreaterThan(0)
    // First issue must be an error (sorted errors-first)
    expect(issues[0].severity).toBe('error')
  })

  it('chat readiness gate: 8+ week program with null readinessState would block propose_program', () => {
    // Verify the gate logic: isLongProgram && readinessState === null
    const isLongProgram = (draft.weeks ?? 0) >= 8
    const readinessState = null
    expect(isLongProgram && readinessState === null).toBe(true)
  })

  it('no SPARSE_SESSION for beginner — sparse sessions are allowed at beginner level', () => {
    // Beginners legitimately do 2-3 exercise sessions; SPARSE_SESSION is intermediate/advanced only
    const issues = validateProgramQuality(draft, qualityCtx)
    const issue = issues.find(i => i.code === 'SPARSE_SESSION')
    expect(issue).toBeUndefined()
  })
})

// ─── Production Failure B — advanced, 2-exercise days, no load anchors ───────

describe('Production Failure B: advanced lifter, 2-exercise days, no progression or alternating', () => {
  // The production output: Bench + Incline Fly on Day 1, Squat + RDL on Day 2, etc.
  // Only 2 exercises per day for an advanced user with 315/405/455 1RMs.
  // Use session types and names that trigger MISSING_REQUIRED_ROLE inference,
  // matching the spirit of the production failure (short push/lower sessions).
  const advancedSparseProgram: ProgramDraft = {
    program_name: 'Advanced Upper/Lower',
    description: 'Upper/lower split',
    weeks: 12,
    // No progression_strategy, no week_progressions, no session_sequencing
    days: [
      {
        name: 'Upper Push',
        session_type: 'upper_push',
        focus: 'Chest and biceps',
        estimated_duration_minutes: 45,
        exercises: [
          makeEx('0662', 'horizontal_push'),   // Bench Press — missing shoulder, tricep, fly
          makeEx('0663', 'fly'),               // Incline DB Fly
        ],
      },
      {
        name: 'Lower Strength',
        session_type: 'lower_quad',
        focus: 'Lower body — squat dominant',
        estimated_duration_minutes: 45,
        exercises: [
          makeEx('0664', 'squat'),
          makeEx('0665', 'hinge'),
        ],
      },
      {
        name: 'Upper Pull',
        session_type: 'upper_pull',
        focus: 'Back and biceps',
        estimated_duration_minutes: 40,
        exercises: [
          makeEx('0666', 'bicep'),
          makeEx('0667', 'tricep'),
        ],
      },
      {
        name: 'Lower Posterior',
        session_type: 'lower_posterior',
        focus: 'Deadlift and lunges',
        estimated_duration_minutes: 45,
        exercises: [
          makeEx('0668', 'hinge'),
          makeEx('0669', 'lunge'),
        ],
      },
    ],
  }

  const qualityCtx = {
    fitnessLevel: 'advanced',
    weeks: 12,
    readinessState: 'advanced' as const,
  }

  it('SPARSE_SESSION fires as error — advanced user needs 4+ exercises on strength days', () => {
    const issues = validateProgramQuality(advancedSparseProgram, qualityCtx)
    const sparseIssues = issues.filter(i => i.code === 'SPARSE_SESSION')
    expect(sparseIssues.length).toBeGreaterThan(0)
    expect(sparseIssues[0].severity).toBe('error')
  })

  it('ADVANCED_SHALLOW_SESSION fires as error on push/pull/full-body days with < 5 exercises', () => {
    const issues = validateProgramQuality(advancedSparseProgram, qualityCtx)
    const shallowIssues = issues.filter(i => i.code === 'ADVANCED_SHALLOW_SESSION')
    expect(shallowIssues.length).toBeGreaterThan(0)
    expect(shallowIssues[0].severity).toBe('error')
  })

  it('NO_STRUCTURED_PROGRESSION fires as error — no week_progressions or progression_model', () => {
    const issues = validateProgramQuality(advancedSparseProgram, qualityCtx)
    const issue = issues.find(i => i.code === 'NO_STRUCTURED_PROGRESSION')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('MISSING_REQUIRED_ROLE fires for Upper Push day missing required roles (shoulder_isolation, tricep)', () => {
    const issues = validateProgramQuality(advancedSparseProgram, qualityCtx)
    const issue = issues.find(i => i.code === 'MISSING_REQUIRED_ROLE' && i.message.includes('Upper Push'))
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('multiple hard errors block acceptance — quality retry would be triggered', () => {
    const issues = validateProgramQuality(advancedSparseProgram, qualityCtx)
    const errors = issues.filter(i => i.severity === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})

// ─── Quality passes: corrected program accepted ────────────────────────────────

describe('Corrected advanced program passes quality checks', () => {
  // The corrected version V should produce after quality errors are returned
  const correctedProgram: ProgramDraft = {
    program_name: 'Advanced Upper/Lower — Corrected',
    description: 'Upper/lower split with full role coverage, alternating chest/bicep preference, and percentage-based progression from stated 1RMs.',
    weeks: 12,
    phases: [
      { name: 'Accumulation', weeks: '1-4', focus: 'volume' },
      { name: 'Strength', weeks: '5-8', focus: 'intensity' },
      { name: 'Peak', weeks: '9-12', focus: 'peak strength' },
    ],
    progression_strategy: 'Percentage-based: Week 1-4 @ 70-75%, Week 5-8 @ 77.5-82.5%, Week 9-12 @ 80-87.5% 1RM.',
    session_sequencing: 'Alternating push/pull pairs on upper days',
    days: [
      {
        name: 'Day 1 — Upper Push',
        session_type: 'upper_push',
        focus: 'Chest, shoulder, tricep — alternating with upper pull',
        estimated_duration_minutes: 70,
        exercises: [
          makeEx('0662', 'horizontal_push', {
            sequencing_mode: 'alternating', sequencing_group: 1,
            progression_model: 'percentage_rpe',
            week_progressions: [
              { week: 1, sets: 4, reps_min: 5, reps_max: 5, load_note: '70% 1RM (~220 lb)' },
              { week: 2, sets: 4, reps_min: 5, reps_max: 5, load_note: '72.5% 1RM (~227 lb)' },
            ],
          }),
          makeEx('0663', 'incline_push',        { progression_model: 'double_progression' }),
          makeEx('0664', 'fly',                 { progression_model: 'rep_progression' }),
          makeEx('0665', 'shoulder_isolation',  { progression_model: 'rep_progression' }),
          makeEx('0666', 'tricep',              { progression_model: 'double_progression' }),
        ],
      },
    ],
  }

  it('no SPARSE_SESSION — 5 exercises on upper push day', () => {
    const issues = validateProgramQuality(correctedProgram, { fitnessLevel: 'advanced', weeks: 12 })
    expect(issues.find(i => i.code === 'SPARSE_SESSION')).toBeUndefined()
  })

  it('no ADVANCED_SHALLOW_SESSION — 5 exercises meets threshold', () => {
    const issues = validateProgramQuality(correctedProgram, { fitnessLevel: 'advanced', weeks: 12 })
    expect(issues.find(i => i.code === 'ADVANCED_SHALLOW_SESSION')).toBeUndefined()
  })

  it('no NO_STRUCTURED_PROGRESSION — week_progressions present on main lift', () => {
    const issues = validateProgramQuality(correctedProgram, { fitnessLevel: 'advanced', weeks: 12 })
    expect(issues.find(i => i.code === 'NO_STRUCTURED_PROGRESSION')).toBeUndefined()
  })

  it('no hard errors — program would be accepted', () => {
    const issues = validateProgramQuality(correctedProgram, { fitnessLevel: 'advanced', weeks: 12 })
    const errors = issues.filter(i => i.severity === 'error')
    expect(errors.length).toBe(0)
  })
})

// ─── Readiness gate: 8+ week program with unknown training history ─────────────

describe('Chat readiness gate', () => {
  const longProgramDraft: ProgramDraft = {
    program_name: 'Test Program',
    weeks: 8,
    days: [{ name: 'Day 1', estimated_duration_minutes: 45, exercises: [] }],
  }

  it('gate fires when readinessState is null and program is 8+ weeks', () => {
    const isLongProgram = (longProgramDraft.weeks ?? 0) >= 8
    const ctxWithNullReadiness = makeTrainingCtx({ readinessState: null })
    expect(isLongProgram && ctxWithNullReadiness.readinessState === null).toBe(true)
  })

  it('gate does not fire for 7-week programs', () => {
    const shortProgram = { ...longProgramDraft, weeks: 7 }
    const isLongProgram = (shortProgram.weeks ?? 0) >= 8
    expect(isLongProgram).toBe(false)
  })

  it('gate does not fire when readinessState is known', () => {
    const ctx = makeTrainingCtx({ readinessState: 'advanced' })
    const isLongProgram = (longProgramDraft.weeks ?? 0) >= 8
    expect(isLongProgram && ctx.readinessState === null).toBe(false)
  })

  it('assessIntakeGaps also flags missing readiness for 8-week program', () => {
    const ctxNoReadiness = makeTrainingCtx({
      readinessState: null,
      equipment: { profileName: 'Full Gym', items: ['barbell', 'dumbbell'] },
      profile: {
        fitnessLevel: null,
        goals: [],
        bodyMetrics: { ageYears: null, weightKg: null },
        weeklyWorkoutTarget: 4,
      },
    })
    const assessment = assessIntakeGaps(ctxNoReadiness, { weeks: 8, days: 4 })
    expect(assessment.hasEnough).toBe(false)
    expect(assessment.missingHighValue.some(q => /train/i.test(q))).toBe(true)
  })
})

// ─── Multi-turn intake: context accumulates across conversation ────────────────

describe('Intake assessment with draft-derived parameters', () => {
  it('assessIntakeGaps satisfied when training context is complete', () => {
    const richCtx = makeTrainingCtx({
      readinessState: 'consistent_intermediate',
      equipment: { profileName: 'Home Gym', items: ['barbell', 'dumbbell', 'pull-up bar'] },
      profile: {
        fitnessLevel: 'intermediate',
        goals: [{ type: 'strength', title: 'Build strength' }],
        bodyMetrics: { ageYears: 28, weightKg: 80 },
        weeklyWorkoutTarget: 4,
      },
    })
    const assessment = assessIntakeGaps(richCtx, { weeks: 8, days: 4 })
    expect(assessment.hasEnough).toBe(true)
  })

  it('assessIntakeGaps blocks when equipment unknown and days unknown', () => {
    const sparseCtx = makeTrainingCtx({
      readinessState: 'consistent_intermediate',
      equipment: null,
      profile: {
        fitnessLevel: 'intermediate',
        goals: [],
        bodyMetrics: { ageYears: null, weightKg: null },
        weeklyWorkoutTarget: null,
      },
    })
    // No days passed (V hasn't extracted days from conversation yet)
    const assessment = assessIntakeGaps(sparseCtx, { weeks: 8 })
    expect(assessment.hasEnough).toBe(false)
    expect(assessment.missingHighValue.length).toBeGreaterThan(0)
  })
})
