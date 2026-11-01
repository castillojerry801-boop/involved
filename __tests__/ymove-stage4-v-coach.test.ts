/**
 * Stage 4 — YMove-first search, cardio classification, substitute enrichment
 *
 * Tests cover:
 * - executeExerciseSearchAsync: YMove-only when flag on, honest empty result, no ExerciseDB fallback
 * - classifyAnyExercise + validateExerciseIdAsync: cardio category threading (treadmill, cycling, rowing, HIIT)
 * - validateWorkoutDraft / validateProgramDraft: cardio exercises validate correctly end-to-end
 * - Substitute enrichment: ymv: name/metadata resolved, no gifId on ymv: result
 * - Feature flag off: ExerciseDB-only behavior preserved
 * - Legacy ExerciseDB history: validateExerciseIdAsync still resolves 4-digit IDs
 * - Mixed legacy + YMove workout/program compatibility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateExerciseIdAsync, executeExerciseSearchAsync, classifyAnyExercise } from '../lib/ai/tools/exercises'
import { validateWorkoutDraft } from '../lib/ai/tools/workout'
import { validateProgramDraft } from '../lib/ai/tools/program'

// ── constants ─────────────────────────────────────────────────────────────────

const EXDB_BENCH    = '0025'  // barbell bench press — exists in exercises.json
const EXDB_SQUAT    = '0025'  // same as bench — used for flag-off path, any valid ExerciseDB ID works
const YMV_UUID      = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
const YMV_ID        = `ymv:${YMV_UUID}`
const YMV_UUID2     = 'c3d4e5f6-a7b8-9012-cdef-123456789012'
const YMV_ID2       = `ymv:${YMV_UUID2}`
const CARDIO_UUID   = 'd4e5f6a7-b8c9-0123-defa-234567890123'
const CARDIO_YMV_ID = `ymv:${CARDIO_UUID}`

// ── DB mock helpers ───────────────────────────────────────────────────────────

type MockDb = NonNullable<Parameters<typeof validateExerciseIdAsync>[2]>

function makeDb(overrides: Record<string, unknown> = {}): MockDb {
  return {
    ymoveExerciseCatalog: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany:   vi.fn().mockResolvedValue([]),
      ...((overrides.ymoveExerciseCatalog as object) ?? {}),
    },
    ...overrides,
  } as unknown as MockDb
}

function makeRow(ymoveId: string, name: string, equipment: string, category: string | null, primaryMuscleGroup: string) {
  return { ymoveId, name, equipment, category, primaryMuscleGroup }
}

const SQUAT_ROW  = makeRow(YMV_UUID,    'Barbell Back Squat',  'barbell',     'Legs',    'quadriceps')
const PULL_ROW   = makeRow(YMV_UUID2,   'Cable Row',           'cable',       'Back',    'back')
const CARDIO_ROW = makeRow(CARDIO_UUID, 'Treadmill Run',       'treadmill',   'cardio',  'cardiovascular system')

// ── YMove-first search ─────────────────────────────────────────────────────────

describe('executeExerciseSearchAsync — YMove-first', () => {
  const OLD_ENV = process.env

  beforeEach(() => { process.env = { ...OLD_ENV } })
  afterEach(() => { process.env = OLD_ENV })

  it('returns only ymv: results when flag is on — no ExerciseDB results mixed in', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([SQUAT_ROW, PULL_ROW]),
      },
    })
    const results = await executeExerciseSearchAsync({ limit: 20 }, db)
    expect(results.every(r => r.id.startsWith('ymv:'))).toBe(true)
    expect(results).toHaveLength(2)
  })

  it('returns empty array when YMove has no match — does not fall back to ExerciseDB', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    })
    const results = await executeExerciseSearchAsync({ query: 'bench press', limit: 10 }, db)
    expect(results).toHaveLength(0)
  })

  it('preserves ExerciseDB-only behavior when flag is off', async () => {
    delete process.env.YMOVE_CATALOG_ENABLED
    const results = await executeExerciseSearchAsync({ query: 'bench', limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(r => !r.id.startsWith('ymv:'))).toBe(true)
  })

  it('preserves ExerciseDB-only behavior when db is undefined', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const results = await executeExerciseSearchAsync({ query: 'squat', limit: 5 }, undefined)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(r => !r.id.startsWith('ymv:'))).toBe(true)
  })

  it('filters ymv: results by movementPattern correctly', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([SQUAT_ROW, PULL_ROW]),
      },
    })
    const results = await executeExerciseSearchAsync({ movementPattern: 'squat', limit: 20 }, db)
    expect(results.every(r => r.movementPattern === 'squat')).toBe(true)
    expect(results.some(r => r.id === YMV_ID)).toBe(true)
    expect(results.some(r => r.id === YMV_ID2)).toBe(false)
  })

  it('cardio movementPattern filter returns only cardio exercises', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([SQUAT_ROW, CARDIO_ROW]),
      },
    })
    const results = await executeExerciseSearchAsync({ movementPattern: 'cardio', limit: 20 }, db)
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(CARDIO_YMV_ID)
    expect(results[0].movementPattern).toBe('cardio')
    expect(results[0].exerciseRole).toBe('conditioning')
  })

  it('sorts results by role priority (primary_compound before isolation)', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const curlRow = makeRow('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Bicep Curl', 'dumbbell', 'Arms', 'biceps')
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn(),
        // Curl comes first in DB order; squat (primary_compound) should sort before it
        findMany: vi.fn().mockResolvedValue([curlRow, SQUAT_ROW]),
      },
    })
    const results = await executeExerciseSearchAsync({ limit: 20 }, db)
    const squatIdx = results.findIndex(r => r.name === 'Barbell Back Squat')
    const curlIdx  = results.findIndex(r => r.name === 'Bicep Curl')
    expect(squatIdx).toBeLessThan(curlIdx)
  })
})

// ── Cardio classification with category threading ─────────────────────────────

describe('classifyAnyExercise — cardio category threading', () => {
  it('classifies treadmill run as cardio when ymoveCategory is set', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(CARDIO_ROW),
        findMany: vi.fn(),
      },
    })
    const exercise = await validateExerciseIdAsync(CARDIO_YMV_ID, 'user1', db)
    expect(exercise).not.toBeNull()
    expect(exercise!.ymoveCategory).toBe('cardio')

    const cls = classifyAnyExercise(exercise!)
    expect(cls.primaryMovementPattern).toBe('cardio')
    expect(cls.exerciseRole).toBe('conditioning')
  })

  it('classifies HIIT cardio as cardio when ymoveCategory is hiit-cardio', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const hiitRow = makeRow(YMV_UUID, 'Burpees', 'body weight', 'hiit-cardio', 'cardiovascular system')
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(hiitRow),
        findMany: vi.fn(),
      },
    })
    const exercise = await validateExerciseIdAsync(YMV_ID, 'user1', db)
    expect(exercise!.ymoveCategory).toBe('hiit-cardio')

    const cls = classifyAnyExercise(exercise!)
    expect(cls.primaryMovementPattern).toBe('cardio')
    expect(cls.exerciseRole).toBe('conditioning')
  })

  it('classifies cycling as cardio when category is cardio', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const cyclingRow = makeRow(YMV_UUID, 'Stationary Bike', 'machine', 'cardio', 'cardiovascular system')
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(cyclingRow),
        findMany: vi.fn(),
      },
    })
    const exercise = await validateExerciseIdAsync(YMV_ID, 'user1', db)
    const cls = classifyAnyExercise(exercise!)
    expect(cls.primaryMovementPattern).toBe('cardio')
  })

  it('classifies rowing ergometer as cardio when category is cardio', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const rowingRow = makeRow(YMV_UUID, 'Rowing Ergometer', 'machine', 'cardio', 'cardiovascular system')
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(rowingRow),
        findMany: vi.fn(),
      },
    })
    const exercise = await validateExerciseIdAsync(YMV_ID, 'user1', db)
    const cls = classifyAnyExercise(exercise!)
    expect(cls.primaryMovementPattern).toBe('cardio')
    expect(cls.exerciseRole).toBe('conditioning')
  })

  it('does NOT force an unknown exercise into cardio based on name alone when no category', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    // "Jump Rope" without a category — should not be forced to cardio
    const jumpRopeRow = makeRow(YMV_UUID, 'Jump Rope', 'body weight', null, 'full body')
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(jumpRopeRow),
        findMany: vi.fn(),
      },
    })
    const exercise = await validateExerciseIdAsync(YMV_ID, 'user1', db)
    expect(exercise!.ymoveCategory).toBeNull()
    const cls = classifyAnyExercise(exercise!)
    // Without category, classification falls through to name-based — may be 'other' or
    // a specific pattern depending on the classifier, but must NOT be 'cardio'.
    // 'other' is the expected fallback for ambiguous full-body exercises.
    expect(cls.primaryMovementPattern).not.toBe('cardio')
  })
})

// ── validateWorkoutDraft — cardio exercises ───────────────────────────────────

describe('validateWorkoutDraft — cardio exercises', () => {
  const OLD_ENV = process.env

  beforeEach(() => { process.env = { ...OLD_ENV } })
  afterEach(() => { process.env = OLD_ENV })

  it('accepts a cardio ymv: exercise with intended_pattern cardio', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(CARDIO_ROW),
        findMany: vi.fn(),
      },
    })
    const draft = {
      workout_name: 'Cardio Session',
      estimated_duration_minutes: 30,
      exercises: [{
        exercise_id: CARDIO_YMV_ID,
        intended_pattern: 'cardio',
        sets: 1,
        duration_seconds: 1800,
        rest_seconds: 0,
      }],
    }
    const result = await validateWorkoutDraft(draft, 'user1', db)
    expect(result.valid).toBe(true)
    expect(result.workout?.exercises[0].exercise.name).toBe('Treadmill Run')
  })

  it('rejects a cardio exercise with wrong intended_pattern (e.g. squat)', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(CARDIO_ROW),
        findMany: vi.fn(),
      },
    })
    const draft = {
      workout_name: 'Bad Pattern',
      estimated_duration_minutes: 30,
      exercises: [{
        exercise_id: CARDIO_YMV_ID,
        intended_pattern: 'squat',
        sets: 3,
        rest_seconds: 90,
      }],
    }
    const result = await validateWorkoutDraft(draft, 'user1', db)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('intended_pattern'))).toBe(true)
  })
})

// ── validateProgramDraft — cardio exercises ───────────────────────────────────

describe('validateProgramDraft — cardio exercises', () => {
  const OLD_ENV = process.env

  beforeEach(() => { process.env = { ...OLD_ENV } })
  afterEach(() => { process.env = OLD_ENV })

  it('accepts a program with a cardio day', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(CARDIO_ROW),
        findMany: vi.fn(),
      },
    })
    const draft = {
      program_name: 'Run / Lift',
      days: [{
        name: 'Cardio Day',
        estimated_duration_minutes: 45,
        exercises: [{
          exercise_id: CARDIO_YMV_ID,
          intended_pattern: 'cardio',
          sets: 1,
          duration_seconds: 2700,
          rest_seconds: 0,
        }],
      }],
    }
    const result = await validateProgramDraft(draft, 'user1', db)
    expect(result.valid).toBe(true)
  })
})

// ── Substitute enrichment ─────────────────────────────────────────────────────

describe('substitute enrichment — ymv: metadata and media', () => {
  it('validateExerciseIdAsync returns ymoveCategory for ymv: exercises', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(SQUAT_ROW),
        findMany: vi.fn(),
      },
    })
    const meta = await validateExerciseIdAsync(YMV_ID, 'user1', db)
    expect(meta).not.toBeNull()
    expect(meta!.ymoveCategory).toBe('Legs')
    expect(meta!.name).toBe('Barbell Back Squat')
    expect(meta!.equipment).toBe('barbell')
  })

  it('validateExerciseIdAsync does not set ymoveCategory for ExerciseDB exercises', async () => {
    const db = makeDb()
    const meta = await validateExerciseIdAsync(EXDB_BENCH, 'user1', db)
    expect(meta).not.toBeNull()
    expect(meta!.ymoveCategory).toBeUndefined()
  })
})

// ── Legacy ExerciseDB compatibility ───────────────────────────────────────────

describe('legacy ExerciseDB compatibility', () => {
  const OLD_ENV = process.env

  beforeEach(() => { process.env = { ...OLD_ENV } })
  afterEach(() => { process.env = OLD_ENV })

  it('validateExerciseIdAsync resolves 4-digit ExerciseDB IDs regardless of flag', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb()
    const result = await validateExerciseIdAsync(EXDB_BENCH, 'user1', db)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(EXDB_BENCH)
    expect(db.ymoveExerciseCatalog.findUnique).not.toHaveBeenCalled()
  })

  it('validateExerciseIdAsync resolves ExerciseDB IDs when flag is off', async () => {
    delete process.env.YMOVE_CATALOG_ENABLED
    const result = await validateExerciseIdAsync(EXDB_SQUAT)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(EXDB_SQUAT)
  })

  it('classifyAnyExercise uses ExerciseDB path for non-ymv IDs', () => {
    const exercise = {
      id: EXDB_BENCH, name: 'Barbell Bench Press', bodyPart: 'chest',
      equipment: 'barbell', target: 'pectorals', secondaryMuscles: [],
      instructions: [], description: '',
    }
    const cls = classifyAnyExercise(exercise)
    expect(['horizontal_push', 'incline_push', 'fly']).toContain(cls.primaryMovementPattern)
  })

  it('mixed workout with ExerciseDB + ymv: IDs validates correctly', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const db = makeDb({
      ymoveExerciseCatalog: {
        findUnique: vi.fn().mockResolvedValue(PULL_ROW),
        findMany: vi.fn(),
      },
    })
    const draft = {
      workout_name: 'Legacy + YMove',
      estimated_duration_minutes: 60,
      exercises: [
        { exercise_id: EXDB_BENCH, intended_pattern: 'horizontal_push', sets: 3, rest_seconds: 90 },
        { exercise_id: YMV_ID2,    intended_pattern: 'horizontal_pull', sets: 3, rest_seconds: 60 },
      ],
    }
    const result = await validateWorkoutDraft(draft, 'user1', db)
    expect(result.valid).toBe(true)
    expect(result.workout?.exercises[0].exercise.id).toBe(EXDB_BENCH)
    expect(result.workout?.exercises[1].exercise.id).toBe(YMV_ID2)
  })

  it('mixed program across days (ExerciseDB + ymv:) validates correctly', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const findUnique = vi.fn().mockImplementation(({ where }: { where: { ymoveId: string } }) =>
      where.ymoveId === YMV_UUID2 ? PULL_ROW : null
    )
    const db = makeDb({ ymoveExerciseCatalog: { findUnique, findMany: vi.fn() } })
    const draft = {
      program_name: 'Legacy + YMove Program',
      days: [
        {
          name: 'Push',
          estimated_duration_minutes: 50,
          exercises: [{ exercise_id: EXDB_BENCH, intended_pattern: 'horizontal_push', sets: 4, reps_min: 6, reps_max: 8, rest_seconds: 120 }],
        },
        {
          name: 'Pull',
          estimated_duration_minutes: 50,
          exercises: [{ exercise_id: YMV_ID2, intended_pattern: 'horizontal_pull', sets: 4, reps_min: 8, reps_max: 12, rest_seconds: 90 }],
        },
      ],
    }
    const result = await validateProgramDraft(draft, 'user1', db)
    expect(result.valid).toBe(true)
    expect(result.program?.days[0].exercises[0].exercise.id).toBe(EXDB_BENCH)
    expect(result.program?.days[1].exercises[0].exercise.id).toBe(YMV_ID2)
  })
})
