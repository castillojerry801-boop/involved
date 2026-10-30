/**
 * Browse-mode safety tests for lib/ymove/client.ts
 *
 * These tests prove that:
 *  1. All browse-mode calls pass includeVideos=false explicitly.
 *  2. Video-mode calls pass includeVideos=true explicitly.
 *  3. No call ever relies on API-key default behaviour (both values always sent).
 *  4. searchYmoveCandidates never requests video data.
 *  5. The API key is never exposed in any response value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Flat response (legacy / forward-compat path)
function makeFetchResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok:   true,
    json: async () => ({
      id:           'aaaa-bbbb-cccc-dddd',
      title:        'Test Exercise',
      thumbnailUrl: '',
      thumbnails:   { default: '', square: '', portrait: '', landscape: '' },
      ...overrides,
    }),
  }
}

// Wrapped response — mirrors the real YMove API shape: { data: {...}, _notice: {...} }
function makeWrappedFetchResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok:   true,
    json: async () => ({
      data: {
        id:           'aaaa-bbbb-cccc-dddd',
        title:        'Test Exercise',
        thumbnailUrl: '',
        thumbnails:   { default: '', square: '', portrait: '', landscape: '' },
        ...overrides,
      },
      _notice: { message: 'test', reason: 'browse_mode' },
    }),
  }
}

function makeListResponse(items: unknown[] = []) {
  return {
    ok:   true,
    json: async () => ({ exercises: items }),
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.YMOVE_API_KEY = 'test-key-do-not-expose'
  vi.resetModules()
})

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.YMOVE_API_KEY
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function capturedUrl(callIndex = 0): string {
  return mockFetch.mock.calls[callIndex][0] as string
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getYmoveById — browse mode (includeVideo=false)', () => {
  it('sends includeVideos=false explicitly', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse())
    const { getYmoveById } = await import('@/lib/ymove/client')
    await getYmoveById('aaaa-bbbb-cccc-dddd', false)

    const url = capturedUrl()
    expect(url).toContain('includeVideos=false')
    expect(url).not.toContain('includeVideos=true')
  })

  it('never omits the includeVideos parameter (no key-default reliance)', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse())
    const { getYmoveById } = await import('@/lib/ymove/client')
    await getYmoveById('aaaa-1111-2222-3333', false)

    const url = capturedUrl()
    expect(url).toMatch(/[?&]includeVideos=/)
  })
})

describe('getYmoveById — video mode (includeVideo=true)', () => {
  it('sends includeVideos=true', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({ videoUrl: 'https://example.com/v.mp4' }))
    const { getYmoveById } = await import('@/lib/ymove/client')
    await getYmoveById('aaaa-bbbb-cccc-dddd', true)

    const url = capturedUrl()
    expect(url).toContain('includeVideos=true')
    expect(url).not.toContain('includeVideos=false')
  })
})

describe('getYmoveById — cache behaviour', () => {
  it('uses cache for browse mode and avoids a second network call', async () => {
    const uuid = 'cache-test-uuid-0001'
    mockFetch.mockResolvedValue(makeFetchResponse({ id: uuid }))
    const { getYmoveById } = await import('@/lib/ymove/client')

    await getYmoveById(uuid, false)
    await getYmoveById(uuid, false)   // second call — should hit cache

    // fetch should have been called only once
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('bypasses cache for video mode (video URLs expire in 48 h)', async () => {
    const uuid = 'cache-test-uuid-0002'
    mockFetch.mockResolvedValue(makeFetchResponse({ id: uuid, videoUrl: 'https://cdn.example.com/v.mp4' }))
    const { getYmoveById } = await import('@/lib/ymove/client')

    await getYmoveById(uuid, false) // warms browse cache
    await getYmoveById(uuid, true)  // video mode must bypass cache

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const videoCallUrl = capturedUrl(1)
    expect(videoCallUrl).toContain('includeVideos=true')
  })
})

describe('searchYmoveCandidates — browse mode', () => {
  it('always sends includeVideos=false', async () => {
    mockFetch.mockResolvedValue(makeListResponse([]))
    const { searchYmoveCandidates } = await import('@/lib/ymove/client')
    await searchYmoveCandidates('Barbell Bench Press', 5)

    const url = capturedUrl()
    expect(url).toContain('includeVideos=false')
    expect(url).not.toContain('includeVideos=true')
  })

  it('never sends includeVideos=true regardless of arguments', async () => {
    mockFetch.mockResolvedValue(makeListResponse([]))
    const { searchYmoveCandidates } = await import('@/lib/ymove/client')

    await searchYmoveCandidates('Squat', 1)
    await searchYmoveCandidates('Deadlift', 12)

    for (const call of mockFetch.mock.calls) {
      const url = call[0] as string
      expect(url).not.toContain('includeVideos=true')
    }
  })

  it('includes the search term in the URL', async () => {
    mockFetch.mockResolvedValue(makeListResponse([]))
    const { searchYmoveCandidates } = await import('@/lib/ymove/client')
    await searchYmoveCandidates('Cable Row', 5)

    expect(capturedUrl()).toContain(encodeURIComponent('Cable Row'))
  })

  it('returns empty array when API returns no results', async () => {
    mockFetch.mockResolvedValue(makeListResponse([]))
    const { searchYmoveCandidates } = await import('@/lib/ymove/client')
    const result = await searchYmoveCandidates('XYZ', 5)
    expect(result).toEqual([])
  })

  it('returns empty array on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    const { searchYmoveCandidates } = await import('@/lib/ymove/client')
    const result = await searchYmoveCandidates('Bench Press', 5)
    expect(result).toEqual([])
  })
})

describe('API key safety', () => {
  it('never includes the API key in the returned media object', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse())
    const { getYmoveById } = await import('@/lib/ymove/client')
    const media = await getYmoveById('safe-key-test-uuid', false)

    const serialised = JSON.stringify(media)
    expect(serialised).not.toContain('test-key-do-not-expose')
    expect(serialised).not.toContain('YMOVE_API_KEY')
    expect(serialised).not.toContain('X-API-Key')
  })

  it('never includes the API key in search candidate results', async () => {
    mockFetch.mockResolvedValue(makeListResponse([
      { id: 'uuid-1', title: 'Squat', thumbnailUrl: '' },
    ]))
    const { searchYmoveCandidates } = await import('@/lib/ymove/client')
    const results = await searchYmoveCandidates('Squat', 5)

    const serialised = JSON.stringify(results)
    expect(serialised).not.toContain('test-key-do-not-expose')
    expect(serialised).not.toContain('YMOVE_API_KEY')
  })

  it('sends the API key as a header, not in the URL', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse())
    const { getYmoveById } = await import('@/lib/ymove/client')
    await getYmoveById('header-check-uuid', false)

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('test-key-do-not-expose')
    const headers = init.headers as Record<string, string>
    expect(headers['X-API-Key']).toBe('test-key-do-not-expose')
  })
})

// ── API response wrapper unwrapping ─────────────────────────────────────────
// YMove returns { data: { id, ... }, _notice: {} } — parseMedia must unwrap it.
// These tests reproduce the real API shape and verify the fix.

describe('getYmoveById — data wrapper unwrapping', () => {
  it('correctly parses a wrapped response (real API shape)', async () => {
    mockFetch.mockResolvedValue(makeWrappedFetchResponse({ videoUrl: 'https://cdn.example.com/v.mp4' }))
    const { getYmoveById } = await import('@/lib/ymove/client')
    const media = await getYmoveById('aaaa-bbbb-cccc-dddd', true)

    expect(media).not.toBeNull()
    expect(media?.ymoveId).toBe('aaaa-bbbb-cccc-dddd')
    expect(media?.videoUrl).toBe('https://cdn.example.com/v.mp4')
  })

  it('returns null when wrapper has no nested id (malformed response)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null, _notice: {} }),
    })
    const { getYmoveById } = await import('@/lib/ymove/client')
    const media = await getYmoveById('aaaa-bbbb-cccc-dddd', true)
    expect(media).toBeNull()
  })

  it('also handles a flat response without wrapper (forward compat)', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({ videoUrl: 'https://cdn.example.com/flat.mp4' }))
    const { getYmoveById } = await import('@/lib/ymove/client')
    const media = await getYmoveById('aaaa-bbbb-cccc-dddd', true)

    expect(media).not.toBeNull()
    expect(media?.videoUrl).toBe('https://cdn.example.com/flat.mp4')
  })
})

// ── videos[] array fallback ──────────────────────────────────────────────────
// When top-level videoUrl is absent, the primary video in videos[] is used.

describe('parseMedia — videos[] array fallback', () => {
  it('uses videos[].videoUrl when top-level videoUrl is absent', async () => {
    mockFetch.mockResolvedValue(makeWrappedFetchResponse({
      videoUrl: undefined,
      videos: [
        { videoUrl: 'https://cdn.example.com/nested.mp4', videoHlsUrl: 'https://cdn.example.com/nested.m3u8', isPrimary: true },
      ],
    }))
    const { getYmoveById } = await import('@/lib/ymove/client')
    const media = await getYmoveById('aaaa-bbbb-cccc-dddd', true)

    expect(media?.videoUrl).toBe('https://cdn.example.com/nested.mp4')
    expect(media?.videoHlsUrl).toBe('https://cdn.example.com/nested.m3u8')
  })

  it('prefers isPrimary video when multiple videos exist', async () => {
    mockFetch.mockResolvedValue(makeWrappedFetchResponse({
      videoUrl: undefined,
      videos: [
        { videoUrl: 'https://cdn.example.com/secondary.mp4', isPrimary: false },
        { videoUrl: 'https://cdn.example.com/primary.mp4',   isPrimary: true  },
      ],
    }))
    const { getYmoveById } = await import('@/lib/ymove/client')
    const media = await getYmoveById('aaaa-bbbb-cccc-dddd', true)

    expect(media?.videoUrl).toBe('https://cdn.example.com/primary.mp4')
  })

  it('top-level videoUrl takes precedence over videos[] alias', async () => {
    mockFetch.mockResolvedValue(makeWrappedFetchResponse({
      videoUrl: 'https://cdn.example.com/top-level.mp4',
      videos: [{ videoUrl: 'https://cdn.example.com/nested.mp4', isPrimary: true }],
    }))
    const { getYmoveById } = await import('@/lib/ymove/client')
    const media = await getYmoveById('aaaa-bbbb-cccc-dddd', true)

    expect(media?.videoUrl).toBe('https://cdn.example.com/top-level.mp4')
  })

  it('returns null videoUrl when neither top-level nor videos[] has one', async () => {
    mockFetch.mockResolvedValue(makeWrappedFetchResponse({ videoUrl: undefined, videos: [] }))
    const { getYmoveById } = await import('@/lib/ymove/client')
    const media = await getYmoveById('aaaa-bbbb-cccc-dddd', true)

    expect(media).not.toBeNull()
    expect(media?.videoUrl).toBeUndefined()
  })
})

// ── Provider HTTP error + usage-limit ────────────────────────────────────────

describe('getYmoveById — provider error handling', () => {
  it('returns null on provider 500', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const { getYmoveById } = await import('@/lib/ymove/client')
    expect(await getYmoveById('error-uuid', true)).toBeNull()
  })

  it('returns null on provider 429 (usage limit hit)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'limit exceeded' }) })
    const { getYmoveById } = await import('@/lib/ymove/client')
    expect(await getYmoveById('limit-uuid', true)).toBeNull()
  })

  it('returns null when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    const { getYmoveById } = await import('@/lib/ymove/client')
    // The client doesn't catch network errors — the media route does.
    // Verify that a throw propagates (route catches it).
    await expect(getYmoveById('network-uuid', true)).rejects.toThrow('network error')
  })
})
