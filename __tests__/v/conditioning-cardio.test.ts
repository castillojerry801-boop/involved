/**
 * Cardio pool retrieval, subtype classification, diversity ranking, dosage
 * validation, and equipment filtering — covering the full pipeline from
 * detectMovementSubclass through CARDIO_DRILL_OVERLOAD.
 *
 * All tests are deterministic: no DB, no AI calls.
 */

import { describe, it, expect } from 'vitest'
import { detectMovementSubclass, inferCardioSubtype } from '../../lib/ymove/hierarchy-scorer'
import { filterCandidatesByEquipment } from '../../lib/v/search-orchestration'
import { validateProgramQuality } from '../../lib/v/program-quality'
import { PATTERN_DB_HINTS } from '../../lib/ai/tools/exercises'
import type { ExerciseSummary } from '../../lib/ai/tools/exercises'
import type { ProgramDraft, ProgramDayDraft, ProgramExercise } from '../../lib/ai/tools/program'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCardioEx(id: string, name: string, equipment: string): ExerciseSummary {
  return {
    id,
    name,
    bodyPart: 'cardio',
    equipment,
    target: 'cardiovascular system',
    secondaryMuscles: [],
    movementPattern: 'cardio',
    secondaryMovementPatterns: [],
    movementFamily: 'cardio',
    exerciseRole: 'conditioning',
    laterality: 'bilateral',
    classificationConfidence: 'high',
  }
}

function makeExercise(
  id: string,
  name: string,
  opts: { duration_seconds?: number; intended_pattern?: string; sets?: number } = {},
): ProgramExercise {
  return {
    exercise_id: id,
    exercise_name: name,
    intended_pattern: opts.intended_pattern ?? 'cardio',
    sets: opts.sets ?? 1,
    rest_seconds: 60,
    duration_seconds: opts.duration_seconds,
  }
}

function makeDay(
  exercises: ProgramExercise[],
  session_type: ProgramDayDraft['session_type'] = 'conditioning',
): ProgramDayDraft {
  return {
    name: 'Saturday',
    session_type,
    estimated_duration_minutes: 45,
    exercises,
  }
}

function baseDraft(days: ProgramDayDraft[]): ProgramDraft {
  return {
    program_name: 'Test Program',
    weeks: 4,
    days,
  }
}

// ── Q3 fix: PATTERN_DB_HINTS now includes 'cardio' ───────────────────────────

describe('PATTERN_DB_HINTS cardio entry', () => {
  it('includes cardio hint', () => {
    expect(PATTERN_DB_HINTS['cardio']).toBeDefined()
  })

  it('cardio hint targets cardio and hiit-cardio categories', () => {
    const hint = PATTERN_DB_HINTS['cardio']!
    expect(hint.categories).toContain('cardio')
    expect(hint.categories).toContain('hiit-cardio')
  })

  it('cardio hint has empty nameKeywords (category is sufficient)', () => {
    expect(PATTERN_DB_HINTS['cardio']!.nameKeywords).toHaveLength(0)
  })

  it('non-cardio hints are unchanged', () => {
    expect(PATTERN_DB_HINTS['squat']).toBeDefined()
    expect(PATTERN_DB_HINTS['hinge']).toBeDefined()
    expect(PATTERN_DB_HINTS['horizontal_push']).toBeDefined()
  })
})

// ── Cardio subtype detection ──────────────────────────────────────────────────

describe('detectMovementSubclass — continuous aerobic machines', () => {
  it('Stationary Bike → continuous_aerobic', () => {
    expect(detectMovementSubclass(null, 'Stationary Bike')).toBe('continuous_aerobic')
  })
  it('Stationary Bike Seated Climb → continuous_aerobic', () => {
    expect(detectMovementSubclass(null, 'Stationary Bike Seated Climb')).toBe('continuous_aerobic')
  })
  it('Rowing Machine → continuous_aerobic', () => {
    expect(detectMovementSubclass(null, 'Rowing Machine')).toBe('continuous_aerobic')
  })
  it('Rowing Machine Arms and Body → continuous_aerobic', () => {
    expect(detectMovementSubclass(null, 'Rowing Machine Arms and Body')).toBe('continuous_aerobic')
  })
  it('Treadmill Run → continuous_aerobic', () => {
    expect(detectMovementSubclass(null, 'Treadmill Run')).toBe('continuous_aerobic')
  })
  it('Treadmill Walk → continuous_aerobic', () => {
    expect(detectMovementSubclass(null, 'Treadmill Walk')).toBe('continuous_aerobic')
  })
  it('Treadmill Jog → continuous_aerobic', () => {
    expect(detectMovementSubclass(null, 'Treadmill Jog')).toBe('continuous_aerobic')
  })
  it('Air Bike → continuous_aerobic', () => {
    expect(detectMovementSubclass(null, 'Air Bike')).toBe('continuous_aerobic')
  })
  it('Air Bike Arms Only → continuous_aerobic', () => {
    expect(detectMovementSubclass(null, 'Air Bike Arms Only')).toBe('continuous_aerobic')
  })
})

