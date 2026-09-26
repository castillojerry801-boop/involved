/**
 * Admin grant entitlement tests
 *
 * Tests the admin_grant resolution path in getUserEntitlement().
 * Mocks prisma so no real DB connection is needed.
 *
 * Scenarios:
 *   1 — User with no grants/subs → free tier (isAdminGrant false)
 *   2 — Active permanent admin grant → plus tier, isAdminGrant true
 *   3 — Active admin grant with future expiry → plus tier, isAdminGrant true
 *   4 — Admin grant with past expiry (DB filtered) → free tier
 *   5 — Revoked admin grant (DB filtered) → free tier
 *   6 — trainer_sponsored outranks admin_grant
 *   7 — isAdmin() env var present/absent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock prisma — factory cannot reference hoisted vars ─────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSubscription: { findUnique: vi.fn() },
    trainerSubscription: { findUnique: vi.fn() },
    userEntitlement: { findMany: vi.fn() },
    profile: { update: vi.fn() },
  },
}))

// Import after mock declaration
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '../../lib/subscription/entitlements'
import { isAdmin } from '../../lib/admin/auth'

// ─── Typed mock refs ─────────────────────────────────────────────────────────
const mockFindUniqueSub = prisma.userSubscription.findUnique as ReturnType<typeof vi.fn>
const mockFindUniqueTrainer = prisma.trainerSubscription.findUnique as ReturnType<typeof vi.fn>
const mockFindManyEntitlements = prisma.userEntitlement.findMany as ReturnType<typeof vi.fn>

// ─── Constants ───────────────────────────────────────────────────────────────
const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const GRANT_ID = 'bbbbbbbb-0000-0000-0000-000000000002'

function futureDate(daysFromNow: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d
}

function makeAdminGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    userId: USER_ID,
    source: 'admin_grant',
    status: 'active',
    sourceRef: 'granted_by:admin|reason:beta tester',
    grantedAt: new Date(),
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  }
}

function resetMocks() {
  mockFindUniqueSub.mockResolvedValue(null)
  mockFindUniqueTrainer.mockResolvedValue(null)
  mockFindManyEntitlements.mockResolvedValue([])
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Scenario 1 — Free user with no grants or subscriptions', () => {
  beforeEach(() => { vi.unstubAllEnvs(); resetMocks() })

  it('returns free tier', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('free')
    expect(e.isPlus).toBe(false)
    expect(e.isFree).toBe(true)
    expect(e.isAdminGrant).toBe(false)
  })
})

describe('Scenario 2 — Active permanent admin grant', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    resetMocks()
    mockFindManyEntitlements.mockImplementation(
      ({ where }: { where: { source: string } }) =>
        where.source === 'admin_grant'
          ? Promise.resolve([makeAdminGrant()])
          : Promise.resolve([])
    )
  })

  it('returns plus tier', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
    expect(e.isFree).toBe(false)
  })

  it('sets isAdminGrant to true', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.isAdminGrant).toBe(true)
  })

  it('isTrainerSponsored is false', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.isTrainerSponsored).toBe(false)
  })

  it('isTrainer is false', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.isTrainer).toBe(false)
  })
})

describe('Scenario 3 — Active admin grant with future expiry', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    resetMocks()
    mockFindManyEntitlements.mockImplementation(
      ({ where }: { where: { source: string } }) =>
        where.source === 'admin_grant'
          ? Promise.resolve([makeAdminGrant({ expiresAt: futureDate(30) })])
          : Promise.resolve([])
    )
  })

  it('returns plus tier when grant has not expired', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isAdminGrant).toBe(true)
  })
})

describe('Scenario 4 — Admin grant with past expiry (filtered by DB query)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    // The DB WHERE clause filters expiresAt < now, so findMany returns empty
    resetMocks()
  })

  it('returns free tier when all grants are expired', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('free')
    expect(e.isAdminGrant).toBe(false)
  })
})

describe('Scenario 5 — Revoked admin grant (filtered by status: active)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    // Revoked grants excluded by status: 'active' filter in DB query
    resetMocks()
  })

  it('returns free tier when grant is revoked', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('free')
    expect(e.isAdminGrant).toBe(false)
  })
})

describe('Scenario 6 — trainer_sponsored outranks admin_grant', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    resetMocks()
    mockFindManyEntitlements.mockImplementation(
      ({ where }: { where: { source: string } }) => {
        if (where.source === 'trainer_sponsored') {
          return Promise.resolve([{
            id: 'cccccccc-0000-0000-0000-000000000003',
            userId: USER_ID,
            source: 'trainer_sponsored',
            status: 'active',
            sourceRef: 'trainer:trainer-001',
            grantedAt: new Date(),
            expiresAt: null,
            revokedAt: null,
          }])
        }
        if (where.source === 'admin_grant') {
          return Promise.resolve([makeAdminGrant()])
        }
        return Promise.resolve([])
      }
    )
  })

  it('returns plus tier', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
  })

  it('isTrainerSponsored is true (resolved before admin_grant)', async () => {
    const e = await getUserEntitlement(USER_ID)
    expect(e.isTrainerSponsored).toBe(true)
    expect(e.isAdminGrant).toBe(false)
  })
})

// ─── Scenario 7 — isAdmin() env var ──────────────────────────────────────────

describe('Scenario 7 — isAdmin() env var checks', () => {
  const ADMIN_ID = 'dddddddd-0000-0000-0000-000000000004'

  afterEach(() => { vi.unstubAllEnvs() })

  it('returns true when userId is in ADMIN_USER_IDS', () => {
    vi.stubEnv('ADMIN_USER_IDS', ADMIN_ID)
    expect(isAdmin(ADMIN_ID)).toBe(true)
  })

  it('returns false when userId is not in ADMIN_USER_IDS', () => {
    vi.stubEnv('ADMIN_USER_IDS', ADMIN_ID)
    expect(isAdmin(USER_ID)).toBe(false)
  })

  it('returns false when ADMIN_USER_IDS is not set', () => {
    expect(isAdmin(ADMIN_ID)).toBe(false)
  })

  it('supports comma-separated multiple admins', () => {
    vi.stubEnv('ADMIN_USER_IDS', `${ADMIN_ID},${USER_ID}`)
    expect(isAdmin(ADMIN_ID)).toBe(true)
    expect(isAdmin(USER_ID)).toBe(true)
  })

  it('trims whitespace around IDs', () => {
    vi.stubEnv('ADMIN_USER_IDS', `  ${ADMIN_ID}  ,  ${USER_ID}  `)
    expect(isAdmin(ADMIN_ID)).toBe(true)
  })
})
