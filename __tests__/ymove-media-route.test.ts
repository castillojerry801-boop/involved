import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

const _mockMapping: Record<string, string | null | undefined> = {}

vi.mock('@/lib/ymove/mapping', () => ({
  getYmoveExerciseId: (id: string) => {
    if (!(id in _mockMapping)) return Promise.resolve(undefined)
    return Promise.resolve(_mockMapping[id])
  },
}))

vi.mock('@/lib/exercises', () => ({
  getExerciseById: (id: string) =>
    id === '0026' ? { id: '0026', name: 'Barbell Bench Press' } : undefined,
  getGifUrl: (id: string) => `https://cdn.example.com/gifs/${id}.gif`,
}))

const mockGetYmoveById = vi.fn()

vi.mock('@/lib/ymove/client', () => ({
  getYmoveById: (...args: unknown[]) => mockGetYmoveById(...args),
}))

import { GET } from '@/app/api/training/exercises/[exerciseId]/media/route'
import { NextRequest } from 'next/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

const YMOVE_UUID = '65e95132-e6bb-41e8-af7d-0eda931a1693'

const MOCK_YMOVE_VIDEO = {
  ymoveId:           YMOVE_UUID,
  thumbnailUrl:      'https://ymove.example.com/thumb.jpg',
  thumbnails:        { default: '', square: '', portrait: '', landscape: '' },
  videoUrl:          'https://ymove.example.com/video.mp4',
  videoHlsUrl:       'https://ymove.example.com/video.m3u8',
  videoDurationSecs: 30,
}

function makeRequest(exerciseId: string, video = false) {
  const url = `http://localhost/api/training/exercises/${exerciseId}/media${video ? '?video=true' : ''}`
  return new NextRequest(url)
}

async function callRoute(exerciseId: string, video = false) {
  const res = await GET(makeRequest(exerciseId, video), {
    params: Promise.resolve({ exerciseId }),
  })
  return { status: res.status, body: await res.json() }
}

function setMapping(m: Record<string, string | null | undefined>) {
  Object.keys(_mockMapping).forEach(k => delete _mockMapping[k])
  Object.assign(_mockMapping, m)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/training/exercises/[exerciseId]/media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMapping({})
    mockGetYmoveById.mockResolvedValue(MOCK_YMOVE_VIDEO)
  })

  // ── Thumbnail mode (no ?video=true) ─────────────────────────────────────────

  it('thumbnail mode: mapped exercise returns source=ymove with ymoveId', async () => {
    setMapping({ '0026': YMOVE_UUID })
    const { body } = await callRoute('0026')
    expect(body.source).toBe('ymove')
    expect(body.ymoveId).toBe(YMOVE_UUID)
    expect(body.fallbackGifUrl).toContain('0026')
  })

  it('thumbnail mode: does NOT call getYmoveById (no cap charge, no API round-trip)', async () => {
    setMapping({ '0026': YMOVE_UUID })
    await callRoute('0026')
    expect(mockGetYmoveById).not.toHaveBeenCalled()
  })

  it('thumbnail mode: does not return videoUrl', async () => {
    setMapping({ '0026': YMOVE_UUID })
    const { body } = await callRoute('0026')
    expect(body.videoUrl).toBeUndefined()
  })

  it('thumbnail mode: unmapped exercise returns source=exercisedb', async () => {
    setMapping({})
    const { body } = await callRoute('0026')
    expect(body.source).toBe('exercisedb')
    expect(body.fallbackGifUrl).toContain('0026')
    expect(mockGetYmoveById).not.toHaveBeenCalled()
  })

  it('thumbnail mode: rejected exercise (null) returns source=exercisedb', async () => {
    setMapping({ '0026': null })
    const { body } = await callRoute('0026')
    expect(body.source).toBe('exercisedb')
    expect(mockGetYmoveById).not.toHaveBeenCalled()
  })

  it('thumbnail mode: unknown exercise returns 404', async () => {
    const { status } = await callRoute('9999')
    expect(status).toBe(404)
  })

  // ── Video mode (?video=true) ─────────────────────────────────────────────────

  it('video mode: calls getYmoveById with includeVideo=true', async () => {
    setMapping({ '0026': YMOVE_UUID })
    await callRoute('0026', true)
    expect(mockGetYmoveById).toHaveBeenCalledWith(YMOVE_UUID, true)
  })

  it('video mode: returns videoUrl and hlsUrl when available', async () => {
    setMapping({ '0026': YMOVE_UUID })
    const { body } = await callRoute('0026', true)
    expect(body.source).toBe('ymove')
    expect(body.videoUrl).toBe('https://ymove.example.com/video.mp4')
    expect(body.videoHlsUrl).toBe('https://ymove.example.com/video.m3u8')
    expect(body.videoDurationSecs).toBe(30)
  })

  it('video mode: getYmoveById throws → returns ymove source with ymoveId (thumbnail still works)', async () => {
    setMapping({ '0026': YMOVE_UUID })
    mockGetYmoveById.mockRejectedValue(new Error('ymove network error'))
    const { body } = await callRoute('0026', true)
    expect(body.source).toBe('ymove')
    expect(body.ymoveId).toBe(YMOVE_UUID)
    expect(body.videoUrl).toBeUndefined()
  })

  it('video mode: getYmoveById returns null → returns ymove source with ymoveId', async () => {
    setMapping({ '0026': YMOVE_UUID })
    mockGetYmoveById.mockResolvedValue(null)
    const { body } = await callRoute('0026', true)
    expect(body.source).toBe('ymove')
    expect(body.ymoveId).toBe(YMOVE_UUID)
    expect(body.videoUrl).toBeUndefined()
  })

  it('video mode: unmapped exercise returns source=exercisedb', async () => {
    setMapping({})
    const { body } = await callRoute('0026', true)
    expect(body.source).toBe('exercisedb')
    expect(mockGetYmoveById).not.toHaveBeenCalled()
  })
})

