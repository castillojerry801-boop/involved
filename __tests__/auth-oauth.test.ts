/**
 * Regression tests — OAuth callback route and social auth flows.
 *
 * Covers:
 *  1. Callback handles missing code (redirect to login)
 *  2. Callback handles OAuth provider errors (access_denied, other)
 *  3. Callback calls exchangeCodeForSession on a valid code
 *  4. Callback upserts a profile for a new OAuth user
 *  5. Callback redirects to a safe `next` param; blocks open-redirect attempts
 *  6. Deep-link safe-next validation (matches callback safeNext logic)
 *  7. Native deep-link URL parsing contract
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockUpsert = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    profile: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}))

// ── Supabase SSR mock ─────────────────────────────────────────────────────────

const mockExchange = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => mockExchange(...args),
    },
  }),
}))

// ── next/headers mock ─────────────────────────────────────────────────────────

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    getAll: () => [],
    set: () => {},
  }),
}))

import { GET } from '@/app/api/auth/callback/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(params: Record<string, string>) {
  const sp = new URLSearchParams(params)
  return new Request(`https://www.involvedfit.com/api/auth/callback?${sp}`)
}

const FAKE_USER = {
  id:            'user-uuid-0000-0000-000000000001',
  user_metadata: { full_name: 'Jane Doe' },
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Missing code
// ─────────────────────────────────────────────────────────────────────────────

describe('OAuth callback — missing code', () => {
  it('redirects to /login?error=missing_code when no code param', async () => {
    const res = await GET(makeReq({}))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login?error=missing_code')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. OAuth provider error param
// ─────────────────────────────────────────────────────────────────────────────

describe('OAuth callback — provider error', () => {
  it('redirects to /login?error=oauth_canceled on access_denied', async () => {
    const res = await GET(makeReq({ error: 'access_denied' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('oauth_canceled')
  })

  it('redirects to /login?error=oauth_failed for other provider errors', async () => {
    const res = await GET(makeReq({ error: 'server_error' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('oauth_failed')
  })

  it('error param takes precedence over code when both present', async () => {
    const res = await GET(makeReq({ error: 'access_denied', code: 'some-code' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('oauth_canceled')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Successful code exchange
// ─────────────────────────────────────────────────────────────────────────────

describe('OAuth callback — successful exchange', () => {
  beforeEach(() => {
    mockExchange.mockResolvedValue({ data: { user: FAKE_USER }, error: null })
    mockUpsert.mockResolvedValue({})
  })
  afterEach(() => vi.clearAllMocks())

  it('calls exchangeCodeForSession with the code', async () => {
    await GET(makeReq({ code: 'valid-code-abc' }))
    expect(mockExchange).toHaveBeenCalledWith('valid-code-abc')
  })

  it('redirects to /today by default', async () => {
    const res = await GET(makeReq({ code: 'valid-code-abc' }))
    expect(res.headers.get('location')).toMatch(/\/today$/)
  })

  it('honours a safe next param', async () => {
    const res = await GET(makeReq({ code: 'abc', next: '/training' }))
    expect(res.headers.get('location')).toMatch(/\/training$/)
  })

  it('redirects failed exchange to /login?error=auth_failed', async () => {
    mockExchange.mockResolvedValue({ data: { user: null }, error: { message: 'invalid code' } })
    const res = await GET(makeReq({ code: 'bad-code' }))
    expect(res.headers.get('location')).toContain('auth_failed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Profile upsert for new OAuth users
// ─────────────────────────────────────────────────────────────────────────────

describe('OAuth callback — profile upsert', () => {
  beforeEach(() => {
    mockExchange.mockResolvedValue({ data: { user: FAKE_USER }, error: null })
    mockUpsert.mockResolvedValue({})
  })
  afterEach(() => vi.clearAllMocks())

  it('calls profile.upsert with the user id', async () => {
    await GET(makeReq({ code: 'abc' }))
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where:  { id: FAKE_USER.id },
        update: {},
      })
    )
  })

  it('upsert create includes displayName from user_metadata.full_name', async () => {
    await GET(makeReq({ code: 'abc' }))
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ displayName: 'Jane Doe' }),
      })
    )
  })

  it('upsert create falls back to null when no name metadata', async () => {
    mockExchange.mockResolvedValue({
      data: { user: { id: 'uuid-no-name', user_metadata: {} } },
      error: null,
    })
    await GET(makeReq({ code: 'abc' }))
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ displayName: null }),
      })
    )
  })

  it('does not fail if upsert throws (non-fatal)', async () => {
    mockUpsert.mockRejectedValue(new Error('DB error'))
    const res = await GET(makeReq({ code: 'abc' }))
    // Should still redirect successfully
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/today$/)
  })

  it('skips upsert when exchange returns no user', async () => {
    mockExchange.mockResolvedValue({ data: { user: null }, error: null })
    await GET(makeReq({ code: 'abc' }))
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Open-redirect guard on `next`
// ─────────────────────────────────────────────────────────────────────────────

describe('OAuth callback — open-redirect guard', () => {
  beforeEach(() => {
    mockExchange.mockResolvedValue({ data: { user: FAKE_USER }, error: null })
    mockUpsert.mockResolvedValue({})
  })
  afterEach(() => vi.clearAllMocks())

  it('falls back to /today for an absolute URL next', async () => {
    const res = await GET(makeReq({ code: 'abc', next: 'https://evil.com' }))
    expect(res.headers.get('location')).toMatch(/\/today$/)
  })

  it('falls back to /today for a protocol-relative next', async () => {
    const res = await GET(makeReq({ code: 'abc', next: '//evil.com' }))
    expect(res.headers.get('location')).toMatch(/\/today$/)
  })

  it('allows a relative path next', async () => {
    const res = await GET(makeReq({ code: 'abc', next: '/profile' }))
    expect(res.headers.get('location')).toMatch(/\/profile$/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Native deep-link URL parsing (mirrors OAuthDeepLinkHandler logic)
// ─────────────────────────────────────────────────────────────────────────────

describe('Native deep-link URL parsing', () => {
  function parseDeepLink(url: string): { isOAuthCallback: boolean; next: string } {
    const isOAuthCallback = url.startsWith('com.involved.app://auth/callback')
    if (!isOAuthCallback) return { isOAuthCallback: false, next: '/today' }

    const urlObj  = new URL(url)
    const rawNext = urlObj.searchParams.get('next')
    const next    = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
      ? rawNext
      : '/today'

    return { isOAuthCallback, next }
  }

  it('recognises the com.involved.app://auth/callback scheme', () => {
    const { isOAuthCallback } = parseDeepLink('com.involved.app://auth/callback?code=abc')
    expect(isOAuthCallback).toBe(true)
  })

  it('ignores unrelated deep links', () => {
    const { isOAuthCallback } = parseDeepLink('com.involved.app://workout/123')
    expect(isOAuthCallback).toBe(false)
  })

  it('extracts a safe next param', () => {
    const { next } = parseDeepLink('com.involved.app://auth/callback?code=abc&next=%2Ftraining')
    expect(next).toBe('/training')
  })

  it('falls back to /today for unsafe next', () => {
    const { next } = parseDeepLink('com.involved.app://auth/callback?code=abc&next=https%3A%2F%2Fevil.com')
    expect(next).toBe('/today')
  })

  it('falls back to /today when next is absent', () => {
    const { next } = parseDeepLink('com.involved.app://auth/callback?code=abc')
    expect(next).toBe('/today')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. Secret isolation — no client-side exposure
// ─────────────────────────────────────────────────────────────────────────────

describe('OAuth secret isolation', () => {
  it('callback route does not import or re-export SUPABASE_SERVICE_ROLE_KEY', async () => {
    // The callback uses the anon key (public) via createServerClient, not the service role key.
    // Verify the module source does not reference the service role key string.
    const fs = await import('fs/promises')
    const src = await fs.readFile('app/api/auth/callback/route.ts', 'utf8')
    expect(src).not.toContain('SERVICE_ROLE')
    expect(src).not.toContain('service_role')
  })

  it('social-auth-buttons component does not contain any server-only secrets', async () => {
    const fs = await import('fs/promises')
    const src = await fs.readFile('components/auth/social-auth-buttons.tsx', 'utf8')
    // Must not contain service role key, must not contain any private key markers
    expect(src).not.toContain('SERVICE_ROLE')
    expect(src).not.toContain('PRIVATE_KEY')
    expect(src).not.toContain('-----BEGIN')
  })
})
