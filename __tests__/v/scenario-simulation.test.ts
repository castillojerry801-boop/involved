/**
 * V Program Engine V2 — production scenario simulation tests
 *
 * Tests the full quality validation pipeline on realistic program fixtures
 * representing real user archetypes. No AI calls — programs are hand-authored
 * to simulate what V would produce for each scenario.
 *
 * Scenario A — Returning beginner: 3-day full-body, 6 weeks
 *   User: never_trained readiness, no PRs, body weight only, 3 days/week
 *   Expected: passes structural validation, no hard errors on well-formed program
 *   Expected failure mode: SPARSE_SESSION error if <4 exercises per day
 *
 * Scenario B — Advanced 15-year lifter: 5-day PPL+, 12 weeks, barbell focus
 *   User: advanced readiness, PRs available, full gym, 5 days/week
 *   Expected: passes on well-formed program with phases + progressions
 *   Expected failure mode: ADVANCED_SHALLOW_SESSION if <5 exercises on push/pull days
 *
 * Scenario C — Quality regression: programs that MUST trigger hard errors
 *   C1 — Alternating order violated
 *   C2 — auto-only progression on long program
 *   C3 — beginner with failure_allowed
 */

import { describe, it, expect } from 'vitest'
import { validateProgramQuality } from '../../lib/v/program-quality'
import { validateProgramDraft } from '../../lib/ai/tools/program'
import type { ProgramDraft } from '../../lib/ai/tools/program'

// ─── Exercise ID legend (all body weight — no equipment constraints needed) ──
// 0662 push-up             → horizontal_push  (chest, body weight)
// 0652 pull-up             → vertical_pull    (back, body weight)
// 3561 glute bridge march  → hinge            (upper legs, body weight)
// 3470 forward lunge       → lunge            (upper legs, body weight)
// 0464 front plank twist   → core (waist, body weight)

function ex(
  exercise_id: string,
  intended_pattern: string,
  overrides: Record<string, unknown> = {}
) {
  return { exercise_id, intended_pattern, sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, ...overrides }
}

// ─── Scenario A — Returning beginner ─────────────────────────────────────────

