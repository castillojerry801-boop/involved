/**
 * RevenueCat sync endpoint tests
 *
 * The sync route now delegates entirely to reconcileSubscriberFromRC.
 * Tests verify:
 *   - reconcileSubscriberFromRC is called with the correct options
 *   - Each ReconcileResult status maps to the correct HTTP response
 *   - Authentication guard (401 when not logged in)
 *   - RC not configured (503)
 *
 * Subscription state behavior is tested in revenuecat-reconcile.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock reconcileSubscriberFromRC ───────────────────────────────────────────
vi.mock('@/lib/revenuecat/reconcile', () => ({
  reconcileSubscriberFromRC: vi.fn(),
}))

vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn().mockResolvedValue({
    tier: 'free', status: null, isPlus: false, isFree: true,
    isTrial: false, isTrainer: false, isTrainerSponsored: false, isAdminGrant: false,
    trialEndsAt: null, trialDaysRemaining: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'aaaaaaaa-0000-0000-0000-000000000001' } },
      }),
    },
  }),
}))

import { reconcileSubscriberFromRC } from '@/lib/revenuecat/reconcile'

const mockReconcile = reconcileSubscriberFromRC as ReturnType<typeof vi.fn>
const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

const freeEntitlement = {
  tier: 'free', status: null, isPlus: false, isFree: true,
  isTrial: false, isTrainer: false, isTrainerSponsored: false, isAdminGrant: false,
  trialEndsAt: null, trialDaysRemaining: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
}

const plusEntitlement = {
  tier: 'plus', status: 'active', isPlus: true, isFree: false,
  isTrial: false, isTrainer: false, isTrainerSponsored: false, isAdminGrant: false,
  trialEndsAt: null, trialDaysRemaining: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
}

function makeEnv() {
  vi.stubEnv('REVENUECAT_SECRET_KEY', 'sk_test_secret')
  vi.stubEnv('NODE_ENV', 'test')
}

function resetSyncMocks() {
  vi.clearAllMocks()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Delegation to reconcileSubscriberFromRC
// ═══════════════════════════════════════════════════════════════════════════════

describe('sync POST — delegates to reconcileSubscriberFromRC', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    makeEnv()
    resetSyncMocks()
  })

  it('calls reconcileSubscriberFromRC with correct userId and env options', async () => {
    mockReconcile.mockResolvedValueOnce({ status: 'ok', entitlement: plusEntitlement })

    const { POST } = await import('../../app/api/subscription/sync/route')
    await POST()

    expect(mockReconcile).toHaveBeenCalledOnce()
    const callArgs = mockReconcile.mock.calls[0][0]
    expect(callArgs.userId).toBe(USER_ID)
    expect(callArgs.rcSecretKey).toBe('sk_test_secret')
    expect(callArgs.isProduction).toBe(false)   // NODE_ENV=test
    expect(typeof callArgs.acceptSandbox).toBe('boolean')
  })

  it('returns entitlement and source=rc_sync on success', async () => {
    mockReconcile.mockResolvedValueOnce({ status: 'ok', entitlement: plusEntitlement })

    const { POST } = await import('../../app/api/subscription/sync/route')
    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.source).toBe('rc_sync')
    expect(body.entitlement.tier).toBe('plus')
  })

  it('returns 502 when reconcileSubscriberFromRC returns rc_error', async () => {
    mockReconcile.mockResolvedValueOnce({ status: 'rc_error', retriable: true })

    const { POST } = await import('../../app/api/subscription/sync/route')
    const response = await POST()

    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.error).toBe('rc_api_error')
  })

  it('returns 200 with entitlement and source=no_rc_record on 404', async () => {
    mockReconcile.mockResolvedValueOnce({ status: 'no_rc_record' })

    const { POST } = await import('../../app/api/subscription/sync/route')
    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.source).toBe('no_rc_record')
    // Falls back to getUserEntitlement from DB
    expect(body.entitlement).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Auth and configuration guards
// ═══════════════════════════════════════════════════════════════════════════════

describe('sync POST — auth and configuration guards', () => {
  beforeEach(resetSyncMocks)

  it('returns 401 when user is not authenticated', async () => {
    vi.unstubAllEnvs()
    makeEnv()
    // Override supabase mock to return no user
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })

    const { POST } = await import('../../app/api/subscription/sync/route')
    const response = await POST()
    expect(response.status).toBe(401)
  })

  it('returns 503 when REVENUECAT_SECRET_KEY is not configured', async () => {
    vi.unstubAllEnvs()
    // No REVENUECAT_SECRET_KEY set

    const { POST } = await import('../../app/api/subscription/sync/route')
    const response = await POST()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toBe('rc_not_configured')
  })
})
