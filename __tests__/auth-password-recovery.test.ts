/**
 * Tests for the password recovery flow.
 *
 * Covers:
 *  1. auth/confirm — recovery type routes to /reset-password
 *  2. auth/confirm — signup type routes to /onboarding
 *  3. auth/confirm — recovery with explicit next param honours the param
 *  4. auth/confirm — invalid token redirects to login with error
 *  5. auth/confirm — missing token_hash or type redirects to login
 *  6. change-password route — rejects unauthenticated requests
 *  7. change-password route — rejects short new passwords
 *  8. change-password route — rejects same current/new password
 *  9. change-password route — rejects wrong current password
 * 10. change-password route — succeeds when credentials are valid
 * 11. change-password route — returns 500 when updateUser fails
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — auth/confirm routing
// ─────────────────────────────────────────────────────────────────────────────

const mockVerifyOtp = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    },
  }),
}))

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    getAll:  () => [],
    set:     () => {},
    setAll:  () => {},
  }),
}))

function makeConfirmReq(params: Record<string, string>) {
  const sp = new URLSearchParams(params)
  return new NextRequest(`https://www.involvedfit.com/auth/confirm?${sp}`)
}

describe('auth/confirm — recovery routing', () => {
  beforeEach(() => { mockVerifyOtp.mockResolvedValue({ error: null }) })
  afterEach(() => vi.clearAllMocks())

  it('redirects type=recovery to /reset-password when no next param', async () => {
    const { GET } = await import('@/app/auth/confirm/route')
    const res = await GET(makeConfirmReq({ token_hash: 'hash123', type: 'recovery' }))
    expect(res.headers.get('location')).toContain('/reset-password')
  })

  it('redirects type=recovery with explicit next param to that path', async () => {
    const { GET } = await import('@/app/auth/confirm/route')
    const res = await GET(makeConfirmReq({ token_hash: 'hash123', type: 'recovery', next: '/settings' }))
    expect(res.headers.get('location')).toContain('/settings')
    expect(res.headers.get('location')).not.toContain('/reset-password')
  })

  it('falls back to /reset-password for recovery when next is an absolute URL (open-redirect guard)', async () => {
    const { GET } = await import('@/app/auth/confirm/route')
    const res = await GET(makeConfirmReq({ token_hash: 'hash123', type: 'recovery', next: 'https://evil.com' }))
    expect(res.headers.get('location')).toContain('/reset-password')
    expect(res.headers.get('location')).not.toContain('evil.com')
  })

  it('falls back to /onboarding for signup when next is a protocol-relative URL (open-redirect guard)', async () => {
    const { GET } = await import('@/app/auth/confirm/route')
    const res = await GET(makeConfirmReq({ token_hash: 'hash123', type: 'signup', next: '//evil.com' }))
    expect(res.headers.get('location')).toContain('/onboarding')
    expect(res.headers.get('location')).not.toContain('evil.com')
  })

  it('does NOT redirect type=recovery to /onboarding', async () => {
    const { GET } = await import('@/app/auth/confirm/route')
    const res = await GET(makeConfirmReq({ token_hash: 'hash123', type: 'recovery' }))
    expect(res.headers.get('location')).not.toContain('/onboarding')
  })

  it('redirects type=signup to /onboarding when no next param', async () => {
    const { GET } = await import('@/app/auth/confirm/route')
    const res = await GET(makeConfirmReq({ token_hash: 'hash123', type: 'signup' }))
    expect(res.headers.get('location')).toContain('/onboarding')
  })

  it('redirects failed token verification to /login?error=confirmation_failed', async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: 'invalid token' } })
    const { GET } = await import('@/app/auth/confirm/route')
    const res = await GET(makeConfirmReq({ token_hash: 'bad', type: 'recovery' }))
    expect(res.headers.get('location')).toContain('confirmation_failed')
  })

  it('redirects missing token_hash to /login?error=missing_token', async () => {
    const { GET } = await import('@/app/auth/confirm/route')
    const res = await GET(makeConfirmReq({ type: 'recovery' }))
    expect(res.headers.get('location')).toContain('missing_token')
  })

  it('redirects missing type to /login?error=missing_token', async () => {
    const { GET } = await import('@/app/auth/confirm/route')
    const res = await GET(makeConfirmReq({ token_hash: 'hash123' }))
    expect(res.headers.get('location')).toContain('missing_token')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — change-password API route
// ─────────────────────────────────────────────────────────────────────────────

const mockGetUser       = vi.fn()
const mockSignIn        = vi.fn()
const mockUpdateUser    = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  getUser:      () => mockGetUser(),
  createClient: async () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignIn(...args),
      updateUser:         (...args: unknown[]) => mockUpdateUser(...args),
    },
  }),
}))

function makeChangeReq(body: object) {
  return new NextRequest('https://www.involvedfit.com/api/account/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('change-password route — guards', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue(null)
    const { POST } = await import('@/app/api/account/change-password/route')
    const res = await POST(makeChangeReq({ currentPassword: 'old123!', newPassword: 'new456!' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when new password is fewer than 8 characters', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'user@example.com' })
    const { POST } = await import('@/app/api/account/change-password/route')
    const res = await POST(makeChangeReq({ currentPassword: 'oldpassword', newPassword: 'short' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when new password equals current password', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'user@example.com' })
    const { POST } = await import('@/app/api/account/change-password/route')
    const res = await POST(makeChangeReq({ currentPassword: 'samepassword', newPassword: 'samepassword' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when either password field is missing', async () => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'user@example.com' })
    const { POST } = await import('@/app/api/account/change-password/route')
    const res = await POST(makeChangeReq({ currentPassword: 'oldpassword' }))
    expect(res.status).toBe(400)
  })
})

describe('change-password route — authentication', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ id: 'u1', email: 'user@example.com' })
  })
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when current password is wrong', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const { POST } = await import('@/app/api/account/change-password/route')
    const res = await POST(makeChangeReq({ currentPassword: 'wrongpass', newPassword: 'newpassword123' }))
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Current password is incorrect')
  })

  it('verifies current password via signInWithPassword before updating', async () => {
    mockSignIn.mockResolvedValue({ error: null })
    mockUpdateUser.mockResolvedValue({ error: null })
    const { POST } = await import('@/app/api/account/change-password/route')
    await POST(makeChangeReq({ currentPassword: 'correct!Pass1', newPassword: 'newpassword99!' }))
    expect(mockSignIn).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'correct!Pass1',
    })
  })

  it('returns 200 on success', async () => {
    mockSignIn.mockResolvedValue({ error: null })
    mockUpdateUser.mockResolvedValue({ error: null })
    const { POST } = await import('@/app/api/account/change-password/route')
    const res = await POST(makeChangeReq({ currentPassword: 'correct!Pass1', newPassword: 'newpassword99!' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean }
    expect(body.success).toBe(true)
  })

  it('returns 500 when updateUser fails', async () => {
    mockSignIn.mockResolvedValue({ error: null })
    mockUpdateUser.mockResolvedValue({ error: { message: 'DB error' } })
    const { POST } = await import('@/app/api/account/change-password/route')
    const res = await POST(makeChangeReq({ currentPassword: 'correct!Pass1', newPassword: 'newpassword99!' }))
    expect(res.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — secret isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('password recovery — secret isolation', () => {
  it('forgot-password page does not contain service role key references', async () => {
    const fs = await import('fs/promises')
    const src = await fs.readFile('app/(auth)/forgot-password/page.tsx', 'utf8')
    expect(src).not.toContain('SERVICE_ROLE')
    expect(src).not.toContain('service_role')
    expect(src).not.toContain('SUPABASE_SERVICE_ROLE')
  })

  it('reset-password page does not contain service role key references', async () => {
    const fs = await import('fs/promises')
    const src = await fs.readFile('app/(auth)/reset-password/page.tsx', 'utf8')
    expect(src).not.toContain('SERVICE_ROLE')
    expect(src).not.toContain('service_role')
  })

  it('change-password route imports server-only', async () => {
    const fs = await import('fs/promises')
    const src = await fs.readFile('app/api/account/change-password/route.ts', 'utf8')
    expect(src).toContain("import 'server-only'")
  })
})
