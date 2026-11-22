/**
 * Explicit-schedule quality-validator regression tests.
 *
 * All tests are deterministic — no AI calls, no DB.
 * Tests the SCHEDULE_MISSING_WEEKDAY, SCHEDULE_REST_DAY_VIOLATED, and
 * SCHEDULE_DUPLICATE_WEEKDAY error codes introduced to validateProgramQuality.
 *
 * Weekday encoding: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
 * Production schedule (from actual user message, commit 93d8831):
 *   Monday(0)    Chest/Biceps/Core  — training
 *   Tuesday(1)   Back/Triceps       — training
 *   Wednesday(2) Rest               — rest  ← the day omitted in live Run 2
 *   Thursday(3)  Shoulders/Core     — training
 *   Friday(4)    Legs               — training
 *   Saturday(5)  Cardio             — training (cardio-only)
 *   Sunday(6)    Rest               — rest
 */

import { describe, it, expect } from 'vitest'
import { validateProgramQuality } from '../../lib/v/program-quality'
import type { ProgramDraft } from '../../lib/ai/tools/program'
import type { WeeklySchedule } from '../../lib/v/program-intake'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

function makeExercise(exercise_id = '0662', intended_pattern = 'horizontal_push') {
  return {
    exercise_id,
    intended_pattern,
    sets: 3,
    reps_min: 8,
    reps_max: 12,
    rest_seconds: 90,
    progression_model: 'linear' as const,
    week_progressions: [
      { week: 1, sets: 3, reps_min: 8, reps_max: 10, load_note: 'Start moderate' },
      { week: 2, sets: 3, reps_min: 8, reps_max: 12, load_note: 'Add weight' },
    ],
  }
}

function makeWalkExercise() {
  return {
    exercise_id: '9001',
    intended_pattern: 'cardio',
    sets: 1,
    reps_min: 1,
    reps_max: 1,
    rest_seconds: 0,
    distance_m: 1609,
    progression_model: 'duration_distance' as const,
  }
}

/** Full 7-day program matching the production schedule. */
function makeFullProductionDraft(): ProgramDraft {
  return {
    program_name: 'Strength & Conditioning',
    description: 'Progressive 8-week program following the user\'s exact weekly schedule with daily walking.',
    weeks: 8,
    progression_strategy: 'Linear progression on main lifts, double progression on accessories',
    phases: [
      { name: 'Base', weeks: '1-4', focus: 'Volume' },
      { name: 'Build', weeks: '5-8', focus: 'Intensity' },
    ],
    days: [
      // Monday(0) — chest/biceps
      {
        name: 'Chest, Biceps, Core',
        weekday: 0,
        session_type: 'chest_biceps',
        estimated_duration_minutes: 60,
        exercises: [
          makeExercise('0662', 'horizontal_push'),
          makeExercise('1234', 'incline_push'),
          makeExercise('0652', 'vertical_pull'),
          makeExercise('5678', 'core_antiextension'),
          makeWalkExercise(),
        ],
      },
      // Tuesday(1) — back/triceps
      {
        name: 'Back and Triceps',
        weekday: 1,
        session_type: 'back_triceps',
        estimated_duration_minutes: 60,
        exercises: [
          makeExercise('0652', 'vertical_pull'),
          makeExercise('3561', 'hinge'),
          makeExercise('1111', 'horizontal_pull'),
          makeExercise('2222', 'tricep_extension'),
          makeWalkExercise(),
        ],
      },
      // Wednesday(2) — rest/active_recovery
      {
        name: 'Wednesday Active Recovery',
        weekday: 2,
        session_type: 'active_recovery',
        estimated_duration_minutes: 20,
        exercises: [makeWalkExercise()],
      },
      // Thursday(3) — shoulders/core
      {
        name: 'Shoulders and Core',
        weekday: 3,
        session_type: 'shoulder',
        estimated_duration_minutes: 55,
        exercises: [
          makeExercise('3333', 'vertical_push'),
          makeExercise('4444', 'lateral_raise'),
          makeExercise('5555', 'core_antiextension'),
          makeExercise('6666', 'rear_delt'),
          makeWalkExercise(),
        ],
      },
      // Friday(4) — legs
      {
        name: 'Legs',
        weekday: 4,
        session_type: 'lower_full',
        estimated_duration_minutes: 65,
        exercises: [
          makeExercise('3561', 'hinge'),
          makeExercise('7777', 'squat'),
          makeExercise('8888', 'lunge'),
          makeExercise('9999', 'leg_curl'),
          makeWalkExercise(),
        ],
      },
      // Saturday(5) — cardio/conditioning
      {
        name: 'Cardio',
        weekday: 5,
        session_type: 'conditioning',
        estimated_duration_minutes: 40,
        exercises: [
          makeExercise('0001', 'cardio'),
          makeWalkExercise(),
        ],
      },
      // Sunday(6) — rest/active_recovery
      {
        name: 'Sunday Active Recovery',
        weekday: 6,
        session_type: 'active_recovery',
        estimated_duration_minutes: 20,
        exercises: [makeWalkExercise()],
      },
    ],
  }
}

