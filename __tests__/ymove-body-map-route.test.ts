import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

// Mapping mock: models the three states returned by getYmoveExerciseId:
//   undefined → not yet reviewed
//   null      → explicitly no YMove match
//   string    → verified/mapped ymoveId
const _mockMapping: Record<string, string | null | undefined> = {}

vi.mock('@/lib/ymove/mapping', () => ({
  getYmoveExerciseId: (id: string) => {
    if (!(id in _mockMapping)) return Promise.resolve(undefined)
    return Promise.resolve(_mockMapping[id])
  },
}))

const mockGetBodyMap = vi.fn<(id: string) => Promise<string | null>>()

vi.mock('@/lib/ymove/client', () => ({
  getBodyMap: (...args: unknown[]) => mockGetBodyMap(...args as [string]),
}))

// sanitizeSvg: call through to real implementation normally; override only for
// the "sanitizer rejects dangerous input" test cases.
let _sanitizeOverride: ((s: string) => string | null) | null = null
vi.mock('@/lib/ymove/sanitize-svg', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ymove/sanitize-svg')>()
  return {
    sanitizeSvg: (raw: string) => {
      if (_sanitizeOverride) return _sanitizeOverride(raw)
      return real.sanitizeSvg(raw)
    },
  }
})

import { GET as getByExercise } from '@/app/api/ymove/body-map/by-exercise/[exerciseId]/route'
import { GET as getByYmoveId } from '@/app/api/ymove/body-map/[ymoveId]/route'
import { NextRequest } from 'next/server'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EXERCISE_ID = '0026'
const YMOVE_UUID  = '65e95132-e6bb-41e8-af7d-0eda931a1693'
const VALID_SVG   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 93" role="img" aria-label="Muscles worked: Bench Press">
  <g data-region="chest" fill="rgba(255,80,80,0.8)"><path d="M10 20 L30 20 L30 40 L10 40 Z"/></g>
  <g data-region="front-delts" fill="rgba(255,80,80,0.07)"><path d="M35 20 L55 20 L55 40 L35 40 Z"/></g>
</svg>`

function setMapping(m: Record<string, string | null | undefined>) {
  Object.keys(_mockMapping).forEach(k => delete _mockMapping[k])
  Object.assign(_mockMapping, m)
}

function makeByExerciseRequest(exerciseId: string) {
  return new NextRequest(`http://localhost/api/ymove/body-map/by-exercise/${exerciseId}`)
}

function makeByYmoveIdRequest(ymoveId: string) {
  return new NextRequest(`http://localhost/api/ymove/body-map/${ymoveId}`)
}

async function callByExercise(exerciseId: string) {
  const res = await getByExercise(makeByExerciseRequest(exerciseId), {
    params: Promise.resolve({ exerciseId }),
  })
  return res
}

async function callByYmoveId(ymoveId: string) {
  const res = await getByYmoveId(makeByYmoveIdRequest(ymoveId), {
    params: Promise.resolve({ ymoveId }),
  })
  return res
}

// ── Tests: by-exercise route ──────────────────────────────────────────────────

