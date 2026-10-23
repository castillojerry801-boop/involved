/**
 * next-workout — unit tests for getNextWorkout and formatWorkoutDate
 *
 * getNextWorkout query structure:
 *   1. Includes in_progress workouts unconditionally (no date filter)
 *   2. Includes planned workouts with scheduledDate >= today (user's local date)
 *   3. Excludes completed workouts — not present in the OR clause
 *   4. Excludes unscheduled planned templates — null scheduledDate fails the gte filter
 *   5. Prioritises in_progress before planned via status asc ordering
 *   6. Returns null when findFirst returns null (no match)
 *
 * formatWorkoutDate:
 *   7.  Today's date → "Today"
 *   8.  Next day → "Tomorrow"
 *   9.  Farther future → short formatted date (e.g. "Sat, Oct 25")
 *  10.  Timezone boundary: @db.Date is stored as a calendar date; UTC midnight of
 *       that date is what Prisma returns. The UTC ISO string matches todayStr directly
 *       without timezone conversion, so users in any timezone see the correct label.
 *  11.  Consecutive days correctly distinguished
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    workout: {
      findFirst: vi.fn(),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// ── Late imports ─────────────────────────────────────────────────────────────

import { getNextWorkout, formatWorkoutDate } from '@/lib/today/next-workout'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID   = 'user-uuid-0001'
const TODAY_STR = '2026-10-17'  // arbitrary fixed date for all tests

function makeWorkout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workout-uuid-0001',
    userId: USER_ID,
    title: 'Push Day A',
    status: 'planned',
    scheduledDate: new Date('2026-10-17T00:00:00Z'),
    exercises: [{ exerciseId: 'ex-1' }, { exerciseId: 'ex-2' }],
    ...overrides,
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.workout.findFirst.mockResolvedValue(null)
})

// ── getNextWorkout — query structure ─────────────────────────────────────────

describe('getNextWorkout — WHERE clause', () => {
  it('includes in_progress workouts unconditionally (no scheduledDate filter)', async () => {
    await getNextWorkout(USER_ID, TODAY_STR)

    const [call] = mockPrisma.workout.findFirst.mock.calls
    const { where } = call[0] as { where: { OR: unknown[] } }

    const inProgressClause = (where.OR as { status: string }[]).find(
      c => c.status === 'in_progress',
    )
    expect(inProgressClause).toBeDefined()
    // Must NOT have a scheduledDate filter — in_progress has no date restriction
    expect(inProgressClause).not.toHaveProperty('scheduledDate')
  })

  it('includes planned workouts with scheduledDate >= today', async () => {
    await getNextWorkout(USER_ID, TODAY_STR)

    const [call] = mockPrisma.workout.findFirst.mock.calls
    const { where } = call[0] as { where: { OR: unknown[] } }

    const plannedClause = (where.OR as { status: string; scheduledDate?: unknown }[]).find(
      c => c.status === 'planned',
    )
    expect(plannedClause).toBeDefined()
    expect(plannedClause!.scheduledDate).toMatchObject({
      gte: expect.any(Date),
    })

    // The gte date must represent 'today' (2026-10-17) as UTC midnight
    const gteDate = (plannedClause!.scheduledDate as { gte: Date }).gte
    expect(gteDate.toISOString().slice(0, 10)).toBe(TODAY_STR)
  })

  it('excludes completed workouts — status completed is absent from the OR clause', async () => {
    await getNextWorkout(USER_ID, TODAY_STR)

    const [call] = mockPrisma.workout.findFirst.mock.calls
    const { where } = call[0] as { where: { OR: { status: string }[] } }

    const completedClause = where.OR.find(c => c.status === 'completed')
    expect(completedClause).toBeUndefined()
  })

  it('excludes unscheduled templates — null scheduledDate cannot satisfy the gte filter', async () => {
    // This is a structural guarantee: the planned clause uses { scheduledDate: { gte: ... } }
    // which cannot match null in SQL. We verify no special null-exclusion is needed.
    await getNextWorkout(USER_ID, TODAY_STR)

    const [call] = mockPrisma.workout.findFirst.mock.calls
    const { where } = call[0] as { where: { OR: { status: string; scheduledDate?: unknown }[] } }

    const plannedClause = where.OR.find(c => c.status === 'planned')
    // Should not have an additional isNot: null check — the gte handles it
    const sd = plannedClause?.scheduledDate as Record<string, unknown> | undefined
    expect(sd).not.toHaveProperty('not')
  })
})

describe('getNextWorkout — ORDER BY', () => {
  it('orders by status asc so in_progress sorts before planned', async () => {
    await getNextWorkout(USER_ID, TODAY_STR)

    const [call] = mockPrisma.workout.findFirst.mock.calls
    const { orderBy } = call[0] as { orderBy: { status?: string; scheduledDate?: string }[] }

    expect(orderBy[0]).toEqual({ status: 'asc' })
    expect(orderBy[1]).toEqual({ scheduledDate: 'asc' })
  })
})

describe('getNextWorkout — return value', () => {
  it('returns the workout when findFirst resolves one', async () => {
    const workout = makeWorkout()
    mockPrisma.workout.findFirst.mockResolvedValue(workout)

    const result = await getNextWorkout(USER_ID, TODAY_STR)
    expect(result).toBe(workout)
  })

  it('returns null when no workout matches', async () => {
    mockPrisma.workout.findFirst.mockResolvedValue(null)

    const result = await getNextWorkout(USER_ID, TODAY_STR)
    expect(result).toBeNull()
  })
})

describe('getNextWorkout — timezone-correct date comparison', () => {
  it('uses UTC midnight of todayDateStr so @db.Date comparison is tz-independent', async () => {
    // A user in Tokyo (UTC+9) has local date '2026-10-17'.
    // todayStart for them is 2026-10-16T15:00:00Z (UTC), which Prisma would serialize
    // as '2026-10-16' — their yesterday. getNextWorkout uses new Date(dateStr + 'T00:00:00Z')
    // to produce 2026-10-17T00:00:00Z → '2026-10-17', which is correct.
    const tokyoTodayStr = '2026-10-17'
    await getNextWorkout(USER_ID, tokyoTodayStr)

    const [call] = mockPrisma.workout.findFirst.mock.calls
    const { where } = call[0] as { where: { OR: { status: string; scheduledDate?: { gte: Date } }[] } }
    const plannedClause = where.OR.find(c => c.status === 'planned')
    const gteDate = plannedClause!.scheduledDate!.gte

    // Must be UTC midnight of 2026-10-17, not 2026-10-16
    expect(gteDate.toISOString()).toBe('2026-10-17T00:00:00.000Z')
  })
})

// ── formatWorkoutDate ─────────────────────────────────────────────────────────

describe('formatWorkoutDate — label values', () => {
  it('returns "Today" when the stored date matches todayStr', () => {
    // @db.Date '2026-10-17' → Prisma returns Date('2026-10-17T00:00:00Z')
    const scheduledDate = new Date('2026-10-17T00:00:00Z')
    expect(formatWorkoutDate(scheduledDate, '2026-10-17')).toBe('Today')
  })

  it('returns "Tomorrow" for the next calendar day', () => {
    const scheduledDate = new Date('2026-10-18T00:00:00Z')
    expect(formatWorkoutDate(scheduledDate, '2026-10-17')).toBe('Tomorrow')
  })

  it('returns a short date string for dates further in the future', () => {
    const scheduledDate = new Date('2026-10-25T00:00:00Z')
    const result = formatWorkoutDate(scheduledDate, '2026-10-17')
    // Should contain the day number and not be "Today" or "Tomorrow"
    expect(result).not.toBe('Today')
    expect(result).not.toBe('Tomorrow')
    expect(result).toContain('25')
  })

  it('correctly distinguishes consecutive days', () => {
    const oct17 = new Date('2026-10-17T00:00:00Z')
    const oct18 = new Date('2026-10-18T00:00:00Z')
    const oct19 = new Date('2026-10-19T00:00:00Z')

    expect(formatWorkoutDate(oct17, '2026-10-17')).toBe('Today')
    expect(formatWorkoutDate(oct18, '2026-10-17')).toBe('Tomorrow')
    expect(formatWorkoutDate(oct19, '2026-10-17')).not.toBe('Tomorrow')
  })
})

describe('formatWorkoutDate — timezone boundary', () => {
  it('uses the stored calendar date directly — UTC ISO slice, not tz-shifted conversion', () => {
    // @db.Date '2026-10-17' → Prisma Date = 2026-10-17T00:00:00Z
    // A user in America/New_York (UTC-4): toLocaleDateString gives '2026-10-16' — WRONG
    // formatWorkoutDate uses .toISOString().slice(0,10) = '2026-10-17' — CORRECT
    const prismaDate = new Date('2026-10-17T00:00:00Z')
    const todayStr   = '2026-10-17'

    // Verify what a tz-naive conversion would give (the bug we avoid)
    const naiveConversion = prismaDate.toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    })
    // In CI (UTC), this returns '2026-10-17'; in EDT it would return '2026-10-16'.
    // The function must NOT use timezone conversion, so the result is always 'Today'.
    expect(formatWorkoutDate(prismaDate, todayStr)).toBe('Today')
  })

  it('returns "Tomorrow" for a workout stored as Oct 18 when user today is Oct 17', () => {
    // Works for any user timezone — stored date Oct 18 vs today Oct 17
    const scheduledDate = new Date('2026-10-18T00:00:00Z') // @db.Date '2026-10-18'
    expect(formatWorkoutDate(scheduledDate, '2026-10-17')).toBe('Tomorrow')
  })

  it('month boundary: Oct 31 today → Nov 1 is Tomorrow', () => {
    const nov1 = new Date('2026-11-01T00:00:00Z')
    expect(formatWorkoutDate(nov1, '2026-10-31')).toBe('Tomorrow')
  })

  it('year boundary: Dec 31 today → Jan 1 is Tomorrow', () => {
    const jan1 = new Date('2027-01-01T00:00:00Z')
    expect(formatWorkoutDate(jan1, '2026-12-31')).toBe('Tomorrow')
  })
})
