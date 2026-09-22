/**
 * V Program Engine — validation tests
 *
 * These tests validate the core of the V program pipeline:
 * validateProgramDraft() must accept well-formed programs and reject
 * malformed ones before anything touches the database.
 *
 * All exercise IDs come from the live exercises.json so the tests
 * catch regressions if the library is modified.
 *
 * Scenario A — Beginner home gym (body weight only)
 * Scenario B — Intermediate hypertrophy (barbell + dumbbell)
 * Scenario C — Hybrid athletic / Spartan-style (mixed equipment)
 * Scenario D — Modification produces a valid revised program
 * Scenario E — Invalid exercise ID is rejected
 */

import { describe, it, expect } from 'vitest'
import { validateProgramDraft } from '../../lib/ai/tools/program'
import type { ProgramDraft } from '../../lib/ai/tools/program'
import { executeExerciseSearch } from '../../lib/ai/tools/exercises'

// ─── Scenario A — Beginner / home gym ─────────────────────────────────────────
//
// 3 days/week, body weight only, 4 exercises per session.
// IDs verified from exercises.json:
//   0662  push-up           chest  body weight  → horizontal_push
//   0652  pull-up           back   body weight  → vertical_pull
//   3561  glute bridge march upper legs bw      → hinge
//   3470  forward lunge     upper legs bw       → lunge
//   0464  front plank with twist  waist  bw     → core_antiextension
// ─────────────────────────────────────────────────────────────────────────────

const scenarioA: ProgramDraft = {
  program_name: 'Beginner Home Gym — 3 Days',
  description: 'Full-body sessions three times a week using body weight only. Builds foundational strength and movement competency.',
  primary_goal: 'Build foundational strength',
  weeks: 4,
  progression_strategy: 'Add 1 rep per set each week. Move to weighted variations when hitting top of rep range.',
  days: [
    {
      name: 'Day A — Full Body',
      focus: 'Squat + Push dominant',
      estimated_duration_minutes: 35,
      exercises: [
        {
          exercise_id: '0662',  // push-up
          intended_pattern: 'horizontal_push',
          sets: 3,
          reps_min: 8,
          reps_max: 12,
          rest_seconds: 60,
          notes: 'Keep elbows at ~45° from torso',
        },
        {
          exercise_id: '3470',  // forward lunge
          intended_pattern: 'lunge',
          sets: 3,
          reps_min: 8,
          reps_max: 10,
          rest_seconds: 60,
        },
        {
          exercise_id: '3561',  // glute bridge march
          intended_pattern: 'hinge',
          sets: 3,
          reps_min: 10,
          reps_max: 15,
          rest_seconds: 45,
        },
        {
          exercise_id: '0464',  // front plank with twist
          intended_pattern: 'core_antiextension',
          sets: 3,
          duration_seconds: 30,
          rest_seconds: 45,
        },
      ],
    },
    {
      name: 'Day B — Full Body',
      focus: 'Pull + Hinge dominant',
      estimated_duration_minutes: 35,
      exercises: [
        {
          exercise_id: '0652',  // pull-up
          intended_pattern: 'vertical_pull',
          sets: 3,
          reps_min: 5,
          reps_max: 8,
          rest_seconds: 90,
          notes: 'Use band assistance if needed. Dead hang from the top for 1 second.',
        },
        {
          exercise_id: '3561',  // glute bridge march
          intended_pattern: 'hinge',
          sets: 3,
          reps_min: 12,
          reps_max: 15,
          rest_seconds: 45,
        },
        {
          exercise_id: '0662',  // push-up
          intended_pattern: 'horizontal_push',
          sets: 2,
          reps_min: 10,
          reps_max: 12,
          rest_seconds: 60,
        },
        {
          exercise_id: '0464',  // front plank with twist
          intended_pattern: 'core_antiextension',
          sets: 3,
          duration_seconds: 30,
          rest_seconds: 45,
        },
      ],
    },
  ],
}

describe('Scenario A — Beginner home gym', () => {
  it('validates a well-formed body weight program', () => {
    const result = validateProgramDraft(scenarioA)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.program).toBeDefined()
    expect(result.program!.days).toHaveLength(2)
    expect(result.program!.days[0].exercises).toHaveLength(4)
  })

  it('preserves program metadata through validation', () => {
    const result = validateProgramDraft(scenarioA)
    expect(result.program!.program_name).toBe('Beginner Home Gym — 3 Days')
    expect(result.program!.description).toBeDefined()
  })

  it('attaches exercise records from the library', () => {
    const result = validateProgramDraft(scenarioA)
    const firstEx = result.program!.days[0].exercises[0]
    expect(firstEx.exercise).toBeDefined()
    expect(firstEx.exercise.name.toLowerCase()).toContain('push')
  })
})

