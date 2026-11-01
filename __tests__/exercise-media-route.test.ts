/**
 * Tests for app/api/training/exercises/[exerciseId]/media/route.ts
 * and lib/ymove/client.ts:isTrustedThumbnailUrl
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/ymove/mapping', () => ({
  getYmoveExerciseId: vi.fn(),
}))

vi.mock('@/lib/ymove/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ymove/client')>()
  return { ...real, getYmoveById: vi.fn() }
})

vi.mock('@/lib/exercises', () => ({
  getExerciseById: vi.fn(),
  getGifUrl: (id: string) => `/exercises/${id}.gif`,
}))

import { GET } from '@/app/api/training/exercises/[exerciseId]/media/route'
import { isTrustedThumbnailUrl, getYmoveById } from '@/lib/ymove/client'
import { getYmoveExerciseId } from '@/lib/ymove/mapping'
import { getExerciseById } from '@/lib/exercises'

const mockGetYmoveById       = vi.mocked(getYmoveById)
const mockGetYmoveExerciseId = vi.mocked(getYmoveExerciseId)
const mockGetExerciseById    = vi.mocked(getExerciseById)

// ── Fixtures — matching actual YMove API response shape ───────────────────────
//
// YMove thumbnail URLs are authenticated API URLs, not public CDN URLs:
//   https://exercise-api.ymove.app/api/v2/thumbnail/{mediaUUID}?crop={crop}
//
// The mediaUUID is different from the exercise UUID stored in the mapping.
// The client always routes through /api/ymove/thumbnail/:id (which adds the API key).

const EX_ID      = '0043'
const YMOVE_ID   = '65e95132-e6bb-41e8-af7d-0eda931a1693'  // exercise UUID (from mapping)
const MEDIA_UUID = '99ec8b20-8150-4d36-a043-69d008627604'  // media UUID (from API response)

// Realistic thumbnail URL format returned by the YMove API
const THUMB_BASE = `https://exercise-api.ymove.app/api/v2/thumbnail/${MEDIA_UUID}`

const MOCK_EXERCISE = {
  id: EX_ID, name: 'Barbell Back Squat',
  bodyPart: 'upper legs', equipment: 'barbell',
  target: 'quads', secondaryMuscles: [], instructions: [], description: '',
}

function makeYmoveMeta(overrides: Record<string, unknown> = {}) {
  return {
    ymoveId:      YMOVE_ID,
    thumbnailUrl: `${THUMB_BASE}?crop=default`,
    thumbnails: {
      default:   `${THUMB_BASE}?crop=default`,
      square:    `${THUMB_BASE}?crop=square`,
      portrait:  `${THUMB_BASE}?crop=portrait`,
      landscape: `${THUMB_BASE}?crop=landscape`,
    },
    ...overrides,
  }
}

function makeRequest(exerciseId: string, video = false) {
  const qs = video ? '?video=true' : ''
  return new NextRequest(`http://localhost/api/training/exercises/${exerciseId}/media${qs}`)
}

function makeParams(exerciseId: string) {
  return Promise.resolve({ exerciseId })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockGetExerciseById.mockReturnValue(MOCK_EXERCISE as ReturnType<typeof getExerciseById>)
  mockGetYmoveExerciseId.mockResolvedValue(null)
  mockGetYmoveById.mockResolvedValue(null)
})

// ── Basic validation ──────────────────────────────────────────────────────────

describe('GET /api/training/exercises/:id/media', () => {
  it('returns 404 for an unknown exercise ID', async () => {
    mockGetExerciseById.mockReturnValue(undefined as ReturnType<typeof getExerciseById>)
    const res = await GET(makeRequest('9999'), { params: makeParams('9999') })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns exercisedb source for an unmapped exercise (null mapping)', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(null)
    const res = await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.source).toBe('exercisedb')
    expect(body.fallbackGifUrl).toBe(`/exercises/${EX_ID}.gif`)
    expect(body.ymoveId).toBeUndefined()
    expect(body.thumbnailMediaId).toBeUndefined()
  })

  it('returns exercisedb source when exercise has not been checked yet (undefined mapping)', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(undefined)
    const res = await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    expect((await res.json()).source).toBe('exercisedb')
  })

  // ── Thumbnail mode (default — no ?video=true) ───────────────────────────────

  it('calls getYmoveById with includeVideo=false in thumbnail mode', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    mockGetYmoveById.mockResolvedValue(makeYmoveMeta())
    await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    expect(mockGetYmoveById).toHaveBeenCalledWith(YMOVE_ID, false)
    expect(mockGetYmoveById).not.toHaveBeenCalledWith(YMOVE_ID, true)
  })

  it('never calls getYmoveById with includeVideo=true in thumbnail mode (no video cap charge)', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    mockGetYmoveById.mockResolvedValue(makeYmoveMeta())
    await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    const videoCalls = mockGetYmoveById.mock.calls.filter(args => args[1] === true)
    expect(videoCalls).toHaveLength(0)
  })

  it('extracts the media UUID (thumbnailMediaId) from the YMove thumbnail URL', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    mockGetYmoveById.mockResolvedValue(makeYmoveMeta())
    const res = await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    const body = await res.json()
    expect(body.source).toBe('ymove')
    expect(body.ymoveId).toBe(YMOVE_ID)
    expect(body.thumbnailMediaId).toBe(MEDIA_UUID)
    expect(body.fallbackGifUrl).toBe(`/exercises/${EX_ID}.gif`)
    // thumbnails object is NOT returned — client routes through the proxy with thumbnailMediaId
    expect(body.thumbnails).toBeUndefined()
  })

  it('returns thumbnailMediaId: null when the thumbnail URL domain is untrusted', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    const untrustedThumb = `http://evil.com/thumbnail/${MEDIA_UUID}?crop=default`
    mockGetYmoveById.mockResolvedValue(makeYmoveMeta({
      thumbnailUrl: untrustedThumb,
      thumbnails: {
        default:   untrustedThumb,
        square:    untrustedThumb,
        portrait:  untrustedThumb,
        landscape: untrustedThumb,
      },
    }))
    const res = await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    const body = await res.json()
    // Falls back to GIF for thumbnail but still returns ymove source for video support
    expect(body.source).toBe('ymove')
    expect(body.thumbnailMediaId).toBeNull()
    expect(body.fallbackGifUrl).toBe(`/exercises/${EX_ID}.gif`)
  })

  it('returns thumbnailMediaId: null when the URL path segment is not a UUID', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    // URL on trusted domain but path ends in a non-UUID segment
    const nonUuidThumb = 'https://exercise-api.ymove.app/api/v2/thumbnail/not-a-uuid?crop=default'
    mockGetYmoveById.mockResolvedValue(makeYmoveMeta({
      thumbnailUrl: nonUuidThumb,
      thumbnails: { default: nonUuidThumb, square: nonUuidThumb, portrait: nonUuidThumb, landscape: nonUuidThumb },
    }))
    const res = await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    const body = await res.json()
    expect(body.thumbnailMediaId).toBeNull()
  })

  it('returns thumbnailMediaId: null when getYmoveById returns null (YMove API unavailable)', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    mockGetYmoveById.mockResolvedValue(null)
    const res = await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    const body = await res.json()
    expect(body.source).toBe('ymove')
    expect(body.ymoveId).toBe(YMOVE_ID)
    expect(body.thumbnailMediaId).toBeNull()
    expect(body.fallbackGifUrl).toBe(`/exercises/${EX_ID}.gif`)
  })

  // ── API key never exposed ───────────────────────────────────────────────────

  it('never includes the YMove API key in the response body', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    mockGetYmoveById.mockResolvedValue(makeYmoveMeta())
    const res = await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    const text = await res.text()
    expect(text).not.toContain('X-API-Key')
    expect(text).not.toContain('YMOVE_API_KEY')
  })

  it('returns the media UUID (thumbnailMediaId) but never the raw authenticated thumbnail URL', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    mockGetYmoveById.mockResolvedValue(makeYmoveMeta())
    const res = await GET(makeRequest(EX_ID), { params: makeParams(EX_ID) })
    const text = await res.text()
    // The raw API URL (which would fail without the API key) must not be in the response
    expect(text).not.toContain('exercise-api.ymove.app')
    // The media UUID alone (for proxy construction) is fine to return
    expect(text).toContain(MEDIA_UUID)
  })

  // ── Video mode ──────────────────────────────────────────────────────────────

  it('returns videoUrl and thumbnailMediaId in video mode when video is available', async () => {
    const videoUrl = 'https://video.ymove.app/0043.mp4'
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    mockGetYmoveById.mockResolvedValue(makeYmoveMeta({
      videoUrl,
      videoHlsUrl:       'https://video.ymove.app/0043.m3u8',
      videoDurationSecs: 15,
    }))
    const res = await GET(makeRequest(EX_ID, true), { params: makeParams(EX_ID) })
    const body = await res.json()
    expect(body.source).toBe('ymove')
    expect(body.videoUrl).toBe(videoUrl)
    expect(body.videoDurationSecs).toBe(15)
    expect(body.thumbnailMediaId).toBe(MEDIA_UUID)
    expect(mockGetYmoveById).toHaveBeenCalledWith(YMOVE_ID, true)
  })

  it('returns ymove source with thumbnailMediaId but no videoUrl when video is unavailable', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    mockGetYmoveById.mockResolvedValue(makeYmoveMeta({ videoUrl: undefined }))
    const res = await GET(makeRequest(EX_ID, true), { params: makeParams(EX_ID) })
    const body = await res.json()
    expect(body.source).toBe('ymove')
    expect(body.videoUrl).toBeUndefined()
    expect(body.thumbnailMediaId).toBe(MEDIA_UUID)
  })

  it('falls back to browse-mode thumbnailMediaId when video fetch throws (network error)', async () => {
    mockGetYmoveExerciseId.mockResolvedValue(YMOVE_ID)
    mockGetYmoveById
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(makeYmoveMeta())
    const res = await GET(makeRequest(EX_ID, true), { params: makeParams(EX_ID) })
    const body = await res.json()
    expect(body.source).toBe('ymove')
    expect(body.thumbnailMediaId).toBe(MEDIA_UUID)
    // First call: video mode (throws); second: browse-mode fallback
    expect(mockGetYmoveById).toHaveBeenCalledTimes(2)
    expect(mockGetYmoveById).toHaveBeenNthCalledWith(1, YMOVE_ID, true)
    expect(mockGetYmoveById).toHaveBeenNthCalledWith(2, YMOVE_ID, false)
  })
})

// ── isTrustedThumbnailUrl ─────────────────────────────────────────────────────

describe('isTrustedThumbnailUrl', () => {
  it('accepts HTTPS URLs on ymove.app subdomains (YMove-controlled)', () => {
    // exercise-api.ymove.app is where YMove serves thumbnail URLs
    expect(isTrustedThumbnailUrl(`https://exercise-api.ymove.app/api/v2/thumbnail/${MEDIA_UUID}?crop=default`)).toBe(true)
    expect(isTrustedThumbnailUrl('https://cdn.ymove.app/thumbnails/img.jpg')).toBe(true)
    expect(isTrustedThumbnailUrl('https://media.ymove.app/img.jpg')).toBe(true)
  })

  it('rejects bare apex ymove.app (no subdomain prefix)', () => {
    expect(isTrustedThumbnailUrl('https://ymove.app/thumb.jpg')).toBe(false)
  })

  it('rejects shared CDN domains (cloudfront.net, fastly.net, imgix.net) — not exclusively YMove-controlled', () => {
    // Any third-party CDN customer can serve from these domains
    expect(isTrustedThumbnailUrl('https://d1abc123xyz.cloudfront.net/thumb.jpg')).toBe(false)
    expect(isTrustedThumbnailUrl('https://ymove.global.ssl.fastly.net/thumb.jpg')).toBe(false)
    expect(isTrustedThumbnailUrl('https://ymove.imgix.net/thumb.jpg')).toBe(false)
  })

  it('rejects HTTP URLs regardless of host', () => {
    expect(isTrustedThumbnailUrl('http://cdn.ymove.app/thumb.jpg')).toBe(false)
  })

  it('rejects deceptive hostnames where ymove.app appears mid-string (not as TLD)', () => {
    // ymove.app must be the TLD of the hostname, not appear anywhere else
    expect(isTrustedThumbnailUrl('https://cdn.ymove.app.evil.com/thumb.jpg')).toBe(false)
    expect(isTrustedThumbnailUrl('https://cdn.ymove.evil.com/thumb.jpg')).toBe(false)
    expect(isTrustedThumbnailUrl('https://notymove.app/thumb.jpg')).toBe(false)
  })

  it('rejects data URIs', () => {
    expect(isTrustedThumbnailUrl('data:image/png;base64,abc123==')).toBe(false)
    expect(isTrustedThumbnailUrl('data:text/html,<script>xss()</script>')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isTrustedThumbnailUrl('')).toBe(false)
  })

  it('rejects localhost and loopback addresses', () => {
    expect(isTrustedThumbnailUrl('https://localhost/thumb.jpg')).toBe(false)
    expect(isTrustedThumbnailUrl('https://127.0.0.1/thumb.jpg')).toBe(false)
  })

  it('rejects non-URL strings', () => {
    expect(isTrustedThumbnailUrl('not-a-url')).toBe(false)
    expect(isTrustedThumbnailUrl('/relative/path.jpg')).toBe(false)
  })

  it('rejects javascript: URIs', () => {
    expect(isTrustedThumbnailUrl('javascript:alert(1)')).toBe(false)
  })
})
