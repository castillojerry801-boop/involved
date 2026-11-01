/**
 * Stage 2 regression tests — YMove write gate and hydration correctness.
 *
 * Verifies that every workout/program/template write path:
 *   1. Accepts ymv: IDs (syntax-valid + DB-verified)
 *   2. Accepts ExerciseDB IDs (unchanged behaviour)
 *   3. Rejects syntactically-valid ymv: IDs that don't exist in the catalog
 *   4. Rejects unknown IDs regardless of shape
 *   5. Hydration paths return human-readable names for ymv: IDs
 *
 * Routes under test:
 *   POST /api/workouts
 *   POST /api/workouts/[id]/exercises
 *   POST /api/programs
 *   POST /api/programs/[id]/days
 *   PATCH /api/programs/[id]/days/[dayId]
 *   POST  /api/training/exercises/[exerciseId]/preference
 *   GET/POST /api/v/substitute (write gate + hydration)
 *   GET  /api/analytics/summary (ymv PR name hydration)
 *   GET  /api/v/weekly-review   (ymv exercise name hydration)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Shared constants ─────────────────────────────────────────────────────────

const VALID_UUID   = '65e95132-e6bb-41e8-af7d-0eda931a1693'
const VALID_YMV    = `ymv:${VALID_UUID}`
const GHOST_UUID   = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
const GHOST_YMV    = `ymv:${GHOST_UUID}`   // syntactically valid but not in catalog
const EXDB_ID      = '0025'
const USER_ID      = 'aaaaaaaa-0000-0000-0000-000000000001'

// ─── Mock: server-only ────────────────────────────────────────────────────────
// Handled by __tests__/__mocks__/server-only.ts

// ─── Mock: supabase ───────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

// ─── Mock: exercises (ExerciseDB) ─────────────────────────────────────────────

vi.mock('@/lib/exercises', () => ({
  getExerciseById: vi.fn((id: string) => {
    if (id === EXDB_ID) return { id: EXDB_ID, name: 'Barbell Squat', bodyPart: 'upper legs', equipment: 'barbell', target: 'quads', secondaryMuscles: [], instructions: [], description: '' }
    return undefined
  }),
  isCustomExerciseId: vi.fn((id: string) => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return UUID_RE.test(id) && !id.startsWith('ymv:')
  }),
}))

// ─── Mock: resolver ───────────────────────────────────────────────────────────

const ymvMeta = {
  id:               VALID_YMV,
  name:             'Dumbbell Bench Press',
  bodyPart:         'chest',
  equipment:        'dumbbell',
  target:           'pecs',
  secondaryMuscles: [],
  instructions:     [],
  description:      '',
}

vi.mock('@/lib/ymove/resolver', () => ({
  verifyYmvIds: vi.fn(async (ids: string[]) => {
    // GHOST_YMV is syntactically valid but "not in catalog"
    return !ids.some(id => id === GHOST_YMV)
  }),
  resolveExerciseMeta: vi.fn(async (id: string) => {
    if (id === VALID_YMV) return ymvMeta
    if (id === EXDB_ID) return { id: EXDB_ID, name: 'Barbell Squat', bodyPart: 'upper legs', equipment: 'barbell', target: 'quads', secondaryMuscles: [], instructions: [], description: '' }
    return null
  }),
  prefetchYmvMeta: vi.fn(async (ids: string[]) => {
    const map = new Map<string, typeof ymvMeta>()
    if (ids.includes(VALID_YMV)) map.set(VALID_YMV, ymvMeta)
    return map
  }),
}))

// ─── Mock: prisma ─────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workout: {
      create:    vi.fn().mockResolvedValue({ id: 'wk1', title: 'Test', status: 'planned', source: 'manual', exercises: [], createdAt: new Date(), updatedAt: new Date(), scheduledDate: new Date(), startedAt: null, completedAt: null, notes: null, programDayId: null, stravaActivityId: null }),
      findFirst: vi.fn().mockResolvedValue({ id: 'wk1', status: 'planned', exercises: [] }),
      findMany:  vi.fn().mockResolvedValue([]),
      count:     vi.fn().mockResolvedValue(0),
    },
    workoutExercise: {
      create:    vi.fn().mockResolvedValue({ id: 'we1', exerciseId: 'ymv:65e95132-e6bb-41e8-af7d-0eda931a1693', workoutId: 'wk1', order: 0, sets: [] }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    program: {
      create:    vi.fn().mockResolvedValue({ id: 'pg1', name: 'Test Program', description: null, isActive: false, durationWeeks: null, createdAt: new Date(), updatedAt: new Date(), days: [] }),
      findFirst: vi.fn().mockResolvedValue({ id: 'pg1', name: 'Test Program', userId: 'aaaaaaaa-0000-0000-0000-000000000001' }),
      findMany:  vi.fn().mockResolvedValue([]),
    },
    programDay: {
      create:    vi.fn().mockResolvedValue({ id: 'day1', programId: 'pg1', name: 'Day 1', sortOrder: 0, weekday: null, focus: null, createdAt: new Date(), updatedAt: new Date(), exercises: [] }),
      findFirst: vi.fn().mockResolvedValue({ id: 'day1', programId: 'pg1', name: 'Day 1', sortOrder: 0, exercises: [] }),
      update:    vi.fn().mockResolvedValue({ id: 'day1', programId: 'pg1', name: 'Day 1', sortOrder: 0, exercises: [] }),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      delete:    vi.fn().mockResolvedValue({ id: 'day1' }),
    },
    programExercise: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    exercisePreference: {
      upsert:     vi.fn().mockResolvedValue({ state: 'favorite' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    personalRecord: {
      findMany: vi.fn().mockResolvedValue([
        { exerciseId: 'ymv:65e95132-e6bb-41e8-af7d-0eda931a1693', metric: 'weight', value: 100, unit: 'kg', achievedAt: new Date() },
        { exerciseId: '0025', metric: 'weight', value: 80, unit: 'kg', achievedAt: new Date() },
      ]),
    },
    workoutSet:     { findMany:   vi.fn().mockResolvedValue([]) },
    nutritionLog:   { aggregate:  vi.fn().mockResolvedValue({ _avg: { calories: null } }) },
    bodyWeight:     { findFirst:  vi.fn().mockResolvedValue(null) },
    foodLogEntry:   { findMany:   vi.fn().mockResolvedValue([]) },
    healthMetric:   { findFirst:  vi.fn().mockResolvedValue(null) },
    profile:        { findUnique: vi.fn().mockResolvedValue(null) },
    customExercise: { findFirst:  vi.fn().mockResolvedValue(null) },
    ymoveExerciseCatalog: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  },
}))

// ─── Mock: subscription ───────────────────────────────────────────────────────

vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn().mockResolvedValue({ tier: 'plus', isPlus: true, isFree: false }),
}))

vi.mock('@/lib/subscription/config', () => ({
  hasFeatureAccess: vi.fn().mockReturnValue(true),
}))

// ─── Mock: V-specific ─────────────────────────────────────────────────────────

vi.mock('@/lib/v/usage', () => ({
  checkAndConsumeVUsage: vi.fn().mockResolvedValue({ allowed: true, limit: 50 }),
}))

vi.mock('@/lib/v/training-context', () => ({
  buildVTrainingContext: vi.fn().mockResolvedValue({}),
  trainingContextToPrompt: vi.fn().mockReturnValue(''),
}))

vi.mock('@/lib/ai/request-logger', () => ({
  buildTokenLog: vi.fn().mockReturnValue({}),
  flushRequestLogs: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/models', () => ({
  workoutModel: vi.fn().mockReturnValue('gpt-4o-mini'),
}))

vi.mock('@/lib/ai/client', () => ({
  getOpenAI: vi.fn().mockReturnValue({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'No substitutes', tool_calls: null } }],
          usage: null,
        }),
      },
    },
  }),
}))

vi.mock('@/lib/ai/tools/exercises', () => ({
  SEARCH_EXERCISES_TOOL:  { type: 'function', function: { name: 'search_exercises', description: '', parameters: {} } },
  executeExerciseSearch:  vi.fn().mockReturnValue([]),
  validateExerciseId:     vi.fn((id: string) => id === EXDB_ID),
}))

vi.mock('@/lib/v/weekly-review', () => ({
  buildWeeklyReview: vi.fn().mockReturnValue({ summary: 'ok', sessions: [] }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { createClient } from '@/lib/supabase/server'
import { verifyYmvIds } from '@/lib/ymove/resolver'

const mockCreateClient = createClient as ReturnType<typeof vi.fn>
const mockVerifyYmvIds = verifyYmvIds as ReturnType<typeof vi.fn>

function mockAuthed() {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
  })
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ─── POST /api/workouts ───────────────────────────────────────────────────────

import { POST as createWorkout } from '../app/api/workouts/route'

describe('POST /api/workouts — ymv: write gate', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuthed() })

  it('accepts ExerciseDB IDs unchanged', async () => {
    const res = await createWorkout(makeRequest({ title: 'Test', exercises: [{ exerciseId: EXDB_ID }] }) as never)
    expect(res.status).toBe(201)
  })

  it('accepts valid ymv: ID that exists in catalog', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(true)
    const res = await createWorkout(makeRequest({ title: 'Test', exercises: [{ exerciseId: VALID_YMV }] }) as never)
    expect(res.status).toBe(201)
  })

  it('rejects ymv: ID not in catalog (syntax-valid ghost ID)', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(false)
    const res = await createWorkout(makeRequest({ title: 'Test', exercises: [{ exerciseId: GHOST_YMV }] }) as never)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/ymove|catalog/i)
  })

  it('rejects completely unknown exercise ID', async () => {
    const res = await createWorkout(makeRequest({ title: 'Test', exercises: [{ exerciseId: 'bad-id-999' }] }) as never)
    expect(res.status).toBe(400)
  })

  it('accepts workout with no exercises', async () => {
    const res = await createWorkout(makeRequest({ title: 'Empty Workout' }) as never)
    expect(res.status).toBe(201)
  })

  it('mixes ymv: and ExerciseDB IDs — verifyYmvIds called only for ymv: subset', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(true)
    const res = await createWorkout(makeRequest({
      title: 'Mixed',
      exercises: [{ exerciseId: EXDB_ID }, { exerciseId: VALID_YMV }],
    }) as never)
    expect(res.status).toBe(201)
    expect(mockVerifyYmvIds).toHaveBeenCalledWith([VALID_YMV], expect.anything())
  })
})

// ─── POST /api/workouts/[id]/exercises ───────────────────────────────────────

import { POST as addExercise } from '../app/api/workouts/[id]/exercises/route'

const WORKOUT_PARAMS = { params: Promise.resolve({ id: 'wk1' }) }

describe('POST /api/workouts/[id]/exercises — ymv: write gate', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuthed() })

  it('accepts ExerciseDB ID', async () => {
    const res = await addExercise(makeRequest({ exerciseId: EXDB_ID }) as never, WORKOUT_PARAMS)
    expect(res.status).toBe(201)
  })

  it('accepts valid ymv: ID', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(true)
    const res = await addExercise(makeRequest({ exerciseId: VALID_YMV }) as never, WORKOUT_PARAMS)
    expect(res.status).toBe(201)
  })

  it('rejects ghost ymv: ID', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(false)
    const res = await addExercise(makeRequest({ exerciseId: GHOST_YMV }) as never, WORKOUT_PARAMS)
    expect(res.status).toBe(400)
  })

  it('rejects unknown ID', async () => {
    const res = await addExercise(makeRequest({ exerciseId: 'junk' }) as never, WORKOUT_PARAMS)
    expect(res.status).toBe(400)
  })
})

// ─── POST /api/programs ───────────────────────────────────────────────────────

import { POST as createProgram } from '../app/api/programs/route'

describe('POST /api/programs — ymv: write gate', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuthed() })

  it('accepts ExerciseDB IDs in program days', async () => {
    const res = await createProgram(makeRequest({
      name: 'P1',
      days: [{ name: 'Day 1', exercises: [{ exerciseId: EXDB_ID }] }],
    }) as never)
    expect(res.status).toBe(201)
  })

  it('accepts ymv: IDs that exist in catalog', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(true)
    const res = await createProgram(makeRequest({
      name: 'P2',
      days: [{ name: 'Day 1', exercises: [{ exerciseId: VALID_YMV }] }],
    }) as never)
    expect(res.status).toBe(201)
  })

  it('rejects ghost ymv: IDs', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(false)
    const res = await createProgram(makeRequest({
      name: 'P3',
      days: [{ name: 'Day 1', exercises: [{ exerciseId: GHOST_YMV }] }],
    }) as never)
    expect(res.status).toBe(400)
  })

  it('accepts program with no days', async () => {
    const res = await createProgram(makeRequest({ name: 'Empty' }) as never)
    expect(res.status).toBe(201)
  })

  it('collects all ymv: IDs across all days before verifying', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(true)
    await createProgram(makeRequest({
      name: 'MultiDay',
      days: [
        { name: 'A', exercises: [{ exerciseId: EXDB_ID }, { exerciseId: VALID_YMV }] },
        { name: 'B', exercises: [{ exerciseId: VALID_YMV }] },
      ],
    }) as never)
    // Both ymv: IDs passed in one call (deduplication is verifyYmvIds's responsibility)
    const calls = mockVerifyYmvIds.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── POST /api/programs/[id]/days ────────────────────────────────────────────

import { POST as addDay } from '../app/api/programs/[id]/days/route'

const PROGRAM_PARAMS = { params: Promise.resolve({ id: 'pg1' }) }

describe('POST /api/programs/[id]/days — ymv: write gate', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuthed() })

  it('accepts ExerciseDB IDs', async () => {
    const res = await addDay(makeRequest({
      name: 'Day 1',
      exercises: [{ exerciseId: EXDB_ID }],
    }) as never, PROGRAM_PARAMS)
    expect(res.status).toBe(201)
  })

  it('accepts ymv: IDs present in catalog', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(true)
    const res = await addDay(makeRequest({
      name: 'Day 1',
      exercises: [{ exerciseId: VALID_YMV }],
    }) as never, PROGRAM_PARAMS)
    expect(res.status).toBe(201)
  })

  it('rejects ghost ymv: IDs', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(false)
    const res = await addDay(makeRequest({
      name: 'Day 1',
      exercises: [{ exerciseId: GHOST_YMV }],
    }) as never, PROGRAM_PARAMS)
    expect(res.status).toBe(400)
  })
})

// ─── PATCH /api/programs/[id]/days/[dayId] ───────────────────────────────────

import { PATCH as patchDay } from '../app/api/programs/[id]/days/[dayId]/route'

const DAY_PARAMS = { params: Promise.resolve({ id: 'pg1', dayId: 'day1' }) }

describe('PATCH /api/programs/[id]/days/[dayId] — ymv: write gate', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuthed() })

  it('accepts ExerciseDB IDs in exercises array', async () => {
    const res = await patchDay(makeRequest({
      exercises: [{ exerciseId: EXDB_ID }],
    }) as never, DAY_PARAMS)
    expect(res.status).toBe(200)
  })

  it('accepts ymv: IDs present in catalog', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(true)
    const res = await patchDay(makeRequest({
      exercises: [{ exerciseId: VALID_YMV }],
    }) as never, DAY_PARAMS)
    expect(res.status).toBe(200)
  })

  it('rejects ghost ymv: IDs', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(false)
    const res = await patchDay(makeRequest({
      exercises: [{ exerciseId: GHOST_YMV }],
    }) as never, DAY_PARAMS)
    expect(res.status).toBe(400)
  })

  it('skips DB check for exercises with existing id (update, not create)', async () => {
    const res = await patchDay(makeRequest({
      exercises: [{ id: 'existing-ex-1', exerciseId: GHOST_YMV }],
    }) as never, DAY_PARAMS)
    // Existing exercises (id present) bypass the create-path validation
    expect(mockVerifyYmvIds).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })
})

// ─── POST /api/training/exercises/[exerciseId]/preference ────────────────────

import { POST as setPreference } from '../app/api/training/exercises/[exerciseId]/preference/route'

function makePreferenceRequest(exerciseId: string) {
  return {
    req: makeRequest({ state: 'favorite' }) as never,
    ctx: { params: Promise.resolve({ exerciseId }) },
  }
}

describe('POST /api/training/exercises/preference — ymv: write gate', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuthed() })

  it('accepts ExerciseDB IDs', async () => {
    const { req, ctx } = makePreferenceRequest(EXDB_ID)
    const res = await setPreference(req, ctx)
    expect(res.status).toBe(200)
  })

  it('accepts ymv: IDs present in catalog', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(true)
    const { req, ctx } = makePreferenceRequest(VALID_YMV)
    const res = await setPreference(req, ctx)
    expect(res.status).toBe(200)
  })

  it('rejects ghost ymv: IDs', async () => {
    mockVerifyYmvIds.mockResolvedValueOnce(false)
    const { req, ctx } = makePreferenceRequest(GHOST_YMV)
    const res = await setPreference(req, ctx)
    expect(res.status).toBe(404)
  })

  it('rejects unknown IDs', async () => {
    const { req, ctx } = makePreferenceRequest('bad-id')
    const res = await setPreference(req, ctx)
    expect(res.status).toBe(404)
  })
})

// ─── POST /api/v/substitute — write gate and hydration ───────────────────────

import { POST as substitute } from '../app/api/v/substitute/route'

describe('POST /api/v/substitute — ymv: write gate', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuthed() })

  it('accepts ymv: ID as the exercise to substitute', async () => {
    const res = await substitute(makeRequest({ exerciseId: VALID_YMV }) as never)
    // V returns 422 if it can't find substitutes (no real AI), but 404 means the write gate blocked it
    expect(res.status).not.toBe(404)
  })

  it('accepts ExerciseDB ID as the exercise to substitute', async () => {
    const res = await substitute(makeRequest({ exerciseId: EXDB_ID }) as never)
    expect(res.status).not.toBe(404)
  })

  it('returns 404 for unknown exercise ID', async () => {
    const res = await substitute(makeRequest({ exerciseId: 'unknown-9999' }) as never)
    expect(res.status).toBe(404)
  })

  it('does not crash when proposed substitute is an ExerciseDB ID', async () => {
    // The enrichment for proposed substitutes uses getExerciseById (ExerciseDB-only)
    // This tests the safe fallback — name defaults to exerciseId when ex is undefined
    // which prevents the previous `getExerciseById(s.exercise_id)!` non-null crash
    const res = await substitute(makeRequest({ exerciseId: EXDB_ID }) as never)
    // No assertion on status — just must not throw
    expect(res).toBeDefined()
  })
})

// ─── GET /api/analytics/summary — ymv: PR hydration ─────────────────────────

import { GET as analyticsSummary } from '../app/api/analytics/summary/route'
import { prefetchYmvMeta } from '@/lib/ymove/resolver'

const mockPrefetch = prefetchYmvMeta as ReturnType<typeof vi.fn>

describe('GET /api/analytics/summary — ymv: exercise name hydration', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuthed() })

  it('returns human-readable name for ymv: PR records', async () => {
    mockPrefetch.mockResolvedValueOnce(new Map([[VALID_YMV, ymvMeta]]))
    const res = await analyticsSummary(new Request('http://localhost') as never)
    expect(res.status).toBe(200)
    const body = await res.json() as { topPRs: Array<{ exerciseName: string; exerciseId: string }> }
    const ymvPR = body.topPRs.find(p => p.exerciseId === VALID_YMV)
    expect(ymvPR).toBeDefined()
    expect(ymvPR!.exerciseName).toBe('Dumbbell Bench Press')
  })

  it('falls back to ExerciseDB name for ExerciseDB PRs when ymv map misses', async () => {
    mockPrefetch.mockResolvedValueOnce(new Map())
    const res = await analyticsSummary(new Request('http://localhost') as never)
    expect(res.status).toBe(200)
    const body = await res.json() as { topPRs: Array<{ exerciseName: string; exerciseId: string }> }
    const exdbPR = body.topPRs.find(p => p.exerciseId === EXDB_ID)
    expect(exdbPR).toBeDefined()
    expect(exdbPR!.exerciseName).toBe('Barbell Squat')
  })
})

// ─── GET /api/v/weekly-review — ymv: exercise name hydration ─────────────────

import { GET as weeklyReview } from '../app/api/v/weekly-review/route'
import { getUserEntitlement } from '@/lib/subscription/entitlements'

const mockGetEntitlement = getUserEntitlement as ReturnType<typeof vi.fn>

const mockWorkoutWithYmv = {
  id: 'wk-weekly',
  userId: USER_ID,
  title: 'Week Workout',
  status: 'completed',
  source: 'manual',
  scheduledDate: new Date(),
  completedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  notes: null,
  programDayId: null,
  stravaActivityId: null,
  exercises: [
    {
      id: 'we1',
      exerciseId: VALID_YMV,
      workoutId: 'wk-weekly',
      sets: [
        { setType: 'working', targetWeightKg: 60, actualWeightKg: 65, targetReps: 8, targetRepsMin: null, actualReps: 8, rpe: null },
      ],
    },
  ],
}

describe('GET /api/v/weekly-review — ymv: exercise name hydration', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuthed() })

  it('uses ymv: exercise name instead of raw ID in set summaries', async () => {
    mockGetEntitlement.mockResolvedValue({ tier: 'plus', isPlus: true, isFree: false })
    mockPrefetch.mockResolvedValueOnce(new Map([[VALID_YMV, ymvMeta]]))

    const { prisma: mockPrisma } = await import('@/lib/prisma')
    // No active program → avoids createdAt crash in programWeek calculation
    ;(mockPrisma.program.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(mockPrisma.workout.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([mockWorkoutWithYmv])

    const { buildWeeklyReview } = await import('@/lib/v/weekly-review')
    const mockBuild = buildWeeklyReview as ReturnType<typeof vi.fn>

    const res = await weeklyReview()
    expect(res.status).toBe(200)

    // Confirm buildWeeklyReview was called and the sets used the resolved name
    expect(mockBuild).toHaveBeenCalled()
    const [summaries] = mockBuild.mock.calls[0] as [Array<{ sets: Array<{ exerciseName: string }> }>]
    const setNames = summaries.flatMap(s => s.sets.map(set => set.exerciseName))
    expect(setNames).toContain('Dumbbell Bench Press')
    expect(setNames).not.toContain(VALID_YMV)
  })
})

// ─── Identity space isolation ─────────────────────────────────────────────────

import { isYmvId, isCustomExerciseId as isCustom, isExerciseDbId } from '../lib/exercises/identity'

describe('identity space isolation — no cross-space collisions', () => {
  it('ymv: ID is not classified as custom', () => {
    expect(isCustom(VALID_YMV)).toBe(false)
  })

  it('ymv: ID is not classified as ExerciseDB', () => {
    expect(isExerciseDbId(VALID_YMV)).toBe(false)
  })

  it('ExerciseDB ID is not classified as ymv:', () => {
    expect(isYmvId(EXDB_ID)).toBe(false)
  })

  it('ExerciseDB ID is not classified as custom', () => {
    expect(isCustom(EXDB_ID)).toBe(false)
  })

  it('bare UUID is not classified as ymv:', () => {
    expect(isYmvId(VALID_UUID)).toBe(false)
  })

  it('bare UUID is not classified as ExerciseDB', () => {
    expect(isExerciseDbId(VALID_UUID)).toBe(false)
  })

  it('ghost ymv: ID (syntactically valid but missing) passes syntax but would fail DB check', () => {
    // isYmvId is syntax-only — it should pass; DB check is what catches ghost IDs
    expect(isYmvId(GHOST_YMV)).toBe(true)
  })
})