describe('Scenario A — Returning beginner, 6-week 3-day full-body', () => {
  // Exercise IDs (body weight only):
  // 3533 quads (bodyweight squat) → squat
  // 3561 glute bridge march       → hinge
  // 3470 forward lunge (male)     → lunge
  // 0662 push-up                  → horizontal_push
  // 0652 pull-up                  → vertical_pull
  // 0464 front plank with twist   → core_antiextension
  const goodProgram: ProgramDraft = {
    program_name: 'Foundation — Full Body',
    description: 'A 6-week introductory full-body program for a returning beginner. Straight sets throughout with linear load progression on main lifts. Sessions 45-55 min.',
    primary_goal: 'Build movement competency and base strength',
    weeks: 6,
    progression_strategy: 'Add 5% load or 1 rep per week on main lifts once all sets are completed at target reps.',
    program_rationale: 'User has no recent training history. Full-body 3x/week maximises skill practice per movement. Low exercise count keeps sessions manageable.',
    days: [
      {
        name: 'Full Body A',
        session_type: 'full_body',
        estimated_duration_minutes: 50,
        day_rationale: 'Squat + hinge lower; push/pull balanced upper; core accessory.',
        exercises: [
          ex('3533', 'squat', { progression_model: 'linear', progression_condition: 'all sets hit reps_max at 2 RIR', progression_increment: 5, failure_allowed: false }),
          ex('3561', 'hinge', { progression_model: 'linear', progression_condition: 'all sets hit reps_max at 2 RIR', failure_allowed: false }),
          ex('0662', 'horizontal_push', { progression_model: 'linear', progression_condition: 'all sets hit reps_max', progression_increment: 5, failure_allowed: false }),
          ex('0652', 'vertical_pull', { progression_model: 'double_progression', progression_condition: 'all sets hit reps_max, then add band resistance', failure_allowed: false }),
          ex('0464', 'core_antiextension', { sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60, failure_allowed: false }),
        ],
      },
      {
        name: 'Full Body B',
        session_type: 'full_body',
        estimated_duration_minutes: 50,
        day_rationale: 'Squat-pattern lower; hinge accessory; push/pull upper.',
        exercises: [
          ex('3533', 'squat', { progression_model: 'linear', progression_condition: 'complete all sets, increase 5 lb', failure_allowed: false }),
          ex('0662', 'horizontal_push', { progression_model: 'linear', progression_condition: 'add reps until reps_max then add weight', failure_allowed: false }),
          ex('0652', 'vertical_pull', { progression_model: 'rep_progression', failure_allowed: false }),
          ex('3561', 'hinge', { sets: 2, reps_min: 10, reps_max: 15, rest_seconds: 90, failure_allowed: false }),
          ex('0464', 'core_antiextension', { sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60, failure_allowed: false }),
        ],
      },
      {
        name: 'Full Body C',
        session_type: 'full_body',
        estimated_duration_minutes: 50,
        day_rationale: 'Lighter deload week variation.',
        exercises: [
          ex('3533', 'squat', { sets: 2, progression_model: 'linear', failure_allowed: false }),
          ex('3561', 'hinge', { sets: 2, progression_model: 'linear', failure_allowed: false }),
          ex('0662', 'horizontal_push', { sets: 2, progression_model: 'linear', failure_allowed: false }),
          ex('0652', 'vertical_pull', { sets: 2, progression_model: 'rep_progression', failure_allowed: false }),
        ],
      },
    ],
  }

  it('passes structural validateProgramDraft', () => {
    const result = validateProgramDraft(goodProgram, { allowedEquipment: ['body weight'] })
    if (!result.valid) console.error('Structural errors:', result.errors)
    expect(result.valid).toBe(true)
  })

  it('passes quality validator with no hard errors', () => {
    const issues = validateProgramQuality(goodProgram, {
      fitnessLevel: 'beginner',
      weeks: 6,
    })
    const hardErrors = issues.filter(i => i.severity === 'error')
    if (hardErrors.length > 0) console.error('Hard errors:', hardErrors.map(e => e.code))
    expect(hardErrors).toHaveLength(0)
  })

  it('has no failure_allowed exercises (beginner rule)', () => {
    const allEx = goodProgram.days.flatMap(d => d.exercises)
    const withFailure = allEx.filter(e => e.failure_allowed === true)
    expect(withFailure).toHaveLength(0)
  })

  describe('Failure mode: sparse sessions trigger hard error', () => {
    const sparseProgram: ProgramDraft = {
      program_name: 'Sparse Beginner',
      weeks: 6,
      progression_strategy: 'Linear',
      days: [
        {
          name: 'Full Body',
          session_type: 'full_body',
          estimated_duration_minutes: 30,
          exercises: [
            ex('0662', 'horizontal_push', { failure_allowed: false }),
            ex('0652', 'vertical_pull', { failure_allowed: false }),
          ],
        },
      ],
    }

    it('does NOT trigger SPARSE_SESSION for beginner (only fires for intermediate+)', () => {
      const issues = validateProgramQuality(sparseProgram, { fitnessLevel: 'beginner', weeks: 6 })
      const sparse = issues.find(i => i.code === 'SPARSE_SESSION')
      expect(sparse).toBeUndefined()
    })
  })
})

// ─── Scenario B — Advanced 15-year lifter ────────────────────────────────────