describe('detectMovementSubclass — sprint/interval variants', () => {
  it('Air Bike Sprint → interval', () => {
    expect(detectMovementSubclass(null, 'Air Bike Sprint')).toBe('interval')
  })
  it('Stationary Bike Seated Sprint → interval', () => {
    expect(detectMovementSubclass(null, 'Stationary Bike Seated Sprint')).toBe('interval')
  })
  it('Rowing Machine Sprint → interval', () => {
    expect(detectMovementSubclass(null, 'Rowing Machine Sprint')).toBe('interval')
  })
  it('Pogo Hops → interval', () => {
    expect(detectMovementSubclass(null, 'Pogo Hops')).toBe('interval')
  })
  it('Depth jump with turn → interval', () => {
    expect(detectMovementSubclass(null, 'Depth jump with turn')).toBe('interval')
  })
  it('Box Switch Jumps → interval', () => {
    expect(detectMovementSubclass(null, 'Box Switch Jumps')).toBe('interval')
  })
})

describe('detectMovementSubclass — running mechanics drills', () => {
  it('A steps → running_drill', () => {
    expect(detectMovementSubclass(null, 'A steps')).toBe('running_drill')
  })
  it('A Steps (capitalised) → running_drill', () => {
    expect(detectMovementSubclass(null, 'A Steps')).toBe('running_drill')
  })
  it('B steps → running_drill', () => {
    expect(detectMovementSubclass(null, 'B steps')).toBe('running_drill')
  })
  it('A-steps (hyphenated) → running_drill', () => {
    expect(detectMovementSubclass(null, 'A-steps')).toBe('running_drill')
  })
})

describe('detectMovementSubclass — agility and coordination', () => {
  it('Grapevines → agility', () => {
    expect(detectMovementSubclass(null, 'Grapevines')).toBe('agility')
  })
  it('Back Shuffle → agility', () => {
    expect(detectMovementSubclass(null, 'Back Shuffle')).toBe('agility')
  })
  it('Crab Walk → agility', () => {
    expect(detectMovementSubclass(null, 'Crab Walk')).toBe('agility')
  })
})

describe('detectMovementSubclass — activation / warm-up', () => {
  it('Jumping Jack → activation', () => {
    expect(detectMovementSubclass(null, 'Jumping Jack')).toBe('activation')
  })
  it('Seal jacks → activation', () => {
    expect(detectMovementSubclass(null, 'Seal jacks')).toBe('activation')
  })
  it('Standing March → activation', () => {
    expect(detectMovementSubclass(null, 'Standing March')).toBe('activation')
  })
})

describe('detectMovementSubclass — general cardio (no subtype)', () => {
  it('Mountain Climbers → null', () => {
    expect(detectMovementSubclass(null, 'Mountain Climbers')).toBeNull()
  })
  it('Double unders → null', () => {
    expect(detectMovementSubclass(null, 'Double unders (Rope jumping)')).toBeNull()
  })
  it('Half burpee → null', () => {
    expect(detectMovementSubclass(null, 'Half burpee')).toBeNull()
  })
  it('Cross-body mountain climber → null', () => {
    expect(detectMovementSubclass(null, 'Cross-body mountain climber')).toBeNull()
  })
})

describe('detectMovementSubclass — strength exercises unaffected', () => {
  it('Romanian Deadlift → rdl', () => {
    expect(detectMovementSubclass(null, 'Romanian Deadlift')).toBe('rdl')
  })
  it('Back Squat → squat', () => {
    expect(detectMovementSubclass(null, 'Back Squat')).toBe('squat')
  })
  it('Hip Thrust → hip_thrust', () => {
    expect(detectMovementSubclass(null, 'Hip Thrust')).toBe('hip_thrust')
  })
  it('Leg Curl → leg_curl', () => {
    expect(detectMovementSubclass(null, 'Leg Curl')).toBe('leg_curl')
  })
})

