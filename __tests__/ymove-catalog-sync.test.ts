/**
 * Tests for:
 *   lib/ymove/namespace.ts          — ymv: UUID namespace
 *   lib/ymove/catalog-sync.ts       — catalog sync service
 *   app/api/admin/ymove-catalog/sync/route.ts — admin POST trigger
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

// ── Prisma mock ────────────────────────────────────────────────────────────────
// vi.mock is hoisted — define shared state with vi.hoisted.

const { mockUpsert, mockPrisma } = vi.hoisted(() => {
  const mockUpsert = vi.fn().mockResolvedValue({})
  const mockPrisma = {
    ymoveExerciseCatalog: {
      upsert: mockUpsert,
    },
  }
  return { mockUpsert, mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// ── YMove client mock (isTrustedThumbnailUrl is real, not mocked) ─────────────

vi.mock('@/lib/ymove/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ymove/client')>()
  return { ...real }
})

// ── Supabase / admin auth mocks ───────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockIsAdmin = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ getUser: (...a: unknown[]) => mockGetUser(...a) }))
vi.mock('@/lib/admin/auth',      () => ({ isAdmin: (...a: unknown[]) => mockIsAdmin(...a) }))

// ── Global fetch mock ─────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { parseYmvId, formatYmvId, isYmvId }   from '@/lib/ymove/namespace'
import { syncYmoveCatalog }                     from '@/lib/ymove/catalog-sync'
import { POST }                                  from '@/app/api/admin/ymove-catalog/sync/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const YMOVE_UUID = '65e95132-e6bb-41e8-af7d-0eda931a1693'
const MEDIA_UUID = '99ec8b20-8150-4d36-a043-69d008627604'
const THUMB_URL  = `https://exercise-api.ymove.app/api/v2/thumbnail/${MEDIA_UUID}?crop=default`

function makeExercise(overrides: Record<string, unknown> = {}) {
  return {
    id:              YMOVE_UUID,
    title:           'Barbell Back Squat',
    slug:            'barbell-back-squat-abc123',
    description:     'A compound lower body exercise.',
    muscleGroup:     'quadriceps',
    muscleGroups:    ['quadriceps', 'glutes', 'hamstrings'],
    secondaryMuscles: ['core', 'calves'],
    equipment:       'barbell',
    category:        'strength',
    difficulty:      'intermediate',
    hasVideo:        true,
    exerciseType:    ['strength', 'compound'],
    thumbnailUrl:    THUMB_URL,
    thumbnails:      { default: THUMB_URL, square: THUMB_URL },
    ...overrides,
  }
}

function makePage(exercises: unknown[], total = 2, page = 1, totalPages = 1) {
  return {
    status: 200,
    ok: true,
    json: () => Promise.resolve({
      data:       exercises,
      pagination: { page, pageSize: 50, total, totalPages },
    }),
    headers: new Headers(),
  }
}

function makeRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/admin/ymove-catalog/sync', {
    method: 'POST',
    body:   JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  process.env.YMOVE_API_KEY = 'test-key'
  mockGetUser.mockResolvedValue({ id: 'admin-user-id' })
  mockIsAdmin.mockReturnValue(true)
  mockFetch.mockResolvedValue(makePage([makeExercise()]))
})

// ═════════════════════════════════════════════════════════════════════════════
// ymv: NAMESPACE
// ═════════════════════════════════════════════════════════════════════════════

describe('parseYmvId', () => {
  it('returns the bare UUID for a valid ymv:-prefixed ID', () => {
    expect(parseYmvId(`ymv:${YMOVE_UUID}`)).toBe(YMOVE_UUID)
  })

  it('returns null for a bare UUID without the ymv: prefix', () => {
    expect(parseYmvId(YMOVE_UUID)).toBeNull()
  })

  it('returns null for a ymv: prefix followed by an invalid UUID', () => {
    expect(parseYmvId('ymv:not-a-uuid')).toBeNull()
    expect(parseYmvId('ymv:65e95132-e6bb-41e8-af7d')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseYmvId('')).toBeNull()
  })

  it('returns null for ExerciseDB numeric IDs', () => {
    expect(parseYmvId('0025')).toBeNull()
    expect(parseYmvId('ymv:0025')).toBeNull()
  })

  it('is case-insensitive for the UUID hex digits', () => {
    const upper = YMOVE_UUID.toUpperCase()
    expect(parseYmvId(`ymv:${upper}`)).toBe(upper)
  })
})

describe('formatYmvId', () => {
  it('wraps a bare UUID in the ymv: namespace', () => {
    expect(formatYmvId(YMOVE_UUID)).toBe(`ymv:${YMOVE_UUID}`)
  })

  it('round-trips with parseYmvId for valid UUIDs', () => {
    expect(parseYmvId(formatYmvId(YMOVE_UUID))).toBe(YMOVE_UUID)
  })
})

describe('isYmvId', () => {
  it('returns true for valid ymv:-prefixed IDs', () => {
    expect(isYmvId(`ymv:${YMOVE_UUID}`)).toBe(true)
  })

  it('returns false for bare UUIDs', () => {
    expect(isYmvId(YMOVE_UUID)).toBe(false)
  })

  it('returns false for ExerciseDB IDs', () => {
    expect(isYmvId('0025')).toBe(false)
  })

  it('returns false for ymv: with non-UUID payload', () => {
    expect(isYmvId('ymv:barbell-squat')).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// CATALOG SYNC
// ═════════════════════════════════════════════════════════════════════════════

describe('syncYmoveCatalog', () => {

  // ── Result shape ───────────────────────────────────────────────────────────

  it('returns the expected SyncResult fields', async () => {
    const result = await syncYmoveCatalog()

    expect(result).toMatchObject({
      total:      expect.any(Number),
      fetched:    expect.any(Number),
      unique:     expect.any(Number),
      skipped:    expect.any(Number),
      written:    expect.any(Number),
      pageErrors: expect.any(Number),
      pages:      expect.any(Number),
      isComplete: expect.any(Boolean),
      durationMs: expect.any(Number),
    })
  })

  it('reports isComplete:true when all API pages are fetched without errors', async () => {
    mockFetch
      .mockResolvedValueOnce(makePage([makeExercise()], 2, 1, 2))
      .mockResolvedValueOnce(makePage([makeExercise({ id: '99ec8b20-8150-4d36-a043-69d008627604', title: 'Curl' })], 2, 2, 2))

    const result = await syncYmoveCatalog()
    expect(result.isComplete).toBe(true)
  })

  it('reports isComplete:false when maxPages is less than totalApiPages', async () => {
    // API reports 5 pages but maxPages=1
    mockFetch.mockResolvedValue(makePage([makeExercise()], 250, 1, 5))

    const result = await syncYmoveCatalog({ maxPages: 1 })
    expect(result.isComplete).toBe(false)
    expect(result.pages).toBe(1)
  })

  it('reports isComplete:false when a page error occurred', async () => {
    mockFetch
      .mockResolvedValueOnce(makePage([makeExercise()], 2, 1, 2))
      .mockRejectedValue(new Error('network'))

    const result = await syncYmoveCatalog()
    expect(result.isComplete).toBe(false)
    expect(result.pageErrors).toBe(1)
  })

  // ── Pagination ─────────────────────────────────────────────────────────────

  it('reads total and totalPages from page 1 pagination', async () => {
    mockFetch.mockResolvedValueOnce(makePage([makeExercise()], 42, 1, 1))

    const result = await syncYmoveCatalog()
    expect(result.total).toBe(42)
  })

  it('fetches multiple pages until totalApiPages is exhausted', async () => {
    const ex2 = makeExercise({ id: '99ec8b20-8150-4d36-a043-69d008627604', title: 'Curl' })

    mockFetch
      .mockResolvedValueOnce(makePage([makeExercise()], 2, 1, 2))
      .mockResolvedValueOnce(makePage([ex2], 2, 2, 2))

    const result = await syncYmoveCatalog()

    expect(result.pages).toBe(2)
    expect(result.fetched).toBe(2)
    expect(result.unique).toBe(2)
    expect(result.written).toBe(2)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('stops at maxPages even when more API pages exist', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()], 5000, 1, 100))

    const result = await syncYmoveCatalog({ maxPages: 1 })

    expect(result.pages).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('always passes includeVideos=false (no cap charge)', async () => {
    mockFetch
      .mockResolvedValueOnce(makePage([makeExercise()], 2, 1, 2))
      .mockResolvedValueOnce(makePage([makeExercise({ id: '99ec8b20-8150-4d36-a043-69d008627604' })], 2, 2, 2))

    await syncYmoveCatalog()

    for (const call of mockFetch.mock.calls) {
      expect(call[0]).toContain('includeVideos=false')
      expect(call[0]).not.toContain('includeVideos=true')
    }
  })

  // ── Counts ─────────────────────────────────────────────────────────────────

  it('counts skipped exercises with malformed IDs separately', async () => {
    mockFetch.mockResolvedValue(makePage([
      makeExercise({ id: 'not-a-uuid' }),    // skipped
      makeExercise({ id: '' }),              // skipped
      makeExercise({ id: null }),            // skipped
      makeExercise(),                        // written
    ]))

    const result = await syncYmoveCatalog()

    expect(result.fetched).toBe(4)
    expect(result.unique).toBe(1)
    expect(result.skipped).toBe(3)
    expect(result.written).toBe(1)
  })

  it('counts cross-page duplicate IDs as skipped, not written', async () => {
    // Both pages return the same UUID — the duplicate should be skipped.
    mockFetch
      .mockResolvedValueOnce(makePage([makeExercise()], 2, 1, 2))
      .mockResolvedValueOnce(makePage([makeExercise()], 2, 2, 2))  // same id

    const result = await syncYmoveCatalog()

    expect(result.fetched).toBe(2)
    expect(result.unique).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.written).toBe(1)
  })

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('uses upsert so re-running sync is safe', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()]))

    await syncYmoveCatalog()
    await syncYmoveCatalog()

    expect(mockUpsert).toHaveBeenCalledTimes(2)
    const [firstArgs, secondArgs] = mockUpsert.mock.calls
    expect(firstArgs[0].where).toEqual(secondArgs[0].where)
  })

  // ── Concurrent sync guard ──────────────────────────────────────────────────

  it('throws if a sync is already in progress', async () => {
    // Start one sync — keep it hung by never resolving fetch
    let resolveFirst!: () => void
    const hangFetch = new Promise<typeof makePage extends (...a: infer A) => infer R ? R : never>(
      resolve => { resolveFirst = () => resolve(makePage([makeExercise()])) }
    )
    mockFetch.mockReturnValueOnce(hangFetch)

    const firstSync = syncYmoveCatalog()

    // Second sync should throw immediately
    await expect(syncYmoveCatalog()).rejects.toThrow(/already in progress/)

    // Let first sync complete
    resolveFirst()
    await firstSync
  })

  // ── Page-1 failure handling ────────────────────────────────────────────────

  it('aborts after page 1 failure instead of looping through maxPages', async () => {
    mockFetch.mockRejectedValue(new Error('network'))

    const result = await syncYmoveCatalog({ maxPages: 50 })

    // Should have tried page 1 three times (3 retries) then aborted — not 50 pages × 3
    expect(mockFetch).toHaveBeenCalledTimes(MAX_RETRIES_EXPECTED)
    expect(result.pageErrors).toBe(1)
    expect(result.pages).toBe(0)
    expect(result.isComplete).toBe(false)
  })

  // ── 429 retry ─────────────────────────────────────────────────────────────

  it('retries a page after a 429 response and eventually succeeds', async () => {
    const rate429 = {
      status: 429, ok: false,
      headers: new Headers({ 'Retry-After': '0' }),
      json: () => Promise.resolve({}),
    }

    mockFetch
      .mockResolvedValueOnce(rate429)
      .mockResolvedValueOnce(makePage([makeExercise()]))

    const result = await syncYmoveCatalog()

    expect(result.written).toBe(1)
    expect(result.pageErrors).toBe(0)
  })

  // ── Non-page-1 failure handling ────────────────────────────────────────────

  it('increments pageErrors and continues when a non-first page fails', async () => {
    mockFetch
      .mockResolvedValueOnce(makePage([makeExercise()], 2, 1, 2))
      .mockRejectedValue(new Error('network'))

    const result = await syncYmoveCatalog()

    expect(result.pageErrors).toBe(1)
    expect(result.written).toBe(1)    // page 1 still written
    expect(result.pages).toBe(1)
    expect(result.isComplete).toBe(false)
  })

  // ── Thumbnail media ID extraction ──────────────────────────────────────────

  it('extracts thumbnailMediaId from a trusted ymove.app thumbnail URL', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()]))

    await syncYmoveCatalog()

    const call = mockUpsert.mock.calls[0][0]
    expect(call.create.thumbnailMediaId).toBe(MEDIA_UUID)
    expect(call.update.thumbnailMediaId).toBe(MEDIA_UUID)
  })

  it('sets thumbnailMediaId to null for untrusted domains', async () => {
    const badThumb = `https://evil.com/thumbnail/${MEDIA_UUID}?crop=default`
    mockFetch.mockResolvedValue(makePage([makeExercise({
      thumbnailUrl: badThumb, thumbnails: { default: badThumb },
    })]))

    await syncYmoveCatalog()

    expect(mockUpsert.mock.calls[0][0].create.thumbnailMediaId).toBeNull()
  })

  it('sets thumbnailMediaId to null when path has no UUID segment', async () => {
    const badThumb = 'https://exercise-api.ymove.app/api/v2/thumbnail/not-a-uuid?crop=default'
    mockFetch.mockResolvedValue(makePage([makeExercise({
      thumbnailUrl: badThumb, thumbnails: { default: badThumb },
    })]))

    await syncYmoveCatalog()

    expect(mockUpsert.mock.calls[0][0].create.thumbnailMediaId).toBeNull()
  })

  it('never stores video playback URLs in any upsert field', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise({
      videoUrl:    'https://video.ymove.app/expiring-token.mp4',
      videoHlsUrl: 'https://video.ymove.app/expiring.m3u8',
    })]))

    await syncYmoveCatalog()

    const call = mockUpsert.mock.calls[0][0]
    expect(JSON.stringify(call.create)).not.toContain('videoUrl')
    expect(JSON.stringify(call.update)).not.toContain('videoUrl')
  })

  // ── Dry run ────────────────────────────────────────────────────────────────

  it('dryRun=true fetches all pages but skips DB writes', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()]))

    const result = await syncYmoveCatalog({ dryRun: true })

    expect(result.fetched).toBe(1)
    expect(result.unique).toBe(1)
    expect(result.written).toBe(0)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('dryRun counts unique and skipped without writing', async () => {
    mockFetch.mockResolvedValue(makePage([
      makeExercise({ id: 'not-a-uuid' }),
      makeExercise(),
    ]))

    const result = await syncYmoveCatalog({ dryRun: true })

    expect(result.fetched).toBe(2)
    expect(result.unique).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.written).toBe(0)
  })

  // ── API key security ───────────────────────────────────────────────────────

  it('sends X-API-Key header on every fetch call', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()]))

    await syncYmoveCatalog()

    const opts = mockFetch.mock.calls[0][1] as RequestInit
    expect((opts.headers as Record<string, string>)['X-API-Key']).toBe('test-key')
  })

  it('only touches ymoveExerciseCatalog model — no writes to other tables', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()]))

    await syncYmoveCatalog()

    expect(mockUpsert).toHaveBeenCalled()
    expect(Object.keys(mockPrisma)).toEqual(['ymoveExerciseCatalog'])
  })

})

// Helper accessed inside the test
const MAX_RETRIES_EXPECTED = 3

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINT
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/ymove-catalog/sync', () => {

  it('returns 403 when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValue(null)
    expect((await POST(makeRequest())).status).toBe(403)
  })

  it('returns 403 when the authenticated user is not an admin', async () => {
    mockGetUser.mockResolvedValue({ id: 'regular-user' })
    mockIsAdmin.mockReturnValue(false)
    expect((await POST(makeRequest())).status).toBe(403)
  })

  it('returns ok:true with full SyncResult fields when called by an admin', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()]))

    const res  = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(typeof body.total).toBe('number')
    expect(typeof body.fetched).toBe('number')
    expect(typeof body.unique).toBe('number')
    expect(typeof body.skipped).toBe('number')
    expect(typeof body.written).toBe('number')
    expect(typeof body.pageErrors).toBe('number')
    expect(typeof body.isComplete).toBe('boolean')
    expect(typeof body.durationMs).toBe('number')
  })

  it('passes dryRun:true to syncYmoveCatalog and returns written:0', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()]))

    const body = await (await POST(makeRequest({ dryRun: true }))).json()

    expect(body.dryRun).toBe(true)
    expect(body.written).toBe(0)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('clamps maxPages to [1, 50] — value of 1 fetches exactly one page', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()], 250, 1, 5))

    const body = await (await POST(makeRequest({ maxPages: 1 }))).json()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(body.pages).toBe(1)
  })

  it('ignores non-numeric maxPages and uses default', async () => {
    mockFetch.mockResolvedValue(makePage([makeExercise()]))
    expect((await POST(makeRequest({ maxPages: 'all' }))).status).toBe(200)
  })

  it('returns 500 with an error message when YMOVE_API_KEY is missing', async () => {
    delete process.env.YMOVE_API_KEY

    const res  = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBeTruthy()
  })

})