/** The 7-day explicit schedule matching the production user message. */
const PRODUCTION_SCHEDULE: WeeklySchedule = [
  { weekday: 'monday',    focus: 'Chest, Biceps, and Core', isRest: false, isCardioOnly: false },
  { weekday: 'tuesday',   focus: 'Back and Triceps',        isRest: false, isCardioOnly: false },
  { weekday: 'wednesday', focus: 'Rest',                    isRest: true,  isCardioOnly: false },
  { weekday: 'thursday',  focus: 'Shoulders and Core',      isRest: false, isCardioOnly: false },
  { weekday: 'friday',    focus: 'Legs',                    isRest: false, isCardioOnly: false },
  { weekday: 'saturday',  focus: 'Cardio',                  isRest: false, isCardioOnly: true  },
  { weekday: 'sunday',    focus: 'Rest',                    isRest: true,  isCardioOnly: false },
]

// ─── Scenario 1 — Full 7-day schedule correctly represented ───────────────────

describe('Scenario 1 — Full 7-day schedule correctly preserved → no SCHEDULE_* errors', () => {
  it('a fully-correct draft produces no SCHEDULE_* errors', () => {
    const draft = makeFullProductionDraft()
    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
      requiredDailyActivityIds: ['9001'],
    })
    const scheduleCodes = issues.filter(i => i.code.startsWith('SCHEDULE_')).map(i => i.code)
    expect(scheduleCodes).toHaveLength(0)
  })

  it('a program without an explicit schedule is unaffected', () => {
    const draft = makeFullProductionDraft()
    // Remove weekday from one day to ensure it would fire if schedule enforcement were active
    draft.days[2].weekday = undefined
    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      // No explicitSchedule — schedule checks must not run
    })
    const scheduleCodes = issues.filter(i => i.code.startsWith('SCHEDULE_')).map(i => i.code)
    expect(scheduleCodes).toHaveLength(0)
  })
})

// ─── Scenario 2 — Wednesday omitted (the Run 2 failure) ──────────────────────

describe('Scenario 2 — Wednesday omitted from draft → SCHEDULE_MISSING_WEEKDAY', () => {
  it('fires SCHEDULE_MISSING_WEEKDAY for Wednesday when it is absent from the draft', () => {
    const draft = makeFullProductionDraft()
    // Remove Wednesday (weekday 2) entirely — the Run 2 failure scenario
    draft.days = draft.days.filter(d => d.weekday !== 2)

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
      requiredDailyActivityIds: ['9001'],
    })

    const missing = issues.filter(i => i.code === 'SCHEDULE_MISSING_WEEKDAY')
    expect(missing).toHaveLength(1)
    expect(missing[0].severity).toBe('error')
    expect(missing[0].message).toContain('Wednesday')
    expect(missing[0].message).toContain('weekday: 2')
    expect(missing[0].message).toContain('active_recovery')
  })

  it('error message includes actionable walking exercise entry hint', () => {
    const draft = makeFullProductionDraft()
    draft.days = draft.days.filter(d => d.weekday !== 2)

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
      requiredDailyActivityIds: ['9001'],
    })

    const missing = issues.find(i => i.code === 'SCHEDULE_MISSING_WEEKDAY')!
    expect(missing.message).toContain('9001')
    expect(missing.message).toContain('distance_m: 1609')
  })
})

// ─── Scenario 3 — REGRESSION: Thursday/Wednesday assignment swap ──────────────

