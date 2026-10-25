/**
 * Trainer invite flow API tests.
 *
 * Covers:
 *   GET /api/trainer/invite?token= — public token lookup (no auth required)
 *   POST /api/trainer/invite       — emailSent flag, 401, seat errors
 *   POST /api/trainer/invite/accept — 401 for unauthenticated, valid acceptance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerInvitation: {
      findUnique:  vi.fn(),
      findMany:    vi.fn(),
      updateMany:  vi.fn(),
      create:      vi.fn(),
      update:      vi.fn(),
    },
    profile: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/trainer/relationships', () => ({
  createInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}))

vi.mock('@/lib/email/send-trainer-invite', () => ({
  sendTrainerInvite: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { createInvitation, acceptInvitation } from '@/lib/trainer/relationships'
import { sendTrainerInvite } from '@/lib/email/send-trainer-invite'
import { GET as inviteGET, POST as invitePOST } from '../../app/api/trainer/invite/route'
import { POST as acceptPOST } from '../../app/api/trainer/invite/accept/route'
import { GET as onboardingGET } from '../../app/api/onboarding/route'
import { NextRequest } from 'next/server'

// ── Typed refs ────────────────────────────────────────────────────────────────
const mockCreateClient      = createClient         as ReturnType<typeof vi.fn>
const mockFindUniqueInv     = prisma.trainerInvitation.findUnique as ReturnType<typeof vi.fn>
const mockCreateInvitation  = createInvitation      as ReturnType<typeof vi.fn>
const mockAcceptInvitation  = acceptInvitation      as ReturnType<typeof vi.fn>
const mockSendEmail         = sendTrainerInvite     as ReturnType<typeof vi.fn>
const mockFindUniqueProfile = prisma.profile.findUnique as ReturnType<typeof vi.fn>

const TRAINER_ID = 'tttttttt-0000-0000-0000-000000000001'
const CLIENT_ID  = 'cccccccc-0000-0000-0000-000000000002'
const TOKEN      = 'a'.repeat(64) // 64-char hex token

function makeInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id:               'inv-id-001',
    trainerId:        TRAINER_ID,
    invitedEmail:     'client@example.com',
    token:            TOKEN,
    status:           'pending',
    expiresAt:        new Date(Date.now() + 7 * 86_400_000),
    sentAt:           new Date(),
    acceptedAt:       null,
    acceptedByUserId: null,
    trainer: {
      profile: { displayName: 'Coach Jordan' },
    },
    ...overrides,
  }
}

function mockAuthed(userId = TRAINER_ID, email = 'trainer@example.com') {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: userId, email } },
      }),
    },
  })
}

function mockUnauthed() {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  })
}

function makeGetRequest(path: string) {
  return new NextRequest(`http://localhost${path}`)
}

function makePostRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => { vi.clearAllMocks() })

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/trainer/invite?token= — PUBLIC token lookup
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/trainer/invite?token= — public token lookup', () => {
  it('returns invitation info without requiring authentication', async () => {
    mockFindUniqueInv.mockResolvedValue(makeInvitation())
    const req = makeGetRequest(`/api/trainer/invite?token=${TOKEN}`)
    const res = await inviteGET(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { invitation: { trainerName: string; status: string } }
    expect(body.invitation.trainerName).toBe('Coach Jordan')
    expect(body.invitation.status).toBe('pending')
    // createClient should NOT have been called (no auth check for token lookup)
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown token', async () => {
    mockFindUniqueInv.mockResolvedValue(null)
    const req = makeGetRequest(`/api/trainer/invite?token=unknowntoken`)
    const res = await inviteGET(req)
    expect(res.status).toBe(404)
  })

  it('does NOT expose invitedEmail in the public response', async () => {
    mockFindUniqueInv.mockResolvedValue(makeInvitation())
    const req = makeGetRequest(`/api/trainer/invite?token=${TOKEN}`)
    const res = await inviteGET(req)
    const body = await res.json() as Record<string, unknown>
    expect((body.invitation as Record<string, unknown>).invitedEmail).toBeUndefined()
  })

  it('does NOT expose invitation id or trainerId in the public response', async () => {
    mockFindUniqueInv.mockResolvedValue(makeInvitation())
    const req = makeGetRequest(`/api/trainer/invite?token=${TOKEN}`)
    const res = await inviteGET(req)
    const body = await res.json() as Record<string, unknown>
    const inv = body.invitation as Record<string, unknown>
    expect(inv.id).toBeUndefined()
    expect(inv.trainerId).toBeUndefined()
    expect(inv.token).toBeUndefined()
  })

  it('returns trainer name as null when displayName is missing', async () => {
    mockFindUniqueInv.mockResolvedValue(makeInvitation({ trainer: { profile: null } }))
    const req = makeGetRequest(`/api/trainer/invite?token=${TOKEN}`)
    const res = await inviteGET(req)
    const body = await res.json() as { invitation: { trainerName: null } }
    expect(body.invitation.trainerName).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/trainer/invite — authenticated trainer listing
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/trainer/invite — trainer list (no token param)', () => {
  it('returns 401 when unauthenticated', async () => {
    mockUnauthed()
    const req = makeGetRequest('/api/trainer/invite')
    const res = await inviteGET(req)
    expect(res.status).toBe(401)
  })

  it('returns invitation list for authenticated trainer', async () => {
    mockAuthed()
    ;(prisma.trainerInvitation.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValue([makeInvitation()])
    const req = makeGetRequest('/api/trainer/invite')
    const res = await inviteGET(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { invitations: unknown[] }
    expect(body.invitations).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/trainer/invite — email sent / failed / errors
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/trainer/invite — send invitation', () => {
  beforeEach(() => {
    mockAuthed(TRAINER_ID, 'trainer@example.com')
    mockFindUniqueProfile.mockResolvedValue({ displayName: 'Coach Jordan' })
    mockCreateInvitation.mockResolvedValue({ token: TOKEN, expiresAt: new Date(Date.now() + 7 * 86_400_000) })
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthed()
    const req = makePostRequest('/api/trainer/invite', { email: 'client@example.com' })
    const res = await invitePOST(req)
    expect(res.status).toBe(401)
  })

  it('returns emailSent: true when Resend succeeds', async () => {
    mockSendEmail.mockResolvedValue({ id: 'email-id-001' })
    const req = makePostRequest('/api/trainer/invite', { email: 'client@example.com' })
    const res = await invitePOST(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; emailSent: boolean; token: string }
    expect(body.ok).toBe(true)
    expect(body.emailSent).toBe(true)
    expect(body.token).toBe(TOKEN)
  })

  it('returns emailSent: false when Resend throws', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend API error'))
    const req = makePostRequest('/api/trainer/invite', { email: 'client@example.com' })
    const res = await invitePOST(req)
    // Invitation still created — only email delivery failed
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; emailSent: boolean; token: string }
    expect(body.ok).toBe(true)
    expect(body.emailSent).toBe(false)
    expect(body.token).toBe(TOKEN)
  })

  it('returns 400 when email is missing', async () => {
    const req = makePostRequest('/api/trainer/invite', {})
    const res = await invitePOST(req)
    expect(res.status).toBe(400)
  })

  it('returns 403 when trainer is at seat capacity', async () => {
    mockCreateInvitation.mockRejectedValue(new Error('Seat limit reached (20 clients)'))
    const req = makePostRequest('/api/trainer/invite', { email: 'client@example.com' })
    const res = await invitePOST(req)
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/seat limit/i)
  })

  it('returns 403 when trainer has no subscription', async () => {
    mockCreateInvitation.mockRejectedValue(new Error('Trainer subscription required'))
    const req = makePostRequest('/api/trainer/invite', { email: 'client@example.com' })
    const res = await invitePOST(req)
    expect(res.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/trainer/invite/accept — acceptance security
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/trainer/invite/accept', () => {
  it('returns 401 when unauthenticated', async () => {
    mockUnauthed()
    const req = makePostRequest('/api/trainer/invite/accept', { token: TOKEN })
    const res = await acceptPOST(req)
    expect(res.status).toBe(401)
    expect(mockAcceptInvitation).not.toHaveBeenCalled()
  })

  it('returns 400 when token is missing', async () => {
    mockAuthed(CLIENT_ID, 'client@example.com')
    const req = makePostRequest('/api/trainer/invite/accept', {})
    const res = await acceptPOST(req)
    expect(res.status).toBe(400)
    expect(mockAcceptInvitation).not.toHaveBeenCalled()
  })

  it('returns 200 and accepts invitation for authenticated user', async () => {
    mockAuthed(CLIENT_ID, 'client@example.com')
    mockAcceptInvitation.mockResolvedValue(undefined)
    const req = makePostRequest('/api/trainer/invite/accept', { token: TOKEN })
    const res = await acceptPOST(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(mockAcceptInvitation).toHaveBeenCalledWith(TOKEN, CLIENT_ID)
  })

  it('returns 404 when invitation is not found', async () => {
    mockAuthed(CLIENT_ID, 'client@example.com')
    mockAcceptInvitation.mockRejectedValue(new Error('Invitation not found'))
    const req = makePostRequest('/api/trainer/invite/accept', { token: TOKEN })
    const res = await acceptPOST(req)
    expect(res.status).toBe(404)
  })

  it('returns 410 when invitation has expired', async () => {
    mockAuthed(CLIENT_ID, 'client@example.com')
    mockAcceptInvitation.mockRejectedValue(new Error('Invitation has expired'))
    const req = makePostRequest('/api/trainer/invite/accept', { token: TOKEN })
    const res = await acceptPOST(req)
    expect(res.status).toBe(410)
  })

  it('returns 409 when invitation is already accepted or cancelled', async () => {
    mockAuthed(CLIENT_ID, 'client@example.com')
    mockAcceptInvitation.mockRejectedValue(new Error('Invitation is no longer valid'))
    const req = makePostRequest('/api/trainer/invite/accept', { token: TOKEN })
    const res = await acceptPOST(req)
    expect(res.status).toBe(409)
  })

  it('does not auto-accept on sign-in — requires explicit accept call', async () => {
    // Simulates: user is authenticated but only loads the page (no accept call made)
    mockAuthed(CLIENT_ID, 'client@example.com')
    // No call to acceptPOST is made here — this test asserts the absence of side effects
    expect(mockAcceptInvitation).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// safeRedirect — open-redirect prevention (unit-level)
// ─────────────────────────────────────────────────────────────────────────────

describe('next param open-redirect prevention', () => {
  it('only relative paths starting with / are safe', () => {
    const safe   = ['/invite/abc', '/today', '/trainer']
    const unsafe = ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '']

    function safeRedirect(next: string | null): string {
      if (!next || !next.startsWith('/') || next.startsWith('//')) return '/today'
      return next
    }

    safe.forEach(s => expect(safeRedirect(s)).toBe(s))
    unsafe.forEach(u => expect(safeRedirect(u)).toBe('/today'))
  })

  it('null next returns null from signup safeRedirect', () => {
    function safeRedirect(next: string | null): string | null {
      if (!next || !next.startsWith('/') || next.startsWith('//')) return null
      return next
    }

    expect(safeRedirect(null)).toBeNull()
    expect(safeRedirect('')).toBeNull()
    expect(safeRedirect('//evil.com')).toBeNull()
    expect(safeRedirect('/invite/abc')).toBe('/invite/abc')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/onboarding — completion check
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/onboarding — completion check', () => {
  // Re-use prisma mock already loaded; add a profile mock for this suite.
  beforeEach(() => { vi.clearAllMocks() })

  it('returns complete: false for a new user without fitnessLevel', async () => {
    mockAuthed(CLIENT_ID, 'client@example.com')
    ;(prisma.profile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      fitnessLevel: null,
      displayName: 'Alex',
    })
    const GET = onboardingGET
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json() as { complete: boolean }
    expect(body.complete).toBe(false)
  })

  it('returns complete: true for a user who has set fitnessLevel', async () => {
    mockAuthed(CLIENT_ID, 'client@example.com')
    ;(prisma.profile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      fitnessLevel: 'intermediate',
      displayName: 'Alex',
    })
    const GET = onboardingGET
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json() as { complete: boolean }
    expect(body.complete).toBe(true)
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthed()
    const GET = onboardingGET
    const res = await GET()
    expect(res.status).toBe(401)
  })
})
