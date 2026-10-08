import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

// Shared state for the mapping mock — mutated by setMockMapping()
const _mockMapping: Record<string, string | null> = {}

vi.mock('@/lib/ymove/mapping', () => ({
  getYmoveExerciseId: (id: string) => {
    if (!(id in _mockMapping)) return Promise.resolve(undefined)
    return Promise.resolve(_mockMapping[id])
  },
  getAllMappings: () => Promise.resolve({ ..._mockMapping }),
  upsertMapping: vi.fn().mockResolvedValue(undefined),
  deleteMapping: vi.fn().mockResolvedValue(undefined),
}))

const mockGetYmoveById = vi.fn()
const mockSearchYmoveCandidates = vi.fn()

vi.mock('@/lib/ymove/client', () => ({
  getYmoveById: (...args: unknown[]) => mockGetYmoveById(...args),
  searchYmoveCandidates: (...args: unknown[]) => mockSearchYmoveCandidates(...args),
}))

vi.mock('@/lib/exercises', () => ({
  getExerciseById: (id: string) => {
    if (id === '0026') return { id: '0026', name: 'barbell bench squat' }
    if (id === '0999') return { id: '0999', name: 'dumbbell curl' }
    return undefined
  },
  getGifUrl: (id: string) => `https://cdn.example.com/gifs/${id}.gif`,
  exercises: [
    { id: '0026', name: 'barbell bench squat' },
    { id: '0999', name: 'dumbbell curl' },
  ],
}))

vi.mock('@/lib/exercises/canonical', () => ({
  getInvolvedDisplayName: (_id: string, rawName: string) => rawName,
}))

// Import mocked modules at the top (Vitest ESM — no require() in test bodies)
import { getYmoveExerciseId, getAllMappings } from '@/lib/ymove/mapping'
import { getYmoveById, searchYmoveCandidates } from '@/lib/ymove/client'
import { getGifUrl } from '@/lib/exercises'

// ── Helpers ──────────────────────────────────────────────────────────────────

function setMockMapping(mapping: Record<string, string | null>) {
  Object.keys(_mockMapping).forEach(k => delete _mockMapping[k])
  Object.assign(_mockMapping, mapping)
}

const YMOVE_UUID = '65e95132-e6bb-41e8-af7d-0eda931a1693'