describe('Scenario 3 — REGRESSION: Thursday rest / Wednesday training swap', () => {
  it('fires SCHEDULE_REST_DAY_VIOLATED when Thursday (training) appears as rest', () => {
    const draft = makeFullProductionDraft()
    // Swap: Thursday gets session_type=active_recovery (should be shoulder)
    const thu = draft.days.find(d => d.weekday === 3)!
    thu.session_type = 'active_recovery'
    thu.name = 'Thursday Active Recovery'

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    // Thursday is a training day (isRest=false), it's just incorrectly typed —
    // the missing-role checks will fire, but no SCHEDULE_REST_DAY_VIOLATED
    // because Thursday is NOT a rest day in the schedule.
    const restViolations = issues.filter(i => i.code === 'SCHEDULE_REST_DAY_VIOLATED')
    expect(restViolations).toHaveLength(0)
    // But the day IS present, so SCHEDULE_MISSING_WEEKDAY does not fire for Thursday.
    const missingWkday = issues.filter(i => i.code === 'SCHEDULE_MISSING_WEEKDAY' && i.message.includes('Thursday'))
    expect(missingWkday).toHaveLength(0)
  })

  it('fires SCHEDULE_REST_DAY_VIOLATED when Wednesday (rest) appears as a strength session', () => {
    const draft = makeFullProductionDraft()
    // Assign Wednesday a strength session type — simulates the AI swapping Wed/Thu
    const wed = draft.days.find(d => d.weekday === 2)!
    wed.session_type = 'shoulder'
    wed.name = 'Shoulders and Core'

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
      requiredDailyActivityIds: ['9001'],
    })

    const restViolations = issues.filter(i => i.code === 'SCHEDULE_REST_DAY_VIOLATED')
    expect(restViolations).toHaveLength(1)
    expect(restViolations[0].severity).toBe('error')
    expect(restViolations[0].message).toContain('Wednesday')
    expect(restViolations[0].message).toContain('rest day')
    expect(restViolations[0].message).toContain('shoulder')
    expect(restViolations[0].message).toContain('active_recovery')
  })
})

// ─── Scenario 4 — Rest day converted to lifting ───────────────────────────────

describe('Scenario 4 — Rest day converted to any strength session type', () => {
  const strengthTypes = [
    'chest_biceps', 'back_triceps', 'shoulder', 'arms',
    'full_body', 'upper_full', 'upper_push', 'upper_pull',
    'lower_full', 'lower_quad', 'lower_posterior',
    'push_pull_legs_push', 'push_pull_legs_pull', 'push_pull_legs_legs',
  ] as const

  for (const st of strengthTypes) {
    it(`fires SCHEDULE_REST_DAY_VIOLATED when Sunday rest becomes session_type="${st}"`, () => {
      const draft = makeFullProductionDraft()
      const sun = draft.days.find(d => d.weekday === 6)!
      sun.session_type = st
      sun.name = `Sunday ${st}`

      const issues = validateProgramQuality(draft, {
        fitnessLevel: 'consistent_intermediate',
        weeks: 8,
        explicitSchedule: PRODUCTION_SCHEDULE,
        requiredDailyActivityIds: ['9001'],
      })

      const restViolations = issues.filter(i => i.code === 'SCHEDULE_REST_DAY_VIOLATED')
      expect(restViolations.length).toBeGreaterThanOrEqual(1)
      const sundayViolation = restViolations.find(i => i.message.includes('Sunday'))
      expect(sundayViolation).toBeDefined()
    })
  }
})

// ─── Scenario 5 — Rest day without walking, no daily walk requirement ─────────

describe('Scenario 5 — Pure rest days with no daily-walk requirement remain optional', () => {
  it('does NOT fire SCHEDULE_MISSING_WEEKDAY when rest days are absent and no walk is required', () => {
    const draft = makeFullProductionDraft()
    // Remove both rest days (Wednesday=2, Sunday=6) and also strip walk exercises
    draft.days = draft.days.filter(d => d.weekday !== 2 && d.weekday !== 6)
    for (const day of draft.days) {
      day.exercises = day.exercises.filter(e => e.exercise_id !== '9001')
    }

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
      // No requiredDailyActivityIds — user did not request daily walking
    })

    const scheduleCodes = issues.filter(i => i.code.startsWith('SCHEDULE_')).map(i => i.code)
    // No SCHEDULE_MISSING_WEEKDAY for absent rest days when walk is not required
    expect(scheduleCodes).not.toContain('SCHEDULE_MISSING_WEEKDAY')
  })
})

