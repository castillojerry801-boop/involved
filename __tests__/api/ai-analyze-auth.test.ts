import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
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
  buildTokenLog: vi.fn().mockReturnValue({ userId: 'u1', feature: 'meal_photo', operationType: 'photo_analysis', model: 'gpt-4o', inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, audioBytes: null, estimatedCostUsd: null, pricingStatus: 'confirmed' }),
  flushRequestLogs: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn().mockResolvedValue({
    tier: 'plus', isPlus: true, isTrial: false, isFree: false,
    isTrainer: false, isTrainerSponsored: false, isAdminGrant: false,
    status: 'active', trialEndsAt: null, trialDaysRemaining: null,
    currentPeriodEnd: null, cancelAtPeriodEnd: false,
  }),
}))
vi.mock('@/lib/v/usage', () => ({
  checkAndConsumeVUsage: vi.fn().mockResolvedValue({ allowed: true, count: 1, limit: null }),
  decrementVUsage: vi.fn().mockResolvedValue(undefined),
}))

import { createClient } from '@/lib/supabase/server'
import { flushRequestLogs } from '@/lib/ai/request-logger'
import { POST } from '../../app/api/nutrition/ai-analyze/route'
import { NextRequest } from 'next/server'

const mockCreateClient = vi.mocked(createClient)
const mockFlushRequestLogs = vi.mocked(flushRequestLogs)

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/nutrition/ai-analyze', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/nutrition/ai-analyze — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)

    const res = await POST(makeRequest({ imageBase64: 'data:image/jpeg;base64,abc' }))
    expect(res.status).toBe(401)
  })

  it('does not call OpenAI when unauthenticated', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)

    const { getOpenAI } = await import('@/lib/ai/client')
    const mockGetOpenAI = vi.mocked(getOpenAI)

    await POST(makeRequest({ imageBase64: 'data:image/jpeg;base64,abc' }))
    // OpenAI should not have been called — unauthenticated request blocked before API call
    const createFn = mockGetOpenAI.mock.results[0]?.value?.chat?.completions?.create
    expect(createFn).toBeUndefined()
  })

  it('does not log any AI usage for unauthenticated requests', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)

    await POST(makeRequest({ imageBase64: 'data:image/jpeg;base64,abc' }))
    expect(mockFlushRequestLogs).not.toHaveBeenCalled()
  })

  it('returns 400 when authenticated but no image provided', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    } as never)

    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('allows authenticated requests to proceed', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    } as never)

    const res = await POST(makeRequest({ imageBase64: 'data:image/jpeg;base64,abc' }))
    // Should proceed past auth (may fail at image parsing, but not 401)
    expect(res.status).not.toBe(401)
  })
})
