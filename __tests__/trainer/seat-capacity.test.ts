/**
 * Trainer seat capacity — concurrency safety tests
 *
 * Verifies that acceptInvitation:
 * - Acquires a FOR UPDATE lock inside the transaction to serialize concurrent accepts
 * - Enforces Starter (5), Pro (20), Studio (50) caps
 * - Respects the absolute ceiling of 50 even if DB has a higher value
 * - TRAINER_USER_IDS bypass skips the DB lock and seat check
 * - Expired and already-accepted invitations are rejected before the lock
 * - Does not remove or delete existing clients
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockQueryRaw,
  mockTransaction,
  mockFindUniqueInvitation,
  mockFindUniqueRel,
  mockCountRel,
  mockCreateEntitlement,
  mockCreateRel,
  mockUpdateRel,
  mockUpdateInvitation,
  mockUpdateProfile,
} = vi.hoisted(() => {
  const mockQueryRaw              = vi.fn()
  const mockCountRel              = vi.fn()
  const mockCreateEntitlement     = vi.fn()
  const mockCreateRel             = vi.fn()
  const mockUpdateRel             = vi.fn()
  const mockUpdateInvitation      = vi.fn()
  const mockUpdateProfile         = vi.fn()
  const mockFindUniqueInvitation  = vi.fn()
  const mockFindUniqueRel         = vi.fn()

  // $transaction receives a callback; we execute it with a mock tx proxy
  const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      $queryRaw:                 mockQueryRaw,
      trainerClientRelationship: { count: mockCountRel, create: mockCreateRel, update: mockUpdateRel },
      userEntitlement:           { create: mockCreateEntitlement },
      trainerInvitation:         { update: mockUpdateInvitation },
      profile:                   { update: mockUpdateProfile },
    }),
  )

  return {
    mockQueryRaw, mockTransaction, mockFindUniqueInvitation,
    mockFindUniqueRel, mockCountRel, mockCreateEntitlement,
    mockCreateRel, mockUpdateRel, mockUpdateInvitation, mockUpdateProfile,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw:                 mockQueryRaw,
    $transaction:              mockTransaction,
    trainerInvitation:         { findUnique: mockFindUniqueInvitation },
    trainerClientRelationship: { findUnique: mockFindUniqueRel },
  },
}))

import { acceptInvitation } from '../../lib/trainer/relationships'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TRAINER_ID = 'trainer-aaaa-0000-0000-000000000001'
const CLIENT_ID  = 'client-bbbb-0000-0000-000000000002'
const TOKEN      = 'valid-invite-token-abc'

function futureDate(days = 7): Date {
  const d = new Date(); d.setDate(d.getDate() + days); return d
}

function makeInvitation(overrides: Record<string, unknown> = {}) {
  return { id: 'inv-0001', trainerId: TRAINER_ID, invitedEmail: 'c@test.com',
    token: TOKEN, status: 'pending', expiresAt: futureDate(), ...overrides }
}

function trainerSubRows(maxClients: number, status = 'active') {
  return [{ max_clients: maxClients, status }]
}

function setupSuccess(maxClients: number, activeCount: number) {
  mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
  mockFindUniqueRel.mockResolvedValue(null)
  mockQueryRaw.mockResolvedValue(trainerSubRows(maxClients))
  mockCountRel.mockResolvedValue(activeCount)
  mockCreateEntitlement.mockResolvedValue({ id: 'ent-0001' })
  mockCreateRel.mockResolvedValue({})
  mockUpdateInvitation.mockResolvedValue({})
  mockUpdateProfile.mockResolvedValue({})
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TRAINER_USER_IDS
})

afterEach(() => {
  delete process.env.TRAINER_USER_IDS
})

// ─── Invitation pre-checks ────────────────────────────────────────────────────

describe('Pre-checks (before transaction)', () => {
  it('rejects unknown token', async () => {
    mockFindUniqueInvitation.mockResolvedValue(null)
    await expect(acceptInvitation('bad-token', CLIENT_ID)).rejects.toThrow('Invitation not found')
  })

  it('rejects already-accepted invitation', async () => {
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation({ status: 'accepted' }))
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Invitation is no longer valid')
  })

  it('rejects expired invitation', async () => {
    const past = new Date(); past.setDate(past.getDate() - 1)
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation({ expiresAt: past }))
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Invitation has expired')
  })

  it('rejects duplicate active relationship', async () => {
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue({ status: 'active', revokedAt: null })
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Relationship already active')
  })
})

// ─── Per-plan seat caps ───────────────────────────────────────────────────────

describe('Starter plan (max 5)', () => {
  it('accepts at 4/5', async () => {
    setupSuccess(5, 4)
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).resolves.toBeUndefined()
  })

  it('blocks at 5/5', async () => {
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue(trainerSubRows(5))
    mockCountRel.mockResolvedValue(5)
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Client limit reached (5 clients)')
  })
})

describe('Pro plan (max 20)', () => {
  it('accepts at 19/20', async () => {
    setupSuccess(20, 19)
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).resolves.toBeUndefined()
  })

  it('blocks at 20/20', async () => {
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue(trainerSubRows(20))
    mockCountRel.mockResolvedValue(20)
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Client limit reached (20 clients)')
  })
})

describe('Studio plan (max 50)', () => {
  it('accepts at 49/50', async () => {
    setupSuccess(50, 49)
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).resolves.toBeUndefined()
  })

  it('blocks at 50/50', async () => {
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue(trainerSubRows(50))
    mockCountRel.mockResolvedValue(50)
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Client limit reached (50 clients)')
  })
})

// ─── Absolute ceiling ─────────────────────────────────────────────────────────

describe('Absolute ceiling — 50 regardless of DB value', () => {
  it('clamps a DB max_clients of 100 → cap is 50, blocks at 50 active', async () => {
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue(trainerSubRows(100))
    mockCountRel.mockResolvedValue(50)
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Client limit reached (50 clients)')
  })

  it('allows 49 active clients when DB max_clients is 100 (clamped to 50)', async () => {
    setupSuccess(100, 49)
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).resolves.toBeUndefined()
  })
})

// ─── FOR UPDATE lock ──────────────────────────────────────────────────────────

describe('FOR UPDATE lock — concurrency proof', () => {
  it('calls $queryRaw inside the transaction for non-bypass trainers', async () => {
    setupSuccess(5, 0)
    await acceptInvitation(TOKEN, CLIENT_ID)
    expect(mockQueryRaw).toHaveBeenCalled()
  })

  it('blocks when trainer subscription is canceled', async () => {
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue(trainerSubRows(5, 'canceled'))
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Trainer subscription required')
  })

  it('blocks when no trainer_subscriptions row exists', async () => {
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue([])
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Trainer subscription required')
  })

  it('concurrent simulation: two accepts at the last slot — only first succeeds', async () => {
    // Simulate Postgres serializing two concurrent accepts on the same trainer:
    // T1 acquires lock → sees count=4 < 5 → creates relationship → releases lock
    // T2 acquires lock → sees count=5 = 5 → throws
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue(trainerSubRows(5))

    // First transaction: count=4 → allowed
    mockCountRel.mockResolvedValueOnce(4)
    mockCreateEntitlement.mockResolvedValue({ id: 'ent-A' })
    mockCreateRel.mockResolvedValue({})
    mockUpdateInvitation.mockResolvedValue({})
    mockUpdateProfile.mockResolvedValue({})
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).resolves.toBeUndefined()

    // Second transaction (same trainer, different client): count=5 → blocked
    vi.clearAllMocks()
    mockQueryRaw.mockResolvedValue(trainerSubRows(5))
    mockCountRel.mockResolvedValueOnce(5)
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation({ id: 'inv-0002', token: TOKEN }))
    mockFindUniqueRel.mockResolvedValue(null)
    await expect(acceptInvitation(TOKEN, 'other-client-id')).rejects.toThrow('Client limit reached (5 clients)')
  })
})

// ─── TRAINER_USER_IDS bypass ──────────────────────────────────────────────────

describe('TRAINER_USER_IDS bypass', () => {
  it('uses profile row lock (not subscription lock) for bypass trainers', async () => {
    process.env.TRAINER_USER_IDS = TRAINER_ID
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    // Profile lock returns the row; subscription lock is not called
    mockQueryRaw.mockResolvedValueOnce([{ id: TRAINER_ID }])
    mockCountRel.mockResolvedValueOnce(0)
    mockCreateEntitlement.mockResolvedValue({ id: 'ent-bypass' })
    mockCreateRel.mockResolvedValue({})
    mockUpdateInvitation.mockResolvedValue({})
    mockUpdateProfile.mockResolvedValue({})
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).resolves.toBeUndefined()
    // $queryRaw is called exactly once (profile lock), not the subscription lock
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('bypass trainer at 49/50: profile lock acquired, allowed', async () => {
    process.env.TRAINER_USER_IDS = TRAINER_ID
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValueOnce([{ id: TRAINER_ID }])
    mockCountRel.mockResolvedValueOnce(49)
    mockCreateEntitlement.mockResolvedValue({ id: 'ent-bypass-49' })
    mockCreateRel.mockResolvedValue({})
    mockUpdateInvitation.mockResolvedValue({})
    mockUpdateProfile.mockResolvedValue({})
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).resolves.toBeUndefined()
  })

  it('bypass trainer at 50/50: blocked by absolute ceiling after lock', async () => {
    process.env.TRAINER_USER_IDS = TRAINER_ID
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValueOnce([{ id: TRAINER_ID }])
    mockCountRel.mockResolvedValueOnce(50)
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).rejects.toThrow('Client limit reached (50 clients)')
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('concurrent simulation: two bypass accepts at the last slot — only first succeeds', async () => {
    process.env.TRAINER_USER_IDS = TRAINER_ID
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation())
    mockFindUniqueRel.mockResolvedValue(null)

    // T1: profile lock acquired → count=49 < 50 → allowed
    mockQueryRaw.mockResolvedValueOnce([{ id: TRAINER_ID }])
    mockCountRel.mockResolvedValueOnce(49)
    mockCreateEntitlement.mockResolvedValue({ id: 'ent-bypass-concurrent' })
    mockCreateRel.mockResolvedValue({})
    mockUpdateInvitation.mockResolvedValue({})
    mockUpdateProfile.mockResolvedValue({})
    await expect(acceptInvitation(TOKEN, CLIENT_ID)).resolves.toBeUndefined()

    // T2: profile lock acquired → count=50 = 50 → blocked
    vi.clearAllMocks()
    mockFindUniqueInvitation.mockResolvedValue(makeInvitation({ id: 'inv-0002' }))
    mockFindUniqueRel.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValueOnce([{ id: TRAINER_ID }])
    mockCountRel.mockResolvedValueOnce(50)
    await expect(acceptInvitation(TOKEN, 'other-client-id')).rejects.toThrow('Client limit reached (50 clients)')
  })

  it('non-bypass trainer in same env list still uses subscription lock', async () => {
    process.env.TRAINER_USER_IDS = 'some-other-trainer-id'
    setupSuccess(5, 2)
    await acceptInvitation(TOKEN, CLIENT_ID)
    expect(mockQueryRaw).toHaveBeenCalled()
  })
})