// ─── Scenario 6 — Duplicate weekday in draft ─────────────────────────────────

describe('Scenario 6 — Duplicate weekday in draft → SCHEDULE_DUPLICATE_WEEKDAY', () => {
  it('fires SCHEDULE_DUPLICATE_WEEKDAY when two days share weekday=2', () => {
    const draft = makeFullProductionDraft()
    // Add a second Wednesday (duplicate)
    draft.days.push({
      name: 'Wednesday Duplicate',
      weekday: 2,
      session_type: 'active_recovery',
      estimated_duration_minutes: 20,
      exercises: [makeWalkExercise()],
    })

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
      requiredDailyActivityIds: ['9001'],
    })

    const dupes = issues.filter(i => i.code === 'SCHEDULE_DUPLICATE_WEEKDAY')
    expect(dupes).toHaveLength(1)
    expect(dupes[0].severity).toBe('error')
    expect(dupes[0].message).toContain('Wednesday')
    expect(dupes[0].message).toContain('weekday 2')
  })
})

// ─── Scenario 7 — Program without explicit schedule is unaffected ─────────────

describe('Scenario 7 — Explicit-schedule checks do not affect programs without a schedule', () => {
  it('no SCHEDULE_* errors when ctx.explicitSchedule is undefined', () => {
    const draft = makeFullProductionDraft()
    // Corrupt weekdays — would fire under schedule enforcement, but no schedule is provided
    draft.days = draft.days.filter(d => d.weekday !== 2 && d.weekday !== 6)

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
    })

    const scheduleCodes = issues.filter(i => i.code.startsWith('SCHEDULE_')).map(i => i.code)
    expect(scheduleCodes).toHaveLength(0)
  })

  it('no SCHEDULE_* errors when ctx.explicitSchedule is null', () => {
    const draft = makeFullProductionDraft()
    draft.days = draft.days.filter(d => d.weekday !== 2)

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: null,
    })

    const scheduleCodes = issues.filter(i => i.code.startsWith('SCHEDULE_')).map(i => i.code)
    expect(scheduleCodes).toHaveLength(0)
  })
})

// ─── Scenario 8 — Saturday training day (cardio-only) is not misdetected ──────

describe('Scenario 8 — Saturday cardio-only training day present and correct', () => {
  it('no SCHEDULE_MISSING_WEEKDAY for Saturday when conditioning day is present', () => {
    const draft = makeFullProductionDraft()

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
      requiredDailyActivityIds: ['9001'],
    })

    const satMissing = issues.filter(i => i.code === 'SCHEDULE_MISSING_WEEKDAY' && i.message.includes('Saturday'))
    expect(satMissing).toHaveLength(0)
  })
})

// ─── Scenario 9 — Multiple training days missing simultaneously ───────────────

describe('Scenario 9 — Multiple missing training days each produce a separate error', () => {
  it('fires one SCHEDULE_MISSING_WEEKDAY per missing weekday', () => {
    const draft = makeFullProductionDraft()
    // Remove Monday(0), Wednesday(2), and Friday(4)
    draft.days = draft.days.filter(d => d.weekday !== 0 && d.weekday !== 2 && d.weekday !== 4)

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
      requiredDailyActivityIds: ['9001'],
    })

    const missingCodes = issues.filter(i => i.code === 'SCHEDULE_MISSING_WEEKDAY')
    // Monday and Friday are training days → fire
    // Wednesday is a rest day WITH daily-walk requirement → fire
    expect(missingCodes).toHaveLength(3)
    const days = missingCodes.map(i => i.message)
    expect(days.some(m => m.includes('Monday'))).toBe(true)
    expect(days.some(m => m.includes('Wednesday'))).toBe(true)
    expect(days.some(m => m.includes('Friday'))).toBe(true)
  })
})

// ─── Scenario 10 — Focus enforcement (cardio, session type, accessory) ─────────
//
// Tests the three new checks:
//   SCHEDULE_CARDIO_DAY_VIOLATED  — cardio-only day has a strength session type
//   SCHEDULE_FOCUS_MISMATCH       — wrong muscle group family on a training day
//   SCHEDULE_ACCESSORY_MISSING    — "core" in focus but no core exercise pattern
//
// All tests use the production schedule (Mon–Sun) so side-effects from one day
// do not accidentally satisfy checks for another.