// ─── Scenario B — Intermediate hypertrophy ────────────────────────────────────
//
// 4-day upper/lower split.
// IDs verified:
//   0025  barbell bench press      chest  barbell    → horizontal_push
//   0027  barbell bent over row    back   barbell    → horizontal_pull
//   0032  barbell deadlift         upper legs bbl    → hinge
//   0085  barbell romanian deadlift upper legs bbl  → hinge (DIFFERENT family)
//   0031  barbell curl             upper arms bbl   → bicep
//   1760  dumbbell goblet squat    upper legs db    → squat
//   0293  dumbbell bent over row   back   dumbbell  → horizontal_pull
//   2330  cable lat pulldown full range  back cable → vertical_pull
// ─────────────────────────────────────────────────────────────────────────────

const scenarioB: ProgramDraft = {
  program_name: '4-Day Upper / Lower Hypertrophy',
  description: 'Upper/lower split with a volume focus. 8-week block with weekly progressive overload.',
  primary_goal: 'Muscle hypertrophy',
  weeks: 8,
  progression_strategy: 'Add 5 lb on main lifts every 2 weeks. Increase reps by 1 each week within the given range.',
  days: [
    {
      name: 'Upper A — Horizontal emphasis',
      focus: 'Horizontal push + pull, arm accessories',
      estimated_duration_minutes: 60,
      exercises: [
        {
          exercise_id: '0025',  // barbell bench press
          intended_pattern: 'horizontal_push',
          sets: 4,
          reps_min: 8,
          reps_max: 12,
          rest_seconds: 90,
          rpe: 8,
        },
        {
          exercise_id: '0027',  // barbell bent over row
          intended_pattern: 'horizontal_pull',
          sets: 4,
          reps_min: 8,
          reps_max: 10,
          rest_seconds: 90,
          rpe: 7.5,
        },
        {
          exercise_id: '0031',  // barbell curl
          intended_pattern: 'bicep',
          sets: 3,
          reps_min: 10,
          reps_max: 15,
          rest_seconds: 60,
        },
      ],
    },
    {
      name: 'Lower A — Squat emphasis',
      focus: 'Quad-dominant squat + posterior chain accessory',
      estimated_duration_minutes: 55,
      exercises: [
        {
          exercise_id: '1760',  // dumbbell goblet squat
          intended_pattern: 'squat',
          sets: 4,
          reps_min: 8,
          reps_max: 12,
          rest_seconds: 120,
          rpe: 8,
        },
        {
          exercise_id: '0085',  // barbell romanian deadlift
          intended_pattern: 'hinge',
          sets: 3,
          reps_min: 10,
          reps_max: 12,
          rest_seconds: 90,
        },
      ],
    },
    {
      name: 'Upper B — Vertical emphasis',
      focus: 'Vertical pull + push, arm accessories',
      estimated_duration_minutes: 60,
      exercises: [
        {
          exercise_id: '2330',  // cable lat pulldown
          intended_pattern: 'vertical_pull',
          sets: 4,
          reps_min: 10,
          reps_max: 12,
          rest_seconds: 90,
        },
        {
          exercise_id: '0293',  // dumbbell bent over row
          intended_pattern: 'horizontal_pull',
          sets: 3,
          reps_min: 10,
          reps_max: 12,
          rest_seconds: 75,
        },
        {
          exercise_id: '0031',  // barbell curl (accessory)
          intended_pattern: 'bicep',
          sets: 3,
          reps_min: 12,
          reps_max: 15,
          rest_seconds: 60,
        },
      ],
    },
    {
      name: 'Lower B — Hinge emphasis',
      focus: 'Hip-dominant posterior chain + squat accessory',
      estimated_duration_minutes: 55,
      exercises: [
        {
          exercise_id: '0032',  // barbell deadlift
          intended_pattern: 'hinge',
          sets: 4,
          reps_min: 5,
          reps_max: 6,
          rest_seconds: 180,
          rpe: 8,
        },
        {
          exercise_id: '1760',  // dumbbell goblet squat (accessory)
          intended_pattern: 'squat',
          sets: 3,
          reps_min: 12,
          reps_max: 15,
          rest_seconds: 75,
        },
      ],
    },
  ],
}

