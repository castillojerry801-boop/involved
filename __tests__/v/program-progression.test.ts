/**
 * 12-week executable progression — quality regression tests
 *
 * Proves a 12-week program has MATERIALLY different structure across
 * build → deload → build → deload → build → taper, and that a one-week
 * template dressed up with prose fails validation.
 *
 * These assert the new week-by-week checks in program-quality.ts in isolation
 * (by exercise-id-free fixtures — validateProgramQuality reads structure only).
 */

import { describe, it, expect } from 'vitest'
import { validateProgramQuality } from '../../lib/v/program-quality'
import type { ProgramDraft, WeekProgression } from '../../lib/ai/tools/program'

function ex(
  exercise_id: string,
  intended_pattern: string,
  week_progressions: WeekProgression[],
  overrides: Record<string, unknown> = {},
) {
  return {
    exercise_id,
    intended_pattern,
    sets: 3,
    reps_min: 8,
    reps_max: 12,
    rest_seconds: 120,
    progression_model: 'double_progression' as const,
    target_rir: 2,
    failure_allowed: false,
    week_progressions,
    ...overrides,
  }
}

const codes = (d: ProgramDraft) => validateProgramQuality(d, { fitnessLevel: 'beginner', weeks: d.weeks }).map(i => i.code)

// Build → deload(4) → build → deload(8) → build → taper(12): sets drop on deloads/taper.
const PERIODIZED: WeekProgression[] = [
  { week: 1,  sets: 3, reps_min: 8,  reps_max: 10 },
  { week: 3,  sets: 3, reps_min: 10, reps_max: 12 },
  { week: 4,  sets: 2, reps_min: 8,  reps_max: 10 }, // deload — fewer sets
  { week: 7,  sets: 4, reps_min: 8,  reps_max: 10 },
  { week: 8,  sets: 2, reps_min: 8,  reps_max: 10 }, // deload
  { week: 11, sets: 4, reps_min: 6,  reps_max: 8  },
  { week: 12, sets: 2, reps_min: 6,  reps_max: 8  }, // taper — reduced final week
]

// A simple, returning-trainee 2-day full-body program (kept intentionally simple).
function periodizedProgram(): ProgramDraft {
  return {
    program_name: 'Return to Training — 12 Week',
    description: 'A 12-week return-to-training block: two full-body days with double progression, deloads at weeks 4 and 8, and a reduced-volume final week.',
    weeks: 12,
    progression_strategy: 'Double progression: advance reps within range, then add load and reset. Deload weeks 4 and 8 drop to 2 sets. Week 12 tapers volume.',
    phases: [
      { name: 'Base', weeks: '1-4', focus: 'Rebuild work capacity' },
      { name: 'Build', weeks: '5-8', focus: 'Add load and volume' },
      { name: 'Peak', weeks: '9-12', focus: 'Heavier loading then taper' },
    ],
    days: [
      {
        name: 'Full Body A', session_type: 'full_body', estimated_duration_minutes: 55,
        exercises: [
          ex('0025', 'horizontal_push', PERIODIZED),
          ex('0100', 'horizontal_pull', PERIODIZED),
          ex('0043', 'squat', PERIODIZED),
        ],
      },
      {
        name: 'Full Body B', session_type: 'full_body', estimated_duration_minutes: 55,
        exercises: [
          ex('0052', 'vertical_pull', PERIODIZED),
          ex('0060', 'vertical_push', PERIODIZED),
          ex('0088', 'hinge', PERIODIZED),
        ],
      },
    ],
  }
}

describe('12-week periodized program — meaningful structured differences', () => {
  it('does NOT trip any of the new progression errors/warnings', () => {
    const c = codes(periodizedProgram())
    expect(c).not.toContain('WEEK_PROGRESSIONS_UNIFORM')
    expect(c).not.toContain('NO_STRUCTURED_DELOAD')
    expect(c).not.toContain('NO_FINAL_TAPER')
  })

  it('the prescription actually changes across weeks (build vs deload vs taper)', () => {
    // Deload weeks have strictly fewer sets than the build weeks around them.
    const build = PERIODIZED.find(w => w.week === 3)!.sets!
    const deload4 = PERIODIZED.find(w => w.week === 4)!.sets!
    const deload8 = PERIODIZED.find(w => w.week === 8)!.sets!
    const taper = PERIODIZED.find(w => w.week === 12)!.sets!
    const peak = PERIODIZED.find(w => w.week === 11)!.sets!
    expect(deload4).toBeLessThan(build)
    expect(deload8).toBeLessThan(build)
    expect(taper).toBeLessThan(peak)
  })
})

