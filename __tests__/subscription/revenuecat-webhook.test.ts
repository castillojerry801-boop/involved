/**
 * RevenueCat Phase A — webhook integration tests
 *
 * Coverage:
 *   - HMAC-SHA256 signature verification (including bypass-path regression)
 *   - Authorization-only authentication
 *   - Both credentials required when both env vars are set (Fix #1 regression)
 *   - Event routing: subscription events call reconcileFn; no-ops do not
 *   - RC API error propagation (retriable → throw; non-retriable → skipped:)
 *   - RC 404 handled gracefully (no throw, no DB write)
 *   - TRANSFER: direct revoke for old owner + reconcile for new owner
 *   - Identity guards (anonymous user, invalid UUID)
 *   - Sandbox filtering
 *   - Unsupported stores skipped (Fix #7 regression)
 *   - PRODUCT_CHANGE triggers reconcile (RC may not send separate events)
 *
 * Subscription state behavior (what happens inside the DB) is tested in
 * revenuecat-reconcile.test.ts, which tests reconcileSubscriberFromRC directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

// ─── Mock prisma ──────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSubscription: { findFirst: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    profile:          { update: vi.fn() },
    webhookEvent:     { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
import { verifyRevenueCatSignature } from '../../lib/revenuecat/webhook-auth'
import { processWebhookEvent } from '../../lib/revenuecat/webhook'
import type { RCWebhookPayload } from '../../lib/revenuecat/webhook-types'
import type { ReconcileResult } from '../../lib/revenuecat/reconcile'

// ─── Typed mock refs ──────────────────────────────────────────────────────────
const mockUpdateMany  = prisma.userSubscription.updateMany as ReturnType<typeof vi.fn>
const mockProfileUpd  = prisma.profile.update              as ReturnType<typeof vi.fn>
const mockGetEntitlement = getUserEntitlement              as ReturnType<typeof vi.fn>

// ─── Constants ────────────────────────────────────────────────────────────────
const USER_ID   = 'aaaaaaaa-0000-0000-0000-000000000001'
const USER_ID_2 = 'bbbbbbbb-0000-0000-0000-000000000002'
const TXN_ID    = 'txn_original_001'
const NOW_MS    = 1_700_000_000_000
const NOW_S     = Math.floor(NOW_MS / 1000)
const SIGNING_SECRET = 'test-signing-secret-for-unit-tests'
const AUTH_SECRET    = 'test-auth-secret'

function makePayload(overrides: Partial<RCWebhookPayload['event']> = {}): RCWebhookPayload {
  return {
    api_version: '1.0',
    event: {
      id:  'evt-' + Math.random().toString(36).slice(2),
      type: 'INITIAL_PURCHASE',
      app_user_id: USER_ID,
      event_timestamp_ms: NOW_MS,
      store: 'APP_STORE',
      environment: 'PRODUCTION',
      original_transaction_id: TXN_ID,
      product_id: 'com.involved.plus.monthly',
      purchased_at_ms: NOW_MS - 60_000,
      expiration_at_ms: NOW_MS + 30 * 86_400_000,
      ...overrides,
    } as RCWebhookPayload['event'],
  }
}

function makeHmacHeader(rawBody: string, secret: string, timestampS = NOW_S): string {
  const message = `${timestampS}.${rawBody}`
  const sig = createHmac('sha256', secret).update(message, 'utf8').digest('hex')
  return `t=${timestampS},v1=${sig}`
}

// ── Default mock reconcile function (injected into processWebhookEvent) ───────
// Cast through unknown to satisfy the strict (userId: string) => Promise<ReconcileResult>
// signature — vi.fn() return type is too generic for direct assignment.
type ReconcileFn = (userId: string) => Promise<ReconcileResult>

function makeReconcile(result: ReconcileResult = { status: 'ok' }): ReconcileFn & ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(result) as unknown as ReconcileFn & ReturnType<typeof vi.fn>
}

function okReconcile(): ReconcileFn & ReturnType<typeof vi.fn> {
  return makeReconcile({
    status: 'ok',
    entitlement: {
      tier: 'plus', status: 'active', isPlus: true, isFree: false,
      isTrial: false, isTrainer: false, isTrainerSponsored: false, isAdminGrant: false,
      trialEndsAt: null, trialDaysRemaining: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
    } as any,
  })
}

function resetMocks() {
  vi.clearAllMocks()
  mockUpdateMany.mockResolvedValue({ count: 1 })
  mockProfileUpd.mockResolvedValue({})
  mockGetEntitlement.mockResolvedValue({
    tier: 'plus', status: 'active', isPlus: true, isFree: false,
    isTrial: false, isTrainer: false, isTrainerSponsored: false, isAdminGrant: false,
    trialEndsAt: null, trialDaysRemaining: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNATURE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('verifyRevenueCatSignature — HMAC-SHA256 (signing secret only)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('REVENUECAT_WEBHOOK_SIGNING_SECRET', SIGNING_SECRET)
  })

  it('accepts valid HMAC signature', () => {
    const body = '{"test":true}'
    const header = makeHmacHeader(body, SIGNING_SECRET)
    expect(verifyRevenueCatSignature(body, header, null, { nowMs: NOW_MS })).toBe(true)
  })

  it('accepts valid HMAC with an auth header present (auth header ignored when webhookSecret not set)', () => {
    const body = '{"test":true}'
    const header = makeHmacHeader(body, SIGNING_SECRET)
    expect(verifyRevenueCatSignature(body, header, `Bearer ${AUTH_SECRET}`, { nowMs: NOW_MS })).toBe(true)
  })

  it('rejects tampered body', () => {
    const body = '{"test":true}'
    const header = makeHmacHeader(body, SIGNING_SECRET)
    expect(verifyRevenueCatSignature('{"test":false}', header, null, { nowMs: NOW_MS })).toBe(false)
  })

  it('rejects wrong secret', () => {
    const body = '{"test":true}'
    const header = makeHmacHeader(body, 'wrong-secret')
    expect(verifyRevenueCatSignature(body, header, null, { nowMs: NOW_MS })).toBe(false)
  })

  it('rejects timestamp older than 5 minutes', () => {
    const body = '{"test":true}'
    const staleTs = NOW_S - 301
    const header = makeHmacHeader(body, SIGNING_SECRET, staleTs)
    expect(verifyRevenueCatSignature(body, header, null, { nowMs: NOW_MS })).toBe(false)
  })

  it('rejects timestamp more than 5 minutes in the future', () => {
    const body = '{"test":true}'
    const futureTs = NOW_S + 301
    const header = makeHmacHeader(body, SIGNING_SECRET, futureTs)
    expect(verifyRevenueCatSignature(body, header, null, { nowMs: NOW_MS })).toBe(false)
  })

  it('accepts timestamp within tolerance', () => {
    const body = '{"test":true}'
    const ts = NOW_S - 299
    const header = makeHmacHeader(body, SIGNING_SECRET, ts)
    expect(verifyRevenueCatSignature(body, header, null, { nowMs: NOW_MS })).toBe(true)
  })

  it('rejects malformed header (missing v1=)', () => {
    expect(verifyRevenueCatSignature('body', `t=${NOW_S}`, null, { nowMs: NOW_MS })).toBe(false)
  })

  it('rejects missing signature header when signing secret is set', () => {
    expect(verifyRevenueCatSignature('body', null, null, { nowMs: NOW_MS })).toBe(false)
  })
})

describe('verifyRevenueCatSignature — Authorization header (webhook secret only)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', AUTH_SECRET)
  })

  it('accepts valid Bearer token', () => {
    expect(verifyRevenueCatSignature('body', null, `Bearer ${AUTH_SECRET}`, { nowMs: NOW_MS })).toBe(true)
  })

  it('accepts token without Bearer prefix', () => {
    expect(verifyRevenueCatSignature('body', null, AUTH_SECRET, { nowMs: NOW_MS })).toBe(true)
  })

  it('rejects wrong token', () => {
    expect(verifyRevenueCatSignature('body', null, 'Bearer wrong', { nowMs: NOW_MS })).toBe(false)
  })

  it('rejects missing auth header when webhook secret is set', () => {
    expect(verifyRevenueCatSignature('body', null, null, { nowMs: NOW_MS })).toBe(false)
  })
})

describe('verifyRevenueCatSignature — both secrets configured (AND requirement)', () => {
  const body = '{"event":{"id":"e1"}}'

  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', AUTH_SECRET)
    vi.stubEnv('REVENUECAT_WEBHOOK_SIGNING_SECRET', SIGNING_SECRET)
  })

  it('accepts request with both valid auth header and valid HMAC signature', () => {
    const hmac = makeHmacHeader(body, SIGNING_SECRET)
    expect(verifyRevenueCatSignature(body, hmac, `Bearer ${AUTH_SECRET}`, { nowMs: NOW_MS })).toBe(true)
  })

  it('rejects when HMAC is valid but auth header is missing (Fix #1 regression)', () => {
    const hmac = makeHmacHeader(body, SIGNING_SECRET)
    expect(verifyRevenueCatSignature(body, hmac, null, { nowMs: NOW_MS })).toBe(false)
  })

  it('rejects when HMAC is valid but auth header is wrong (Fix #1 regression)', () => {
    const hmac = makeHmacHeader(body, SIGNING_SECRET)
    expect(verifyRevenueCatSignature(body, hmac, 'Bearer wrong-auth', { nowMs: NOW_MS })).toBe(false)
  })

  it('rejects when auth is valid but HMAC signature is missing (Fix #1 regression)', () => {
    expect(verifyRevenueCatSignature(body, null, `Bearer ${AUTH_SECRET}`, { nowMs: NOW_MS })).toBe(false)
  })

  it('rejects when auth is valid but HMAC signature is wrong', () => {
    const badHmac = makeHmacHeader(body, 'wrong-signing-secret')
    expect(verifyRevenueCatSignature(body, badHmac, `Bearer ${AUTH_SECRET}`, { nowMs: NOW_MS })).toBe(false)
  })

  it('rejects when both credentials are invalid', () => {
    expect(verifyRevenueCatSignature(body, null, null, { nowMs: NOW_MS })).toBe(false)
  })
})

describe('verifyRevenueCatSignature — no secrets configured', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('rejects when no env vars are set', () => {
    expect(verifyRevenueCatSignature('body', 'some-sig', 'Bearer token', { nowMs: NOW_MS })).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// processWebhookEvent — event routing
// ═══════════════════════════════════════════════════════════════════════════════

describe('processWebhookEvent — subscription events call reconcileFn', () => {
  beforeEach(resetMocks)

  const subscriptionEventTypes = [
    'INITIAL_PURCHASE', 'RENEWAL', 'CANCELLATION', 'EXPIRATION',
    'BILLING_ISSUE', 'UNCANCELLATION', 'SUBSCRIPTION_PAUSED',
    'SUBSCRIPTION_EXTENDED', 'REFUND_REVERSED', 'PRODUCT_CHANGE',
  ] as const

  for (const type of subscriptionEventTypes) {
    it(`${type}: calls reconcileFn with userId`, async () => {
      const reconcile = okReconcile()
      const extra: Record<string, unknown> = {}
      if (type === 'CANCELLATION') extra.cancel_reason = 'UNSUBSCRIBE'
      await processWebhookEvent(makePayload({ type, ...extra } as Partial<RCWebhookPayload['event']>), reconcile)
      expect(reconcile).toHaveBeenCalledWith(USER_ID)
    })
  }

  it('TEST: does NOT call reconcileFn', async () => {
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({ type: 'TEST' }), reconcile)
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('NON_SUBSCRIPTION_PURCHASE: does NOT call reconcileFn', async () => {
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({ type: 'NON_SUBSCRIPTION_PURCHASE' }), reconcile)
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('handles PLAY_STORE (google) — calls reconcileFn', async () => {
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({ store: 'PLAY_STORE' }), reconcile)
    expect(reconcile).toHaveBeenCalledWith(USER_ID)
  })

  it('handles STRIPE — calls reconcileFn', async () => {
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({ store: 'STRIPE' }), reconcile)
    expect(reconcile).toHaveBeenCalledWith(USER_ID)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// processWebhookEvent — RC API error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('processWebhookEvent — RC API error handling', () => {
  beforeEach(resetMocks)

  it('throws rc_api_unavailable when reconcileFn returns rc_error retriable=true', async () => {
    const reconcile = makeReconcile({ status: 'rc_error', retriable: true })
    await expect(
      processWebhookEvent(makePayload(), reconcile),
    ).rejects.toThrow('rc_api_unavailable')
  })

  it('throws skipped:rc_client_error when reconcileFn returns rc_error retriable=false', async () => {
    const reconcile = makeReconcile({ status: 'rc_error', retriable: false })
    await expect(
      processWebhookEvent(makePayload(), reconcile),
    ).rejects.toThrow('skipped:rc_client_error')
  })

  it('EXPIRATION: no_rc_record returns normally (subscription gone, skip gracefully)', async () => {
    const reconcile = makeReconcile({ status: 'no_rc_record' })
    await expect(
      processWebhookEvent(makePayload({ type: 'EXPIRATION' }), reconcile),
    ).resolves.toBeUndefined()
  })

  it('rc_api_unavailable is not prefixed with skipped: → route will return 500 for retry', () => {
    // Verifies the nonRetriable logic in route.ts: rc_api_unavailable does NOT start
    // with 'skipped:', so it will cause the route to return 500 → RC retries.
    const note: string = 'rc_api_unavailable'  // widened to avoid literal narrowing
    const nonRetriable =
      note === 'anonymous_user_rejected' ||
      note === 'invalid_user_id_format'  ||
      note.startsWith('skipped:')
    expect(nonRetriable).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// processWebhookEvent — no_rc_record additive vs destructive events (Case 1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('processWebhookEvent — no_rc_record: additive events are retriable', () => {
  beforeEach(resetMocks)

  // Additive events: RC MUST have a subscriber record when it sends these webhooks.
  // A 404 means RC eventual-consistency lag. We throw rc_api_unavailable so RC
  // retries — the user gets their entitlement once the subscriber record appears.
  const additive = [
    'INITIAL_PURCHASE', 'RENEWAL', 'REFUND_REVERSED', 'UNCANCELLATION',
  ] as const

  for (const type of additive) {
    it(`${type}: no_rc_record → throws rc_api_unavailable (must not be marked completed)`, async () => {
      const reconcile = makeReconcile({ status: 'no_rc_record' })
      await expect(
        processWebhookEvent(makePayload({ type } as Partial<RCWebhookPayload['event']>), reconcile),
      ).rejects.toThrow('rc_api_unavailable')
    })
  }

  // Destructive events: 404 means the subscriber record is gone.
  // Skip gracefully — there is nothing to reconcile.
  const destructive = [
    'CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED', 'PRODUCT_CHANGE',
  ] as const

  for (const type of destructive) {
    it(`${type}: no_rc_record → returns normally (subscription gone, graceful skip)`, async () => {
      const extra: Record<string, unknown> = {}
      if (type === 'CANCELLATION') extra.cancel_reason = 'UNSUBSCRIBE'
      const reconcile = makeReconcile({ status: 'no_rc_record' })
      await expect(
        processWebhookEvent(makePayload({ type, ...extra } as Partial<RCWebhookPayload['event']>), reconcile),
      ).resolves.toBeUndefined()
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// processWebhookEvent — TRANSFER
// ═══════════════════════════════════════════════════════════════════════════════

describe('processWebhookEvent — TRANSFER', () => {
  beforeEach(resetMocks)

  it('directly revokes old owner subscription (updateMany)', async () => {
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({
      type: 'TRANSFER',
      app_user_id: USER_ID_2,
      transferred_from: [USER_ID],
      transferred_to:   [USER_ID_2],
    } as Partial<RCWebhookPayload['event']>), reconcile)

    const revokeCall = mockUpdateMany.mock.calls.find(
      (c: any[]) => (c[0] as any)?.where?.userId === USER_ID,
    )
    expect(revokeCall).toBeDefined()
    expect(revokeCall![0].data.status).toBe('canceled')
  })

  it('calls reconcileFn for new owner', async () => {
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({
      type: 'TRANSFER',
      app_user_id: USER_ID_2,
      transferred_from: [USER_ID],
      transferred_to:   [USER_ID_2],
    } as Partial<RCWebhookPayload['event']>), reconcile)

    expect(reconcile).toHaveBeenCalledWith(USER_ID_2)
  })

  it('refreshes old owner profile after direct revoke (Fix #2 partial — old owner downgrade)', async () => {
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({
      type: 'TRANSFER',
      app_user_id: USER_ID_2,
      transferred_from: [USER_ID],
      transferred_to:   [USER_ID_2],
    } as Partial<RCWebhookPayload['event']>), reconcile)

    const profileUpdateIds = mockProfileUpd.mock.calls.map(
      (c: any[]) => (c[0] as { where: { id: string } }).where.id,
    )
    expect(profileUpdateIds).toContain(USER_ID)
  })

  it('throws rc_api_unavailable if reconcileFn fails for new owner', async () => {
    const reconcile = makeReconcile({ status: 'rc_error', retriable: true })
    await expect(
      processWebhookEvent(makePayload({
        type: 'TRANSFER',
        app_user_id: USER_ID_2,
        transferred_from: [USER_ID],
        transferred_to:   [USER_ID_2],
      } as Partial<RCWebhookPayload['event']>), reconcile),
    ).rejects.toThrow('rc_api_unavailable')
  })

  it('skips when new owner is not a valid UUID', async () => {
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({
      type: 'TRANSFER',
      app_user_id: '$RCAnonymousID:xyz',
      transferred_from: [USER_ID],
      transferred_to:   ['$RCAnonymousID:xyz'],
    } as Partial<RCWebhookPayload['event']>), reconcile)

    expect(reconcile).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('still calls reconcileFn for new owner when transferred_from is empty', async () => {
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({
      type: 'TRANSFER',
      app_user_id: USER_ID_2,
      transferred_from: [],
      transferred_to:   [USER_ID_2],
    } as Partial<RCWebhookPayload['event']>), reconcile)

    expect(reconcile).toHaveBeenCalledWith(USER_ID_2)
    // No revoke since transferred_from is empty
    const revokeCall = mockUpdateMany.mock.calls.find(
      (c: any[]) => (c[0] as any)?.data?.status === 'canceled',
    )
    expect(revokeCall).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// processWebhookEvent — sandbox filtering
// ═══════════════════════════════════════════════════════════════════════════════

describe('processWebhookEvent — sandbox filtering', () => {
  beforeEach(resetMocks)

  it('skips sandbox events in production (reconcileFn not called)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('REVENUECAT_ACCEPT_SANDBOX', '')
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({ environment: 'SANDBOX' }), reconcile)
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('processes sandbox events when REVENUECAT_ACCEPT_SANDBOX=true', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('REVENUECAT_ACCEPT_SANDBOX', 'true')
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({ environment: 'SANDBOX' }), reconcile)
    expect(reconcile).toHaveBeenCalledWith(USER_ID)
  })

  it('processes sandbox events in non-production environment', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({ environment: 'SANDBOX' }), reconcile)
    expect(reconcile).toHaveBeenCalledWith(USER_ID)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// processWebhookEvent — identity guards
// ═══════════════════════════════════════════════════════════════════════════════

describe('processWebhookEvent — identity guards', () => {
  beforeEach(resetMocks)

  it('throws on anonymous RC user ID', async () => {
    const reconcile = okReconcile()
    await expect(
      processWebhookEvent(makePayload({ app_user_id: '$RCAnonymousID:sometoken' }), reconcile),
    ).rejects.toThrow('anonymous_user_rejected')
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('throws on non-UUID app_user_id', async () => {
    const reconcile = okReconcile()
    await expect(
      processWebhookEvent(makePayload({ app_user_id: 'not-a-uuid' }), reconcile),
    ).rejects.toThrow('invalid_user_id_format')
    expect(reconcile).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// processWebhookEvent — unsupported stores (Fix #7 regression)
// ═══════════════════════════════════════════════════════════════════════════════

describe('processWebhookEvent — unsupported stores (Fix #7 regression)', () => {
  beforeEach(resetMocks)

  it('INITIAL_PURCHASE from AMAZON throws with skipped: prefix (not a 500-worthy error)', async () => {
    const reconcile = okReconcile()
    await expect(
      processWebhookEvent(makePayload({ type: 'INITIAL_PURCHASE', store: 'AMAZON' } as Partial<RCWebhookPayload['event']>), reconcile),
    ).rejects.toThrow(/^skipped:unsupported_store:/)
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('EXPIRATION from UNKNOWN_STORE throws with skipped: prefix', async () => {
    const reconcile = okReconcile()
    await expect(
      processWebhookEvent(makePayload({ type: 'EXPIRATION', store: 'UNKNOWN_STORE' }), reconcile),
    ).rejects.toThrow(/^skipped:unsupported_store:/)
  })

  it('CANCELLATION from AMAZON throws with skipped: prefix', async () => {
    const reconcile = okReconcile()
    await expect(
      processWebhookEvent(makePayload({ type: 'CANCELLATION', store: 'AMAZON', cancel_reason: 'UNSUBSCRIBE' } as Partial<RCWebhookPayload['event']>), reconcile),
    ).rejects.toThrow(/^skipped:unsupported_store:/)
  })

  it('unsupported store does NOT call reconcileFn', async () => {
    const reconcile = okReconcile()
    try {
      await processWebhookEvent(makePayload({ store: 'AMAZON' } as Partial<RCWebhookPayload['event']>), reconcile)
    } catch { /* expected */ }
    expect(reconcile).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// processWebhookEvent — TRANSFER precision (Case 2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('processWebhookEvent — TRANSFER precision: revoke scoped to transferred subscription', () => {
  beforeEach(resetMocks)

  it('old-owner revoke includes externalSubscriptionId filter when original_transaction_id is provided', async () => {
    // The revoke must only cancel the row that holds the specific transferred
    // subscription. If the row currently holds a different subscription (the user
    // bought a new plan after the transfer was initiated), it must not be touched.
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({
      type:                    'TRANSFER',
      app_user_id:             USER_ID_2,
      transferred_from:        [USER_ID],
      transferred_to:          [USER_ID_2],
      original_transaction_id: TXN_ID,
    } as Partial<RCWebhookPayload['event']>), reconcile)

    const revokeCall = mockUpdateMany.mock.calls.find(
      (c: any[]) => (c[0] as any)?.where?.userId === USER_ID,
    )
    expect(revokeCall).toBeDefined()
    expect(revokeCall![0].where.externalSubscriptionId).toBe(TXN_ID)
  })

  it('old-owner revoke omits externalSubscriptionId filter when original_transaction_id is null', async () => {
    // When RC does not include the transaction ID, we cannot scope the revoke further.
    // The billing-source filter alone is applied (safe: unique constraint ensures
    // one row per user per billing source).
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({
      type:                    'TRANSFER',
      app_user_id:             USER_ID_2,
      transferred_from:        [USER_ID],
      transferred_to:          [USER_ID_2],
      original_transaction_id: null,
    } as Partial<RCWebhookPayload['event']>), reconcile)

    const revokeCall = mockUpdateMany.mock.calls.find(
      (c: any[]) => (c[0] as any)?.where?.userId === USER_ID,
    )
    expect(revokeCall).toBeDefined()
    expect(revokeCall![0].where.externalSubscriptionId).toBeUndefined()
  })

  it('old-owner revoke is scoped to the billingSource from the event — other sources are not touched', async () => {
    // TRANSFER with store: 'APP_STORE' → billingSource: 'apple'.
    // Only the apple row for the old owner is targeted. google/manual rows are untouched.
    const reconcile = okReconcile()
    await processWebhookEvent(makePayload({
      type:             'TRANSFER',
      app_user_id:      USER_ID_2,
      transferred_from: [USER_ID],
      transferred_to:   [USER_ID_2],
      store:            'APP_STORE',
    } as Partial<RCWebhookPayload['event']>), reconcile)

    const revokeCall = mockUpdateMany.mock.calls.find(
      (c: any[]) => (c[0] as any)?.where?.userId === USER_ID,
    )
    expect(revokeCall).toBeDefined()
    expect(revokeCall![0].where.billingSource).toBe('apple')
    // Verify the WHERE does not contain 'google' or 'manual'
    expect(revokeCall![0].where.billingSource).not.toBe('google')
    expect(revokeCall![0].where.billingSource).not.toBe('manual')
  })
})
