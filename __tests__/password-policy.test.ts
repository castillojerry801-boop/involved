/**
 * Tests for the shared password policy module and its enforcement across routes.
 *
 * Covers:
 *  1. validatePassword — min-length boundary (14 chars rejected, 15 accepted)
 *  2. validatePassword — passphrases and special characters accepted
 *  3. validatePassword — no complexity requirements (all-lowercase accepted)
 *  4. validatePassword — error message mentions the minimum length
 *  5. MIN_PASSWORD_LENGTH is 15
 *  6. signup route — rejects passwords below minimum (admin API would bypass Supabase policy)
 *  7. signup route — does not call admin.createUser when password is too short
 *  8. signup route — accepts minimum-length password (passes validation layer)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validatePassword, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — validatePassword pure function
// ─────────────────────────────────────────────────────────────────────────────

describe('validatePassword', () => {
  it('MIN_PASSWORD_LENGTH is 15', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(15)
  })

  it('accepts a password exactly at the minimum length', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull()
  })

  it('accepts a passphrase with spaces', () => {
    expect(validatePassword('correct horse battery staple')).toBeNull()
  })

  it('accepts a password with special characters', () => {
    expect(validatePassword('my-p@ssw0rd#2026!!')).toBeNull()
  })

  it('accepts a long password-manager-generated password', () => {
    expect(validatePassword('xK8#mP2$nQ7@wR5!vL3')).toBeNull()
  })

  it('accepts an all-lowercase password — no complexity requirement', () => {
    expect(validatePassword('correcthorsebatterystaple')).toBeNull()
  })

  it('accepts a password with only numbers and spaces', () => {
    expect(validatePassword('1234 5678 9012 345')).toBeNull()
  })

  it('rejects a password one character below the minimum', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull()
  })

  it('rejects an empty password', () => {
    expect(validatePassword('')).not.toBeNull()
  })

  it('error message mentions the minimum length', () => {
    const msg = validatePassword('tooshort')
    expect(msg).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('returns null (no error) for the exact boundary', () => {
    // 15 chars — exactly at limit, must pass
    expect(validatePassword('passphrase-here')).toBeNull()
  })

  it('returns a string error for 14 chars — one under the boundary', () => {
    // 14 chars — just under limit, must fail
    expect(typeof validatePassword('fourteenchars!')).toBe('string')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — signup route server-side enforcement
// The signup route uses admin.auth.admin.createUser() which bypasses Supabase's
// password policy. Length validation must be enforced explicitly in the route.
// ─────────────────────────────────────────────────────────────────────────────

const mockAdminCreateUser = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        createUser: (...args: unknown[]) => mockAdminCreateUser(...args),
      },
    },
  }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    profile: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

function makeSignupReq(body: object) {
  return new NextRequest('https://www.involvedfit.com/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('signup route — password length enforcement', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 400 for a password shorter than MIN_PASSWORD_LENGTH', async () => {
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(makeSignupReq({ email: 'a@b.com', password: '14charpasswrd!', name: 'Test' }))
    expect(res.status).toBe(400)
  })

  it('does not call admin.createUser when password is too short', async () => {
    const { POST } = await import('@/app/api/auth/signup/route')
    await POST(makeSignupReq({ email: 'a@b.com', password: '14charpasswrd!', name: 'Test' }))
    expect(mockAdminCreateUser).not.toHaveBeenCalled()
  })

  it('error body mentions the minimum length when password is too short', async () => {
    const { POST } = await import('@/app/api/auth/signup/route')
    const res = await POST(makeSignupReq({ email: 'a@b.com', password: 'short', name: 'Test' }))
    const body = await res.json() as { error: string }
    expect(body.error).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('passes the password-length guard for a minimum-length password', async () => {
    // A 15-char password clears the validation layer. createUser is then called.
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    })
    const { POST } = await import('@/app/api/auth/signup/route')
    await POST(makeSignupReq({ email: 'a@b.com', password: 'correctpassword', name: 'Test' }))
    expect(mockAdminCreateUser).toHaveBeenCalled()
  })
})