describe('Scenario B — Intermediate hypertrophy', () => {
  it('validates a 4-day upper/lower program', () => {
    const result = validateProgramDraft(scenarioB)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.program!.days).toHaveLength(4)
  })

  it('accepts RPE values on exercises', () => {
    const result = validateProgramDraft(scenarioB)
    expect(result.valid).toBe(true)
    // RPE passes through on the validated draft
    const benchEx = result.program!.days[0].exercises[0]
    expect(benchEx.rpe).toBe(8)
  })

  it('accepts weeks and progression_strategy in the draft', () => {
    const result = validateProgramDraft(scenarioB)
    expect(result.valid).toBe(true)
    // These live on the ProgramDraft (not ValidatedProgram), but the program was produced from the draft
    expect(scenarioB.weeks).toBe(8)
    expect(scenarioB.progression_strategy).toBeDefined()
  })
})

// ─── Scenario C — Hybrid Spartan / athletic ───────────────────────────────────
//
// 3-day hybrid: 1 strength, 1 power/conditioning, 1 full-body athletic.
// Uses body weight, barbell, dumbbell, cable equipment.
// ─────────────────────────────────────────────────────────────────────────────

const scenarioC: ProgramDraft = {
  program_name: 'Hybrid Athletic — 3 Day',
  description: 'Strength + conditioning hybrid for Spartan-style race prep. Three distinct sessions per week.',
  primary_goal: 'Athletic performance + Spartan race conditioning',
  weeks: 12,
  progression_strategy: 'Add load on strength days weekly. Increase carry distance or conditioning intervals biweekly.',
  days: [
    {
      name: 'Day 1 — Strength',
      focus: 'Compound lower + upper strength',
      estimated_duration_minutes: 55,
      exercises: [
        {
          exercise_id: '0032',  // barbell deadlift
          intended_pattern: 'hinge',
          sets: 4,
          reps_min: 4,
          reps_max: 6,
          rest_seconds: 180,
          rpe: 8,
        },
        {
          exercise_id: '0025',  // barbell bench press
          intended_pattern: 'horizontal_push',
          sets: 4,
          reps_min: 5,
          reps_max: 8,
          rest_seconds: 120,
        },
        {
          exercise_id: '0027',  // barbell bent over row
          intended_pattern: 'horizontal_pull',
          sets: 4,
          reps_min: 6,
          reps_max: 8,
          rest_seconds: 120,
        },
      ],
    },
    {
      name: 'Day 2 — Conditioning',
      focus: 'Bodyweight circuit + carry conditioning',
      estimated_duration_minutes: 40,
      exercises: [
        {
          exercise_id: '0662',  // push-up
          intended_pattern: 'horizontal_push',
          sets: 4,
          reps_min: 15,
          reps_max: 20,
          rest_seconds: 45,
          notes: 'Part of circuit — minimal rest between exercises',
        },
        {
          exercise_id: '3470',  // forward lunge
          intended_pattern: 'lunge',
          sets: 4,
          reps_min: 12,
          reps_max: 15,
          rest_seconds: 45,
        },
        {
          exercise_id: '0652',  // pull-up
          intended_pattern: 'vertical_pull',
          sets: 4,
          reps_min: 8,
          reps_max: 12,
          rest_seconds: 60,
        },
        {
          exercise_id: '0464',  // front plank with twist
          intended_pattern: 'core_antiextension',
          sets: 3,
          duration_seconds: 45,
          rest_seconds: 30,
        },
      ],
    },
    {
      name: 'Day 3 — Full Body Athletic',
      focus: 'Squat + hinge + upper body balance',
      estimated_duration_minutes: 50,
      exercises: [
        {
          exercise_id: '1760',  // dumbbell goblet squat
          intended_pattern: 'squat',
          sets: 4,
          reps_min: 10,
          reps_max: 12,
          rest_seconds: 90,
        },
        {
          exercise_id: '0085',  // barbell romanian deadlift
          intended_pattern: 'hinge',
          sets: 3,
          reps_min: 10,
          reps_max: 12,
          rest_seconds: 90,
        },
        {
          exercise_id: '2330',  // cable lat pulldown
          intended_pattern: 'vertical_pull',
          sets: 3,
          reps_min: 10,
          reps_max: 12,
          rest_seconds: 75,
        },
      ],
    },
  ],
}

describe('Scenario C — Hybrid athletic / Spartan', () => {
  it('validates a mixed-equipment hybrid athletic program', () => {
    const result = validateProgramDraft(scenarioC)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.program!.days).toHaveLength(3)
  })

  it('handles multiple equipment types across days', () => {
    const result = validateProgramDraft(scenarioC)
    expect(result.valid).toBe(true)
    const day1 = result.program!.days[0]
    const day2 = result.program!.days[1]
    expect(day1.exercises[0].exercise.equipment).toBe('barbell')
    expect(day2.exercises[0].exercise.equipment).toBe('body weight')
  })
})