describe('one-week-template failures', () => {
  it('UNIFORM: identical week_progressions every week → error', () => {
    const uniform: WeekProgression[] = [
      { week: 1, sets: 3, reps_min: 8, reps_max: 12 },
      { week: 6, sets: 3, reps_min: 8, reps_max: 12 },
      { week: 12, sets: 3, reps_min: 8, reps_max: 12 },
    ]
    const d = periodizedProgram()
    d.phases = []                                   // remove phases so no deload phase masks it
    d.days.forEach(day => day.exercises.forEach(e => { e.week_progressions = uniform }))
    const c = codes(d)
    expect(c).toContain('WEEK_PROGRESSIONS_UNIFORM')
  })

  it('NO_STRUCTURED_DELOAD: monotonic increase, no volume drop, no deload phase → error', () => {
    const rising: WeekProgression[] = [
      { week: 1,  sets: 3, reps_min: 8,  reps_max: 10 },
      { week: 6,  sets: 4, reps_min: 8,  reps_max: 10 },
      { week: 12, sets: 5, reps_min: 8,  reps_max: 10 },
    ]
    const d = periodizedProgram()
    d.phases = [{ name: 'Build', weeks: '1-12', focus: 'Keep adding' }] // no deload/taper phase
    d.days.forEach(day => day.exercises.forEach(e => { e.week_progressions = rising }))
    const c = codes(d)
    expect(c).toContain('NO_STRUCTURED_DELOAD')
  })

  it('NO_FINAL_TAPER: has a mid-block deload but peaks at week 12 → warning', () => {
    const noTaper: WeekProgression[] = [
      { week: 1,  sets: 3, reps_min: 8, reps_max: 10 },
      { week: 4,  sets: 2, reps_min: 8, reps_max: 10 }, // deload (satisfies NO_STRUCTURED_DELOAD)
      { week: 8,  sets: 4, reps_min: 8, reps_max: 10 },
      { week: 12, sets: 5, reps_min: 6, reps_max: 8  }, // peak at the very end, no taper
    ]
    const d = periodizedProgram()
    d.phases = [{ name: 'Build', weeks: '1-12', focus: 'Ramp' }]
    d.days.forEach(day => day.exercises.forEach(e => { e.week_progressions = noTaper }))
    const c = codes(d)
    expect(c).not.toContain('NO_STRUCTURED_DELOAD')  // mid deload present
    expect(c).toContain('NO_FINAL_TAPER')
  })
})

describe('cardio duration progression', () => {
  it('CARDIO_DURATION_STATIC: fixed cardio duration while plan claims it increases → warning', () => {
    const d: ProgramDraft = {
      program_name: 'Return + Conditioning',
      weeks: 12,
      description: 'Full body plus easy aerobic work that builds gradually from 20 to 30 minutes.',
      progression_strategy: 'Easy aerobic duration increases gradually week to week.',
      phases: [{ name: 'Base', weeks: '1-6', focus: 'Aerobic base' }, { name: 'Build', weeks: '7-12', focus: 'More work' }],
      days: [
        {
          name: 'Full Body A', session_type: 'full_body', estimated_duration_minutes: 55,
          exercises: [ex('0025', 'horizontal_push', PERIODIZED), ex('0100', 'horizontal_pull', PERIODIZED), ex('0043', 'squat', PERIODIZED)],
        },
        {
          name: 'Easy Aerobic', session_type: 'conditioning', estimated_duration_minutes: 25,
          exercises: [
            // fixed duration, NO week_progressions → cannot encode the stated increase
            { exercise_id: '2138', intended_pattern: 'cardio', sets: 1, duration_seconds: 1200, rest_seconds: 0 },
          ],
        },
      ],
    }
    expect(codes(d)).toContain('CARDIO_DURATION_STATIC')
  })
})
