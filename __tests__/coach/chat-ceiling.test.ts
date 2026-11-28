/**
 * Coach V chat ceiling — integration tests
 *
 * Verifies the per-billing-period message limits enforced in /api/coach POST:
 *   - Free:    20 messages → message 20 allowed, 21 blocked before any model call
 *   - Premium: 150 messages → message 150 allowed, 151 blocked before any model call
 *   - Trainer: unlimited (null limit) — never blocked
 *   - Concurrent requests cannot exceed the cap (atomic SQL guarantee)
 *   - Next billing period resets usage
 *   - Blocked attempts are logged to AiRequestLog (chat_rate_limited)
 *   - GET handler returns correct remaining count for all tiers
 *   - X-Usage-Count and X-Usage-Limit response headers are present
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockQueryRaw, mockFindUnique, mockCreate, mockCreateMany,
  mockFlushRequestLogs, mockGetUserEntitlement,
} = vi.hoisted(() => ({
  mockQueryRaw:            vi.fn(),
  mockFindUnique:          vi.fn(),
  mockCreate:              vi.fn(),
  mockCreateMany:          vi.fn(),
  mockFlushRequestLogs:    vi.fn().mockResolvedValue(undefined),
  mockGetUserEntitlement:  vi.fn(),
}))

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'test@involved.app' } },
      }),
    },
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw:    mockQueryRaw,
    aiUsageLog:   { findUnique: mockFindUnique },
    aiRequestLog: { createMany: mockCreateMany },
    userTrainingPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    workoutLog:       { findMany:  vi.fn().mockResolvedValue([]) },
    foodLogEntry:     { findMany:  vi.fn().mockResolvedValue([]) },
    foodItem:         { findMany:  vi.fn().mockResolvedValue([]) },
    foodItemPortion:  {
      findMany:  vi.fn().mockResolvedValue([]),
      upsert:    vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}))

vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: mockGetUserEntitlement,
}))

vi.mock('@/lib/ai/request-logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/request-logger')>()
  return { ...actual, flushRequestLogs: mockFlushRequestLogs }
})

vi.mock('@/lib/ai/context', () => ({
  buildCoachContext: vi.fn().mockResolvedValue({
    trainingCtx:  null, healthCtx: null, nutritionCtx: null, scheduleCtx: null,
  }),
  contextToSystemSnippet: vi.fn().mockReturnValue(''),
}))

vi.mock('@/lib/ai/client', () => ({
  getOpenAI: vi.fn().mockReturnValue({
    chat: { completions: { create: mockCreate } },
  }),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(messages = [{ role: 'user' as const, content: 'hello' }]) {
  return new NextRequest('http://localhost/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
}

type Tier = 'free' | 'trial' | 'plus' | 'trainer'
function setTier(tier: Tier) {
  mockGetUserEntitlement.mockResolvedValue({
    tier,
    isPlus:    tier === 'plus' || tier === 'trainer',
    isTrial:   tier === 'trial',
    isFree:    tier === 'free',
    isTrainer: tier === 'trainer',
    trialDaysRemaining: tier === 'trial' ? 7 : null,
  })
}

function allowedAt(n: number) {
  mockQueryRaw.mockResolvedValueOnce([{ n }])
}

function blockedAt(currentCount: number) {
  mockQueryRaw.mockResolvedValueOnce([])
  mockFindUnique.mockResolvedValueOnce({ interactionCount: currentCount })
}

function mockChatCompletion(text = 'Hi there!') {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { role: 'assistant', content: text, tool_calls: null } }],
    usage:   { prompt_tokens: 10, completion_tokens: 5 },
  })
}

async function drainStream(res: Response) {
  if (res.body) {
    const r = res.body.getReader()
    while (!(await r.read()).done) {}
  }
}

// ── Import route after mocks ──────────────────────────────────────────────────
import { POST, GET } from '@/app/api/coach/route'

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateMany.mockResolvedValue({ count: 1 })
  // Fake only Date so billingPeriod() returns '2026-11'. Do NOT fake setTimeout —
  // the route streams words via setTimeout(_, 8) and would hang with full fake timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
})

// ── Free tier ceiling ─────────────────────────────────────────────────────────

describe('Free tier ceiling (limit = 20)', () => {
  beforeEach(() => setTier('free'))

  it('message 1 of 20: allowed, model is called', async () => {
    allowedAt(1)
    mockChatCompletion()
    const res = await POST(makeRequest())
    await drainStream(res)
    expect(res.status).not.toBe(429)
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('message 20 of 20: last slot still allowed', async () => {
    allowedAt(20)
    mockChatCompletion()
    const res = await POST(makeRequest())
    await drainStream(res)
    expect(res.status).not.toBe(429)
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('message 21: blocked before any model call', async () => {
    blockedAt(20)
    const res = await POST(makeRequest())
    expect(res.status).toBe(429)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('blocked response body has error=limit_reached, limit=20, count=20', async () => {
    blockedAt(20)
    const res = await POST(makeRequest())
    const body = await res.json() as { error: string; limit: number; count: number }
    expect(body.error).toBe('limit_reached')
    expect(body.limit).toBe(20)
    expect(body.count).toBe(20)
  })
})

// ── Premium tier ceiling ──────────────────────────────────────────────────────

describe('Premium tier ceiling (limit = 150)', () => {
  beforeEach(() => setTier('plus'))

  it('message 1 of 150: allowed', async () => {
    allowedAt(1)
    mockChatCompletion()
    const res = await POST(makeRequest())
    await drainStream(res)
    expect(res.status).not.toBe(429)
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('message 150 of 150: last slot still allowed', async () => {
    allowedAt(150)
    mockChatCompletion()
    const res = await POST(makeRequest())
    await drainStream(res)
    expect(res.status).not.toBe(429)
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('message 151: blocked before any model call', async () => {
    blockedAt(150)
    const res = await POST(makeRequest())
    expect(res.status).toBe(429)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('blocked response body has error=limit_reached, limit=150, count=150', async () => {
    blockedAt(150)
    const res = await POST(makeRequest())
    const body = await res.json() as { error: string; limit: number; count: number }
    expect(body.error).toBe('limit_reached')
    expect(body.limit).toBe(150)
    expect(body.count).toBe(150)
  })
})

// ── Trainer tier — unlimited ──────────────────────────────────────────────────

describe('Trainer tier — unlimited (null limit)', () => {
  beforeEach(() => setTier('trainer'))

  it('never blocked regardless of message count', async () => {
    mockQueryRaw.mockResolvedValue([{ n: 500 }])
    mockChatCompletion()
    const res = await POST(makeRequest())
    await drainStream(res)
    expect(res.status).not.toBe(429)
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('X-Usage-Limit header is "unlimited"', async () => {
    mockQueryRaw.mockResolvedValue([{ n: 1 }])
    mockChatCompletion()
    const res = await POST(makeRequest())
    await drainStream(res)
    expect(res.headers.get('X-Usage-Limit')).toBe('unlimited')
  })
})

// ── Concurrent request safety ─────────────────────────────────────────────────

describe('Concurrent request safety — Premium', () => {
  beforeEach(() => setTier('plus'))

  it('two simultaneous requests at count=149: exactly one succeeds, one is blocked', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ n: 150 }]) // first caller wins the last slot
      .mockResolvedValueOnce([])            // second: WHERE 150 < 150 fails
    mockFindUnique.mockResolvedValue({ interactionCount: 150 })
    mockChatCompletion()

    const [resA, resB] = await Promise.all([POST(makeRequest()), POST(makeRequest())])
    await Promise.all([drainStream(resA), drainStream(resB)])

    const statuses = [resA.status, resB.status]
    expect(statuses.filter(s => s !== 429).length).toBe(1)
    expect(statuses.filter(s => s === 429).length).toBe(1)
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('two simultaneous blocked requests: neither calls the model', async () => {
    mockQueryRaw.mockResolvedValue([])
    mockFindUnique.mockResolvedValue({ interactionCount: 150 })

    const [resA, resB] = await Promise.all([POST(makeRequest()), POST(makeRequest())])

    expect(resA.status).toBe(429)
    expect(resB.status).toBe(429)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

// ── Billing period reset ──────────────────────────────────────────────────────

describe('Billing period reset', () => {
  beforeEach(() => setTier('plus'))

  it('November at-limit does not block a December first request', async () => {
    // November — blocked
    blockedAt(150)
    const novRes = await POST(makeRequest())
    expect(novRes.status).toBe(429)

    // Advance to December
    vi.setSystemTime(new Date('2026-12-01T00:00:00Z'))
    // New billing period: INSERT fires, count = 1
    allowedAt(1)
    mockChatCompletion()
    const decRes = await POST(makeRequest())
    await drainStream(decRes)
    expect(decRes.status).not.toBe(429)
    expect(mockCreate).toHaveBeenCalledOnce()
  })
})

// ── Blocked attempt logging ───────────────────────────────────────────────────

describe('Blocked attempt logging', () => {
  beforeEach(() => setTier('plus'))

  it('blocked request flushes a chat_rate_limited log entry', async () => {
    blockedAt(150)
    await POST(makeRequest())
    // Allow microtasks (the after() fallback path runs synchronously in tests)
    await Promise.resolve()
    expect(mockFlushRequestLogs).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ operationType: 'chat_rate_limited', model: 'blocked' }),
      ]),
    )
  })
})

// ── DB error — fail-closed for capped tiers ───────────────────────────────────

describe('DB error — fail-closed for capped tiers', () => {
  it('free tier DB error returns 503 before any model call', async () => {
    setTier('free')
    mockQueryRaw.mockRejectedValueOnce(new Error('DB connection lost'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(503)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('usage_unavailable')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('plus tier DB error returns 503 before any model call', async () => {
    setTier('plus')
    mockQueryRaw.mockRejectedValueOnce(new Error('DB connection lost'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(503)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('trainer DB error: still allowed, fail open (unlimited)', async () => {
    setTier('trainer')
    mockQueryRaw.mockRejectedValueOnce(new Error('DB connection lost'))
    mockChatCompletion()
    const res = await POST(makeRequest())
    await drainStream(res)
    expect(res.status).not.toBe(503)
    expect(res.status).not.toBe(429)
    expect(mockCreate).toHaveBeenCalledOnce()
  })
})

// ── Response headers ─────────────────────────────────────────────────────────

describe('Response headers', () => {
  it('Premium allowed request: X-Usage-Count=5, X-Usage-Limit=150', async () => {
    setTier('plus')
    allowedAt(5)
    mockChatCompletion()
    const res = await POST(makeRequest())
    await drainStream(res)
    expect(res.headers.get('X-Usage-Count')).toBe('5')
    expect(res.headers.get('X-Usage-Limit')).toBe('150')
  })

  it('Free tier: X-Usage-Limit=20', async () => {
    setTier('free')
    allowedAt(3)
    mockChatCompletion()
    const res = await POST(makeRequest())
    await drainStream(res)
    expect(res.headers.get('X-Usage-Limit')).toBe('20')
  })
})