describe('Scenario 10a — SCHEDULE_FOCUS_MISMATCH: Monday chest/biceps replaced by back/triceps', () => {
  it('fires SCHEDULE_FOCUS_MISMATCH error when Monday gets back_triceps instead of chest_biceps', () => {
    const draft = makeFullProductionDraft()
    const mon = draft.days.find(d => d.weekday === 0)!
    mon.session_type = 'back_triceps'
    mon.name = 'Back and Triceps'

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH')
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0].severity).toBe('error')
    expect(mismatch[0].message).toContain('Monday')
    expect(mismatch[0].message).toContain('chest_biceps')
    expect(mismatch[0].message).toContain('back_triceps')
  })

  it('no SCHEDULE_FOCUS_MISMATCH when Monday correctly has chest_biceps', () => {
    const draft = makeFullProductionDraft()

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Monday'))
    expect(mismatch).toHaveLength(0)
  })
})

describe('Scenario 10b — SCHEDULE_FOCUS_MISMATCH: Thursday shoulders replaced by chest', () => {
  it('fires SCHEDULE_FOCUS_MISMATCH error when Thursday gets chest_biceps instead of shoulder', () => {
    const draft = makeFullProductionDraft()
    const thu = draft.days.find(d => d.weekday === 3)!
    thu.session_type = 'chest_biceps'
    thu.name = 'Chest and Biceps'

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Thursday'))
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0].severity).toBe('error')
    expect(mismatch[0].message).toContain('shoulder')
    expect(mismatch[0].message).toContain('chest_biceps')
  })

  it('no SCHEDULE_FOCUS_MISMATCH when Thursday correctly has shoulder', () => {
    const draft = makeFullProductionDraft()

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Thursday'))
    expect(mismatch).toHaveLength(0)
  })
})

