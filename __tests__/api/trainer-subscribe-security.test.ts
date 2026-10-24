/**
 * POST /api/trainer/subscribe — security regression tests
 *
 * Verifies that ordinary authenticated users cannot self-activate or
 * self-upgrade trainer subscriptions regardless of billing source.
 * Activation requires a valid INTERNAL_TRAINER_PROVISIONING_KEY.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { upsert: vi.fn() },
    trainerSubscription: { upsert: vi.fn() },
    profile: { update: vi.fn() },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { POST } from '../../app/api/trainer/subscribe/route'
import { NextRequest } from 'next/server'

const mockCreateClient = vi.mocked(createClient)
const mockTrainerSubUpsert = vi.mocked(prisma.trainerSubscription.upsert)

const VALID_KEY = 'test-provisioning-key-abc123'
const USER_ID   = 'aaaaaaaa-0000-0000-0000-000000000001'

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/trainer/subscribe', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function validBody(): Record<string, unknown> {
  return {
    tierKey:                'trainer_starter',
    externalSubscriptionId: 'ext_123',
    externalPriceId:        'price_123',
    billingSource:          'apple',
  }
}

function withAuth() {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
  } as never)
}

function withNoAuth() {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.INTERNAL_TRAINER_PROVISIONING_KEY
})

// ─── Unauthenticated requests ─────────────────────────────────────────────────

describe('Unauthenticated requests', () => {
  it('returns 403 when no key and no session', async () => {
    withNoAuth()
    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(403)
  })
})

// ─── Key-less authenticated requests ──────────────────────────────────────────

describe('Authenticated users without a provisioning key', () => {
  beforeEach(() => {
    withAuth()
    process.env.INTERNAL_TRAINER_PROVISIONING_KEY = VALID_KEY
  })

  it('returns 403 when no x-internal-key header is sent', async () => {
    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(403)
  })

  it('returns 403 with billingSource: apple and no key', async () => {
    const res = await POST(makeRequest({ ...validBody(), billingSource: 'apple' }))
    expect(res.status).toBe(403)
  })

  it('returns 403 with billingSource: google and no key', async () => {
    const res = await POST(makeRequest({ ...validBody(), billingSource: 'google' }))
    expect(res.status).toBe(403)
  })

  it('returns 403 with billingSource: manual and no key', async () => {
    const res = await POST(makeRequest({ ...validBody(), billingSource: 'manual' }))
    expect(res.status).toBe(403)
  })

  it('returns 403 with a wrong key', async () => {
    const res = await POST(makeRequest(validBody(), { 'x-internal-key': 'wrong-key' }))
    expect(res.status).toBe(403)
  })

  it('returns 403 with a key that is a prefix of the real key', async () => {
    const res = await POST(makeRequest(validBody(), { 'x-internal-key': VALID_KEY.slice(0, -1) }))
    expect(res.status).toBe(403)
  })

  it('returns 403 with an empty key header', async () => {
    const res = await POST(makeRequest(validBody(), { 'x-internal-key': '' }))
    expect(res.status).toBe(403)
  })
})

// ─── Key missing from environment ─────────────────────────────────────────────

describe('INTERNAL_TRAINER_PROVISIONING_KEY not configured', () => {
  beforeEach(() => {
    withAuth()
    // Key intentionally NOT set in env
  })

  it('returns 403 even when x-internal-key header is present', async () => {
    const res = await POST(makeRequest(validBody(), { 'x-internal-key': VALID_KEY }))
    expect(res.status).toBe(403)
  })

  it('returns 403 — fails closed, does not call DB', async () => {
    await POST(makeRequest(validBody(), { 'x-internal-key': VALID_KEY }))
    expect(mockTrainerSubUpsert).not.toHaveBeenCalled()
  })
})

// ─── Authenticated + correct key ─────────────────────────────────────────────

describe('Authenticated user with correct provisioning key', () => {
  beforeEach(() => {
    withAuth()
    process.env.INTERNAL_TRAINER_PROVISIONING_KEY = VALID_KEY
    vi.mocked(prisma.trainerProfile.upsert).mockResolvedValue({} as never)
    mockTrainerSubUpsert.mockResolvedValue({ id: 'sub-1', tierKey: 'trainer_starter' } as never)
    vi.mocked(prisma.profile.update).mockResolvedValue({} as never)
  })

  it('returns 200 when key matches and request is valid', async () => {
    const res = await POST(makeRequest(validBody(), { 'x-internal-key': VALID_KEY }))
    expect(res.status).toBe(200)
  })

  it('returns 400 for invalid tierKey even with correct key', async () => {
    const res = await POST(
      makeRequest({ ...validBody(), tierKey: 'trainer_enterprise' }, { 'x-internal-key': VALID_KEY }),
    )
    expect(res.status).toBe(400)
  })

  it('calls DB upsert exactly once', async () => {
    await POST(makeRequest(validBody(), { 'x-internal-key': VALID_KEY }))
    expect(mockTrainerSubUpsert).toHaveBeenCalledTimes(1)
  })
})

// ─── Ordinary users cannot self-elevate — summary assertion ──────────────────

describe('Self-elevation is impossible without the provisioning key', () => {
  it('cannot activate trainer_starter via apple billing', async () => {
    withAuth()
    process.env.INTERNAL_TRAINER_PROVISIONING_KEY = VALID_KEY
    const res = await POST(makeRequest({ ...validBody(), billingSource: 'apple' }))
    expect(res.status).toBe(403)
    expect(mockTrainerSubUpsert).not.toHaveBeenCalled()
  })

  it('cannot activate trainer_pro via google billing', async () => {
    withAuth()
    process.env.INTERNAL_TRAINER_PROVISIONING_KEY = VALID_KEY
    const res = await POST(makeRequest({ tierKey: 'trainer_pro', billingSource: 'google', externalSubscriptionId: 'x', externalPriceId: 'p' }))
    expect(res.status).toBe(403)
    expect(mockTrainerSubUpsert).not.toHaveBeenCalled()
  })

  it('cannot activate trainer_studio via manual billing', async () => {
    withAuth()
    process.env.INTERNAL_TRAINER_PROVISIONING_KEY = VALID_KEY
    const res = await POST(makeRequest({ tierKey: 'trainer_studio', billingSource: 'manual', externalSubscriptionId: 'x', externalPriceId: 'p' }))
    expect(res.status).toBe(403)
    expect(mockTrainerSubUpsert).not.toHaveBeenCalled()
  })
})
