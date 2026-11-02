/**
 * PR detection regression tests for set completion.
 *
 * The PATCH /api/workouts/[id]/sets/[setId] route must detect personal records
 * on first-time completion, matching the POST (new-set) path exactly.
 *
 * Scenarios covered:
 *  1. PATCH — ymv: exercise first-ever completion earns weight + 1RM PR
 *  2. PATCH — subsequent improvement beats existing PR
 *  3. PATCH — set below existing record earns no PR
 *  4. PATCH — re-editing an already-completed set skips PR detection
 *  5. PATCH — warmup set earns no PR
 *  6. PATCH — bodyweight (no weight) earns reps PR
 *  7. PATCH — legacy ExDB exercise earns PR via PATCH
 *  8. PATCH — ymv: PR keyed to ymv:uuid, not merged with ExDB IDs
 *  9. POST  — new-set path still works (regression guard)
 * 10. POST  — ymv: new set earns PR on first completion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_ID     = 'aaaaaaaa-0000-0000-0000-000000000001'
const WORKOUT_ID  = 'bbbbbbbb-0000-0000-0000-000000000001'
const WE_ID       = 'cccccccc-0000-0000-0000-000000000001'  // workoutExercise ID
const SET_ID      = 'dddddddd-0000-0000-0000-000000000001'  // pre-existing set ID
const YMV_UUID    = 'aabbccdd-ee11-2233-4455-667788990011'
const YMV_ID      = `ymv:${YMV_UUID}`
const EXDB_ID     = '0001'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } } }),
    },
  })),
}))

const mockWsFindFirst  = vi.fn()
const mockWsUpdate     = vi.fn()
const mockWsFindMany   = vi.fn()
const mockPrFindFirst  = vi.fn()
const mockPrCreate     = vi.fn()
const mockWeFindMany   = vi.fn()
const mockWoFindFirst  = vi.fn()
const mockWsFindFirst2 = vi.fn()
const mockWsCreate     = vi.fn()
const mockWeFindFirst  = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workoutSet: {
      findFirst: (...a: unknown[]) => mockWsFindFirst(...a),
      update:    (...a: unknown[]) => mockWsUpdate(...a),
      findMany:  (...a: unknown[]) => mockWsFindMany(...a),
      create:    (...a: unknown[]) => mockWsCreate(...a),
    },
    personalRecord: {
      findFirst: (...a: unknown[]) => mockPrFindFirst(...a),
      create:    (...a: unknown[]) => mockPrCreate(...a),
    },
    workoutExercise: {
      findMany:  (...a: unknown[]) => mockWeFindMany(...a),
      findFirst: (...a: unknown[]) => mockWeFindFirst(...a),
    },
    workout: {
      findFirst: (...a: unknown[]) => mockWoFindFirst(...a),
    },
  },
}))

// ─── Route imports ────────────────────────────────────────────────────────────

import { PATCH } from '@/app/api/workouts/[id]/sets/[setId]/route'
import { POST  } from '@/app/api/workouts/[id]/sets/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function patchReq(workoutId: string, setId: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/workouts/${workoutId}/sets/${setId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function postReq(workoutId: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/workouts/${workoutId}/sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patchParams(workoutId: string, setId: string) {
  return { params: Promise.resolve({ id: workoutId, setId }) }
}

function postParams(workoutId: string) {
  return { params: Promise.resolve({ id: workoutId }) }
}

function makeExistingSet(overrides: Record<string, unknown> = {}) {
  return {
    id: SET_ID,
    setNumber: 1,
    setType: 'working',
    completed: false,
    completedAt: null,
    actualReps: null,
    actualWeightKg: null,
    workoutExercise: { exerciseId: YMV_ID },
    ...overrides,
  }
}

function makeUpdatedSet(overrides: Record<string, unknown> = {}) {
  return {
    id: SET_ID,
    setNumber: 1,
    setType: 'working',
    completed: true,
    completedAt: new Date(),
    actualReps: 10,
    actualWeightKg: 40.82,
    ...overrides,
  }
}

// ─── PATCH — ymv: first-ever completion ───────────────────────────────────────

describe('PATCH /api/workouts/[id]/sets/[setId] — ymv: first-ever completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWsFindFirst.mockResolvedValue(makeExistingSet())
    mockWsUpdate.mockResolvedValue(makeUpdatedSet())
    mockPrFindFirst.mockResolvedValue(null)   // no existing PRs
    mockPrCreate.mockResolvedValue({})
    mockWeFindMany.mockResolvedValue([{ id: WE_ID }])
    mockWsFindMany.mockResolvedValue([{ actualWeightKg: 40.82, actualReps: 10 }])
  })

  it('returns 200', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 40.82 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    expect(res.status).toBe(200)
  })

  it('returns prs.weight = true for first-ever weight', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 40.82 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean>; newPR: boolean }
    expect(body.prs.weight).toBe(true)
    expect(body.newPR).toBe(true)
  })

  it('returns prs.estimated1rm = true for first-ever 1RM', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 40.82 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean> }
    expect(body.prs.estimated1rm).toBe(true)
  })

  it('calls personalRecord.create for the ymv: exerciseId (not a bare UUID)', async () => {
    await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 40.82 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const createCalls = mockPrCreate.mock.calls.map((c: unknown[]) => (c[0] as { data: { exerciseId: string } }).data)
    expect(createCalls.every((d: { exerciseId: string }) => d.exerciseId === YMV_ID)).toBe(true)
    expect(createCalls.every((d: { exerciseId: string }) => !d.exerciseId.includes(YMV_UUID)
      || d.exerciseId.startsWith('ymv:'))).toBe(true)
  })

  it('response includes the updated set', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 40.82 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { set: { id: string } }
    expect(body.set.id).toBe(SET_ID)
  })
})

// ─── PATCH — subsequent improvement beats existing record ─────────────────────

describe('PATCH /api/workouts/[id]/sets/[setId] — improvement beats existing PR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWsFindFirst.mockResolvedValue(makeExistingSet())
    mockWsUpdate.mockResolvedValue(makeUpdatedSet({ actualWeightKg: 50 }))
    // Existing PR: 40 kg — new attempt is 50 kg → new PR
    mockPrFindFirst.mockResolvedValue({ value: 40, metric: 'weight' })
    mockPrCreate.mockResolvedValue({})
    mockWeFindMany.mockResolvedValue([{ id: WE_ID }])
    mockWsFindMany.mockResolvedValue([{ actualWeightKg: 50, actualReps: 5 }])
  })

  it('returns prs.weight = true when new weight beats existing', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 5, actualWeightKg: 50 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean> }
    expect(body.prs.weight).toBe(true)
  })
})

// ─── PATCH — weight below existing record earns no PR ────────────────────────

describe('PATCH /api/workouts/[id]/sets/[setId] — below existing record', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWsFindFirst.mockResolvedValue(makeExistingSet())
    mockWsUpdate.mockResolvedValue(makeUpdatedSet({ actualWeightKg: 30 }))
    // All existing PRs are higher than any value this set could produce
    mockPrFindFirst.mockImplementation((args: { where: { metric: string } }) => {
      const m = args.where.metric
      if (m === 'weight') return Promise.resolve({ value: 60, metric: 'weight' })
      if (m === 'estimated_1rm') return Promise.resolve({ value: 60, metric: 'estimated_1rm' })
      if (m === 'volume_kg') return Promise.resolve({ value: 10000, metric: 'volume_kg' })
      return Promise.resolve(null)
    })
    mockPrCreate.mockResolvedValue({})
    mockWeFindMany.mockResolvedValue([{ id: WE_ID }])
    mockWsFindMany.mockResolvedValue([{ actualWeightKg: 30, actualReps: 10 }])
  })

  it('returns prs.weight absent (no new PR)', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 30 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean>; newPR: boolean }
    expect(body.prs.weight).toBeFalsy()
    expect(body.newPR).toBe(false)
  })

  it('does not call personalRecord.create for weight PR', async () => {
    await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 30 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const weightCreateCalls = mockPrCreate.mock.calls.filter(
      (c: unknown[]) => (c[0] as { data: { metric: string } }).data.metric === 'weight'
    )
    expect(weightCreateCalls).toHaveLength(0)
  })
})

// ─── PATCH — re-editing already-completed set skips PR detection ──────────────

describe('PATCH /api/workouts/[id]/sets/[setId] — re-edit already-completed set', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set was already completed
    mockWsFindFirst.mockResolvedValue(makeExistingSet({ completed: true, completedAt: new Date() }))
    mockWsUpdate.mockResolvedValue(makeUpdatedSet({ actualWeightKg: 100 }))
    mockPrFindFirst.mockResolvedValue(null)
    mockPrCreate.mockResolvedValue({})
    mockWeFindMany.mockResolvedValue([{ id: WE_ID }])
    mockWsFindMany.mockResolvedValue([])
  })

  it('returns prs as empty object (no detection on re-edit)', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 100 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean>; newPR: boolean }
    expect(Object.keys(body.prs)).toHaveLength(0)
    expect(body.newPR).toBe(false)
  })

  it('never calls personalRecord.create on re-edit', async () => {
    await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 100 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    expect(mockPrCreate).not.toHaveBeenCalled()
  })
})

// ─── PATCH — warmup set earns no PR ──────────────────────────────────────────

describe('PATCH /api/workouts/[id]/sets/[setId] — warmup set', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWsFindFirst.mockResolvedValue(makeExistingSet({ setType: 'warmup' }))
    mockWsUpdate.mockResolvedValue(makeUpdatedSet({ setType: 'warmup' }))
    mockPrFindFirst.mockResolvedValue(null)
    mockPrCreate.mockResolvedValue({})
    mockWeFindMany.mockResolvedValue([{ id: WE_ID }])
    mockWsFindMany.mockResolvedValue([])
  })

  it('returns empty prs for warmup set', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 5, actualWeightKg: 20, setType: 'warmup' }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean>; newPR: boolean }
    expect(Object.keys(body.prs)).toHaveLength(0)
    expect(body.newPR).toBe(false)
  })
})

// ─── PATCH — bodyweight (reps only) earns reps PR ────────────────────────────

describe('PATCH /api/workouts/[id]/sets/[setId] — bodyweight reps PR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Bodyweight exercise — no weight, only reps
    mockWsFindFirst.mockResolvedValue(makeExistingSet())
    mockWsUpdate.mockResolvedValue(makeUpdatedSet({ actualWeightKg: null, actualReps: 20 }))
    mockPrFindFirst.mockResolvedValue(null)
    mockPrCreate.mockResolvedValue({})
    mockWeFindMany.mockResolvedValue([{ id: WE_ID }])
    mockWsFindMany.mockResolvedValue([])
  })

  it('returns prs.reps = true for bodyweight first-ever completion', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 20 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean> }
    expect(body.prs.reps).toBe(true)
  })

  it('does not return prs.weight for bodyweight set', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 20 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean> }
    expect(body.prs.weight).toBeFalsy()
  })
})

// ─── PATCH — legacy ExDB exercise earns PR ───────────────────────────────────

describe('PATCH /api/workouts/[id]/sets/[setId] — ExDB exercise PR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // ExDB exercise ID, not ymv:
    mockWsFindFirst.mockResolvedValue(makeExistingSet({ workoutExercise: { exerciseId: EXDB_ID } }))
    mockWsUpdate.mockResolvedValue(makeUpdatedSet())
    mockPrFindFirst.mockResolvedValue(null)
    mockPrCreate.mockResolvedValue({})
    mockWeFindMany.mockResolvedValue([{ id: WE_ID }])
    mockWsFindMany.mockResolvedValue([{ actualWeightKg: 40.82, actualReps: 10 }])
  })

  it('returns prs.weight = true for ExDB exercise first-ever weight', async () => {
    const res = await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 40.82 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean> }
    expect(body.prs.weight).toBe(true)
  })

  it('PR is keyed to ExDB exerciseId, not ymv: ID', async () => {
    await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 40.82 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const createCalls = mockPrCreate.mock.calls.map((c: unknown[]) => (c[0] as { data: { exerciseId: string } }).data)
    expect(createCalls.every((d: { exerciseId: string }) => d.exerciseId === EXDB_ID)).toBe(true)
  })
})

// ─── PATCH — ymv: PR namespace isolation ─────────────────────────────────────

describe('PATCH — ymv: PR namespace isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWsFindFirst.mockResolvedValue(makeExistingSet())
    mockWsUpdate.mockResolvedValue(makeUpdatedSet())
    mockPrFindFirst.mockResolvedValue(null)
    mockPrCreate.mockResolvedValue({})
    mockWeFindMany.mockResolvedValue([{ id: WE_ID }])
    mockWsFindMany.mockResolvedValue([{ actualWeightKg: 40.82, actualReps: 10 }])
  })

  it('personalRecord.findFirst queries with ymv: exerciseId not bare UUID', async () => {
    await PATCH(
      patchReq(WORKOUT_ID, SET_ID, { completed: true, actualReps: 10, actualWeightKg: 40.82 }),
      patchParams(WORKOUT_ID, SET_ID),
    )
    const findCalls = mockPrFindFirst.mock.calls.map((c: unknown[]) => (c[0] as { where: { exerciseId: string } }).where.exerciseId)
    expect(findCalls.every((id: string) => id === YMV_ID)).toBe(true)
    expect(findCalls.every((id: string) => id !== YMV_UUID)).toBe(true)
  })
})

// ─── POST regression — new-set path still earns PR ───────────────────────────

describe('POST /api/workouts/[id]/sets — regression (new-set PR detection unchanged)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWoFindFirst.mockResolvedValue({ id: WORKOUT_ID })
    mockWeFindFirst.mockResolvedValue({ id: WE_ID, exerciseId: YMV_ID })
    mockWsCreate.mockResolvedValue({ id: 'new-set-uuid', setType: 'working', completed: true })
    mockPrFindFirst.mockResolvedValue(null)
    mockPrCreate.mockResolvedValue({})
    mockWeFindMany.mockResolvedValue([{ id: WE_ID }])
    mockWsFindMany.mockResolvedValue([{ actualWeightKg: 40.82, actualReps: 10 }])
  })

  it('POST returns prs.weight = true on first-ever ymv: exercise completion', async () => {
    const res = await POST(
      postReq(WORKOUT_ID, {
        workoutExerciseId: WE_ID,
        setNumber: 1,
        completed: true,
        actualReps: 10,
        actualWeightKg: 40.82,
      }),
      postParams(WORKOUT_ID),
    )
    const body = await res.json() as { prs: Record<string, boolean>; newPR: boolean }
    expect(body.prs.weight).toBe(true)
    expect(body.newPR).toBe(true)
  })
})
