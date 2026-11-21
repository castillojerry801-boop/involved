/**
 * Walking overlay regression tests
 *
 * Covers requirement: daily one-mile walk represented on all 7 days of a
 * 6-day strength + conditioning program, with correct exercise ID, units,
 * and no contamination of unrelated programs.
 *
 * Tests:
 *   A — walking exercise 9001 exists in catalog with correct classification
 *   B — 1-mile walk present on every day (training + recovery)
 *   C — Wednesday and Sunday are active_recovery days (no resistance training)
 *   D — no run exercise (0685) used as walk substitute
 *   E — distance is 1609 m (1 mile) and unit source is distance_m, not duration
 *   F — program validates and saves correctly
 *   G — EXCESSIVE_CORE_REPETITION does NOT fire for daily walking
 *   H — strength-only programs unaffected by walking changes
 *   I — active_recovery days are excluded from MISSING_REQUIRED_ROLE errors
 *   J — inferTrackingType returns 'cardio' for walking (bodyPart: 'cardio')
 *   K — deduplication: walking workout is classified as 'walking' activity type
 */

import { describe, it, expect } from 'vitest'
import { validateProgramDraft } from '../../lib/ai/tools/program'
import { validateProgramQuality } from '../../lib/v/program-quality'
import { classifyExercise, getExerciseById } from '../../lib/exercises'
import { classifyWorkoutActivity, activityTypesCompatible } from '../../lib/health/classify'
import { getSessionRoles } from '../../lib/v/session-composition'
import type { ProgramDraft, SessionType } from '../../lib/ai/tools/program'

// ── constants ─────────────────────────────────────────────────────────────────

const WALK_ID = '9001'
const ONE_MILE_M = 1609

// Real catalog IDs with verified classifications (confirmed via classifyExercise):
//   3294 archer push up      → horizontal_push
//   3293 archer pull up      → vertical_pull
//   3543 bodyweight drop jump squat → squat
//   3561 glute bridge march  → hinge
//   3168 bodyweight squatting row   → horizontal_pull
//   0630 mountain climber    → cardio
const EX = {
  push:  { id: '3294', pattern: 'horizontal_push' as const },
  pull:  { id: '3293', pattern: 'vertical_pull'   as const },
  squat: { id: '3543', pattern: 'squat'            as const },
  hinge: { id: '3561', pattern: 'hinge'            as const },
  row:   { id: '3168', pattern: 'horizontal_pull'  as const },
  cardio: { id: '0630', pattern: 'cardio'          as const },
}

// ── helpers ───────────────────────────────────────────────────────────────────

function walkEntry() {
  return {
    exercise_id:       WALK_ID,
    intended_pattern:  'cardio' as const,
    sets:              1,
    distance_m:        ONE_MILE_M,
    rest_seconds:      0,
    progression_model: 'duration_distance' as const,
  }
}

function trainingDay(
  name: string,
  weekday: number,
  sessionType: SessionType,
  primaryId: string,
  primaryPattern: string,
) {
  return {
    name,
    session_type: sessionType,
    weekday,
    estimated_duration_minutes: 70,
    exercises: [
      {
        exercise_id:      primaryId,
        intended_pattern: primaryPattern,
        sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 120,
        progression_model: 'linear' as const,
      },
      walkEntry(),
    ],
  }
}

function activeRecoveryDay(weekday: number) {
  return {
    name:                       'Active Recovery – Easy Walk',
    session_type:               'active_recovery' as SessionType,
    weekday,
    estimated_duration_minutes: 20,
    exercises: [walkEntry()],
  }
}

/** Full 6-day S&C + daily walk program (5 training days, 2 active-recovery days).
 *  Each training day has a UNIQUE primary exercise so only walking (9001) repeats
 *  across all 7 days — which the EXCESSIVE_CORE_REPETITION check must not flag. */
function makeDailyWalkProgram(): ProgramDraft {
  return {
    program_name:          '6-Day Strength & Conditioning + Daily Walk',
    description:           'An 8-week program focused on building strength and conditioning. Daily: easy 1-mile walk (all 7 days, including active-recovery days).',
    primary_goal:          'Strength + conditioning',
    weeks:                 8,
    progression_strategy:  'Main lifts add 5 lb/week (linear). Conditioning volume increases by 10% each phase.',
    phases: [
      { name: 'Base',  weeks: '1-4', focus: 'Build aerobic base and strength foundation' },
      { name: 'Build', weeks: '5-8', focus: 'Increase intensity and volume on main lifts' },
    ],
    days: [
      trainingDay('Upper Push',          0, 'upper_push',       EX.push.id,  EX.push.pattern),   // Mon
      trainingDay('Upper Pull',          1, 'upper_pull',       EX.pull.id,  EX.pull.pattern),   // Tue
      activeRecoveryDay(2),                                                                        // Wed
      trainingDay('Lower Quad',          3, 'lower_quad',       EX.squat.id, EX.squat.pattern),  // Thu
      trainingDay('Lower Posterior',     4, 'lower_posterior',  EX.hinge.id, EX.hinge.pattern),  // Fri
      trainingDay('Conditioning',        5, 'conditioning',     EX.cardio.id, EX.cardio.pattern), // Sat
      activeRecoveryDay(6),                                                                        // Sun
    ],
  }
}