describe('inferCardioSubtype', () => {
  it('Stationary Bike → continuous_aerobic', () => {
    expect(inferCardioSubtype('Stationary Bike')).toBe('continuous_aerobic')
  })
  it('A steps → running_drill', () => {
    expect(inferCardioSubtype('A steps')).toBe('running_drill')
  })
  it('Grapevines → agility', () => {
    expect(inferCardioSubtype('Grapevines')).toBe('agility')
  })
  it('Mountain Climbers → null (general)', () => {
    expect(inferCardioSubtype('Mountain Climbers')).toBeNull()
  })
  it('Bench Press → null (non-cardio)', () => {
    expect(inferCardioSubtype('Bench Press')).toBeNull()
  })
  it('Air Bike Sprint → interval', () => {
    expect(inferCardioSubtype('Air Bike Sprint')).toBe('interval')
  })
})

// ── Pool diversity — deterministic stubs without DB ──────────────────────────

const AIR_BIKE       = makeCardioEx('ymv:00000000-0000-0000-0000-000000000001', 'Air Bike',          'air bike')
const ROWING_MACHINE = makeCardioEx('ymv:00000000-0000-0000-0000-000000000002', 'Rowing Machine',    'rowing machine')
const STATIONARY     = makeCardioEx('ymv:00000000-0000-0000-0000-000000000003', 'Stationary Bike',   'stationary bike')
const TREADMILL_JOG  = makeCardioEx('ymv:00000000-0000-0000-0000-000000000004', 'Treadmill Jog',     'treadmill')
const MTN_CLIMBERS   = makeCardioEx('ymv:00000000-0000-0000-0000-000000000005', 'Mountain Climbers', 'bodyweight')
const DBL_UNDERS     = makeCardioEx('ymv:00000000-0000-0000-0000-000000000006', 'Double unders',     'bodyweight')
const A_STEPS        = makeCardioEx('ymv:00000000-0000-0000-0000-000000000007', 'A steps',           'bodyweight')
const BATTLE_ROPE    = makeCardioEx('ymv:00000000-0000-0000-0000-000000000008', 'Battle Rope Waves', 'battle rope')

const DIVERSE_POOL = [
  AIR_BIKE, ROWING_MACHINE, STATIONARY, TREADMILL_JOG,
  MTN_CLIMBERS, DBL_UNDERS, A_STEPS, BATTLE_ROPE,
]

describe('filterCandidatesByEquipment — cardio pool diversity', () => {
  it('bodyweight-only user: machine cardio filtered, bodyweight remains', () => {
    const result = filterCandidatesByEquipment(DIVERSE_POOL, ['body weight'])
    const names = result.map(e => e.name)
    expect(names).toContain('Mountain Climbers')
    expect(names).toContain('Double unders')
    expect(names).toContain('A steps')
    expect(names).not.toContain('Air Bike')
    expect(names).not.toContain('Rowing Machine')
    expect(names).not.toContain('Stationary Bike')
    expect(names).not.toContain('Treadmill Jog')
  })

  it('gym user with stationary bike: stationary bike and bodyweight pass', () => {
    const result = filterCandidatesByEquipment(DIVERSE_POOL, ['stationary bike', 'body weight'])
    const names = result.map(e => e.name)
    expect(names).toContain('Stationary Bike')
    expect(names).toContain('Mountain Climbers')
    expect(names).not.toContain('Air Bike')
    expect(names).not.toContain('Rowing Machine')
    expect(names).not.toContain('Treadmill Jog')
  })

  it('gym user with rowing machine: rowing machine and bodyweight pass', () => {
    const result = filterCandidatesByEquipment(DIVERSE_POOL, ['rowing machine', 'body weight'])
    const names = result.map(e => e.name)
    expect(names).toContain('Rowing Machine')
    expect(names).toContain('Mountain Climbers')
    expect(names).not.toContain('Stationary Bike')
    expect(names).not.toContain('Air Bike')
  })

  it('stationary bike is not inferred from generic leverage machine', () => {
    const result = filterCandidatesByEquipment(DIVERSE_POOL, ['leverage machine', 'body weight'])
    const names = result.map(e => e.name)
    expect(names).not.toContain('Stationary Bike')
    expect(names).not.toContain('Rowing Machine')
    expect(names).not.toContain('Treadmill Jog')
  })

  it('rowing machine is not inferred from treadmill access', () => {
    const result = filterCandidatesByEquipment(DIVERSE_POOL, ['treadmill', 'body weight'])
    const names = result.map(e => e.name)
    expect(names).toContain('Treadmill Jog')
    expect(names).not.toContain('Rowing Machine')
    expect(names).not.toContain('Stationary Bike')
  })

  it('A steps (bodyweight) always passes equipment filter', () => {
    // Running drills remain available for appropriate running-mechanics use
    const result = filterCandidatesByEquipment([A_STEPS], ['body weight'])
    expect(result.map(e => e.name)).toContain('A steps')
  })

  it('battle rope requires battle rope in profile', () => {
    const withoutRope = filterCandidatesByEquipment([BATTLE_ROPE], ['body weight'])
    expect(withoutRope).toHaveLength(0)
    const withRope = filterCandidatesByEquipment([BATTLE_ROPE], ['battle rope'])
    expect(withRope).toHaveLength(1)
  })
})