// ── ExerciseMedia play-button display contract ──────────────────────────────
// ExerciseMedia renders a Play overlay iff source==='ymove' && ymoveId is set.
// These tests verify the API response shape that drives that condition.

describe('ExerciseMedia play-button display contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMapping({})
    mockGetYmoveById.mockResolvedValue(MOCK_YMOVE_VIDEO)
  })

  it('mapped exercise: play button shown — source=ymove with ymoveId', async () => {
    setMapping({ '0026': YMOVE_UUID })
    const { body } = await callRoute('0026')
    // ExerciseMedia condition: source === 'ymove' && !!ymoveId → renders Play overlay
    expect(body.source).toBe('ymove')
    expect(body.ymoveId).toBeTruthy()
  })

  it('unmapped exercise: play button hidden — source=exercisedb, no ymoveId', async () => {
    const { body } = await callRoute('0026')
    // ExerciseMedia condition: source !== 'ymove' → no Play overlay, ExerciseDB GIF shown
    expect(body.source).toBe('exercisedb')
    expect(body.ymoveId).toBeUndefined()
  })

  it('rejected exercise: play button hidden — explicit null rejection', async () => {
    setMapping({ '0026': null })
    const { body } = await callRoute('0026')
    expect(body.source).toBe('exercisedb')
    expect(body.ymoveId).toBeUndefined()
  })

  it('play tap (video=true) returns videoUrl, thumbnail-only does not', async () => {
    setMapping({ '0026': YMOVE_UUID })
    const thumb = await callRoute('0026', false)
    expect(thumb.body.videoUrl).toBeUndefined()

    const video = await callRoute('0026', true)
    expect(video.body.videoUrl).toBe('https://ymove.example.com/video.mp4')
    // Confirms the cap is only charged on explicit play tap
    expect(mockGetYmoveById).toHaveBeenCalledTimes(1)
    expect(mockGetYmoveById).toHaveBeenCalledWith(YMOVE_UUID, true)
  })

  it('fallbackGifUrl always present so ExerciseMedia can fall back if thumbnail fails', async () => {
    setMapping({ '0026': YMOVE_UUID })
    const { body } = await callRoute('0026')
    expect(body.fallbackGifUrl).toMatch(/0026/)

    const { body: noMatch } = await callRoute('0026')
    expect(noMatch.fallbackGifUrl).toMatch(/0026/)
  })
})
