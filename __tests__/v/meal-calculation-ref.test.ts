/**
 * meal-calculation-ref — unit tests for server-side ref store
 *
 * Covers:
 *   storeMealCalculationRef
 *     1. Creates a row and returns the generated UUID
 *     2. Triggers lazy cleanup of expired rows for the same user (fire-and-forget)
 *     3. Cleanup targets only expired rows for the authenticated user
 *
 *   resolveMealCalculationRef
 *     4. Returns token when ref exists, is owned by the user, and is not expired
 *     5. Returns not_found when ref does not exist
 *     6. Returns not_found (not wrong_user) when ref belongs to a different user
 *     7. Returns expired when ref exists but expiresAt is in the past
 *     8. Returns db_error without throwing when prisma throws
 *
 *   Security
 *     9. Cross-user access returns not_found — existence is not disclosed
 *    10. db_error does not surface the exception message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    mealCalculationRef: {
      create:     vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// ─── Late imports ────────────────────────────────────────────────────────────

import { storeMealCalculationRef, resolveMealCalculationRef } from '@/lib/v/meal-calculation-ref'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_A = 'user-a-uuid'
const USER_B = 'user-b-uuid'
const FAKE_TOKEN = 'eyJmYWtl.deadbeef'
const FAKE_REF_ID = 'ref-uuid-0001'
const FUTURE = new Date(Date.now() + 7200 * 1000)
const PAST   = new Date(Date.now() - 1000)

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.mealCalculationRef.deleteMany.mockResolvedValue({ count: 0 })
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('storeMealCalculationRef', () => {
  it('creates a row and returns the generated id', async () => {
    mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: FAKE_REF_ID })

    const refId = await storeMealCalculationRef(USER_A, FAKE_TOKEN, FUTURE)

    expect(refId).toBe(FAKE_REF_ID)
    expect(mockPrisma.mealCalculationRef.create).toHaveBeenCalledWith({
      data:   { userId: USER_A, token: FAKE_TOKEN, expiresAt: FUTURE },
      select: { id: true },
    })
  })

  it('triggers lazy cleanup of expired rows for the same user', async () => {
    mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: FAKE_REF_ID })

    await storeMealCalculationRef(USER_A, FAKE_TOKEN, FUTURE)

    // Allow the fire-and-forget to resolve
    await Promise.resolve()

    expect(mockPrisma.mealCalculationRef.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER_A }) }),
    )
  })

  it('cleanup filter targets only rows with expiresAt in the past', async () => {
    mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: FAKE_REF_ID })

    await storeMealCalculationRef(USER_A, FAKE_TOKEN, FUTURE)
    await Promise.resolve()

    const [call] = mockPrisma.mealCalculationRef.deleteMany.mock.calls
    expect(call[0].where.expiresAt).toMatchObject({ lt: expect.any(Date) })
    const ltDate = call[0].where.expiresAt.lt as Date
    expect(ltDate.getTime()).toBeLessThanOrEqual(Date.now())
  })
})

describe('resolveMealCalculationRef', () => {
  it('returns the token when ref exists, is owned by user, and is not expired', async () => {
    mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
      userId: USER_A, token: FAKE_TOKEN, expiresAt: FUTURE,
    })

    const result = await resolveMealCalculationRef(FAKE_REF_ID, USER_A)

    expect(result).toEqual({ ok: true, token: FAKE_TOKEN })
    expect(mockPrisma.mealCalculationRef.findUnique).toHaveBeenCalledWith({
      where:  { id: FAKE_REF_ID },
      select: { userId: true, token: true, expiresAt: true },
    })
  })

  it('returns not_found when the row does not exist', async () => {
    mockPrisma.mealCalculationRef.findUnique.mockResolvedValue(null)

    const result = await resolveMealCalculationRef(FAKE_REF_ID, USER_A)

    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_found (not wrong_user) when ref belongs to a different user', async () => {
    mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
      userId: USER_B, token: FAKE_TOKEN, expiresAt: FUTURE,
    })

    const result = await resolveMealCalculationRef(FAKE_REF_ID, USER_A)

    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns expired when ref exists but expiresAt is in the past', async () => {
    mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
      userId: USER_A, token: FAKE_TOKEN, expiresAt: PAST,
    })

    const result = await resolveMealCalculationRef(FAKE_REF_ID, USER_A)

    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('returns db_error without throwing when prisma throws', async () => {
    mockPrisma.mealCalculationRef.findUnique.mockRejectedValue(new Error('Connection refused'))

    const result = await resolveMealCalculationRef(FAKE_REF_ID, USER_A)

    expect(result).toEqual({ ok: false, reason: 'db_error' })
  })
})

describe('security', () => {
  it('cross-user lookup returns not_found — existence of the ref is not disclosed', async () => {
    // Ref exists but belongs to USER_B
    mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
      userId: USER_B, token: FAKE_TOKEN, expiresAt: FUTURE,
    })

    const result = await resolveMealCalculationRef(FAKE_REF_ID, USER_A)

    // Must not return wrong_user — that would confirm the ref exists
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('db_error does not surface the raw exception message', async () => {
    const sensitiveError = new Error('FATAL: password authentication failed for user "postgres"')
    mockPrisma.mealCalculationRef.findUnique.mockRejectedValue(sensitiveError)

    const result = await resolveMealCalculationRef(FAKE_REF_ID, USER_A)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('db_error')
      // The error object must not contain the exception message
      expect(JSON.stringify(result)).not.toContain('password')
      expect(JSON.stringify(result)).not.toContain('FATAL')
    }
  })
})

describe('UUID reference and user ID handling', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  // 11. storeMealCalculationRef passes the correct fields including UUID-formatted userId
  it('storeMealCalculationRef stores userId as received (UUID-shaped string)', async () => {
    const uuidUserId = '550e8400-e29b-41d4-a716-446655440000'
    mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: FAKE_REF_ID })

    await storeMealCalculationRef(uuidUserId, FAKE_TOKEN, FUTURE)

    const callArg = mockPrisma.mealCalculationRef.create.mock.calls[0][0]
    expect(callArg.data.userId).toBe(uuidUserId)
  })

  // 12. storeMealCalculationRef returns the id exactly as the DB provides it
  it('returns whatever id string the DB returns', async () => {
    const dbId = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff'
    mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: dbId })

    const refId = await storeMealCalculationRef(USER_A, FAKE_TOKEN, FUTURE)

    expect(refId).toBe(dbId)
  })

  // 13. resolveMealCalculationRef passes the refId verbatim to findUnique
  it('resolveMealCalculationRef looks up refId verbatim — no re-encoding', async () => {
    const refId = 'deadbeef-dead-dead-dead-deaddeadbeef'
    mockPrisma.mealCalculationRef.findUnique.mockResolvedValue(null)

    await resolveMealCalculationRef(refId, USER_A)

    expect(mockPrisma.mealCalculationRef.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: refId } }),
    )
  })

  // 14. Cross-user isolation: ownership check is a string-equality comparison
  it('cross-user: ownership check compares userId strings exactly', async () => {
    const ownerUserId  = '11111111-1111-1111-1111-111111111111'
    const callerUserId = '22222222-2222-2222-2222-222222222222'
    mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
      userId: ownerUserId, token: FAKE_TOKEN, expiresAt: FUTURE,
    })

    const result = await resolveMealCalculationRef(FAKE_REF_ID, callerUserId)

    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })
})