// ── Dosage validation — CARDIO_DRILL_OVERLOAD ─────────────────────────────────

describe('CARDIO_DRILL_OVERLOAD quality check', () => {
  it('errors on A Steps prescribed for 1200 seconds (20 min)', () => {
    const draft = baseDraft([
      makeDay([makeExercise('ymv:as1', 'A steps', { duration_seconds: 1200 })]),
    ])
    const issues = validateProgramQuality(draft, {})
    const err = issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')
    expect(err).toBeDefined()
    expect(err!.severity).toBe('error')
    expect(err!.message).toMatch(/running mechanics drill/)
    expect(err!.message).toMatch(/20 continuous minutes/)
  })

  it('errors on Grapevines prescribed for 600 seconds (10 min)', () => {
    const draft = baseDraft([
      makeDay([makeExercise('ymv:gr1', 'Grapevines', { duration_seconds: 600 })]),
    ])
    const issues = validateProgramQuality(draft, {})
    const err = issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')
    expect(err).toBeDefined()
    expect(err!.severity).toBe('error')
    expect(err!.message).toMatch(/agility exercise/)
  })

  it('errors on Back Shuffle prescribed for 600 seconds', () => {
    const draft = baseDraft([
      makeDay([makeExercise('ymv:bs1', 'Back Shuffle', { duration_seconds: 600 })]),
    ])
    const issues = validateProgramQuality(draft, {})
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeDefined()
  })

  it('allows A Steps at 60 seconds (legitimate short drill set)', () => {
    const draft = baseDraft([
      makeDay([makeExercise('ymv:as1', 'A steps', { duration_seconds: 60 })]),
    ])
    const issues = validateProgramQuality(draft, {})
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeUndefined()
  })

  it('allows A Steps at exactly 300 seconds (threshold boundary)', () => {
    const draft = baseDraft([
      makeDay([makeExercise('ymv:as1', 'A steps', { duration_seconds: 300 })]),
    ])
    const issues = validateProgramQuality(draft, {})
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeUndefined()
  })

  it('allows Stationary Bike at 1200 seconds (sustained aerobic)', () => {
    const draft = baseDraft([
      makeDay([makeExercise('ymv:sb1', 'Stationary Bike', { duration_seconds: 1200 })]),
    ])
    const issues = validateProgramQuality(draft, {})
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeUndefined()
  })

  it('allows Rowing Machine at 1800 seconds (30 min steady-state)', () => {
    const draft = baseDraft([
      makeDay([makeExercise('ymv:rm1', 'Rowing Machine', { duration_seconds: 1800 })]),
    ])
    const issues = validateProgramQuality(draft, {})
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeUndefined()
  })

  it('allows Mountain Climbers at any duration (general cardio, no subtype)', () => {
    const draft = baseDraft([
      makeDay([makeExercise('ymv:mc1', 'Mountain Climbers', { duration_seconds: 900 })]),
    ])
    const issues = validateProgramQuality(draft, {})
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeUndefined()
  })

  it('does not fire when both exercise_name and cardioSubtypeHints are absent (conservative)', () => {
    // No hints and no name — validator has no classification source, skips safely
    const draft = baseDraft([
      makeDay([{
        exercise_id: 'ymv:00000000-0000-0000-0000-000000000099',
        intended_pattern: 'cardio',
        sets: 1,
        rest_seconds: 60,
        duration_seconds: 1200,
      }]),
    ])
    const issues = validateProgramQuality(draft, {})
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeUndefined()
  })

  it('does not fire on strength programs without cardio', () => {
    const draft = baseDraft([{
      name: 'Monday',
      session_type: 'full_body',
      estimated_duration_minutes: 60,
      exercises: [{
        exercise_id: '100',
        exercise_name: 'Back Squat',
        intended_pattern: 'squat',
        sets: 4,
        rest_seconds: 180,
        reps_min: 4,
        reps_max: 6,
      }],
    }])
    const issues = validateProgramQuality(draft, {})
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeUndefined()
  })
})

// ── cardioSubtypeHints — pool-identity bypass closure ────────────────────────

