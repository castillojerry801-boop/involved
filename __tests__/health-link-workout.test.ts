/**
 * Unit tests for linkOrCreateHealthActivity.
 *
 * The function's three outcomes on completion:
 *  A. No apple_health match (or multiple ambiguous matches) → create/upsert manual row.
 *  B. Single compatible apple_health match → link it (set involvedWorkoutId).
 *  C. Already linked (idempotency) → no-op.
 *
 * The db is passed as a parameter so we can provide a typed mock without hitting
 * any real database — important because .env.local points to production Supabase.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('server-only', () => ({}))

import { linkOrCreateHealthActivity, type WorkoutForLink } from '@/lib/health/link-workout'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_ID    = 'user-0000-0000-0000-000000000001'
const WORKOUT_ID = 'wkout-000-0000-0000-000000000001'
const NOW        = new Date('2026-11-01T10:00:00Z')
const STARTED_AT = new Date('2026-11-01T09:00:00Z')
const COMPLETED  = new Date('2026-11-01T10:00:00Z')

function makeWorkout(overrides: Partial<WorkoutForLink> = {}): WorkoutForLink {
  return {
    id: WORKOUT_ID,
    userId: USER_ID,
    title: 'Push Day',
    startedAt: STARTED_AT,
    completedAt: COMPLETED,
    durationSeconds: 3600,
    exercises: [{ trackingType: 'strength' }],
    ...overrides,
  }
}

function makeAhCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ah-row-0000-0000-0000-000000000001',
    activityType: 'strength_training',
    startedAt: new Date('2026-11-01T09:03:00Z'),  // 3 min after Involved start — within window
    durationSeconds: 3700,
    involvedWorkoutId: null,
    ...overrides,
  }
}

function makeMockDb() {
  return {
    healthActivity: {
      findFirst: vi.fn(),
      findMany:  vi.fn(),
      update:    vi.fn(),
      upsert:    vi.fn(),
    },
  } as unknown as PrismaClient
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('linkOrCreateHealthActivity — idempotency', () => {
  it('returns without any write if workout is already linked to a health_activity', async () => {
    const db = makeMockDb()
    ;(db.healthActivity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing-ha' })

    await linkOrCreateHealthActivity(makeWorkout(), db)

    expect(db.healthActivity.findMany).not.toHaveBeenCalled()
    expect(db.healthActivity.update).not.toHaveBeenCalled()
    expect(db.healthActivity.upsert).not.toHaveBeenCalled()
  })

  it('exits early when startedAt and completedAt are both null', async () => {
    const db = makeMockDb()
    ;(db.healthActivity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await linkOrCreateHealthActivity(
      makeWorkout({ startedAt: null, completedAt: null }),
      db,
    )

    expect(db.healthActivity.findFirst).not.toHaveBeenCalled()
    expect(db.healthActivity.findMany).not.toHaveBeenCalled()
  })
})

// ─── Arrival-order A: no AH match → manual row ───────────────────────────────

describe('linkOrCreateHealthActivity — creates manual row when no AH match', () => {
  let db: PrismaClient

  beforeEach(() => {
    db = makeMockDb()
    ;(db.healthActivity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.healthActivity.findMany  as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(db.healthActivity.upsert   as ReturnType<typeof vi.fn>).mockResolvedValue({})
  })

  it('calls upsert with manual provider and correct externalId', async () => {
    await linkOrCreateHealthActivity(makeWorkout(), db)

    expect(db.healthActivity.upsert).toHaveBeenCalledTimes(1)
    const call = (db.healthActivity.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.where.userId_provider_externalId).toMatchObject({
      userId:     USER_ID,
      provider:   'manual',
      externalId: `involved:${WORKOUT_ID}`,
    })
  })

  it('create payload has correct fields', async () => {
    await linkOrCreateHealthActivity(makeWorkout(), db)
    const { create } = (db.healthActivity.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(create.involvedWorkoutId).toBe(WORKOUT_ID)
    expect(create.activityType).toBe('strength_training')
    expect(create.startedAt).toEqual(STARTED_AT)
    expect(create.endedAt).toEqual(COMPLETED)
    expect(create.durationSeconds).toBe(3600)
    expect(create.syncState).toBe('synced')
  })

  it('does NOT call update (link path)', async () => {
    await linkOrCreateHealthActivity(makeWorkout(), db)
    expect(db.healthActivity.update).not.toHaveBeenCalled()
  })

  it('uses completedAt as effectiveStart when startedAt is null', async () => {
    const workout = makeWorkout({ startedAt: null, completedAt: COMPLETED })
    await linkOrCreateHealthActivity(workout, db)

    const call = (db.healthActivity.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.create.startedAt).toEqual(COMPLETED)
  })

  it('classifies a running workout correctly in the manual row', async () => {
    const workout = makeWorkout({ title: 'Morning Run', exercises: [] })
    await linkOrCreateHealthActivity(workout, db)
    const { create } = (db.healthActivity.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(create.activityType).toBe('running')
  })
})

// ─── Arrival-order B: single AH match → link it ──────────────────────────────

describe('linkOrCreateHealthActivity — links existing apple_health row (single match)', () => {
  let db: PrismaClient

  beforeEach(() => {
    db = makeMockDb()
    ;(db.healthActivity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.healthActivity.update   as ReturnType<typeof vi.fn>).mockResolvedValue({})
  })

  it('calls update on the matching AH row with involvedWorkoutId', async () => {
    ;(db.healthActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeAhCandidate()])

    await linkOrCreateHealthActivity(makeWorkout(), db)

    expect(db.healthActivity.update).toHaveBeenCalledTimes(1)
    const call = (db.healthActivity.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.where.id).toBe('ah-row-0000-0000-0000-000000000001')
    expect(call.data.involvedWorkoutId).toBe(WORKOUT_ID)
  })

  it('does NOT create a manual row when an AH match is found', async () => {
    ;(db.healthActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeAhCandidate()])

    await linkOrCreateHealthActivity(makeWorkout(), db)

    expect(db.healthActivity.upsert).not.toHaveBeenCalled()
  })

  it('functional_strength AH row matches strength_training workout (compatible types)', async () => {
    ;(db.healthActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAhCandidate({ activityType: 'functional_strength' }),
    ])

    await linkOrCreateHealthActivity(makeWorkout(), db)

    expect(db.healthActivity.update).toHaveBeenCalledTimes(1)
  })
})

// ─── Ambiguous / mismatched matches → manual row ─────────────────────────────

describe('linkOrCreateHealthActivity — falls back to manual row on ambiguous or incompatible match', () => {
  let db: PrismaClient

  beforeEach(() => {
    db = makeMockDb()
    ;(db.healthActivity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.healthActivity.upsert   as ReturnType<typeof vi.fn>).mockResolvedValue({})
  })

  it('creates manual row when multiple AH candidates exist (ambiguous)', async () => {
    ;(db.healthActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAhCandidate({ id: 'ah-1' }),
      makeAhCandidate({ id: 'ah-2', startedAt: new Date('2026-11-01T09:05:00Z') }),
    ])

    await linkOrCreateHealthActivity(makeWorkout(), db)

    expect(db.healthActivity.upsert).toHaveBeenCalledTimes(1)
    expect(db.healthActivity.update).not.toHaveBeenCalled()
  })

  it('rejects AH match with incompatible activity type', async () => {
    ;(db.healthActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAhCandidate({ activityType: 'running' }),  // Involved is strength_training
    ])

    await linkOrCreateHealthActivity(makeWorkout(), db)

    expect(db.healthActivity.upsert).toHaveBeenCalledTimes(1)
    expect(db.healthActivity.update).not.toHaveBeenCalled()
  })

  it('rejects AH match with duration mismatch > 50%', async () => {
    // Workout: 60 min (3600s). AH candidate: 10 min (600s). Ratio = (3600-600)/3600 ≈ 83%.
    ;(db.healthActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAhCandidate({ durationSeconds: 600 }),
    ])

    await linkOrCreateHealthActivity(makeWorkout({ durationSeconds: 3600 }), db)

    expect(db.healthActivity.upsert).toHaveBeenCalledTimes(1)
    expect(db.healthActivity.update).not.toHaveBeenCalled()
  })

  it('accepts AH match when duration is within 50%', async () => {
    // Workout: 3600s. AH: 4800s. Ratio = (4800-3600)/4800 = 25% — within 50%.
    ;(db.healthActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAhCandidate({ durationSeconds: 4800 }),
    ])
    ;(db.healthActivity.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    await linkOrCreateHealthActivity(makeWorkout({ durationSeconds: 3600 }), db)

    expect(db.healthActivity.update).toHaveBeenCalledTimes(1)
    expect(db.healthActivity.upsert).not.toHaveBeenCalled()
  })

  it('accepts AH match when one side has no duration (no duration guard needed)', async () => {
    // AH row has no duration → duration check is skipped → match proceeds.
    ;(db.healthActivity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAhCandidate({ durationSeconds: null }),
    ])
    ;(db.healthActivity.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    await linkOrCreateHealthActivity(makeWorkout(), db)

    expect(db.healthActivity.update).toHaveBeenCalledTimes(1)
  })
})

// ─── AH candidate query filters ──────────────────────────────────────────────

describe('linkOrCreateHealthActivity — AH candidate query parameters', () => {
  it('queries candidates within ±10 min of workout startedAt', async () => {
    const db = makeMockDb()
    ;(db.healthActivity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.healthActivity.findMany  as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(db.healthActivity.upsert   as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const workout = makeWorkout({ startedAt: new Date('2026-11-01T09:00:00Z') })
    await linkOrCreateHealthActivity(workout, db)

    const call = (db.healthActivity.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const { where } = call
    expect(where.provider).toBe('apple_health')
    expect(where.involvedWorkoutId).toBeNull()
    expect(where.startedAt.gte.getTime()).toBe(new Date('2026-11-01T08:50:00Z').getTime())
    expect(where.startedAt.lte.getTime()).toBe(new Date('2026-11-01T09:10:00Z').getTime())
  })
})
