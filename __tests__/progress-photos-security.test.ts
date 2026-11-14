/**
 * Security tests for the progress photos API.
 *
 * Covers:
 *  1. GET generates fresh signed URLs from storageKey (not stored url column)
 *  2. Signed URL TTL is 1 hour (not 1 year)
 *  3. POST uses 1-hour TTL
 *  4. Unauthenticated requests are rejected
 *  5. User can only see their own photos (ownership filter)
 *  6. createSignedUrls partial failure — missing URL returns empty string
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => mockGetUser(),
}))

// ── Subscription entitlement mock ─────────────────────────────────────────────

vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn().mockResolvedValue({ isPlus: false }),
}))

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockFindMany  = vi.fn()
const mockCount     = vi.fn()
const mockCreate    = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    progressPhoto: {
      findMany:  (...args: unknown[]) => mockFindMany(...args),
      count:     (...args: unknown[]) => mockCount(...args),
      create:    (...args: unknown[]) => mockCreate(...args),
    },
  },
}))

// ── Supabase admin mock ───────────────────────────────────────────────────────

const mockCreateSignedUrls = vi.fn()
const mockCreateSignedUrl  = vi.fn()
const mockUpload           = vi.fn()
const mockCreateBucket     = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      createBucket: (...args: unknown[]) => mockCreateBucket(...args),
      from: () => ({
        createSignedUrls: (...args: unknown[]) => mockCreateSignedUrls(...args),
        createSignedUrl:  (...args: unknown[]) => mockCreateSignedUrl(...args),
        upload:           (...args: unknown[]) => mockUpload(...args),
      }),
    },
  }),
}))

import { GET, POST } from '@/app/api/profile/progress-photos/route'

const FAKE_USER = { id: 'user-aaa' }

// ─────────────────────────────────────────────────────────────────────────────
// 1. Auth guard
// ─────────────────────────────────────────────────────────────────────────────

describe('progress-photos GET — auth guard', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Signed URL generation on GET
// ─────────────────────────────────────────────────────────────────────────────

describe('progress-photos GET — signed URL generation', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue(FAKE_USER)
    mockFindMany.mockResolvedValue([
      { id: 'photo-1', storageKey: 'user-aaa/1000.jpg', note: null, takenAt: new Date('2026-01-01') },
      { id: 'photo-2', storageKey: 'user-aaa/2000.jpg', note: 'Week 2', takenAt: new Date('2026-01-08') },
    ])
    mockCreateSignedUrls.mockResolvedValue({
      data: [
        { path: 'user-aaa/1000.jpg', signedUrl: 'https://supabase.co/signed/url-1?token=abc' },
        { path: 'user-aaa/2000.jpg', signedUrl: 'https://supabase.co/signed/url-2?token=def' },
      ],
      error: null,
    })
  })
  afterEach(() => vi.clearAllMocks())

  it('calls createSignedUrls with the storage keys', async () => {
    await GET()
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(
      ['user-aaa/1000.jpg', 'user-aaa/2000.jpg'],
      expect.any(Number)
    )
  })

  it('TTL passed to createSignedUrls is 3600 seconds (1 hour)', async () => {
    await GET()
    const [, ttl] = mockCreateSignedUrls.mock.calls[0]
    expect(ttl).toBe(3600)
  })

  it('returns fresh signed URLs in the response body', async () => {
    const res = await GET()
    const body = await res.json() as { photos: Array<{ id: string; url: string }> }
    expect(body.photos[0].url).toContain('token=abc')
    expect(body.photos[1].url).toContain('token=def')
  })

  it('prisma query selects storageKey not url', async () => {
    await GET()
    const [queryArg] = mockFindMany.mock.calls[0]
    expect(queryArg.select).toHaveProperty('storageKey')
    expect(queryArg.select).not.toHaveProperty('url')
  })

  it('filters photos by authenticated user id', async () => {
    await GET()
    const [queryArg] = mockFindMany.mock.calls[0]
    expect(queryArg.where).toEqual({ userId: FAKE_USER.id })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Partial signed URL failure
// ─────────────────────────────────────────────────────────────────────────────

describe('progress-photos GET — partial signed URL failure', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue(FAKE_USER)
    mockFindMany.mockResolvedValue([
      { id: 'photo-1', storageKey: 'user-aaa/1000.jpg', note: null, takenAt: new Date() },
    ])
    // createSignedUrls returns null data (storage error)
    mockCreateSignedUrls.mockResolvedValue({ data: null, error: { message: 'Storage error' } })
  })
  afterEach(() => vi.clearAllMocks())

  it('returns empty string url when signed URL generation fails', async () => {
    const res = await GET()
    const body = await res.json() as { photos: Array<{ url: string }> }
    expect(body.photos[0].url).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST TTL
// ─────────────────────────────────────────────────────────────────────────────

describe('progress-photos POST — signed URL TTL', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue(FAKE_USER)
    mockCount.mockResolvedValue(0)
    mockCreateBucket.mockResolvedValue({ error: null })
    mockUpload.mockResolvedValue({ error: null })
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://supabase.co/signed/upload-url?token=xyz' },
      error: null,
    })
    mockCreate.mockResolvedValue({
      id: 'photo-new',
      url: 'https://supabase.co/signed/upload-url?token=xyz',
      note: null,
      takenAt: new Date(),
    })
  })
  afterEach(() => vi.clearAllMocks())

  it('uses a 1-hour TTL for the upload signed URL', async () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
    const form = new FormData()
    form.append('file', file)
    const req = new Request('https://www.involvedfit.com/api/profile/progress-photos', {
      method: 'POST',
      body: form,
    })
    // Cast to NextRequest — the route handler uses formData() which works on standard Request
    const { NextRequest } = await import('next/server')
    const nextReq = new NextRequest(req)
    await POST(nextReq)
    const [, ttl] = mockCreateSignedUrl.mock.calls[0]
    expect(ttl).toBe(3600)
  })
})