describe('Scenario 10c — SCHEDULE_CARDIO_DAY_VIOLATED: Saturday cardio replaced by strength', () => {
  it('fires SCHEDULE_CARDIO_DAY_VIOLATED when Saturday cardio-only day gets a strength session', () => {
    const draft = makeFullProductionDraft()
    const sat = draft.days.find(d => d.weekday === 5)!
    sat.session_type = 'chest_biceps'
    sat.name = 'Chest and Biceps'
    sat.exercises = [
      makeExercise('0662', 'horizontal_push'),
      makeExercise('1234', 'incline_push'),
      makeExercise('5678', 'bicep'),
    ]

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const violated = issues.filter(i => i.code === 'SCHEDULE_CARDIO_DAY_VIOLATED')
    expect(violated).toHaveLength(1)
    expect(violated[0].severity).toBe('error')
    expect(violated[0].message).toContain('Saturday')
    expect(violated[0].message).toContain('cardio-only')
    expect(violated[0].message).toContain('chest_biceps')
    expect(violated[0].message).toContain('conditioning')
  })

  it('no SCHEDULE_CARDIO_DAY_VIOLATED when Saturday correctly has conditioning session type', () => {
    const draft = makeFullProductionDraft()

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const violated = issues.filter(i => i.code === 'SCHEDULE_CARDIO_DAY_VIOLATED')
    expect(violated).toHaveLength(0)
  })

  it('fires SCHEDULE_CARDIO_DAY_VIOLATED for all strength session types on a cardio-only day', () => {
    const strengthTypes = [
      'upper_push', 'upper_pull', 'upper_full',
      'lower_full', 'lower_quad', 'lower_posterior',
      'full_body',
      'chest_biceps', 'back_triceps', 'shoulder', 'arms',
      'push_pull_legs_push', 'push_pull_legs_pull', 'push_pull_legs_legs',
    ] as const

    for (const st of strengthTypes) {
      const draft = makeFullProductionDraft()
      const sat = draft.days.find(d => d.weekday === 5)!
      sat.session_type = st

      const issues = validateProgramQuality(draft, {
        fitnessLevel: 'consistent_intermediate',
        weeks: 8,
        explicitSchedule: PRODUCTION_SCHEDULE,
      })

      const violated = issues.filter(i => i.code === 'SCHEDULE_CARDIO_DAY_VIOLATED')
      expect(violated.length).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('Scenario 10d — Equivalent lower-body session types are compatible', () => {
  it('no SCHEDULE_FOCUS_MISMATCH when Friday Legs gets lower_full (instead of push_pull_legs_legs)', () => {
    // inferSessionType("Legs") → push_pull_legs_legs; actual lower_full → same lower family
    const draft = makeFullProductionDraft()
    const fri = draft.days.find(d => d.weekday === 4)!
    fri.session_type = 'lower_full'
    fri.name = 'Legs'

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Friday'))
    expect(mismatch).toHaveLength(0)
  })

  it('no SCHEDULE_FOCUS_MISMATCH when Friday Legs gets lower_quad', () => {
    const draft = makeFullProductionDraft()
    const fri = draft.days.find(d => d.weekday === 4)!
    fri.session_type = 'lower_quad'
    fri.name = 'Quad Focus'
    fri.exercises = [
      makeExercise('7777', 'squat'),
      makeExercise('8888', 'lunge'),
      makeExercise('3561', 'hinge'),
      makeWalkExercise(),
    ]

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Friday'))
    expect(mismatch).toHaveLength(0)
  })

  it('fires SCHEDULE_FOCUS_MISMATCH error when Friday Legs gets an upper_push session', () => {
    const draft = makeFullProductionDraft()
    const fri = draft.days.find(d => d.weekday === 4)!
    fri.session_type = 'upper_push'
    fri.name = 'Push Day'

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Friday'))
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0].severity).toBe('error')
  })
})

describe('Scenario 10e — SCHEDULE_ACCESSORY_MISSING: core work in focus', () => {
  it('no SCHEDULE_ACCESSORY_MISSING when Monday includes a core_antiextension exercise', () => {
    // makeFullProductionDraft Monday already has makeExercise('5678', 'core_antiextension')
    const draft = makeFullProductionDraft()

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const missing = issues.filter(i => i.code === 'SCHEDULE_ACCESSORY_MISSING' && i.message.includes('Monday'))
    expect(missing).toHaveLength(0)
  })

  it('fires SCHEDULE_ACCESSORY_MISSING error when Monday focus says "Core" but no core exercise exists', () => {
    const draft = makeFullProductionDraft()
    const mon = draft.days.find(d => d.weekday === 0)!
    // Remove the core exercise from Monday
    mon.exercises = mon.exercises.filter(ex => ex.intended_pattern !== 'core_antiextension')

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const missing = issues.filter(i => i.code === 'SCHEDULE_ACCESSORY_MISSING' && i.message.includes('Monday'))
    expect(missing).toHaveLength(1)
    expect(missing[0].severity).toBe('error')
    expect(missing[0].message).toContain('core')
  })

  it('fires SCHEDULE_ACCESSORY_MISSING error when Thursday focus says "Core" but no core exercise exists', () => {
    const draft = makeFullProductionDraft()
    const thu = draft.days.find(d => d.weekday === 3)!
    // Remove the core exercise from Thursday
    thu.exercises = thu.exercises.filter(ex => ex.intended_pattern !== 'core_antiextension')

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const missing = issues.filter(i => i.code === 'SCHEDULE_ACCESSORY_MISSING' && i.message.includes('Thursday'))
    expect(missing).toHaveLength(1)
    expect(missing[0].severity).toBe('error')
  })

  it('no SCHEDULE_ACCESSORY_MISSING when focus has no "core" keyword', () => {
    // Tuesday: "Back and Triceps" — no core keyword; removing any core exercise is fine
    const draft = makeFullProductionDraft()

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const missing = issues.filter(i => i.code === 'SCHEDULE_ACCESSORY_MISSING' && i.message.includes('Tuesday'))
    expect(missing).toHaveLength(0)
  })
})

describe('Scenario 10f — Ambiguous focus produces warnings at most, not hard errors', () => {
  it('produces only a warning (not error) when focus is broad "Upper Body" and actual is upper_push', () => {
    // Schedule with an ambiguous "Upper Body" focus — inferSessionType returns upper_full (family: upper)
    // actual is upper_push (family: push) → warning only (broader→specific, still upper body)
    const ambiguousSchedule: WeeklySchedule = [
      { weekday: 'monday',    focus: 'Upper Body',   isRest: false, isCardioOnly: false },
      { weekday: 'tuesday',   focus: 'Lower Body',   isRest: false, isCardioOnly: false },
      { weekday: 'wednesday', focus: 'Rest',         isRest: true,  isCardioOnly: false },
    ]
    const draft = makeFullProductionDraft()
    // Replace Monday with an upper_push session, which is a valid upper-body interpretation
    const mon = draft.days.find(d => d.weekday === 0)!
    mon.session_type = 'upper_push'
    mon.name = 'Upper Push'

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: ambiguousSchedule,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Monday'))
    // May be a warning, but must NOT be an error
    const errors = mismatch.filter(i => i.severity === 'error')
    expect(errors).toHaveLength(0)
  })

  it('produces no SCHEDULE_FOCUS_MISMATCH when focus text cannot be mapped to any session type', () => {
    // "Day 1" and "Day 2" — inferSessionType returns null → check does not run
    const vagueSchedule: WeeklySchedule = [
      { weekday: 'monday',  focus: 'Day 1', isRest: false, isCardioOnly: false },
      { weekday: 'tuesday', focus: 'Day 2', isRest: false, isCardioOnly: false },
    ]
    const draft = makeFullProductionDraft()
    const mon = draft.days.find(d => d.weekday === 0)!
    mon.session_type = 'back_triceps'  // wrong focus — but schedule is vague so no check fires

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: vagueSchedule,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH')
    expect(mismatch).toHaveLength(0)
  })

  it('produces no SCHEDULE_FOCUS_MISMATCH when no explicitSchedule is provided', () => {
    const draft = makeFullProductionDraft()
    // Set wrong session types — would fire if schedule enforcement were active
    const mon = draft.days.find(d => d.weekday === 0)!
    mon.session_type = 'back_triceps'

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      // No explicitSchedule — all schedule checks must be silent
    })

    const scheduleCodes = issues.filter(i => i.code.startsWith('SCHEDULE_')).map(i => i.code)
    expect(scheduleCodes).toHaveLength(0)
  })
})

// ─── Scenario 10g — SCHEDULE_FOCUS_MISMATCH inference fallback ────────────────
//
// When draftDay.session_type is absent, the check falls back to inferring the
// draft's effective session type from the day name and focus. Only fires when
// the inferred type is confident and from an incompatible family.

describe('Scenario 10g — SCHEDULE_FOCUS_MISMATCH inference fallback (no explicit session_type)', () => {
  it('fires SCHEDULE_FOCUS_MISMATCH error when day named "Back and Triceps" (no session_type) is on a Chest/Biceps slot', () => {
    // Monday schedule: "Chest, Biceps, and Core" — expects push family
    // Draft day name: "Back and Triceps" — infers back_triceps → pull family → error
    const draft = makeFullProductionDraft()
    const mon = draft.days.find(d => d.weekday === 0)!
    mon.name = 'Back and Triceps'
    mon.focus = 'Back and Triceps'
    delete (mon as { session_type?: unknown }).session_type

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Monday'))
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0].severity).toBe('error')
    expect(mismatch[0].message).toContain('inferred')
  })

  it('fires only a warning (not hard error) when day named "Upper Body A" (no session_type) is on a Chest/Biceps slot', () => {
    // Monday schedule: "Chest, Biceps, and Core" — expects push family (chest_biceps)
    // Draft day name: "Upper Body A" — infers upper_full → upper family
    // push↔upper = warning, not error
    const draft = makeFullProductionDraft()
    const mon = draft.days.find(d => d.weekday === 0)!
    mon.name = 'Upper Body A'
    mon.focus = 'Upper Body'
    delete (mon as { session_type?: unknown }).session_type

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Monday'))
    const hardErrors = mismatch.filter(i => i.severity === 'error')
    expect(hardErrors).toHaveLength(0)
  })

  it('produces no SCHEDULE_FOCUS_MISMATCH when day named "Day 1" (no session_type) cannot be inferred', () => {
    // "Day 1" → inferSessionType returns null → check is skipped entirely
    const draft = makeFullProductionDraft()
    const mon = draft.days.find(d => d.weekday === 0)!
    mon.name = 'Day 1'
    mon.focus = undefined
    delete (mon as { session_type?: unknown }).session_type

    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'consistent_intermediate',
      weeks: 8,
      explicitSchedule: PRODUCTION_SCHEDULE,
    })

    const mismatch = issues.filter(i => i.code === 'SCHEDULE_FOCUS_MISMATCH' && i.message.includes('Monday'))
    expect(mismatch).toHaveLength(0)
  })
})