// ─── Scenario D — Modification preserves the valid program ────────────────────
//
// Simulates V modifying Scenario B by replacing one exercise.
// The modification logic (in the modify endpoint) re-runs the AI loop and
// calls propose_program again with the adjusted draft. This test verifies
// that the resulting draft still passes validation.
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario D — Modification produces a valid revised program', () => {
  it('a modified version of Scenario B still validates', () => {
    // Simulate "replace the cable lat pulldown with pull-ups on Upper B"
    const modified: ProgramDraft = {
      ...scenarioB,
      days: scenarioB.days.map((day, i) => {
        if (i !== 2) return day  // only touch Upper B
        return {
          ...day,
          exercises: day.exercises.map(ex =>
            ex.exercise_id === '2330'  // cable lat pulldown → pull-up
              ? { ...ex, exercise_id: '0652', intended_pattern: 'vertical_pull', reps_min: 6, reps_max: 8 }
              : ex
          ),
        }
      }),
    }

    const result = validateProgramDraft(modified)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    // Verify the modification took effect
    const upperBExercises = result.program!.days[2].exercises
    expect(upperBExercises[0].exercise.name.toLowerCase()).toContain('pull')
    expect(upperBExercises[0].intended_pattern).toBe('vertical_pull')
  })

  it('preserves unchanged days from the original program', () => {
    const modified: ProgramDraft = {
      ...scenarioB,
      days: scenarioB.days.map((day, i) => {
        if (i !== 0) return day
        return { ...day, name: 'Upper A — Modified' }
      }),
    }
    const result = validateProgramDraft(modified)
    expect(result.valid).toBe(true)
    expect(result.program!.days[0].name).toBe('Upper A — Modified')
    // Other days unchanged
    expect(result.program!.days[1].name).toBe('Lower A — Squat emphasis')
  })
})

// ─── Scenario E — Invalid exercise ID is rejected ─────────────────────────────

describe('Scenario E — Invalid exercise IDs are rejected', () => {
  it('rejects a program with an invented exercise ID', () => {
    const withBadId: ProgramDraft = {
      program_name: 'Bad Program',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: 'inv_made_up_exercise_999',  // non-existent
              intended_pattern: 'squat',
              sets: 3,
              reps_min: 10,
              reps_max: 12,
              rest_seconds: 90,
            },
          ],
        },
      ],
    }

    const result = validateProgramDraft(withBadId)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some(e => e.includes('inv_made_up_exercise_999'))).toBe(true)
  })

  it('rejects a program with a wrong intended_pattern', () => {
    const withBadPattern: ProgramDraft = {
      program_name: 'Wrong Pattern',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: '0025',  // barbell bench press → horizontal_push
              intended_pattern: 'vertical_pull',  // WRONG: bench press is not vertical_pull
              sets: 3,
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
            },
          ],
        },
      ],
    }

    const result = validateProgramDraft(withBadPattern)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('intended_pattern'))).toBe(true)
  })

  it('rejects a program with no days', () => {
    const noDays: ProgramDraft = {
      program_name: 'Empty Program',
      days: [],
    }

    const result = validateProgramDraft(noDays)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects duplicate exercise IDs within a day', () => {
    const withDupes: ProgramDraft = {
      program_name: 'Dupes',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: '0025',  // bench press twice in same day
              intended_pattern: 'horizontal_push',
              sets: 3,
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
            },
            {
              exercise_id: '0025',  // duplicate
              intended_pattern: 'horizontal_push',
              sets: 3,
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
            },
          ],
        },
      ],
    }

    const result = validateProgramDraft(withDupes)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('duplicate') || e.includes('appears more than once'))).toBe(true)
  })

  it('rejects set counts outside 1–20 range', () => {
    const badSets: ProgramDraft = {
      program_name: 'Too Many Sets',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: '0025',
              intended_pattern: 'horizontal_push',
              sets: 25,  // exceeds 20
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
            },
          ],
        },
      ],
    }

    const result = validateProgramDraft(badSets)
    expect(result.valid).toBe(false)
  })

  it('rejects an inv_* exercise ID (canonical library IDs are not in exercises.json)', () => {
    const withInvId: ProgramDraft = {
      program_name: 'Inv ID Test',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: 'inv_barbell_squat',
              intended_pattern: 'squat',
              sets: 3,
              reps_min: 5,
              reps_max: 8,
              rest_seconds: 120,
            },
          ],
        },
      ],
    }

    const result = validateProgramDraft(withInvId)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('inv_barbell_squat'))).toBe(true)
  })

  it('rejects RPE = 0 (below valid 1–10 range)', () => {
    const draft: ProgramDraft = {
      program_name: 'Bad RPE',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: '0025',
              intended_pattern: 'horizontal_push',
              sets: 3,
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
              rpe: 0,
            },
          ],
        },
      ],
    }
    expect(validateProgramDraft(draft).valid).toBe(false)
  })

  it('rejects RPE = 11 (above valid 1–10 range)', () => {
    const draft: ProgramDraft = {
      program_name: 'Bad RPE High',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: '0025',
              intended_pattern: 'horizontal_push',
              sets: 3,
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
              rpe: 11,
            },
          ],
        },
      ],
    }
    expect(validateProgramDraft(draft).valid).toBe(false)
  })

  it('accepts RPE = 10 (max valid value)', () => {
    const draft: ProgramDraft = {
      program_name: 'Max RPE',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: '0025',
              intended_pattern: 'horizontal_push',
              sets: 3,
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
              rpe: 10,
            },
          ],
        },
      ],
    }
    expect(validateProgramDraft(draft).valid).toBe(true)
  })

  it('rejects estimated_duration_minutes = 0', () => {
    const draft: ProgramDraft = {
      program_name: 'Zero Duration',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 0,
          exercises: [
            {
              exercise_id: '0025',
              intended_pattern: 'horizontal_push',
              sets: 3,
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
            },
          ],
        },
      ],
    }
    expect(validateProgramDraft(draft).valid).toBe(false)
  })

  it('rejects a day with more than 15 exercises', () => {
    const exercises = Array.from({ length: 16 }, () => ({
      exercise_id: '0025',
      intended_pattern: 'horizontal_push',
      sets: 3,
      reps_min: 8,
      reps_max: 10,
      rest_seconds: 60,
    }))

    const draft: ProgramDraft = {
      program_name: 'Too Many Exercises',
      days: [{ name: 'Day 1', estimated_duration_minutes: 90, exercises }],
    }
    expect(validateProgramDraft(draft).valid).toBe(false)
  })
})

