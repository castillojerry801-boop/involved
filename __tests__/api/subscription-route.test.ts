import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { userSubscription: { findFirst: vi.fn() } },
}))
vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { GET, POST } from '@/app/api/subscription/route'

const mockCreateClient = createClient as ReturnType<typeof vi.fn>
const mockGetEntitlement = getUserEntitlement as ReturnType<typeof vi.fn>

function mockAuth(userId: string | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  } as never)
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/subscription', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns entitlement for authenticated user', async () => {
    mockAuth('user-1')
    mockGetEntitlement.mockResolvedValue({ tier: 'free', isFree: true, isPlus: false })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json() as { tier: string }
    expect(body.tier).toBe('free')
  })
})

// ── POST — trial removed ──────────────────────────────────────────────────────

describe('POST /api/subscription', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await POST(makePost({ action: 'start_trial' }))
    expect(res.status).toBe(401)
  })

  it('returns 410 trial_unavailable for start_trial action', async () => {
    mockAuth('user-1')
    const res = await POST(makePost({ action: 'start_trial' }))
    expect(res.status).toBe(410)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('trial_unavailable')
  })

  it('returns 400 for unknown action', async () => {
    mockAuth('user-1')
    const res = await POST(makePost({ action: 'unknown_action' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is not valid JSON', async () => {
    mockAuth('user-1')
    const req = new NextRequest('http://localhost/api/subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
