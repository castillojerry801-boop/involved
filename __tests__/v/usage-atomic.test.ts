/**
 * checkAndConsumeVUsage — atomic limit enforcement tests
 *
 * Verifies the conditional INSERT ON CONFLICT behavior through mocked
 * $queryRaw responses, covering:
 *   - First request of a billing period (INSERT path)
 *   - Request at limit-1 (allowed, last slot)
 *   - Request at limit (conditional WHERE fails → 0 rows → blocked)
 *   - Requests already at limit (blocked, current count returned)
 *   - Unlimited tier (never blocked)
 *   - Calendar-month rollover (different period → treated as new)
 *   - Failed AI call refund (decrementVUsage)
 *   - Negative counter prevention (gt:0 guard in decrement)
 *   - Concurrent first requests: both resolve without double-insert
 *   - Concurrent requests at limit-1: exactly one succeeds
 *   - Two concurrent requests already at limit: both blocked
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks — must precede vi.mock() call ───────────────────────────────
const { mockQueryRaw, mockFindUnique, mockUpdateMany } = vi.hoisted(() => ({
  mockQueryRaw:   vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw:  mockQueryRaw,
    aiUsageLog: {
      findUnique: mockFindUnique,
      updateMany: mockUpdateMany,
    },
  },
}))

import { checkAndConsumeVUsage, decrementVUsage } from '../../lib/v/usage'

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const FEATURE = 'coach_message' as const

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T10:00:00Z'))
})

// ─── Limited tier — conditional increment ────────────────────────────────────

describe('Limited tier — free (limit=20)', () => {
  it('first request of a billing period: INSERT fires, returns count=1, allowed', async () => {
    mockQueryRaw.mockResolvedValue([{ n: 1 }])
    const result = await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(1)
    expect(result.limit).toBe(20)
  })

  it('request 19/20: conditional UPDATE fires (count was 18 → 19), allowed', async () => {
    mockQueryRaw.mockResolvedValue([{ n: 19 }])
    const result = await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(19)
  })

  it('request 20/20: last slot (count was 19 → 20), allowed', async () => {
    mockQueryRaw.mockResolvedValue([{ n: 20 }])
    const result = await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(20)
  })

  it('request at limit: WHERE fails, 0 rows returned → blocked', async () => {
    mockQueryRaw.mockResolvedValue([])
    mockFindUnique.mockResolvedValue({ interactionCount: 20 })
    const result = await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    expect(result.allowed).toBe(false)
    expect(result.count).toBe(20)
    expect(result.limit).toBe(20)
  })

  it('blocked: does NOT call updateMany (no over-increment to roll back)', async () => {
    mockQueryRaw.mockResolvedValue([])
    mockFindUnique.mockResolvedValue({ interactionCount: 20 })
    await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('blocked read falls back to limit value when no existing row found', async () => {
    mockQueryRaw.mockResolvedValue([])
    mockFindUnique.mockResolvedValue(null)
    const result = await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    expect(result.allowed).toBe(false)
    expect(result.count).toBe(20)
  })

  it('DB error fails open — returns allowed=true to avoid blocking users', async () => {
    mockQueryRaw.mockRejectedValue(new Error('DB connection lost'))
    const result = await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(0)
  })
})

// ─── Unlimited tier — never blocked ──────────────────────────────────────────

describe('Unlimited tier — plus', () => {
  it('always returns allowed=true', async () => {
    mockQueryRaw.mockResolvedValue([{ n: 500 }])
    const result = await checkAndConsumeVUsage(USER_ID, 'plus', FEATURE)
    expect(result.allowed).toBe(true)
    expect(result.limit).toBeNull()
  })

  it('never calls findUnique (no limit check)', async () => {
    mockQueryRaw.mockResolvedValue([{ n: 1 }])
    await checkAndConsumeVUsage(USER_ID, 'plus', FEATURE)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('trainer tier is also unlimited', async () => {
    mockQueryRaw.mockResolvedValue([{ n: 1 }])
    const result = await checkAndConsumeVUsage(USER_ID, 'trainer', FEATURE)
    expect(result.allowed).toBe(true)
    expect(result.limit).toBeNull()
  })
})

// ─── Calendar-month rollover ──────────────────────────────────────────────────

describe('Calendar-month rollover', () => {
  it('October at-limit does not block a November first request', async () => {
    // October — blocked
    mockQueryRaw.mockResolvedValue([])
    mockFindUnique.mockResolvedValue({ interactionCount: 20 })
    const oct = await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    expect(oct.allowed).toBe(false)

    // Advance to November
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
    mockQueryRaw.mockResolvedValue([{ n: 1 }])
    const nov = await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    expect(nov.allowed).toBe(true)
    expect(nov.count).toBe(1)
  })

  it('passes correct billing period to $queryRaw after month rollover', async () => {
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'))
    mockQueryRaw.mockResolvedValue([{ n: 3 }])
    await checkAndConsumeVUsage(USER_ID, 'free', FEATURE)
    const callArgs = mockQueryRaw.mock.calls[0]
    // Tagged template params are passed after the TemplateStringsArray
    expect(callArgs.some((a: unknown) => a === '2026-11')).toBe(true)
  })
})

// ─── decrementVUsage — refund on AI error ────────────────────────────────────

describe('decrementVUsage', () => {
  it('calls updateMany with gt:0 guard to prevent negative counters', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await decrementVUsage(USER_ID, FEATURE)
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          feature: FEATURE,
          interactionCount: { gt: 0 },
        }),
        data: { interactionCount: { decrement: 1 } },
      }),
    )
  })

  it('swallows DB errors silently (non-critical)', async () => {
    mockUpdateMany.mockRejectedValue(new Error('DB error'))
    await expect(decrementVUsage(USER_ID, FEATURE)).resolves.toBeUndefined()
  })

  it('scopes the decrement to the correct userId', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await decrementVUsage(USER_ID, FEATURE)
    expect(mockUpdateMany.mock.calls[0][0].where.userId).toBe(USER_ID)
  })
})

// ─── Concurrent request safety (behavioral) ──────────────────────────────────

describe('Concurrent request safety', () => {
  it('two simultaneous first requests: both resolve, counts sequential (1 and 2)', async () => {
    // Postgres serializes via unique constraint: one inserts count=1, one upserts to count=2
    mockQueryRaw
      .mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([{ n: 2 }])
    const [rA, rB] = await Promise.all([
      checkAndConsumeVUsage(USER_ID, 'free', FEATURE),
      checkAndConsumeVUsage(USER_ID, 'free', FEATURE),
    ])
    expect(rA.allowed).toBe(true)
    expect(rB.allowed).toBe(true)
    expect(rA.count + rB.count).toBe(3)  // 1 + 2
  })

  it('two simultaneous requests at count=19: exactly one fills slot 20, one is blocked', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ n: 20 }])  // R-A wins the last slot
      .mockResolvedValueOnce([])            // R-B: WHERE 20 < 20 fails
    mockFindUnique.mockResolvedValue({ interactionCount: 20 })
    const [rA, rB] = await Promise.all([
      checkAndConsumeVUsage(USER_ID, 'free', FEATURE),
      checkAndConsumeVUsage(USER_ID, 'free', FEATURE),
    ])
    const allowed = [rA.allowed, rB.allowed]
    expect(allowed.filter(Boolean).length).toBe(1)   // exactly one allowed
    expect(allowed.filter(v => !v).length).toBe(1)   // exactly one blocked
  })

  it('two simultaneous requests already at limit: both blocked, no over-increment', async () => {
    mockQueryRaw.mockResolvedValue([])
    mockFindUnique.mockResolvedValue({ interactionCount: 20 })
    const [rA, rB] = await Promise.all([
      checkAndConsumeVUsage(USER_ID, 'free', FEATURE),
      checkAndConsumeVUsage(USER_ID, 'free', FEATURE),
    ])
    expect(rA.allowed).toBe(false)
    expect(rB.allowed).toBe(false)
    // Crucially: no decrement calls — atomic approach never over-increments
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })
})
