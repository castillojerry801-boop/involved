/**
 * Weekly review entitlement gate tests.
 *
 * Verifies that GET /api/v/weekly-review enforces the PLUS_AND_UP feature gate:
 *   - No auth → 401
 *   - Free tier → 403
 *   - Trial tier → 200
 *   - Plus tier → 200
 *   - Trainer tier → 200
 *   - Trainer-sponsored plus → 200
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    program: { findFirst: vi.fn().mockResolvedValue(null) },
    workout: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/lib/v/weekly-review', () => ({
  buildWeeklyReview: vi.fn().mockReturnValue({ summary: 'test', sessions: [] }),
}))

vi.mock('@/lib/exercises', () => ({
  getExerciseById: vi.fn().mockReturnValue(null),
}))

import { createClient } from '@/lib/supabase/server'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { GET } from '../../app/api/v/weekly-review/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockCreateClient = createClient as ReturnType<typeof vi.fn>
const mockGetEntitlement = getUserEntitlement as ReturnType<typeof vi.fn>

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

function mockAuthed() {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
  })
}

function mockUnauthed() {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  })
}

function makeEntitlement(tier: string, overrides: Record<string, unknown> = {}) {
  return {
    tier,
    status: tier === 'free' ? null : 'active',
    trialEndsAt: null,
    trialDaysRemaining: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    isPlus: ['plus', 'trainer'].includes(tier),
    isTrial: tier === 'trial',
    isFree: tier === 'free',
    isTrainer: tier === 'trainer',
    isTrainerSponsored: false,
    isAdminGrant: false,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v/weekly-review — auth gate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockUnauthed()
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v/weekly-review — entitlement gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthed()
  })

  it('returns 403 for free tier', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('free'))
    const res = await GET()
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/involved\+/i)
  })

  it('returns 200 for trial tier', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('trial'))
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns 200 for plus tier', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('plus'))
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns 200 for trainer tier', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('trainer'))
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns 200 for trainer-sponsored plus', async () => {
    mockGetEntitlement.mockResolvedValue(
      makeEntitlement('plus', { isTrainerSponsored: true }),
    )
    const res = await GET()
    expect(res.status).toBe(200)
  })
})