// ── A — exercise catalog ──────────────────────────────────────────────────────

describe('A — walking exercise in catalog', () => {
  it('exercise 9001 exists', () => {
    const ex = getExerciseById(WALK_ID)
    expect(ex).not.toBeNull()
    expect(ex!.name).toBe('walking')
  })

  it('equipment is body weight', () => {
    const ex = getExerciseById(WALK_ID)!
    expect(ex.equipment).toBe('body weight')
  })

  it('bodyPart is cardio', () => {
    const ex = getExerciseById(WALK_ID)!
    expect(ex.bodyPart).toBe('cardio')
  })

  it('classifies as pattern=cardio, role=conditioning', () => {
    const ex = getExerciseById(WALK_ID)!
    const cls = classifyExercise(ex)
    expect(cls.primaryMovementPattern).toBe('cardio')
    expect(cls.exerciseRole).toBe('conditioning')
  })

  it('is NOT the run exercise (0685)', () => {
    expect(WALK_ID).not.toBe('0685')
    const run = getExerciseById('0685')
    expect(run?.name).not.toContain('walk')
  })
})

// ── B — daily walk on every day ───────────────────────────────────────────────

describe('B — 1-mile walk present on all 7 days', () => {
  it('every day contains exercise 9001', async () => {
    const draft = makeDailyWalkProgram()
    const result = await validateProgramDraft(draft)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)

    for (const day of result.program!.days) {
      const hasWalk = day.exercises.some(ex => ex.exercise_id === WALK_ID)
      expect(hasWalk, `Day "${day.name}" (weekday ${day.weekday}) missing walking exercise`).toBe(true)
    }
  })

  it('covers all 7 weekdays 0–6', async () => {
    const draft = makeDailyWalkProgram()
    const result = await validateProgramDraft(draft)
    expect(result.valid).toBe(true)

    const weekdays = result.program!.days.map(d => d.weekday)
    for (let w = 0; w <= 6; w++) {
      expect(weekdays, `weekday ${w} not covered`).toContain(w)
    }
  })
})

// ── C — Wednesday and Sunday are active_recovery ──────────────────────────────

describe('C — rest days remain active_recovery, no resistance training', () => {
  it('Wednesday (weekday 2) is session_type active_recovery', () => {
    const draft = makeDailyWalkProgram()
    const wed = draft.days.find(d => d.weekday === 2)
    expect(wed).toBeDefined()
    expect(wed!.session_type).toBe('active_recovery')
  })

  it('Sunday (weekday 6) is session_type active_recovery', () => {
    const draft = makeDailyWalkProgram()
    const sun = draft.days.find(d => d.weekday === 6)
    expect(sun).toBeDefined()
    expect(sun!.session_type).toBe('active_recovery')
  })

  it('active_recovery days have ONLY the walking exercise', () => {
    const draft = makeDailyWalkProgram()
    const recoveryDays = draft.days.filter(d => d.session_type === 'active_recovery')
    expect(recoveryDays).toHaveLength(2)
    for (const day of recoveryDays) {
      expect(day.exercises).toHaveLength(1)
      expect(day.exercises[0].exercise_id).toBe(WALK_ID)
    }
  })

  it('active_recovery days contain no resistance-training patterns', () => {
    const draft = makeDailyWalkProgram()
    const resistancePatterns = /squat|hinge|lunge|horizontal_push|incline_push|vertical_push|vertical_pull|horizontal_pull|bicep|tricep/
    for (const day of draft.days.filter(d => d.session_type === 'active_recovery')) {
      for (const ex of day.exercises) {
        expect(ex.intended_pattern).not.toMatch(resistancePatterns)
      }
    }
  })
})

// ── D — no run substitution ───────────────────────────────────────────────────

describe('D — no run exercise substituted for walking', () => {
  it('no exercise with ID 0685 (run) appears in the program', () => {
    const draft = makeDailyWalkProgram()
    for (const day of draft.days) {
      for (const ex of day.exercises) {
        expect(ex.exercise_id).not.toBe('0685')
      }
    }
  })

  it('the walking exercise is 9001, not 0685', () => {
    const walk = walkEntry()
    expect(walk.exercise_id).toBe(WALK_ID)
    expect(walk.exercise_id).not.toBe('0685')
  })
})