describe('CARDIO_DRILL_OVERLOAD — cardioSubtypeHints closes the bypass', () => {
  const A_STEPS_ID = 'ymv:00000000-0000-0000-0000-000000000007'
  const SB_ID      = 'ymv:00000000-0000-0000-0000-000000000003'

  it('fires when exercise_name absent but hint map identifies running_drill', () => {
    const draft = baseDraft([
      makeDay([{
        exercise_id: A_STEPS_ID,
        intended_pattern: 'cardio',
        sets: 1,
        rest_seconds: 60,
        duration_seconds: 1200,
      }]),
    ])
    const issues = validateProgramQuality(draft, {
      cardioSubtypeHints: new Map([[A_STEPS_ID, 'running_drill']]),
    })
    const err = issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')
    expect(err).toBeDefined()
    expect(err!.severity).toBe('error')
    expect(err!.message).toMatch(/running mechanics drill/)
  })

  it('fires when model supplies a wrong exercise_name but hint overrides', () => {
    // Luna erroneously names the exercise "Cardio Work" (bypasses name inference),
    // but the hint map correctly identifies A Steps as a running_drill.
    const draft = baseDraft([
      makeDay([{
        exercise_id: A_STEPS_ID,
        exercise_name: 'Cardio Work',  // wrong — inferCardioSubtype would return null
        intended_pattern: 'cardio',
        sets: 1,
        rest_seconds: 60,
        duration_seconds: 1200,
      }]),
    ])
    const issues = validateProgramQuality(draft, {
      cardioSubtypeHints: new Map([[A_STEPS_ID, 'running_drill']]),
    })
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeDefined()
  })

  it('does NOT fire when hint identifies continuous_aerobic even if name would fail', () => {
    // Hint says continuous_aerobic — should not trigger the drill restriction.
    const draft = baseDraft([
      makeDay([{
        exercise_id: SB_ID,
        intended_pattern: 'cardio',
        sets: 1,
        rest_seconds: 60,
        duration_seconds: 1200,
      }]),
    ])
    const issues = validateProgramQuality(draft, {
      cardioSubtypeHints: new Map([[SB_ID, 'continuous_aerobic']]),
    })
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeUndefined()
  })

  it('allows A Steps short drill (60s) even with running_drill hint', () => {
    const draft = baseDraft([
      makeDay([{
        exercise_id: A_STEPS_ID,
        intended_pattern: 'cardio',
        sets: 4,
        rest_seconds: 60,
        duration_seconds: 60,
      }]),
    ])
    const issues = validateProgramQuality(draft, {
      cardioSubtypeHints: new Map([[A_STEPS_ID, 'running_drill']]),
    })
    expect(issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')).toBeUndefined()
  })

  it('error message uses exercise_name when present, falls back to exercise_id', () => {
    const draft = baseDraft([
      makeDay([{
        exercise_id: A_STEPS_ID,
        // exercise_name intentionally absent
        intended_pattern: 'cardio',
        sets: 1,
        rest_seconds: 60,
        duration_seconds: 1200,
      }]),
    ])
    const issues = validateProgramQuality(draft, {
      cardioSubtypeHints: new Map([[A_STEPS_ID, 'running_drill']]),
    })
    const err = issues.find(i => i.code === 'CARDIO_DRILL_OVERLOAD')
    expect(err).toBeDefined()
    // Falls back to the exercise_id as the display name
    expect(err!.message).toContain(A_STEPS_ID)
  })
})

// ── Existing quality checks are unaffected ────────────────────────────────────

describe('existing quality checks unaffected by new code', () => {
  it('CONDITIONING_WALK_ONLY still fires when conditioning day has only walk', () => {
    const draft = baseDraft([
      makeDay([makeExercise('9001', 'walking')], 'conditioning'),
      {
        name: 'Monday',
        session_type: 'full_body',
        estimated_duration_minutes: 60,
        exercises: [makeExercise('9001', 'walking')],
      },
    ])
    const issues = validateProgramQuality(draft, {})
    expect(issues.find(i => i.code === 'CONDITIONING_WALK_ONLY')).toBeDefined()
  })

  it('CONDITIONING_NO_AEROBIC_MODALITY is still an error for explicit conditioning day', () => {
    const draft = baseDraft([{
      name: 'Saturday',
      session_type: 'conditioning',
      estimated_duration_minutes: 45,
      exercises: [{
        exercise_id: '100',
        exercise_name: 'Back Squat',
        intended_pattern: 'squat',
        sets: 4,
        rest_seconds: 180,
        reps_min: 4,
        reps_max: 6,
      }],
    }])
    const issues = validateProgramQuality(draft, {})
    const issue = issues.find(i => i.code === 'CONDITIONING_NO_AEROBIC_MODALITY')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('error')
  })
})