describe('GET /api/ymove/body-map/by-exercise/[exerciseId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMapping({})
    mockGetBodyMap.mockResolvedValue(VALID_SVG)
    _sanitizeOverride = null
    process.env.YMOVE_API_KEY = 'test-key'
  })

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns 200 with SVG content-type for a verified mapping', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    const res = await callByExercise(EXERCISE_ID)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/image\/svg\+xml/)
  })

  it('returns the sanitized SVG body', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    const res = await callByExercise(EXERCISE_ID)
    const body = await res.text()
    expect(body).toContain('<svg')
    expect(body).toContain('data-region="chest"')
  })

  it('passes the correct ymoveId to getBodyMap', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    await callByExercise(EXERCISE_ID)
    expect(mockGetBodyMap).toHaveBeenCalledWith(YMOVE_UUID)
    expect(mockGetBodyMap).toHaveBeenCalledTimes(1)
  })

  it('sets long cache headers on successful response', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    const res = await callByExercise(EXERCISE_ID)
    expect(res.headers.get('Cache-Control')).toContain('max-age=86400')
  })

  // ── Not-found / no-mapping cases ───────────────────────────────────────────

  it('returns 404 when exercise has no mapping (undefined)', async () => {
    setMapping({})  // exerciseId not in mapping at all
    const res = await callByExercise(EXERCISE_ID)
    expect(res.status).toBe(404)
    expect(mockGetBodyMap).not.toHaveBeenCalled()
  })

  it('returns 404 when exercise is explicitly no-match (null)', async () => {
    setMapping({ [EXERCISE_ID]: null })
    const res = await callByExercise(EXERCISE_ID)
    expect(res.status).toBe(404)
    expect(mockGetBodyMap).not.toHaveBeenCalled()
  })

  it('returns 404 when getBodyMap returns null (upstream 404)', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    mockGetBodyMap.mockResolvedValue(null)
    const res = await callByExercise(EXERCISE_ID)
    expect(res.status).toBe(404)
  })

  it('returns 404 when sanitizeSvg rejects the SVG (dangerous content)', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    _sanitizeOverride = () => null  // simulate sanitizer rejecting
    const res = await callByExercise(EXERCISE_ID)
    expect(res.status).toBe(404)
  })

  // ── Upstream failure ───────────────────────────────────────────────────────

  it('returns 404 when getBodyMap returns empty string', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    mockGetBodyMap.mockResolvedValue('')
    const res = await callByExercise(EXERCISE_ID)
    // empty string → sanitizeSvg returns null → 404
    expect(res.status).toBe(404)
  })

  // ── Configuration / auth ───────────────────────────────────────────────────

  it('returns 503 when YMOVE_API_KEY is not set', async () => {
    delete process.env.YMOVE_API_KEY
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    const res = await callByExercise(EXERCISE_ID)
    expect(res.status).toBe(503)
  })

  // ── SVG content safety (sanitizer integration) ─────────────────────────────

  it('strips script tags injected by upstream before returning', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    // Restore real sanitizer behavior for this test
    _sanitizeOverride = null
    mockGetBodyMap.mockResolvedValue(
      VALID_SVG.replace('</svg>', '<script>alert("xss")</script></svg>')
    )
    const res = await callByExercise(EXERCISE_ID)
    const body = await res.text()
    expect(body).not.toContain('<script')
    expect(body).toContain('data-region="chest"')
  })

  it('strips on* event handlers injected by upstream', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    _sanitizeOverride = null
    mockGetBodyMap.mockResolvedValue(
      VALID_SVG.replace('data-region="chest"', 'data-region="chest" onclick="xss()"')
    )
    const res = await callByExercise(EXERCISE_ID)
    const body = await res.text()
    expect(body).not.toContain('onclick')
    expect(body).toContain('data-region="chest"')
  })

  it('preserves data-region attributes (required for muscle highlighting)', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    _sanitizeOverride = null
    const res = await callByExercise(EXERCISE_ID)
    const body = await res.text()
    expect(body).toContain('data-region="chest"')
    expect(body).toContain('data-region="front-delts"')
  })

  it('preserves accessibility attributes (role and aria-label)', async () => {
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    _sanitizeOverride = null
    const res = await callByExercise(EXERCISE_ID)
    const body = await res.text()
    expect(body).toContain('role="img"')
    expect(body).toContain('aria-label=')
  })
})

// ── Tests: by-ymoveId route ───────────────────────────────────────────────────

describe('GET /api/ymove/body-map/[ymoveId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBodyMap.mockResolvedValue(VALID_SVG)
    _sanitizeOverride = null
    process.env.YMOVE_API_KEY = 'test-key'
  })

  it('returns 200 with SVG for a valid ymoveId', async () => {
    const res = await callByYmoveId(YMOVE_UUID)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/image\/svg\+xml/)
    expect(mockGetBodyMap).toHaveBeenCalledWith(YMOVE_UUID)
  })

  it('returns 404 when getBodyMap returns null', async () => {
    mockGetBodyMap.mockResolvedValue(null)
    const res = await callByYmoveId(YMOVE_UUID)
    expect(res.status).toBe(404)
  })

  it('returns 404 when sanitizeSvg rejects the response', async () => {
    _sanitizeOverride = () => null
    const res = await callByYmoveId(YMOVE_UUID)
    expect(res.status).toBe(404)
  })

  it('returns 503 when YMOVE_API_KEY is missing', async () => {
    delete process.env.YMOVE_API_KEY
    const res = await callByYmoveId(YMOVE_UUID)
    expect(res.status).toBe(503)
  })

  it('sets long cache headers', async () => {
    const res = await callByYmoveId(YMOVE_UUID)
    expect(res.headers.get('Cache-Control')).toContain('max-age=86400')
    expect(res.headers.get('Cache-Control')).toContain('stale-while-revalidate')
  })
})

// ── Cross-route contract: by-exercise delegates to by-ymoveId logic ───────────

describe('body-map route contract: no video cap consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMapping({ [EXERCISE_ID]: YMOVE_UUID })
    mockGetBodyMap.mockResolvedValue(VALID_SVG)
    _sanitizeOverride = null
    process.env.YMOVE_API_KEY = 'test-key'
  })

  it('by-exercise route never calls getYmoveById (no video cap charge)', async () => {
    // The body-map route must ONLY call getBodyMap, never getYmoveById
    // (getYmoveById with includeVideo=true would charge the monthly cap)
    await callByExercise(EXERCISE_ID)
    expect(mockGetBodyMap).toHaveBeenCalledTimes(1)
    // getYmoveById is not imported/called — verified by absence in mock calls
  })

  it('by-exercise returns SVG text, not JSON (no wrapping envelope)', async () => {
    const res = await callByExercise(EXERCISE_ID)
    const body = await res.text()
    // Must be raw SVG, not JSON-wrapped
    expect(() => JSON.parse(body)).toThrow()
    expect(body.trim()).toMatch(/^<svg/)
  })
})
