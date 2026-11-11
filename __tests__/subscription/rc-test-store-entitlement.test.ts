/**
 * RC Test Store entitlement regression tests
 *
 * Verifies that getUserEntitlement() correctly gates rc_test billing source
 * rows behind REVENUECAT_ACCEPT_TEST_STORE=true AND VERCEL_ENV !== 'production'.
 *
 * Scenarios:
 *   1 — rc_test row, flag enabled, preview env  → Plus tier (test store works)
 *   2 — rc_test row, flag enabled, production   → Free tier (env guard blocks it)
 *   3 — rc_test row, flag disabled              → Free tier
 *   4 — rc_test row, flag absent (undefined)    → Free tier
 *   5 — apple row unaffected by rc_test flag    → Plus regardless of flag
 *   6 — google row unaffected                   → Plus regardless of flag
 *   7 — stripe row unaffected                   → Plus regardless of flag
 *   8 — manual row (trial) unaffected           → Trial regardless of flag
 *   9 — rc_test + apple coexist, flag off       → apple still grants Plus
 *  10 — rc_test + apple coexist, flag on        → apple still grants Plus (no duplicate)
 *  11 — rc_test, flag on, local (no VERCEL_ENV) → Plus (local dev permitted)
 *  12 — rc_test canceled, flag on, preview      → Free (status check respected)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSubscription:          { findMany: vi.fn(), updateMany: vi.fn() },
    trainerSubscription:       { findUnique: vi.fn(), findMany: vi.fn() },
    userEntitlement:           { findMany: vi.fn() },
    trainerClientRelationship: { findMany: vi.fn() },
    profile:                   { update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '../../lib/subscription/entitlements'

const mockFindManySubs         = prisma.userSubscription.findMany            as ReturnType<typeof vi.fn>
const mockFindUniqueTrainer    = prisma.trainerSubscription.findUnique       as ReturnType<typeof vi.fn>
const mockFindManyTrainerSubs  = prisma.trainerSubscription.findMany         as ReturnType<typeof vi.fn>
const mockFindManyEntitlements = prisma.userEntitlement.findMany             as ReturnType<typeof vi.fn>
const mockFindManyRels         = prisma.trainerClientRelationship.findMany   as ReturnType<typeof vi.fn>

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000099'

function resetMocks() {
  mockFindManySubs.mockResolvedValue([])
  mockFindUniqueTrainer.mockResolvedValue(null)
  mockFindManyTrainerSubs.mockResolvedValue([])
  mockFindManyRels.mockResolvedValue([])
  mockFindManyEntitlements.mockResolvedValue([])
}

function makeSub(overrides: Record<string, unknown> = {}) {
  return {
    id:                     'sub-00000000-0000-0000-0000-000000000001',
    userId:                 USER_ID,
    billingSource:          'rc_test',
    tier:                   'plus',
    status:                 'active',
    externalSubscriptionId: 'txn_test_001',
    cancelAtPeriodEnd:      false,
    currentPeriodEnd:       new Date(Date.now() + 30 * 86_400_000),
    trialEndsAt:            null,
    createdAt:              new Date(),
    updatedAt:              new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  resetMocks()
})

describe('Scenario 1 — rc_test, flag enabled, VERCEL_ENV=preview → Plus', () => {
  it('grants plus tier', async () => {
    vi.stubEnv('REVENUECAT_ACCEPT_TEST_STORE', 'true')
    vi.stubEnv('VERCEL_ENV', 'preview')
    mockFindManySubs.mockResolvedValue([makeSub()])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
    expect(e.isFree).toBe(false)
  })
})

describe('Scenario 2 — rc_test, flag enabled, VERCEL_ENV=production → Free (env guard)', () => {
  it('blocks rc_test in production even when flag is set', async () => {
    vi.stubEnv('REVENUECAT_ACCEPT_TEST_STORE', 'true')
    vi.stubEnv('VERCEL_ENV', 'production')
    mockFindManySubs.mockResolvedValue([makeSub()])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('free')
    expect(e.isPlus).toBe(false)
    expect(e.isFree).toBe(true)
  })
})

describe('Scenario 3 — rc_test, flag explicitly false → Free', () => {
  it('blocks rc_test when flag is false', async () => {
    vi.stubEnv('REVENUECAT_ACCEPT_TEST_STORE', 'false')
    vi.stubEnv('VERCEL_ENV', 'preview')
    mockFindManySubs.mockResolvedValue([makeSub()])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('free')
    expect(e.isPlus).toBe(false)
  })
})

describe('Scenario 4 — rc_test, flag absent (undefined) → Free', () => {
  it('blocks rc_test when flag is not set', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    mockFindManySubs.mockResolvedValue([makeSub()])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('free')
    expect(e.isPlus).toBe(false)
  })
})

describe('Scenario 5 — apple billing source unaffected by rc_test flag', () => {
  it('grants plus via apple regardless of REVENUECAT_ACCEPT_TEST_STORE', async () => {
    // flag OFF — rc_test would be blocked but apple must still work
    mockFindManySubs.mockResolvedValue([makeSub({ billingSource: 'apple' })])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
  })
})

describe('Scenario 6 — google billing source unaffected by rc_test flag', () => {
  it('grants plus via google regardless of REVENUECAT_ACCEPT_TEST_STORE', async () => {
    mockFindManySubs.mockResolvedValue([makeSub({ billingSource: 'google' })])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
  })
})

describe('Scenario 7 — stripe billing source unaffected by rc_test flag', () => {
  it('grants plus via stripe regardless of REVENUECAT_ACCEPT_TEST_STORE', async () => {
    mockFindManySubs.mockResolvedValue([makeSub({ billingSource: 'stripe' })])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
  })
})

describe('Scenario 8 — manual trial unaffected by rc_test flag', () => {
  it('returns trial tier from manual source regardless of flag', async () => {
    const trialEndsAt = new Date(Date.now() + 7 * 86_400_000)
    mockFindManySubs.mockResolvedValue([
      makeSub({ billingSource: 'manual', tier: 'trial', status: 'trialing', trialEndsAt }),
    ])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('trial')
    expect(e.isTrial).toBe(true)
    expect(e.isPlus).toBe(false)
  })
})

describe('Scenario 9 — rc_test + apple coexist, flag OFF → apple grants Plus', () => {
  it('apple row not suppressed when rc_test is filtered', async () => {
    mockFindManySubs.mockResolvedValue([
      makeSub({ billingSource: 'rc_test' }),
      makeSub({ id: 'sub-apple', billingSource: 'apple' }),
    ])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
  })
})

describe('Scenario 10 — rc_test + apple coexist, flag ON → apple still grants Plus', () => {
  it('apple is not overwritten by rc_test when both present', async () => {
    vi.stubEnv('REVENUECAT_ACCEPT_TEST_STORE', 'true')
    vi.stubEnv('VERCEL_ENV', 'preview')
    mockFindManySubs.mockResolvedValue([
      makeSub({ billingSource: 'rc_test' }),
      makeSub({ id: 'sub-apple', billingSource: 'apple' }),
    ])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
  })
})

describe('Scenario 11 — rc_test, flag ON, no VERCEL_ENV (local dev) → Plus', () => {
  it('allows rc_test in local development where VERCEL_ENV is not set', async () => {
    vi.stubEnv('REVENUECAT_ACCEPT_TEST_STORE', 'true')
    // VERCEL_ENV intentionally not set — local dev
    mockFindManySubs.mockResolvedValue([makeSub()])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('plus')
    expect(e.isPlus).toBe(true)
  })
})

describe('Scenario 12 — rc_test canceled, flag ON, preview → Free', () => {
  it('respects status check even when test store is enabled', async () => {
    vi.stubEnv('REVENUECAT_ACCEPT_TEST_STORE', 'true')
    vi.stubEnv('VERCEL_ENV', 'preview')
    mockFindManySubs.mockResolvedValue([makeSub({ status: 'canceled' })])
    const e = await getUserEntitlement(USER_ID)
    expect(e.tier).toBe('free')
    expect(e.isPlus).toBe(false)
  })
})
