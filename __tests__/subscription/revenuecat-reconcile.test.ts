/**
 * RevenueCat reconcile function tests
 *
 * Coverage:
 *   - selectBestBySource: active > expired, tie-break by later expiry,
 *     sandbox filtering, unsupported stores ignored
 *   - reconcileSubscriberFromRC: RC REST API fetch, upsert behavior,
 *     error propagation, concurrent safety
 *
 * Key regression scenarios (RC-documented):
 *   - App Store early renewal: Apple charges up to 24 hours before period end,
 *     so purchased_at_ms (period start) can be AFTER event_timestamp_ms.
 *     The reconcile approach is unaffected by this — it reads current RC state,
 *     never comparing timestamps.
 *   - Late webhook delivery: RC retries for 24 hours; a stale event arriving
 *     much later than it was generated is still reconciled correctly against
 *     current RC state.
 *   - Product switching: active annual overwrites expired monthly via
 *     selectBestBySource priority, regardless of RC response entry order.
 *   - Multiple active products on different stores: each billing source is
 *     upserted independently.
 *   - Failed API reconciliation: rc_error returned, no DB writes, no downgrade.
 *   - Simultaneous reconcile calls: each upsert is idempotent; concurrent
 *     calls for the same user arrive at a consistent final state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock prisma ──────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSubscription: {
      // Default: row already exists and was updated (CAS guard passed).
      // Tests that exercise the create path explicitly override updateMany to { count: 0 }.
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst:  vi.fn().mockResolvedValue(null),
      create:     vi.fn().mockResolvedValue({}),
    },
    profile: { update: vi.fn().mockResolvedValue({}) },
  },
}))

vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn().mockResolvedValue({
    tier: 'plus', status: 'active', isPlus: true, isFree: false,
    isTrial: false, isTrainer: false, isTrainerSponsored: false, isAdminGrant: false,
    trialEndsAt: null, trialDaysRemaining: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
  }),
}))

import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { selectBestBySource, reconcileSubscriberFromRC } from '../../lib/revenuecat/reconcile'
import type { RCSubscriberSubscription } from '../../lib/revenuecat/reconcile'

const mockUpdateMany     = prisma.userSubscription.updateMany as ReturnType<typeof vi.fn>
const mockFindFirst      = prisma.userSubscription.findFirst  as ReturnType<typeof vi.fn>
const mockCreate         = prisma.userSubscription.create     as ReturnType<typeof vi.fn>
const mockProfileUpd     = prisma.profile.update              as ReturnType<typeof vi.fn>
const mockGetEntitlement = getUserEntitlement                 as ReturnType<typeof vi.fn>

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const TXN_MONTHLY = 'txn_monthly_001'
const TXN_ANNUAL  = 'txn_annual_002'

function futureDate(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString()
}

function pastDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

function makeSub(overrides: Partial<RCSubscriberSubscription> = {}): RCSubscriberSubscription {
  return {
    expires_date:              futureDate(30),
    purchase_date:             pastDate(1),
    original_purchase_date:    pastDate(1),
    store:                     'APP_STORE',
    unsubscribe_detected_at:   null,
    billing_issues_detected_at: null,
    auto_resume_date:          null,
    is_sandbox:                false,
    original_transaction_id:   TXN_MONTHLY,
    product_identifier:        'com.involved.plus.monthly',
    ...overrides,
  }
}

function makeOpts(overrides = {}) {
  return {
    userId:        USER_ID,
    rcSecretKey:   'sk_test_secret',
    isProduction:  false,
    acceptSandbox: false,
    ...overrides,
  }
}

function mockRC(subscriptions: Record<string, RCSubscriberSubscription>, statusCode = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok:     statusCode >= 200 && statusCode < 300,
    status: statusCode,
    json:   () => Promise.resolve({ subscriber: { subscriptions } }),
  } as Response)
}

function resetMocks() {
  vi.clearAllMocks()
  mockUpdateMany.mockResolvedValue({ count: 1 })
  mockFindFirst.mockResolvedValue(null)
  mockCreate.mockResolvedValue({})
  mockProfileUpd.mockResolvedValue({})
  mockGetEntitlement.mockResolvedValue({
    tier: 'plus', status: 'active', isPlus: true, isFree: false,
    isTrial: false, isTrainer: false, isTrainerSponsored: false, isAdminGrant: false,
    trialEndsAt: null, trialDaysRemaining: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// selectBestBySource
// ═══════════════════════════════════════════════════════════════════════════════

describe('selectBestBySource', () => {
  it('selects the only entry when there is one subscription', () => {
    const result = selectBestBySource(
      { 'com.involved.plus.monthly': makeSub() },
      { isProduction: false, acceptSandbox: false },
    )
    expect(result.has('apple')).toBe(true)
    expect(result.get('apple')!.productId).toBe('com.involved.plus.monthly')
  })

  it('active subscription wins over expired when both map to APP_STORE', () => {
    const result = selectBestBySource(
      {
        'com.involved.plus.monthly': makeSub({ expires_date: pastDate(5), original_transaction_id: TXN_MONTHLY }),
        'com.involved.plus.annual':  makeSub({ expires_date: futureDate(300), original_transaction_id: TXN_ANNUAL }),
      },
      { isProduction: false, acceptSandbox: false },
    )
    expect(result.get('apple')!.productId).toBe('com.involved.plus.annual')
    expect(result.get('apple')!.isActive).toBe(true)
  })

  it('later expiry wins when both subscriptions are expired', () => {
    const result = selectBestBySource(
      {
        'com.involved.plus.monthly': makeSub({ expires_date: pastDate(10) }),
        'com.involved.plus.annual':  makeSub({ expires_date: pastDate(2) }),
      },
      { isProduction: false, acceptSandbox: false },
    )
    expect(result.get('apple')!.productId).toBe('com.involved.plus.annual')
  })

  it('later expiry wins when both subscriptions are active', () => {
    const result = selectBestBySource(
      {
        'com.involved.plus.monthly': makeSub({ expires_date: futureDate(10) }),
        'com.involved.plus.annual':  makeSub({ expires_date: futureDate(300) }),
      },
      { isProduction: false, acceptSandbox: false },
    )
    expect(result.get('apple')!.productId).toBe('com.involved.plus.annual')
  })

  it('google and apple are selected independently', () => {
    const result = selectBestBySource(
      {
        'com.involved.plus.monthly':  makeSub({ store: 'APP_STORE' }),
        'involved_premium_monthly':   makeSub({ store: 'PLAY_STORE' }),
      },
      { isProduction: false, acceptSandbox: false },
    )
    expect(result.has('apple')).toBe(true)
    expect(result.has('google')).toBe(true)
  })

  it('filters out sandbox entries in production when acceptSandbox is false', () => {
    const result = selectBestBySource(
      { 'com.involved.plus.monthly': makeSub({ is_sandbox: true }) },
      { isProduction: true, acceptSandbox: false },
    )
    expect(result.size).toBe(0)
  })

  it('allows sandbox entries in production when acceptSandbox is true', () => {
    const result = selectBestBySource(
      { 'com.involved.plus.monthly': makeSub({ is_sandbox: true }) },
      { isProduction: true, acceptSandbox: true },
    )
    expect(result.size).toBe(1)
  })

  it('ignores unsupported stores (AMAZON)', () => {
    const result = selectBestBySource(
      { 'com.involved.plus.monthly': makeSub({ store: 'AMAZON' }) },
      { isProduction: false, acceptSandbox: false },
    )
    expect(result.size).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// reconcileSubscriberFromRC — RC API responses
// ═══════════════════════════════════════════════════════════════════════════════

describe('reconcileSubscriberFromRC — RC API responses', () => {
  beforeEach(resetMocks)

  it('returns rc_error with retriable=true on RC 5xx', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
    const result = await reconcileSubscriberFromRC(makeOpts())
    expect(result.status).toBe('rc_error')
    expect(result.retriable).toBe(true)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('returns rc_error with retriable=true on RC 503', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response)
    const result = await reconcileSubscriberFromRC(makeOpts())
    expect(result.status).toBe('rc_error')
    expect(result.retriable).toBe(true)
  })

  it('returns rc_error with retriable=true on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network timeout'))
    const result = await reconcileSubscriberFromRC(makeOpts())
    expect(result.status).toBe('rc_error')
    expect(result.retriable).toBe(true)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('returns no_rc_record on RC 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response)
    const result = await reconcileSubscriberFromRC(makeOpts())
    expect(result.status).toBe('no_rc_record')
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('failed API reconciliation does not write any DB rows or downgrade access', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
    await reconcileSubscriberFromRC(makeOpts())
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockProfileUpd).not.toHaveBeenCalled()
    expect(mockGetEntitlement).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// reconcileSubscriberFromRC — subscription state upserts
// ═══════════════════════════════════════════════════════════════════════════════

describe('reconcileSubscriberFromRC — subscription state upserts', () => {
  beforeEach(resetMocks)

  it('writes active subscription with correct fields', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub() })
    const result = await reconcileSubscriberFromRC(makeOpts())
    expect(result.status).toBe('ok')

    const data = mockUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('active')
    expect(data.tier).toBe('plus')
    expect(data.externalSubscriptionId).toBe(TXN_MONTHLY)
    expect(data.externalPriceId).toBe('com.involved.plus.monthly')
    // Verify the WHERE clause targets the correct user and billing source
    const where = mockUpdateMany.mock.calls[0][0].where
    expect(where.userId).toBe(USER_ID)
    expect(where.billingSource).toBe('apple')
  })

  it('writes expired subscription with status=expired and tier=free', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub({ expires_date: pastDate(5) }) })
    await reconcileSubscriberFromRC(makeOpts())

    const data = mockUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('expired')
    expect(data.tier).toBe('free')
  })

  it('sets cancelAtPeriodEnd=true when unsubscribe_detected_at is set on an active subscription', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub({ unsubscribe_detected_at: pastDate(1) }) })
    await reconcileSubscriberFromRC(makeOpts())

    const data = mockUpdateMany.mock.calls[0][0].data
    expect(data.cancelAtPeriodEnd).toBe(true)
    expect(data.status).toBe('active')
  })

  it('does not set cancelAtPeriodEnd on expired subscription (unsubscribe was for the old period)', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub({ expires_date: pastDate(5), unsubscribe_detected_at: pastDate(1) }) })
    await reconcileSubscriberFromRC(makeOpts())

    const data = mockUpdateMany.mock.calls[0][0].data
    expect(data.cancelAtPeriodEnd).toBe(false)
  })

  it('sets billingIssueDetectedAt when billing_issues_detected_at is set on an active subscription', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub({ billing_issues_detected_at: pastDate(1) }) })
    await reconcileSubscriberFromRC(makeOpts())

    const data = mockUpdateMany.mock.calls[0][0].data
    expect(data.billingIssueDetectedAt).toBeInstanceOf(Date)
  })

  it('sets status=paused when auto_resume_date is present and subscription is not active', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub({
      expires_date:    pastDate(1),
      auto_resume_date: futureDate(14),
    }) })
    await reconcileSubscriberFromRC(makeOpts())

    const data = mockUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('paused')
    expect(data.tier).toBe('plus')
  })

  it('lastEventTimestampMs is captured before the RC fetch (represents reconcile start time)', async () => {
    // fetchedAt is set before the HTTP call. This matters for the CAS guard:
    // a reconcile that started later (higher fetchedAt) correctly wins the race.
    const before = BigInt(Date.now())
    mockRC({ 'com.involved.plus.monthly': makeSub() })
    await reconcileSubscriberFromRC(makeOpts())
    const after = BigInt(Date.now())

    const ts = mockUpdateMany.mock.calls[0][0].data.lastEventTimestampMs as bigint
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('writes both billing sources independently for apple + google subscriptions', async () => {
    mockRC({
      'com.involved.plus.monthly': makeSub({ store: 'APP_STORE' }),
      'involved_premium:monthly':  makeSub({ store: 'PLAY_STORE' }),
    })
    await reconcileSubscriberFromRC(makeOpts())

    const sources = mockUpdateMany.mock.calls.map(
      (c: any[]) => (c[0] as any).where.billingSource,
    )
    expect(sources).toContain('apple')
    expect(sources).toContain('google')
    expect(sources).toHaveLength(2)
  })

  it('calls getUserEntitlement and updates Profile.subscriptionTier after reconcile', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub() })
    mockGetEntitlement.mockResolvedValueOnce({ tier: 'plus', status: 'active', isPlus: true, isFree: false,
      isTrial: false, isTrainer: false, isTrainerSponsored: false, isAdminGrant: false,
      trialEndsAt: null, trialDaysRemaining: null, currentPeriodEnd: null, cancelAtPeriodEnd: false })
    await reconcileSubscriberFromRC(makeOpts())

    expect(mockGetEntitlement).toHaveBeenCalledWith(USER_ID)
    expect(mockProfileUpd).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: USER_ID },
      data:  { subscriptionTier: 'plus' },
    }))
  })

  it('failed profile update (deleted account) does not throw', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub() })
    mockProfileUpd.mockRejectedValueOnce(new Error('profile not found'))
    const result = await reconcileSubscriberFromRC(makeOpts())
    expect(result.status).toBe('ok')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// reconcileSubscriberFromRC — RC-documented timing edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('reconcileSubscriberFromRC — App Store timing and delivery ordering', () => {
  beforeEach(resetMocks)

  it('App Store early renewal: purchase_date after event_timestamp_ms is not a problem', async () => {
    // RC docs: "Apple may charge up to 24 hours before the billing period starts,
    // so purchased_at_ms (billing period start) can be later than event_timestamp_ms."
    //
    // With reconcile: we read current RC state directly — no timestamp comparison.
    // The reconcile always applies whatever RC reports, regardless of timestamp order.
    const earlyRenewalPurchaseDate = futureDate(0)

    mockRC({
      'com.involved.plus.annual': makeSub({
        expires_date:    futureDate(365),
        purchase_date:   earlyRenewalPurchaseDate,
        original_transaction_id: TXN_ANNUAL,
      }),
    })

    await reconcileSubscriberFromRC(makeOpts())

    const data = mockUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('active')
    expect(data.externalSubscriptionId).toBe(TXN_ANNUAL)
  })

  it('late webhook delivery: reconcile reflects CURRENT RC state regardless of event age', async () => {
    // A CANCELLATION webhook delivered 20 hours after generation would have had
    // event_timestamp_ms far in the past. With timestamp-based guards, it might have
    // been blocked if the row's lastEventTimestampMs was newer.
    //
    // With reconcile: we always fetch current RC state. Expired in RC → expired applied.
    mockRC({
      'com.involved.plus.monthly': makeSub({ expires_date: pastDate(1) }),
    })

    await reconcileSubscriberFromRC(makeOpts())

    const data = mockUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('expired')
  })

  it('product switching (monthly → annual): active annual selected regardless of RC entry order', async () => {
    mockRC({
      'com.involved.plus.annual':  makeSub({ expires_date: futureDate(300), original_transaction_id: TXN_ANNUAL }),
      'com.involved.plus.monthly': makeSub({ expires_date: pastDate(5),    original_transaction_id: TXN_MONTHLY }),
    })

    await reconcileSubscriberFromRC(makeOpts())

    const appleCalls = mockUpdateMany.mock.calls.filter(
      (c: any[]) => (c[0] as any).where.billingSource === 'apple',
    )
    expect(appleCalls).toHaveLength(1)
    expect((appleCalls[0][0] as any).data.externalSubscriptionId).toBe(TXN_ANNUAL)
    expect((appleCalls[0][0] as any).data.status).toBe('active')
  })

  it('multiple active products on different stores: both written, neither overwrites the other', async () => {
    mockRC({
      'com.involved.plus.monthly':   makeSub({ store: 'APP_STORE',  expires_date: futureDate(30) }),
      'involved_premium_monthly_v2': makeSub({ store: 'PLAY_STORE', expires_date: futureDate(25) }),
    })

    await reconcileSubscriberFromRC(makeOpts())

    const sources = mockUpdateMany.mock.calls.map(
      (c: any[]) => (c[0] as any).where.billingSource,
    )
    expect(sources).toContain('apple')
    expect(sources).toContain('google')
    expect(sources).toHaveLength(2)
  })

  it('simultaneous reconcile calls produce consistent final state', async () => {
    // Both calls get the same RC response and issue the same CAS-guarded updateMany.
    // The CAS guard (lastEventTimestampMs < fetchedAt) ensures the later-started
    // reconcile wins if they race, and both contain the same RC-authoritative data.
    mockRC({ 'com.involved.plus.monthly': makeSub() })

    await Promise.all([
      reconcileSubscriberFromRC(makeOpts()),
      reconcileSubscriberFromRC(makeOpts()),
    ])

    expect(mockUpdateMany).toHaveBeenCalledTimes(2)
    const data0 = mockUpdateMany.mock.calls[0][0].data
    const data1 = mockUpdateMany.mock.calls[1][0].data
    expect(data0.status).toBe(data1.status)
    expect(data0.externalSubscriptionId).toBe(data1.externalSubscriptionId)
  })

  it('sandbox subscriptions are ignored in production (not written)', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub({ is_sandbox: true }) })
    await reconcileSubscriberFromRC(makeOpts({ isProduction: true, acceptSandbox: false }))
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('sandbox subscriptions are accepted in production when REVENUECAT_ACCEPT_SANDBOX=true', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub({ is_sandbox: true }) })
    await reconcileSubscriberFromRC(makeOpts({ isProduction: true, acceptSandbox: true }))
    expect(mockUpdateMany).toHaveBeenCalled()
  })

  it('no subscriptions in RC response: no writes, still recalculates entitlement', async () => {
    mockRC({})
    const result = await reconcileSubscriberFromRC(makeOpts())
    expect(result.status).toBe('ok')
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockGetEntitlement).toHaveBeenCalledWith(USER_ID)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// reconcileSubscriberFromRC — concurrent reconciliation safety (CAS guard)
// ═══════════════════════════════════════════════════════════════════════════════

describe('reconcileSubscriberFromRC — concurrent reconciliation safety (CAS guard)', () => {
  beforeEach(resetMocks)

  it('CAS guard prevents older fetch from overwriting newer confirmed state', async () => {
    // Scenario: a concurrent reconcile that started LATER (higher fetchedAt)
    // has already written the row. Our reconcile (lower fetchedAt) should NOT
    // overwrite it.
    //
    // updateMany WHERE (lastEventTimestampMs < our fetchedAt) returns 0 because
    // the existing row's lastEventTimestampMs >= our fetchedAt.
    // findFirst finds the row (it exists). We skip — their state is confirmed newer.
    vi.spyOn(Date, 'now').mockReturnValue(100)
    mockRC({ 'com.involved.plus.monthly': makeSub() })
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })
    mockFindFirst.mockResolvedValueOnce({ id: 'existing-row-id' })  // row exists, newer ts

    await reconcileSubscriberFromRC(makeOpts())

    expect(mockCreate).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('create path is used when no row exists yet', async () => {
    // updateMany returns 0 (no row to update), findFirst returns null (no row at all).
    // create is called to insert the new row.
    mockRC({ 'com.involved.plus.monthly': makeSub() })
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })
    mockFindFirst.mockResolvedValueOnce(null)

    await reconcileSubscriberFromRC(makeOpts())

    expect(mockCreate).toHaveBeenCalledOnce()
    const createData = mockCreate.mock.calls[0][0].data
    expect(createData.userId).toBe(USER_ID)
    expect(createData.billingSource).toBe('apple')
    expect(createData.status).toBe('active')
  })

  it('concurrent create (P2002 unique violation) is swallowed gracefully', async () => {
    // Both reconciles try to create simultaneously. One fails with P2002.
    // This must not propagate — the other process's row is valid.
    mockRC({ 'com.involved.plus.monthly': makeSub() })
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })
    mockFindFirst.mockResolvedValueOnce(null)
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    mockCreate.mockRejectedValueOnce(p2002)

    await expect(reconcileSubscriberFromRC(makeOpts())).resolves.toMatchObject({ status: 'ok' })
  })

  it('non-P2002 create errors are re-thrown', async () => {
    mockRC({ 'com.involved.plus.monthly': makeSub() })
    mockUpdateMany.mockResolvedValueOnce({ count: 0 })
    mockFindFirst.mockResolvedValueOnce(null)
    mockCreate.mockRejectedValueOnce(new Error('connection lost'))

    await expect(reconcileSubscriberFromRC(makeOpts())).rejects.toThrow('connection lost')
  })

  it('CAS WHERE clause includes null check and lt condition', async () => {
    // The updateMany where clause must handle both null (new rows with no previous
    // timestamp) and older timestamps. Verify the OR structure.
    mockRC({ 'com.involved.plus.monthly': makeSub() })
    await reconcileSubscriberFromRC(makeOpts())

    const where = mockUpdateMany.mock.calls[0][0].where
    expect(where.OR).toBeDefined()
    expect(where.OR).toHaveLength(2)
    expect(where.OR[0]).toEqual({ lastEventTimestampMs: null })
    expect(where.OR[1].lastEventTimestampMs.lt).toBeTypeOf('bigint')
  })
})
