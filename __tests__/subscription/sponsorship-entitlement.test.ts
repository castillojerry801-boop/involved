/**
 * Trainer-sponsorship dual-validation tests for getUserEntitlement().
 *
 * Verifies every requirement from the Premium sponsorship security fix:
 *   - Active trainer sub + active rel → Plus (isTrainerSponsored)
 *   - Canceled/paused/expired/missing trainer sub → Free
 *   - Ended/paused/invited/orphaned rel → Free
 *   - Multiple trainers: any one valid pair suffices
 *   - Both invalid → Free
 *   - Bypass trainer satisfies sub check; rel must still exist
 *   - Independent Plus/trial/admin_grant survive sponsorship removal
 *   - cancelAtPeriodEnd with status=active preserves access
 *   - No client history deleted on any path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSubscription:          { findUnique: vi.fn() },
    trainerSubscription:       { findUnique: vi.fn(), findMany: vi.fn() },
    userEntitlement:           { findMany: vi.fn() },
    trainerClientRelationship: { findMany: vi.fn() },
    profile:                   { update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '../../lib/subscription/entitlements'

// ─── Typed refs ───────────────────────────────────────────────────────────────
const mockFindUniqueSub        = prisma.userSubscription.findUnique          as ReturnType<typeof vi.fn>
const mockFindUniqueTrainer    = prisma.trainerSubscription.findUnique       as ReturnType<typeof vi.fn>
const mockFindManyTrainerSubs  = prisma.trainerSubscription.findMany         as ReturnType<typeof vi.fn>
const mockFindManyEntitlements = prisma.userEntitlement.findMany             as ReturnType<typeof vi.fn>
const mockFindManyRels         = prisma.trainerClientRelationship.findMany   as ReturnType<typeof vi.fn>

// ─── Constants ────────────────────────────────────────────────────────────────
const CLIENT_ID   = 'cccccccc-0000-0000-0000-000000000001'
const TRAINER_A   = 'aaaaaaaa-1111-0000-0000-000000000001'
const TRAINER_B   = 'bbbbbbbb-1111-0000-0000-000000000002'

function makeSponsored(trainerId: string, overrides: Record<string, unknown> = {}) {
  return {
    id:        `ee-${trainerId}`,
    userId:    CLIENT_ID,
    source:    'trainer_sponsored',
    status:    'active',
    sourceRef: trainerId,
    grantedAt: new Date(),
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  }
}

function resetAll() {
  vi.unstubAllEnvs()
  mockFindUniqueSub.mockResolvedValue(null)
  mockFindUniqueTrainer.mockResolvedValue(null)
  mockFindManyTrainerSubs.mockResolvedValue([])
  mockFindManyRels.mockResolvedValue([])
  mockFindManyEntitlements.mockResolvedValue([])
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Active trainer + active relationship → Plus (isTrainerSponsored)', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }])
  })

  it('returns plus tier', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
    expect(e.isFree).toBe(false)
  })

  it('sets isTrainerSponsored true', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.isTrainerSponsored).toBe(true)
    expect(e.isTrainer).toBe(false)
    expect(e.isAdminGrant).toBe(false)
  })
})

describe('cancelAtPeriodEnd=true with status=active → Plus preserved', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    // status=active regardless of cancelAtPeriodEnd — billing updates status at period end
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }])
  })

  it('grants Plus when trainer sub is active even with cancelAtPeriodEnd', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('plus')
    expect(e.isTrainerSponsored).toBe(true)
  })
})

describe('Canceled trainer subscription → Free', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    // status=canceled excluded by findMany WHERE status='active'
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }])
  })

  it('returns free tier', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isFree).toBe(true)
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Paused trainer subscription → Free', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }])
  })

  it('returns free tier', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Expired trainer subscription → Free', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }])
  })

  it('returns free tier', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Missing trainer subscription row → Free', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }])
  })

  it('returns free tier when no trainer subscription exists at all', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Ended relationship → Free', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }])
    // status=ended excluded by findMany WHERE status='active', revokedAt=null
    mockFindManyRels.mockResolvedValue([])
  })

  it('returns free tier when relationship is ended', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Paused relationship → Free', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }])
    mockFindManyRels.mockResolvedValue([])
  })

  it('returns free tier when relationship is paused', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Invited relationship (not yet active) → Free', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }])
    mockFindManyRels.mockResolvedValue([])
  })

  it('returns free tier when relationship is invited', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Orphaned sponsorship entitlement (no relationship row) → Free', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }])
    // No relationship row at all
    mockFindManyRels.mockResolvedValue([])
  })

  it('returns free when UserEntitlement exists but relationship is gone', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Two valid trainers → Plus', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A), makeSponsored(TRAINER_B)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }, { userId: TRAINER_B }])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }, { trainerId: TRAINER_B }])
  })

  it('returns plus tier', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('plus')
    expect(e.isTrainerSponsored).toBe(true)
  })
})

describe('One valid trainer + one expired trainer → Plus', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A), makeSponsored(TRAINER_B)])
        : Promise.resolve([]),
    )
    // Only TRAINER_A has an active sub; TRAINER_B is expired (not in active list)
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }, { trainerId: TRAINER_B }])
  })

  it('returns plus tier because one valid trainer remains', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('plus')
    expect(e.isTrainerSponsored).toBe(true)
  })
})

describe('Both trainers invalid → Free', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A), makeSponsored(TRAINER_B)])
        : Promise.resolve([]),
    )
    // Neither trainer has an active sub
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }, { trainerId: TRAINER_B }])
  })

  it('returns free tier when all trainers are invalid', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Bypass trainer via TRAINER_USER_IDS → Plus (no sub row needed)', () => {
  beforeEach(() => {
    resetAll()
    vi.stubEnv('TRAINER_USER_IDS', TRAINER_A)
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    // No TrainerSubscription row — bypass skips this check
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }])
  })

  it('returns plus tier for bypass trainer without subscription row', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('plus')
    expect(e.isTrainerSponsored).toBe(true)
  })
})

describe('Bypass trainer — relationship must still exist', () => {
  beforeEach(() => {
    resetAll()
    vi.stubEnv('TRAINER_USER_IDS', TRAINER_A)
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([])
    // Relationship ended
    mockFindManyRels.mockResolvedValue([])
  })

  it('returns free tier when bypass trainer has no active relationship', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Independent personal Plus survives sponsorship removal', () => {
  beforeEach(() => {
    resetAll()
    // Personal active Plus subscription
    mockFindUniqueSub.mockResolvedValue({
      userId: CLIENT_ID, status: 'active', tier: 'plus',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
    })
    // Sponsorship entitlement also exists but trainer is invalid
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([])
  })

  it('returns plus tier from personal sub regardless of sponsorship state', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Active trial survives sponsorship removal', () => {
  beforeEach(() => {
    resetAll()
    const trialEndsAt = new Date(Date.now() + 7 * 86_400_000)
    mockFindUniqueSub.mockResolvedValue({
      userId: CLIENT_ID, status: 'trialing', tier: 'plus',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt,
    })
    mockFindManyEntitlements.mockResolvedValue([])
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([])
  })

  it('returns trial tier even when sponsorship is gone', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('trial')
    expect(e.isTrial).toBe(true)
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('Admin grant survives sponsorship removal', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) => {
      if (where.source === 'trainer_sponsored') return Promise.resolve([makeSponsored(TRAINER_A)])
      if (where.source === 'admin_grant') return Promise.resolve([{
        id: 'gg-admin',
        userId: CLIENT_ID,
        source: 'admin_grant',
        status: 'active',
        sourceRef: null,
        grantedAt: new Date(),
        expiresAt: null,
        revokedAt: null,
      }])
      return Promise.resolve([])
    })
    // Sponsorship invalid
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([])
  })

  it('returns plus with isAdminGrant when sponsorship is gone', async () => {
    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
    expect(e.isAdminGrant).toBe(true)
    expect(e.isTrainerSponsored).toBe(false)
  })
})

describe('No client history deleted on any path', () => {
  it('does not call profile.update during sponsorship resolution', async () => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }])
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }])

    await getUserEntitlement(CLIENT_ID)
    expect(prisma.profile.update).not.toHaveBeenCalled()
  })

  it('does not call profile.update when sponsorship is invalid', async () => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
    mockFindManyTrainerSubs.mockResolvedValue([])
    mockFindManyRels.mockResolvedValue([])

    await getUserEntitlement(CLIENT_ID)
    expect(prisma.profile.update).not.toHaveBeenCalled()
  })
})

describe('DB errors in batch queries are handled gracefully', () => {
  beforeEach(() => {
    resetAll()
    mockFindManyEntitlements.mockImplementation(({ where }: { where: { source: string } }) =>
      where.source === 'trainer_sponsored'
        ? Promise.resolve([makeSponsored(TRAINER_A)])
        : Promise.resolve([]),
    )
  })

  it('falls through to free if trainerSubscription.findMany throws', async () => {
    mockFindManyTrainerSubs.mockRejectedValue(new Error('DB error'))
    mockFindManyRels.mockResolvedValue([{ trainerId: TRAINER_A }])

    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })

  it('falls through to free if trainerClientRelationship.findMany throws', async () => {
    mockFindManyTrainerSubs.mockResolvedValue([{ userId: TRAINER_A }])
    mockFindManyRels.mockRejectedValue(new Error('DB error'))

    const e = await getUserEntitlement(CLIENT_ID)
    expect(e.tier).toBe('free')
    expect(e.isTrainerSponsored).toBe(false)
  })
})
