/**
 * getTrainingData — query structure and resume-safety tests
 *
 * Verified:
 *  1. recent query fetches ONLY completed workouts (never in_progress)
 *  2. recent query is scoped to userId
 *  3. recent query fetches at most 2 workouts (Training page shows 2 most recent)
 *  4. inProgressWorkout query fetches ONLY in_progress status
 *  5. inProgressWorkout query is scoped to userId
 *  6. inProgressWorkout orders by updatedAt desc (most recently active, not just started)
 *  7. inProgressWorkout is null when no in-progress session exists (null → null coercion)
 *  8. Resume URL uses existing workout id — the returned id is never a new-workout path
 *  9. Prisma error falls back to safe empty defaults — no throw reaches the page
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    workout: {
      findMany:  vi.fn(),
      findFirst: vi.fn(),
    },
    program: {
      findMany: vi.fn(),
    },
    workoutTemplate: {
      count: vi.fn(),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// ── Late imports ──────────────────────────────────────────────────────────────

import { getTrainingData } from '@/lib/training/training-data'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-training-0001'

function makeWorkout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workout-uuid-0001',
    userId: USER_ID,
    title: 'Push Day A',
    status: 'completed',
    completedAt: new Date('2026-10-20T10:00:00Z'),
    startedAt: new Date('2026-10-20T09:00:00Z'),
    updatedAt: new Date('2026-10-20T10:00:00Z'),
    durationSeconds: 3600,
    exercises: [],
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.workout.findMany.mockResolvedValue([])
  mockPrisma.workout.findFirst.mockResolvedValue(null)
  mockPrisma.program.findMany.mockResolvedValue([])
  mockPrisma.workoutTemplate.count.mockResolvedValue(0)
})

// ── 1. recent — status filter ─────────────────────────────────────────────────

describe('recent workouts query', () => {
  it('fetches only completed status — never in_progress', async () => {
    await getTrainingData(USER_ID)

    // findMany is called twice: once for completed (recent), once for planned.
    // The completed call has status: 'completed'.
    const calls = mockPrisma.workout.findMany.mock.calls as Array<[{ where: { userId: string; status: unknown } }]>
    const recentCall = calls.find(([arg]) => arg.where.status === 'completed')
    expect(recentCall).toBeDefined()

    // Confirm in_progress is NOT included in any findMany call
    const inProgressFindMany = calls.find(([arg]) => {
      const s = arg.where.status
      return s === 'in_progress' || (typeof s === 'object' && s !== null && 'in' in (s as object) && (s as { in: string[] }).in.includes('in_progress'))
    })
    expect(inProgressFindMany).toBeUndefined()
  })

  it('scopes recent query to the authenticated userId', async () => {
    await getTrainingData(USER_ID)

    const calls = mockPrisma.workout.findMany.mock.calls as Array<[{ where: { userId: string; status: unknown } }]>
    const recentCall = calls.find(([arg]) => arg.where.status === 'completed')
    expect(recentCall![0].where.userId).toBe(USER_ID)
  })

  it('fetches at most 2 recent workouts — Training page shows only the 2 most recent', async () => {
    await getTrainingData(USER_ID)

    const calls = mockPrisma.workout.findMany.mock.calls as Array<[{ where: { status: unknown }; take?: number }]>
    const recentCall = calls.find(([arg]) => arg.where.status === 'completed')
    expect(recentCall![0].take).toBe(2)
  })
})

// ── 2. inProgressWorkout — query structure ────────────────────────────────────

describe('inProgressWorkout query', () => {
  it('fetches only in_progress status via findFirst', async () => {
    await getTrainingData(USER_ID)

    const [callArgs] = mockPrisma.workout.findFirst.mock.calls
    const { where } = callArgs[0] as { where: { userId: string; status: string } }
    expect(where.status).toBe('in_progress')
  })

  it('scopes inProgressWorkout to the authenticated userId', async () => {
    await getTrainingData(USER_ID)

    const [callArgs] = mockPrisma.workout.findFirst.mock.calls
    const { where } = callArgs[0] as { where: { userId: string; status: string } }
    expect(where.userId).toBe(USER_ID)
  })

  it('orders by updatedAt desc — most recently active session, not just most recently started', async () => {
    await getTrainingData(USER_ID)

    const [callArgs] = mockPrisma.workout.findFirst.mock.calls
    const { orderBy } = callArgs[0] as { orderBy: { updatedAt?: string; startedAt?: string } }
    expect(orderBy).toMatchObject({ updatedAt: 'desc' })
    expect(orderBy).not.toHaveProperty('startedAt')
  })

  it('returns null when no in-progress session exists', async () => {
    mockPrisma.workout.findFirst.mockResolvedValue(null)

    const result = await getTrainingData(USER_ID)
    expect(result.inProgressWorkout).toBeNull()
  })

  it('returns the workout when an in-progress session exists', async () => {
    const activeWorkout = makeWorkout({ id: 'wk-active-001', status: 'in_progress', completedAt: null })
    mockPrisma.workout.findFirst.mockResolvedValue(activeWorkout)

    const result = await getTrainingData(USER_ID)
    expect(result.inProgressWorkout).toBe(activeWorkout)
    expect(result.inProgressWorkout?.id).toBe('wk-active-001')
  })
})

// ── 3. Resume URL safety ──────────────────────────────────────────────────────

describe('Resume URL — no duplicate creation', () => {
  it('inProgressWorkout id can construct a /training/workout/{id} URL, not a /new URL', async () => {
    const activeWorkout = makeWorkout({ id: 'wk-resume-42', status: 'in_progress', completedAt: null })
    mockPrisma.workout.findFirst.mockResolvedValue(activeWorkout)

    const result = await getTrainingData(USER_ID)
    const id = result.inProgressWorkout?.id

    // Resume href must be an existing-session route
    const resumeHref = `/training/workout/${id}`
    expect(resumeHref).toBe('/training/workout/wk-resume-42')
    expect(resumeHref).not.toContain('/new')
    expect(resumeHref).not.toContain('programDayId')
  })
})

// ── 4. Error fallback ─────────────────────────────────────────────────────────

describe('error fallback', () => {
  it('returns safe empty defaults when Prisma throws — never propagates the error', async () => {
    mockPrisma.workout.findMany.mockRejectedValue(new Error('DB connection lost'))

    const result = await getTrainingData(USER_ID)
    expect(result.recent).toEqual([])
    expect(result.planned).toEqual([])
    expect(result.allPrograms).toEqual([])
    expect(result.templateCount).toBe(0)
    expect(result.inProgressWorkout).toBeNull()
    expect(result.activeProgram).toBeNull()
  })
})
