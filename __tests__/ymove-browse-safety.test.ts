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
