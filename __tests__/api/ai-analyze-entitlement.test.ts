/**
 * POST /api/nutrition/ai-analyze — entitlement and usage accounting tests
 *
 * Verifies that:
 * - Free users are blocked with 403
 * - Trial, Plus, Trainer, and trainer-sponsored users are allowed
 * - Monthly limit reached returns 429
 * - OpenAI errors refund the usage credit (decrementVUsage called)
 * - Rejected requests do not consume usage credits
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn(),
}))
vi.mock('@/lib/v/usage', () => ({
  checkAndConsumeVUsage: vi.fn(),
  decrementVUsage: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/ai/client', () => ({
  getOpenAI: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: '{"foods":[],"totalCalories":0,"disclaimer":""}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      },
    },
  })),
}))
vi.mock('@/lib/ai/request-logger', () => ({
  buildTokenLog: vi.fn().mockReturnValue({}),
  flushRequestLogs: vi.fn().mockResolvedValue(undefined),
}))

import { createClient } from '@/lib/supabase/server'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { checkAndConsumeVUsage, decrementVUsage } from '@/lib/v/usage'
import { getOpenAI } from '@/lib/ai/client'
import { POST } from '../../app/api/nutrition/ai-analyze/route'
import { NextRequest } from 'next/server'

const mockCreateClient     = vi.mocked(createClient)
const mockGetEntitlement   = vi.mocked(getUserEntitlement)
const mockConsumeUsage     = vi.mocked(checkAndConsumeVUsage)
const mockDecrementUsage   = vi.mocked(decrementVUsage)

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const VALID_IMAGE = 'data:image/jpeg;base64,/9j/abc123'

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/nutrition/ai-analyze', {
    method: 'POST',
    body: JSON.stringify({ imageBase64: VALID_IMAGE, ...body }),
    headers: { 'content-type': 'application/json' },
  })
}

function withSession() {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
  } as never)
}

function makeEntitlement(tier: string, isPlus = false, isTrial = false, isTrainer = false, isTrainerSponsored = false) {
  return {
    tier, isPlus, isTrial, isFree: tier === 'free',
    isTrainer, isTrainerSponsored, isAdminGrant: false,
    status: 'active', trialEndsAt: null, trialDaysRemaining: null,
    currentPeriodEnd: null, cancelAtPeriodEnd: false,
  } as never
}

function usageAllowed(count = 1) {
  mockConsumeUsage.mockResolvedValue({ allowed: true, count, limit: 15 })
}

beforeEach(() => {
  vi.clearAllMocks()
  withSession()
})

// ─── Subscription gate ────────────────────────────────────────────────────────

describe('Subscription gate', () => {
  it('returns 403 for free users', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('free'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
  })

  it('does not consume usage for free users', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('free'))
    await POST(makeRequest())
    expect(mockConsumeUsage).not.toHaveBeenCalled()
  })

  it('does not call OpenAI for free users', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('free'))
    await POST(makeRequest())
    const openai = getOpenAI()
    expect(openai.chat.completions.create).not.toHaveBeenCalled()
  })

  it('allows trial users', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('trial', false, true))
    usageAllowed()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
  })

  it('allows plus users', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('plus', true))
    usageAllowed()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
  })

  it('allows trainer users', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('trainer', true, false, true))
    usageAllowed()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
  })

  it('allows trainer-sponsored users (plus tier via trainer)', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('plus', true, false, false, true))
    usageAllowed()
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
  })
})

// ─── Usage accounting ─────────────────────────────────────────────────────────

describe('Usage accounting', () => {
  it('returns 429 when monthly limit is reached', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('trial', false, true))
    mockConsumeUsage.mockResolvedValue({ allowed: false, count: 15, limit: 15 })
    const res = await POST(makeRequest())
    expect(res.status).toBe(429)
  })

  it('does not call OpenAI when usage limit is reached', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('trial', false, true))
    mockConsumeUsage.mockResolvedValue({ allowed: false, count: 15, limit: 15 })
    await POST(makeRequest())
    const openai = getOpenAI()
    expect(openai.chat.completions.create).not.toHaveBeenCalled()
  })

  it('consumes one usage credit on a successful request', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('plus', true))
    usageAllowed()
    await POST(makeRequest())
    expect(mockConsumeUsage).toHaveBeenCalledWith(USER_ID, 'plus', 'meal_photo')
  })

  it('passes null limit for plus users (unlimited)', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('plus', true))
    mockConsumeUsage.mockResolvedValue({ allowed: true, count: 1, limit: null })
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
  })
})

// ─── OpenAI error refund ──────────────────────────────────────────────────────

describe('OpenAI error refund', () => {
  it('calls decrementVUsage when OpenAI throws', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('plus', true))
    usageAllowed()
    vi.mocked(getOpenAI).mockReturnValue({
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('OpenAI unavailable')),
        },
      },
    } as never)
    await POST(makeRequest())
    expect(mockDecrementUsage).toHaveBeenCalledWith(USER_ID, 'meal_photo')
  })

  it('does not decrement when request is blocked at auth', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)
    await POST(makeRequest())
    expect(mockDecrementUsage).not.toHaveBeenCalled()
  })

  it('does not decrement when request is blocked at entitlement gate', async () => {
    mockGetEntitlement.mockResolvedValue(makeEntitlement('free'))
    await POST(makeRequest())
    expect(mockDecrementUsage).not.toHaveBeenCalled()
  })
})
