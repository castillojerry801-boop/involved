/**
 * Integration-style tests for unified activity tracking.
 *
 * Tests two arrival-order scenarios:
 *  A) Involved completes first → manual projection row created.
 *     When HealthKit syncs later, reconcileManualRow() transfers the link
 *     to the apple_health row and deletes the manual projection.
 *  B) HealthKit row already exists → linkOrCreateHealthActivity() links it.
 *
 * Also covers: repeat completions, incompatible types, duration mismatch,
 * multiple same-day sessions, and edge cases.
 *
 * All Prisma calls are mocked — no production data is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_ID    = 'user-0000-0000-0000-000000000001'
const WORKOUT_ID = 'wkout-000-0000-0000-000000000001'
const AH_EXT_ID  = 'AH-ext-id-000-1'
const STARTED_AT = '2026-11-01T09:00:00.000Z'

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mockHaFindFirst  = vi.fn()
const mockHaFindMany   = vi.fn()
const mockHaFindUnique = vi.fn()
const mockHaUpsert     = vi.fn()
const mockHaUpdate     = vi.fn()
const mockHaDelete     = vi.fn()
const mockTransaction  = vi.fn()
const mockCursorUpsert = vi.fn()
const mockWoFindFirst  = vi.fn()
const mockWoUpdate     = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    healthActivity: {
      findFirst:  (...a: unknown[]) => mockHaFindFirst(...a),
      findMany:   (...a: unknown[]) => mockHaFindMany(...a),
      findUnique: (...a: unknown[]) => mockHaFindUnique(...a),
      upsert:     (...a: unknown[]) => mockHaUpsert(...a),
      update:     (...a: unknown[]) => mockHaUpdate(...a),
      delete:     (...a: unknown[]) => mockHaDelete(...a),
    },
    healthSyncCursor: {
      upsert: (...a: unknown[]) => mockCursorUpsert(...a),
    },
    workout: {
      findFirst: (...a: unknown[]) => mockWoFindFirst(...a),
      update:    (...a: unknown[]) => mockWoUpdate(...a),
    },
    workoutExercise: { findMany: vi.fn().mockResolvedValue([]) },
    personalRecord:  { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    workoutSet:      { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
  })),
}))

vi.mock('@/lib/exercises',       () => ({ getExerciseById: vi.fn() }))
vi.mock('@/lib/ymove/resolver',  () => ({ resolveExerciseMeta: vi.fn().mockResolvedValue(null) }))

// ─── Route imports ────────────────────────────────────────────────────────────

import { PATCH } from '@/app/api/workouts/[id]/route'
import { POST  } from '@/app/api/healthkit/activities/route'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWorkoutPatchReq(workoutId: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/workouts/${workoutId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeHkPostReq(activities: unknown[]) {
  return new NextRequest('http://localhost/api/healthkit/activities', {
    method: 'POST',
    body: JSON.stringify({ activities }),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeAhActivity(overrides: Record<string, unknown> = {}) {
  return {
    externalId:       AH_EXT_ID,
    provider:         'apple_health',
    activityType:     'strength_training',
    title:            'Strength Training',
    startedAt:        STARTED_AT,
    endedAt:          '2026-11-01T10:00:00.000Z',
    durationSeconds:  3600,
    distanceMeters:   null,
    activeEnergyKcal: 350,
    totalEnergyKcal:  null,
    avgHeartRate:     135,
    maxHeartRate:     162,
    sourceApp:        'Apple Watch',
    ...overrides,
  }
}

function makeExistingWorkout(overrides: Record<string, unknown> = {}) {
  return {
    id:          WORKOUT_ID,
    userId:      USER_ID,
    status:      'in_progress',
    title:       'Push Day',
    startedAt:   new Date(STARTED_AT),
    completedAt: null,
    durationSeconds: null,
    exercises: [{ id: 'we-1', exerciseId: 'ex-1', trackingType: 'strength', sets: [] }],
    ...overrides,
  }
}

// ─── Reset mocks between tests ────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockCursorUpsert.mockResolvedValue({})
  mockHaUpsert.mockResolvedValue({})
  mockHaUpdate.mockResolvedValue({})
  mockHaDelete.mockResolvedValue({ count: 1 })
  mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
})

// ─── Workout PATCH → write-back (arrival-order A first step) ─────────────────

describe('Workout PATCH completion → health activity write-back', () => {
  it('creates a manual projection row when no AH match exists', async () => {
    mockWoFindFirst.mockResolvedValue(makeExistingWorkout())
    mockWoUpdate.mockResolvedValue({
      ...makeExistingWorkout(),
      status: 'completed',
      completedAt: new Date(),
      durationSeconds: 3600,
    })
    mockHaFindFirst.mockResolvedValue(null)  // no existing link
    mockHaFindMany.mockResolvedValue([])     // no AH candidates
    mockHaUpsert.mockResolvedValue({})

    const req = makeWorkoutPatchReq(WORKOUT_ID, { status: 'completed' })
    const res = await PATCH(req, { params: Promise.resolve({ id: WORKOUT_ID }) })

    expect(res.status).toBe(200)
    expect(mockHaUpsert).toHaveBeenCalledTimes(1)

    const call = mockHaUpsert.mock.calls[0][0]
    expect(call.create.provider).toBe('manual')
    expect(call.create.externalId).toBe(`involved:${WORKOUT_ID}`)
    expect(call.create.involvedWorkoutId).toBe(WORKOUT_ID)
    expect(call.create.activityType).toBe('strength_training')
  })

  it('does NOT create manual row when workout was already completed (re-complete idempotency)', async () => {
    // already completed → existing.status === 'completed' → skip write-back
    mockWoFindFirst.mockResolvedValue(makeExistingWorkout({ status: 'completed' }))
    mockWoUpdate.mockResolvedValue(makeExistingWorkout({ status: 'completed' }))

    const req = makeWorkoutPatchReq(WORKOUT_ID, { status: 'completed' })
    await PATCH(req, { params: Promise.resolve({ id: WORKOUT_ID }) })

    expect(mockHaUpsert).not.toHaveBeenCalled()
    expect(mockHaUpdate).not.toHaveBeenCalled()
  })

  it('links existing AH row instead of creating manual (arrival-order B)', async () => {
    mockWoFindFirst.mockResolvedValue(makeExistingWorkout())
    mockWoUpdate.mockResolvedValue({
      ...makeExistingWorkout(),
      status: 'completed',
      completedAt: new Date(),
      durationSeconds: 3600,
    })
    mockHaFindFirst.mockResolvedValue(null)  // no existing link
    mockHaFindMany.mockResolvedValue([{     // matching AH row exists
      id: 'ah-row-1',
      activityType: 'strength_training',
      startedAt: new Date(STARTED_AT),
      durationSeconds: null,  // duration skipped when null; avoids test/wall-clock mismatch
      involvedWorkoutId: null,
    }])
    mockHaUpdate.mockResolvedValue({})

    const req = makeWorkoutPatchReq(WORKOUT_ID, { status: 'completed' })
    await PATCH(req, { params: Promise.resolve({ id: WORKOUT_ID }) })

    expect(mockHaUpdate).toHaveBeenCalledTimes(1)
    expect(mockHaUpdate.mock.calls[0][0].data.involvedWorkoutId).toBe(WORKOUT_ID)
    expect(mockHaUpsert).not.toHaveBeenCalled()
  })

  it('returns 200 even if write-back throws (non-fatal)', async () => {
    mockWoFindFirst.mockResolvedValue(makeExistingWorkout())
    mockWoUpdate.mockResolvedValue({
      ...makeExistingWorkout(),
      status: 'completed',
      completedAt: new Date(),
    })
    mockHaFindFirst.mockRejectedValue(new Error('DB error'))

    const req = makeWorkoutPatchReq(WORKOUT_ID, { status: 'completed' })
    const res = await PATCH(req, { params: Promise.resolve({ id: WORKOUT_ID }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.workout).toBeDefined()
  })

  it('does not write a manual row when status is not completed', async () => {
    mockWoFindFirst.mockResolvedValue(makeExistingWorkout({ status: 'planned' }))
    mockWoUpdate.mockResolvedValue({ ...makeExistingWorkout(), status: 'in_progress' })

    const req = makeWorkoutPatchReq(WORKOUT_ID, { status: 'in_progress' })
    await PATCH(req, { params: Promise.resolve({ id: WORKOUT_ID }) })

    expect(mockHaUpsert).not.toHaveBeenCalled()
  })
})

// ─── HealthKit POST → reconciliation (arrival-order A second step) ────────────

describe('HealthKit POST → reconcileManualRow', () => {
  it('transfers involvedWorkoutId from manual to AH row and deletes manual', async () => {
    // AH row upsert succeeds; row has no existing link
    mockHaFindUnique.mockResolvedValue({
      id:               'ah-row-1',
      activityType:     'strength_training',
      startedAt:        new Date(STARTED_AT),
      durationSeconds:  3600,
      involvedWorkoutId: null,
    })
    // Manual projection row found
    mockHaFindFirst.mockResolvedValue({
      id:               'manual-row-1',
      activityType:     'strength_training',
      startedAt:        new Date(STARTED_AT),
      durationSeconds:  3600,
      involvedWorkoutId: WORKOUT_ID,
    })

    const req = makeHkPostReq([makeAhActivity()])
    const res = await POST(req)

    expect(res.status).toBe(200)

    // Transaction must be called once for delete + update
    expect(mockTransaction).toHaveBeenCalledTimes(1)

    // The delete and update calls happen inside the transaction
    expect(mockHaDelete).toHaveBeenCalledTimes(1)
    expect(mockHaDelete.mock.calls[0][0].where.id).toBe('manual-row-1')

    expect(mockHaUpdate).toHaveBeenCalledTimes(1)
    expect(mockHaUpdate.mock.calls[0][0].where.id).toBe('ah-row-1')
    expect(mockHaUpdate.mock.calls[0][0].data.involvedWorkoutId).toBe(WORKOUT_ID)
  })

  it('skips reconciliation when AH row already has involvedWorkoutId', async () => {
    mockHaFindUnique.mockResolvedValue({
      id:               'ah-row-1',
      activityType:     'strength_training',
      startedAt:        new Date(STARTED_AT),
      durationSeconds:  3600,
      involvedWorkoutId: WORKOUT_ID,  // already linked
    })

    const req = makeHkPostReq([makeAhActivity()])
    await POST(req)

    expect(mockHaFindFirst).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('skips reconciliation when no manual row exists', async () => {
    mockHaFindUnique.mockResolvedValue({
      id:               'ah-row-1',
      activityType:     'strength_training',
      startedAt:        new Date(STARTED_AT),
      durationSeconds:  3600,
      involvedWorkoutId: null,
    })
    mockHaFindFirst.mockResolvedValue(null)  // no manual row

    const req = makeHkPostReq([makeAhActivity()])
    await POST(req)

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('skips reconciliation when manual row activity type is incompatible', async () => {
    mockHaFindUnique.mockResolvedValue({
      id: 'ah-row-1', activityType: 'running',
      startedAt: new Date(STARTED_AT), durationSeconds: 3600, involvedWorkoutId: null,
    })
    mockHaFindFirst.mockResolvedValue({
      id: 'manual-row-1', activityType: 'strength_training',
      startedAt: new Date(STARTED_AT), durationSeconds: 3600, involvedWorkoutId: WORKOUT_ID,
    })

    const req = makeHkPostReq([makeAhActivity({ activityType: 'running' })])
    await POST(req)

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('skips reconciliation when duration mismatch exceeds 50%', async () => {
    // AH row: 3600s. Manual row: 600s. Ratio = 83%.
    mockHaFindUnique.mockResolvedValue({
      id: 'ah-row-1', activityType: 'strength_training',
      startedAt: new Date(STARTED_AT), durationSeconds: 3600, involvedWorkoutId: null,
    })
    mockHaFindFirst.mockResolvedValue({
      id: 'manual-row-1', activityType: 'strength_training',
      startedAt: new Date(STARTED_AT), durationSeconds: 600,
      involvedWorkoutId: WORKOUT_ID,
    })

    const req = makeHkPostReq([makeAhActivity({ durationSeconds: 3600 })])
    await POST(req)

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('reconciles when one side has no duration (skips duration check)', async () => {
    mockHaFindUnique.mockResolvedValue({
      id: 'ah-row-1', activityType: 'strength_training',
      startedAt: new Date(STARTED_AT), durationSeconds: null, involvedWorkoutId: null,
    })
    mockHaFindFirst.mockResolvedValue({
      id: 'manual-row-1', activityType: 'strength_training',
      startedAt: new Date(STARTED_AT), durationSeconds: 3600, involvedWorkoutId: WORKOUT_ID,
    })

    const req = makeHkPostReq([makeAhActivity({ durationSeconds: null })])
    await POST(req)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('reconciliation failure is non-fatal — batch still returns 200', async () => {
    mockHaFindUnique.mockResolvedValue({
      id: 'ah-row-1', activityType: 'strength_training',
      startedAt: new Date(STARTED_AT), durationSeconds: 3600, involvedWorkoutId: null,
    })
    mockHaFindFirst.mockResolvedValue({
      id: 'manual-row-1', activityType: 'strength_training',
      startedAt: new Date(STARTED_AT), durationSeconds: 3600, involvedWorkoutId: WORKOUT_ID,
    })
    mockTransaction.mockRejectedValue(new Error('P2034 serialization failure'))

    const req = makeHkPostReq([makeAhActivity()])
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(1)  // main upsert still succeeded
  })

  it('reconciles functional_strength manual row with strength_training AH row', async () => {
    mockHaFindUnique.mockResolvedValue({
      id: 'ah-row-1', activityType: 'strength_training',
      startedAt: new Date(STARTED_AT), durationSeconds: 3600, involvedWorkoutId: null,
    })
    mockHaFindFirst.mockResolvedValue({
      id: 'manual-row-1', activityType: 'functional_strength',
      startedAt: new Date(STARTED_AT), durationSeconds: 3600, involvedWorkoutId: WORKOUT_ID,
    })

    const req = makeHkPostReq([makeAhActivity()])
    await POST(req)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})

// ─── Same-day multiple sessions ───────────────────────────────────────────────

describe('multiple same-day sessions remain separate', () => {
  it('two completions create two separate health_activity rows', async () => {
    const WORKOUT_ID_2 = 'wkout-000-0000-0000-000000000002'

    // First workout
    mockWoFindFirst.mockResolvedValueOnce(makeExistingWorkout())
    mockWoUpdate.mockResolvedValueOnce({
      ...makeExistingWorkout(), status: 'completed', completedAt: new Date(), durationSeconds: 3600,
    })
    mockHaFindFirst.mockResolvedValueOnce(null)
    mockHaFindMany.mockResolvedValueOnce([])
    mockHaUpsert.mockResolvedValueOnce({})

    const req1 = makeWorkoutPatchReq(WORKOUT_ID, { status: 'completed' })
    await PATCH(req1, { params: Promise.resolve({ id: WORKOUT_ID }) })

    // Second workout
    mockWoFindFirst.mockResolvedValueOnce(makeExistingWorkout({ id: WORKOUT_ID_2, title: 'Cardio' }))
    mockWoUpdate.mockResolvedValueOnce({
      ...makeExistingWorkout({ id: WORKOUT_ID_2 }), status: 'completed', completedAt: new Date(),
    })
    mockHaFindFirst.mockResolvedValueOnce(null)
    mockHaFindMany.mockResolvedValueOnce([])
    mockHaUpsert.mockResolvedValueOnce({})

    const req2 = makeWorkoutPatchReq(WORKOUT_ID_2, { status: 'completed' })
    await PATCH(req2, { params: Promise.resolve({ id: WORKOUT_ID_2 }) })

    expect(mockHaUpsert).toHaveBeenCalledTimes(2)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const externalIds = mockHaUpsert.mock.calls.map((c: any[]) => c[0].where.userId_provider_externalId.externalId)
    expect(externalIds).toContain(`involved:${WORKOUT_ID}`)
    expect(externalIds).toContain(`involved:${WORKOUT_ID_2}`)
  })
})