// ─── Equipment profile enforcement ────────────────────────────────────────────

describe('Equipment validation via ValidationOptions', () => {
  it('rejects a barbell exercise when allowedEquipment = ["dumbbell"]', () => {
    const draft: ProgramDraft = {
      program_name: 'Barbell in Dumbbell Profile',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: '0025',  // barbell bench press
              intended_pattern: 'horizontal_push',
              sets: 3,
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
            },
          ],
        },
      ],
    }

    const result = validateProgramDraft(draft, { allowedEquipment: ['dumbbell'] })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.toLowerCase().includes('equipment'))).toBe(true)
  })

  it('allows body weight exercises regardless of allowedEquipment', () => {
    const draft: ProgramDraft = {
      program_name: 'Bodyweight in Barbell Profile',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 35,
          exercises: [
            {
              exercise_id: '0662',  // push-up — body weight
              intended_pattern: 'horizontal_push',
              sets: 3,
              reps_min: 10,
              reps_max: 15,
              rest_seconds: 60,
            },
          ],
        },
      ],
    }

    const result = validateProgramDraft(draft, { allowedEquipment: ['barbell'] })
    expect(result.valid).toBe(true)
  })

  it('allows exercises when allowedEquipment is not provided', () => {
    const result = validateProgramDraft({
      program_name: 'No Equipment Filter',
      days: [
        {
          name: 'Day 1',
          estimated_duration_minutes: 45,
          exercises: [
            {
              exercise_id: '0025',
              intended_pattern: 'horizontal_push',
              sets: 3,
              reps_min: 8,
              reps_max: 10,
              rest_seconds: 90,
            },
          ],
        },
      ],
    })
    expect(result.valid).toBe(true)
  })
})

// ─── Alias search ─────────────────────────────────────────────────────────────

describe('Exercise search — alias expansion', () => {
  it('finds pull-up exercises when searching for "pullup" (alias expansion)', () => {
    // "pullup" is an alias — the alias expander maps it to pull-up/chin-up names.
    // We verify that results come back with the vertical_pull movement pattern,
    // not that the name literally contains "pull" (chin-ups qualify too).
    const results = executeExerciseSearch({ query: 'pullup', limit: 10 })
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.movementPattern === 'vertical_pull')).toBe(true)
  })

  it('returns numeric IDs (not inv_* IDs) from search results', () => {
    const results = executeExerciseSearch({ query: 'squat', limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r.id).toMatch(/^\d+$/)
    }
  })

  it('returns an empty array when no exercises match', () => {
    const results = executeExerciseSearch({ query: 'xyzzy_nonexistent_exercise_12345', limit: 5 })
    expect(results).toHaveLength(0)
  })
})