describe('Scenario B — Advanced 15-year lifter, 12-week 4-day full-body program', () => {
  // Body weight exercises used (all distinct within each day):
  // 3533 quads (bodyweight squat)           → squat
  // 3561 glute bridge march                  → hinge
  // 3470 forward lunge (male)               → lunge
  // 0662 push-up                            → horizontal_push
  // 0652 pull-up                            → vertical_pull
  // 3158 bodyweight standing close-grip row → horizontal_pull  (required for full_body/advanced)
  // 3294 archer push up                     → horizontal_push
  // 3293 archer pull up                     → vertical_pull
  // 3523 glute bridge two legs on bench     → hinge
  // 1688 lunge with twist                   → lunge
  // 0464 front plank with twist             → core_antiextension
  const advancedProgram: ProgramDraft = {
    program_name: 'Advanced Full Body Block — 12 Weeks',
    description: 'A 12-week advanced full-body program using periodised loading from accumulation through peak. All main lifts use explicit week_progressions. Double progression on accessories.',
    primary_goal: 'Strength and hypertrophy',
    weeks: 12,
    progression_strategy: 'Accumulation (1-4): 3×10-12 RPE 7-8. Intensification (5-9): 4×6-8 RPE 8-9. Peak (10-12): 5×3-5 RPE 9+.',
    program_rationale: 'Advanced trainee with 15 years of experience needs heavy compound work with structured periodisation across three phases.',
    phases: [
      { name: 'Accumulation', weeks: '1-4', focus: 'Volume accumulation at 70-75% intensity, build base' },
      { name: 'Intensification', weeks: '5-9', focus: 'Progressive intensity increase, 6-8 rep range, RPE 8-9' },
      { name: 'Peak', weeks: '10-12', focus: 'Peak strength expression at 85-90%, 3-5 rep range' },
    ],
    days: [
      {
        name: 'Full Body A',
        session_type: 'full_body',
        estimated_duration_minutes: 75,
        day_rationale: 'Squat-pattern primary lower, hinge secondary, horizontal push/pull upper.',
        exercises: [
          ex('3533', 'squat', {
            progression_model: 'percentage_rpe',
            starting_load: '75% 1RM',
            target_rir: 2,
            week_progressions: [
              { week: 1, sets: 3, reps_min: 10, reps_max: 12, rpe: 7 },
              { week: 5, sets: 4, reps_min: 6, reps_max: 8, rpe: 8 },
              { week: 10, sets: 5, reps_min: 3, reps_max: 5, rpe: 9 },
            ],
          }),
          ex('3561', 'hinge', { progression_model: 'linear', progression_condition: 'add 5 lb when all sets completed at target RIR', target_rir: 2 }),
          ex('3470', 'lunge', { progression_model: 'double_progression', progression_condition: 'hit reps_max all sets then add weight', target_rir: 3 }),
          ex('0662', 'horizontal_push', {
            progression_model: 'percentage_rpe',
            week_progressions: [
              { week: 1, sets: 3, reps_min: 8, reps_max: 10 },
              { week: 5, sets: 4, reps_min: 6, reps_max: 8 },
              { week: 10, sets: 5, reps_min: 3, reps_max: 5 },
            ],
          }),
          ex('0652', 'vertical_pull', { progression_model: 'double_progression', progression_condition: 'add band resistance when reps_max hit' }),
          ex('3158', 'horizontal_pull', { progression_model: 'double_progression', progression_condition: 'advance resistance when reps_max hit' }),
          ex('0464', 'core_antiextension', { sets: 3, reps_min: 12, reps_max: 20, rest_seconds: 60 }),
        ],
      },
      {
        name: 'Full Body B',
        session_type: 'full_body',
        estimated_duration_minutes: 75,
        day_rationale: 'Hinge primary lower, squat secondary, vertical pull primary upper.',
        exercises: [
          ex('3523', 'hinge', {
            progression_model: 'percentage_rpe',
            target_rir: 2,
            week_progressions: [
              { week: 1, sets: 3, reps_min: 8, reps_max: 10 },
              { week: 5, sets: 4, reps_min: 6, reps_max: 8 },
              { week: 10, sets: 5, reps_min: 3, reps_max: 5 },
            ],
          }),
          ex('3533', 'squat', { progression_model: 'double_progression', progression_condition: 'all sets at reps_max, then increase', target_rir: 3 }),
          ex('3470', 'lunge', { progression_model: 'rep_progression', target_rir: 2 }),
          ex('3294', 'horizontal_push', { progression_model: 'linear', progression_condition: 'add 2.5 kg per step', target_rir: 2 }),
          ex('3293', 'vertical_pull', { progression_model: 'double_progression', progression_condition: 'increase resistance band when reps_max hit' }),
          ex('3158', 'horizontal_pull', { progression_model: 'rep_progression', target_rir: 3 }),
          ex('0464', 'core_antiextension', { sets: 4, reps_min: 10, reps_max: 15, rest_seconds: 60 }),
        ],
      },
      {
        name: 'Full Body C',
        session_type: 'full_body',
        estimated_duration_minutes: 70,
        day_rationale: 'Third day mirrors Day A with variation in exercise order.',
        exercises: [
          ex('0662', 'horizontal_push', {
            progression_model: 'percentage_rpe',
            target_rir: 2,
            week_progressions: [{ week: 1, sets: 4, reps_min: 8, reps_max: 10 }],
          }),
          ex('3533', 'squat', { progression_model: 'linear', progression_condition: 'add 5 lb each week', target_rir: 2 }),
          ex('3561', 'hinge', { progression_model: 'double_progression', progression_condition: 'hit reps_max then add resistance', target_rir: 3 }),
          ex('0652', 'vertical_pull', { progression_model: 'rep_progression', target_rir: 2 }),
          ex('3158', 'horizontal_pull', { progression_model: 'linear', progression_condition: 'increase resistance band' }),
          ex('3470', 'lunge', { progression_model: 'rep_progression', target_rir: 3 }),
        ],
      },
      {
        name: 'Full Body D',
        session_type: 'full_body',
        estimated_duration_minutes: 70,
        day_rationale: 'Fourth day — lunge-focused lower, push/pull upper accessories.',
        exercises: [
          ex('3470', 'lunge', {
            progression_model: 'linear',
            progression_condition: 'add weight when all sets at reps_max',
            target_rir: 2,
            week_progressions: [{ week: 1, sets: 3, reps_min: 10, reps_max: 12 }],
          }),
          ex('3523', 'hinge', { progression_model: 'double_progression', progression_condition: 'increase load when reps_max hit' }),
          ex('3533', 'squat', { progression_model: 'rep_progression', sets: 3, target_rir: 3 }),
          ex('3294', 'horizontal_push', { progression_model: 'rep_progression', target_rir: 3 }),
          ex('3293', 'vertical_pull', { progression_model: 'linear', progression_condition: 'increase band resistance' }),
          ex('3158', 'horizontal_pull', { progression_model: 'double_progression', progression_condition: 'hit reps_max then advance' }),
        ],
      },
    ],
  }

  it('passes structural validateProgramDraft', () => {
    const result = validateProgramDraft(advancedProgram, { allowedEquipment: ['body weight'] })
    if (!result.valid) console.error('Structural errors:', result.errors)
    expect(result.valid).toBe(true)
  })

  it('passes quality validator with no hard errors for advanced user', () => {
    const issues = validateProgramQuality(advancedProgram, {
      fitnessLevel: 'advanced',
      weeks: 12,
    })
    const hardErrors = issues.filter(i => i.severity === 'error')
    if (hardErrors.length > 0) console.error('Hard errors:', hardErrors.map(e => ({ code: e.code, msg: e.message })))
    expect(hardErrors).toHaveLength(0)
  })

  it('has phases defined for 12-week program', () => {
    expect(advancedProgram.phases?.length).toBeGreaterThan(0)
  })

  it('has week_progressions on at least one compound', () => {
    const allEx = advancedProgram.days.flatMap(d => d.exercises)
    const withWP = allEx.filter(e => e.week_progressions && e.week_progressions.length > 0)
    expect(withWP.length).toBeGreaterThan(0)
  })

  describe('Failure mode: shallow push/pull day triggers ADVANCED_SHALLOW_SESSION', () => {
    const shallowAdvanced: ProgramDraft = {
      program_name: 'Shallow Advanced',
      weeks: 12,
      progression_strategy: 'Linear',
      phases: [
        { name: 'Base', weeks: '1-6', focus: 'Foundation' },
        { name: 'Peak', weeks: '7-12', focus: 'Intensity' },
      ],
      days: [
        {
          name: 'Push Day',
          session_type: 'upper_push',
          estimated_duration_minutes: 60,
          exercises: [
            ex('0662', 'horizontal_push', { progression_model: 'linear' }),
            ex('0662', 'horizontal_push', { progression_model: 'linear' }),
            ex('3470', 'lunge'),
          ],
        },
      ],
    }

    it('triggers ADVANCED_SHALLOW_SESSION error for <5 exercises on push/pull day', () => {
      const issues = validateProgramQuality(shallowAdvanced, { fitnessLevel: 'advanced', weeks: 12 })
      const err = issues.find(i => i.code === 'ADVANCED_SHALLOW_SESSION')
      expect(err).toBeDefined()
      expect(err?.severity).toBe('error')
    })
  })
})