// ── E — distance is 1609 m (1 mile), not duration ─────────────────────────────

describe('E — distance unit is 1609 m, not duration', () => {
  it('walkEntry uses distance_m: 1609', () => {
    const ex = walkEntry()
    expect(ex.distance_m).toBe(ONE_MILE_M)
  })

  it('walkEntry has no duration_seconds (not a timed set)', () => {
    const ex = walkEntry() as Record<string, unknown>
    expect(ex.duration_seconds).toBeUndefined()
  })

  it('walkEntry has no reps_min / reps_max (not rep-based)', () => {
    const ex = walkEntry() as Record<string, unknown>
    expect(ex.reps_min).toBeUndefined()
    expect(ex.reps_max).toBeUndefined()
  })

  it('1609 metres approximates 1 statute mile (1609.34 m)', () => {
    expect(ONE_MILE_M).toBeGreaterThanOrEqual(1600)
    expect(ONE_MILE_M).toBeLessThanOrEqual(1620)
  })
})

// ── F — program validation and structure ──────────────────────────────────────

describe('F — program validates and has correct structure', () => {
  it('validateProgramDraft returns valid: true with no errors', async () => {
    const draft = makeDailyWalkProgram()
    const result = await validateProgramDraft(draft)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('program has exactly 7 days', async () => {
    const draft = makeDailyWalkProgram()
    const result = await validateProgramDraft(draft)
    expect(result.program!.days).toHaveLength(7)
  })

  it('no duplicate weekday assignments', async () => {
    const draft = makeDailyWalkProgram()
    const result = await validateProgramDraft(draft)
    expect(result.valid).toBe(true)
    const weekdays = result.program!.days.map(d => d.weekday).filter(w => w != null)
    expect(new Set(weekdays).size).toBe(weekdays.length)
  })

  it('active_recovery days pass structural validation', async () => {
    const draft = makeDailyWalkProgram()
    const result = await validateProgramDraft(draft)
    expect(result.valid).toBe(true)
    const recoveryDays = result.program!.days.filter(
      (_, i) => draft.days[i]?.session_type === 'active_recovery'
    )
    expect(recoveryDays).toHaveLength(2)
  })
})

// ── G — EXCESSIVE_CORE_REPETITION does not fire for daily walking ─────────────

describe('G — daily walking does not trigger EXCESSIVE_CORE_REPETITION', () => {
  it('no EXCESSIVE_CORE_REPETITION quality issue for 7-day walk program', () => {
    const draft = makeDailyWalkProgram()
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.filter(i => i.code === 'EXCESSIVE_CORE_REPETITION')).toHaveLength(0)
  })

  it('EXCESSIVE_CORE_REPETITION still fires when a strength exercise is repeated > 60% of days', () => {
    const draft = makeDailyWalkProgram()
    // Inject the same strength exercise ID into the active_recovery days to push count above threshold
    for (const day of draft.days) {
      if (day.session_type === 'active_recovery') {
        day.exercises.push({
          exercise_id:      EX.push.id,
          intended_pattern: EX.push.pattern,
          sets: 1, reps_min: 10, reps_max: 15, rest_seconds: 60,
        })
      }
    }
    // EX.push.id now appears in: Mon(push day) + Wed(injected) + Sun(injected) = 3/7 days (43%)
    // Not enough — push only originally appears in 1 day. Need to also inject into 3 more days.
    // Let's inject into Thu, Fri, Sat to get 1(Mon) + 2(recovery) + 3(injected) = 6/7 = 86%
    for (const day of draft.days) {
      if ([3, 4, 5].includes(day.weekday!)) {
        day.exercises.push({
          exercise_id:      EX.push.id,
          intended_pattern: EX.push.pattern,
          sets: 1, reps_min: 10, reps_max: 15, rest_seconds: 60,
        })
      }
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.filter(i => i.code === 'EXCESSIVE_CORE_REPETITION').length).toBeGreaterThan(0)
  })
})

// ── H — strength-only programs unaffected ────────────────────────────────────

describe('H — existing strength-only programs unaffected by walking changes', () => {
  it('3-day strength program without walking validates cleanly', async () => {
    const draft: ProgramDraft = {
      program_name:         '3-Day Strength',
      description:          'A simple 3-day push/pull/legs program.',
      primary_goal:         'Strength',
      weeks:                4,
      progression_strategy: 'Linear: add 5 lb/week on main lifts.',
      days: [
        {
          name: 'Push Day', session_type: 'upper_push', weekday: 0,
          estimated_duration_minutes: 60,
          exercises: [{ exercise_id: EX.push.id, intended_pattern: EX.push.pattern, sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 120, progression_model: 'linear' as const }],
        },
        {
          name: 'Pull Day', session_type: 'upper_pull', weekday: 2,
          estimated_duration_minutes: 60,
          exercises: [{ exercise_id: EX.pull.id, intended_pattern: EX.pull.pattern, sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 120, progression_model: 'linear' as const }],
        },
        {
          name: 'Leg Day', session_type: 'lower_full', weekday: 4,
          estimated_duration_minutes: 60,
          exercises: [{ exercise_id: EX.squat.id, intended_pattern: EX.squat.pattern, sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 180, progression_model: 'linear' as const }],
        },
      ],
    }
    const result = await validateProgramDraft(draft)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('no EXCESSIVE_CORE_REPETITION for 3-day program with unique exercises', () => {
    const draft: ProgramDraft = {
      program_name:         '3-Day Strength',
      description:          'A 3-day program.',
      primary_goal:         'Strength',
      weeks:                4,
      progression_strategy: 'Linear progression.',
      days: [
        { name: 'Push Day', session_type: 'upper_push', weekday: 0, estimated_duration_minutes: 60, exercises: [{ exercise_id: EX.push.id,  intended_pattern: EX.push.pattern,  sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 120 }] },
        { name: 'Pull Day', session_type: 'upper_pull', weekday: 2, estimated_duration_minutes: 60, exercises: [{ exercise_id: EX.pull.id,  intended_pattern: EX.pull.pattern,  sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 120 }] },
        { name: 'Leg Day',  session_type: 'lower_full', weekday: 4, estimated_duration_minutes: 60, exercises: [{ exercise_id: EX.squat.id, intended_pattern: EX.squat.pattern, sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 180 }] },
      ],
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 4 })
    expect(issues.filter(i => i.code === 'EXCESSIVE_CORE_REPETITION')).toHaveLength(0)
  })
})

// ── I — active_recovery days exempt from MISSING_REQUIRED_ROLE ───────────────

describe('I — active_recovery days exempt from MISSING_REQUIRED_ROLE', () => {
  it('no MISSING_REQUIRED_ROLE error references active_recovery session type', () => {
    const draft = makeDailyWalkProgram()
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const recoveryRoleErrors = issues.filter(
      i => i.code === 'MISSING_REQUIRED_ROLE' &&
        typeof i.meta?.sessionType === 'string' &&
        i.meta.sessionType === 'active_recovery'
    )
    expect(recoveryRoleErrors).toHaveLength(0)
  })

  it('active_recovery is not in SESSION_TEMPLATES so getSessionRoles returns []', () => {
    const roles = getSessionRoles('active_recovery', 'intermediate')
    expect(roles).toEqual([])
  })
})

// ── J — inferTrackingType returns cardio for walking ─────────────────────────

describe('J — walking exercise resolves to cardio tracking type in save route', () => {
  // Mirror the save route's infer logic without importing the server-only route module
  function inferTrackingType(equipment: string, bodyPart?: string): string {
    const eq = equipment.toLowerCase()
    if (bodyPart?.toLowerCase() === 'cardio') return 'cardio'
    if (eq.includes('body weight')) return 'bodyweight'
    if (eq.includes('cardio') || eq.includes('cycle') || eq.includes('treadmill')) return 'cardio'
    return 'strength'
  }

  it('walking (body weight, bodyPart cardio) → cardio', () => {
    expect(inferTrackingType('body weight', 'cardio')).toBe('cardio')
  })

  it('push-up (body weight, bodyPart chest) → bodyweight', () => {
    expect(inferTrackingType('body weight', 'chest')).toBe('bodyweight')
  })

  it('treadmill machine (bodyPart cardio) → cardio', () => {
    expect(inferTrackingType('leverage machine', 'cardio')).toBe('cardio')
  })

  it('barbell squat (barbell) → strength', () => {
    expect(inferTrackingType('barbell')).toBe('strength')
  })
})

// ── K — deduplication: completed walk workout classifies as 'walking' ─────────

describe('K — deduplication: completed walk workout classifies as walking activity', () => {
  it('workout titled "Active Recovery – Easy Walk" classifies as walking', () => {
    const type = classifyWorkoutActivity({ title: 'Active Recovery – Easy Walk', exercises: [] })
    expect(type).toBe('walking')
  })

  it('workout titled "Easy Walk" classifies as walking', () => {
    const type = classifyWorkoutActivity({ title: 'Easy Walk', exercises: [] })
    expect(type).toBe('walking')
  })

  it('activityTypesCompatible(walking, walking) is true — HK dedup will link correctly', () => {
    expect(activityTypesCompatible('walking', 'walking')).toBe(true)
  })

  it('activityTypesCompatible(walking, running) is false — no cross-type false merge', () => {
    expect(activityTypesCompatible('walking', 'running')).toBe(false)
  })
})