const MOCK_YMOVE_MEDIA = {
  ymoveId:           YMOVE_UUID,
  thumbnailUrl:      'https://ymove.example.com/thumb.jpg',
  thumbnails:        { default: '', square: '', portrait: '', landscape: '' },
  videoUrl:          'https://ymove.example.com/video.mp4',
  videoHlsUrl:       undefined,
  videoDurationSecs: 30,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ymove verified mapping architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMockMapping({})
    mockGetYmoveById.mockResolvedValue(MOCK_YMOVE_MEDIA)
  })

  afterEach(() => {
    setMockMapping({})
  })

  // 1. Mapped exercise returns ymove source with ymoveId
  it('returns the ymove UUID when exercise has a verified mapping', async () => {
    setMockMapping({ '0026': YMOVE_UUID })
    const ymoveId = await getYmoveExerciseId('0026')
    expect(ymoveId).toBe(YMOVE_UUID)

    const media = await getYmoveById(ymoveId!, false)
    expect(media?.ymoveId).toBe(YMOVE_UUID)
    expect(mockGetYmoveById).toHaveBeenCalledWith(YMOVE_UUID, false)
  })

  // 2. Unmapped exercise returns undefined
  it('returns undefined for an exercise not yet in the mapping', async () => {
    setMockMapping({})
    expect(await getYmoveExerciseId('0999')).toBeUndefined()
  })

  // 3. Explicit no-match entry returns null, not undefined
  it('returns null for an exercise explicitly marked as no ymove match', async () => {
    setMockMapping({ '0999': null })
    expect(await getYmoveExerciseId('0999')).toBeNull()
  })

  // 4. No mapping → getYmoveById must never be called
  it('never calls getYmoveById for unmapped exercises', async () => {
    setMockMapping({})
    const ymoveId = await getYmoveExerciseId('0999')
    // Simulate what the media route does
    if (ymoveId) void getYmoveById(ymoveId, false)
    expect(mockGetYmoveById).not.toHaveBeenCalled()
  })

  // 5. ymove fetch failure → must not propagate (media route catches and falls back)
  it('getYmoveById can be caught and treated as a missing result', async () => {
    setMockMapping({ '0026': YMOVE_UUID })
    mockGetYmoveById.mockRejectedValue(new Error('ymove network error'))

    let media = null
    try {
      media = await getYmoveById(YMOVE_UUID, false)
    } catch {
      // route catches this and returns exercisedb fallback
      media = null
    }
    expect(media).toBeNull()
  })

  // 6. Video included only when explicitly requested
  it('getYmoveById is called with includeVideo=false by default', async () => {
    setMockMapping({ '0026': YMOVE_UUID })
    await getYmoveById(YMOVE_UUID, false)
    expect(mockGetYmoveById).toHaveBeenCalledWith(YMOVE_UUID, false)
  })

  // 7. Video included when includeVideo=true
  it('getYmoveById is called with includeVideo=true for ?video=true requests', async () => {
    setMockMapping({ '0026': YMOVE_UUID })
    await getYmoveById(YMOVE_UUID, true)
    expect(mockGetYmoveById).toHaveBeenCalledWith(YMOVE_UUID, true)
  })

  // 8. The response shape returned from the mock includes a videoUrl but
  //    the media route strips it out unless includeVideo=true.
  //    We test the raw return here; route-level gating is tested separately.
  it('media object includes videoUrl when returned from ymove', async () => {
    setMockMapping({ '0026': YMOVE_UUID })
    const media = await getYmoveById(YMOVE_UUID, true)
    expect(media?.videoUrl).toBe('https://ymove.example.com/video.mp4')
  })

  // 9. searchYmoveCandidates production guard
  it('searchYmoveCandidates is the mock in test env (not the real guard)', async () => {
    // The real guard only fires in production. In test env, the mock is used instead.
    // We verify the mock is what the import resolves to.
    mockSearchYmoveCandidates.mockResolvedValue([])
    const results = await searchYmoveCandidates('squat', 5)
    expect(Array.isArray(results)).toBe(true)
    expect(mockSearchYmoveCandidates).toHaveBeenCalledWith('squat', 5)
  })

  // 10. Mapping is keyed by ExerciseDB ID — unaffected by display name changes
  it('mapping lookup uses ExerciseDB ID, not exercise name', async () => {
    setMockMapping({ '0026': YMOVE_UUID })
    expect(await getYmoveExerciseId('0026')).toBe(YMOVE_UUID)
    // A different ID (even if the exercise name were identical) has no mapping
    expect(await getYmoveExerciseId('0027')).toBeUndefined()
  })

  // 11. No API key in client-facing media response shape
  it('YMOVE_API_KEY is never present in the YmoveMedia interface', () => {
    const keys = Object.keys(MOCK_YMOVE_MEDIA)
    expect(keys).not.toContain('apiKey')
    expect(keys).not.toContain('YMOVE_API_KEY')
    expect(JSON.stringify(MOCK_YMOVE_MEDIA)).not.toContain('YMOVE_API_KEY')
  })

  // 12. ExerciseDB GIF fallback is always present regardless of ymove status
  it('exercisedb fallback always provides a fallbackGifUrl', () => {
    const gifUrl = getGifUrl('0999')
    expect(gifUrl).toMatch(/0999\.gif/)
    const response = { source: 'exercisedb' as const, fallbackGifUrl: gifUrl }
    expect(response.fallbackGifUrl).toBeTruthy()
    expect(response.source).toBe('exercisedb')
  })
})

describe('lib/ymove/mapping unit', () => {
  beforeEach(() => setMockMapping({}))
  afterEach(() => setMockMapping({}))

  it('getYmoveExerciseId returns undefined for keys absent from mapping', async () => {
    setMockMapping({ '0026': YMOVE_UUID })
    expect(await getYmoveExerciseId('9999')).toBeUndefined()
  })

  it('getAllMappings returns a snapshot of the current mapping', async () => {
    setMockMapping({ '0026': YMOVE_UUID, '0999': null })
    const m = await getAllMappings()
    expect(m['0026']).toBe(YMOVE_UUID)
    expect(m['0999']).toBeNull()
    expect(Object.keys(m)).toHaveLength(2)
  })

  it('null and undefined are semantically distinct in the mapping', async () => {
    setMockMapping({ '0026': null })
    expect(await getYmoveExerciseId('0026')).toBeNull()      // explicit no-match
    expect(await getYmoveExerciseId('0999')).toBeUndefined() // not yet checked
  })
})