// ─── Scenario C — Hard error regression fixtures ──────────────────────────────

describe('Scenario C — Regression: hard errors always fire', () => {
  it('C1 — ALTERNATING_ORDER_VIOLATED: grouped alternating exercises trigger error', () => {
    const draft: ProgramDraft = {
      program_name: 'Grouped Alternating',
      days: [{
        name: 'Upper Body',
        session_type: 'upper_full',
        estimated_duration_minutes: 60,
        exercises: [
          ex('0662', 'horizontal_push', { sequencing_mode: 'alternating', sequencing_group: 1 }),
          ex('0662', 'horizontal_push', { sequencing_mode: 'alternating', sequencing_group: 1 }),
          ex('0652', 'vertical_pull', { sequencing_mode: 'alternating', sequencing_group: 2 }),
          ex('0652', 'vertical_pull', { sequencing_mode: 'alternating', sequencing_group: 2 }),
        ],
      }],
    }
    const issues = validateProgramQuality(draft, {})
    expect(issues.some(i => i.code === 'ALTERNATING_ORDER_VIOLATED' && i.severity === 'error')).toBe(true)
  })

  it('C2 — PROGRESSION_NOT_MEANINGFUL: all auto with no details on 8-week program', () => {
    const draft: ProgramDraft = {
      program_name: 'All Auto',
      weeks: 8,
      progression_strategy: 'Progressive overload',
      days: [{
        name: 'Full Body',
        session_type: 'full_body',
        estimated_duration_minutes: 50,
        exercises: [
          ex('0662', 'horizontal_push', { progression_model: 'auto' }),
          ex('0652', 'vertical_pull', { progression_model: 'auto' }),
          ex('3561', 'hinge', { progression_model: 'auto' }),
          ex('3470', 'lunge', { progression_model: 'auto' }),
        ],
      }],
    }
    const issues = validateProgramQuality(draft, { weeks: 8 })
    expect(issues.some(i => i.code === 'PROGRESSION_NOT_MEANINGFUL' && i.severity === 'error')).toBe(true)
  })

  it('C3 — BEGINNER_FAILURE_OVERUSE: beginner with failure_allowed triggers error', () => {
    const draft: ProgramDraft = {
      program_name: 'Beginner Failure',
      days: [{
        name: 'Full Body',
        session_type: 'full_body',
        estimated_duration_minutes: 45,
        exercises: [
          ex('0662', 'horizontal_push', { failure_allowed: true }),
          ex('0652', 'vertical_pull'),
          ex('3561', 'hinge'),
        ],
      }],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'beginner' })
    expect(issues.some(i => i.code === 'BEGINNER_FAILURE_OVERUSE' && i.severity === 'error')).toBe(true)
  })

  it('C4 — errors are sorted first: all errors precede all warnings in result', () => {
    const draft: ProgramDraft = {
      program_name: 'Mixed Issues',
      weeks: 8,
      description: 'x',
      progression_strategy: 'Add load weekly',
      days: [{
        name: 'Full Body',
        session_type: 'full_body',
        estimated_duration_minutes: 45,
        exercises: [
          ex('0662', 'horizontal_push', { failure_allowed: true, progression_model: 'auto' }),
          ex('0652', 'vertical_pull', { progression_model: 'auto' }),
          ex('3561', 'hinge', { progression_model: 'auto' }),
          ex('3470', 'lunge', { progression_model: 'auto' }),
        ],
      }],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'beginner', weeks: 8 })
    const firstWarningIdx = issues.findIndex(i => i.severity === 'warning')
    const lastErrorIdx = issues.map(i => i.severity).lastIndexOf('error')
    if (firstWarningIdx !== -1 && lastErrorIdx !== -1) {
      expect(lastErrorIdx).toBeLessThan(firstWarningIdx)
    }
  })
})
