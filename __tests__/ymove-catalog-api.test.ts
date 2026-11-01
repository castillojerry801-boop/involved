/**
 * Tests for:
 *   GET /api/training/exercises/ymove   — YMove catalog search endpoint
 *   GET /api/training/exercises/[exerciseId]/media — native YMove media bypass
 *
 * All tests are read-only: no Prisma writes, no DB mutations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// ── Feature flag ──────────────────────────────────────────────────────────────

let _catalogEnabled = true

vi.mock('@/lib/exercises/identity', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/exercises/identity')>()
  return { ...real }
})

// ── Prisma mock ───────────────────────────────────────────────────────────────

const MOCK_ROWS = [
  {
    ymoveId:           'aaaa0000-0000-0000-0000-000000000001',
    name:              'Barbell Back Squat',
    equipment:         'Barbell',
    category:          'Legs',
    primaryMuscleGroup: 'Quadriceps',
    thumbnailMediaId:  'thumb-001',
    hasVideo:          true,
  },
  {
    ymoveId:           'aaaa0000-0000-0000-0000-000000000002',
    name:              'Dumbbell Bicep Curl',
    equipment:         'Dumbbell',
    category:          'Arms - Biceps',
    primaryMuscleGroup: 'Biceps',
    thumbnailMediaId:  'thumb-002',
    hasVideo:          false,
  },
  {
    ymoveId:           'aaaa0000-0000-0000-0000-000000000003',
    name:              'Pull-Up',
    equipment:         'Bodyweight',
    category:          'Pull',
    primaryMuscleGroup: 'Latissimus Dorsi',
    thumbnailMediaId:  null,
    hasVideo:          true,
  },
]

let _findManyResult = MOCK_ROWS
let _countResult    = MOCK_ROWS.length

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ymoveExerciseCatalog: {
      findMany:   () => Promise.resolve(_findManyResult),
      count:      () => Promise.resolve(_countResult),
      findUnique: ({ where }: { where: { ymoveId: string } }) =>
        Promise.resolve(MOCK_ROWS.find(r => r.ymoveId === where.ymoveId) ?? null),
    },
  },
}))

// ── ExerciseDB mock (for media route legacy path) ─────────────────────────────

vi.mock('@/lib/exercises', () => ({
  getExerciseById: (id: string) => id === '0025' ? { id: '0025', name: 'Bench Press' } : undefined,
  getGifUrl:       (id: string) => `/exercises/${id}.gif`,
}))

vi.mock('@/lib/ymove/mapping', () => ({
  getYmoveExerciseId: () => Promise.resolve(null),
}))

vi.mock('@/lib/ymove/client', () => ({
  getYmoveById:       () => Promise.resolve(null),
  isTrustedThumbnailUrl: () => false,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(path: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const { NextRequest } = require('next/server')
  return new NextRequest(url)
}

beforeEach(() => {
  _findManyResult = MOCK_ROWS
  _countResult    = MOCK_ROWS.length
  _catalogEnabled = true
  vi.stubEnv('YMOVE_CATALOG_ENABLED', 'true')
})

// ── Catalog endpoint — feature flag ──────────────────────────────────────────

describe('GET /api/training/exercises/ymove — feature flag', () => {
  it('returns 404 when YMOVE_CATALOG_ENABLED is not set', async () => {
    vi.stubEnv('YMOVE_CATALOG_ENABLED', '')
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res = await GET(makeRequest('/api/training/exercises/ymove'))
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(typeof body.error).toBe('string')
  })

  it('returns 404 when YMOVE_CATALOG_ENABLED is false', async () => {
    vi.stubEnv('YMOVE_CATALOG_ENABLED', 'false')
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res = await GET(makeRequest('/api/training/exercises/ymove'))
    expect(res.status).toBe(404)
  })

  it('returns 200 when YMOVE_CATALOG_ENABLED is true', async () => {
    vi.stubEnv('YMOVE_CATALOG_ENABLED', 'true')
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res = await GET(makeRequest('/api/training/exercises/ymove'))
    expect(res.status).toBe(200)
  })
})

// ── Catalog endpoint — response shape ────────────────────────────────────────

describe('GET /api/training/exercises/ymove — response shape', () => {
  beforeEach(() => vi.stubEnv('YMOVE_CATALOG_ENABLED', 'true'))

  it('returns items with ymv:-prefixed IDs', async () => {
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res  = await GET(makeRequest('/api/training/exercises/ymove'))
    const body = await res.json() as { items: Array<{ id: string }> }
    expect(Array.isArray(body.items)).toBe(true)
    for (const item of body.items) {
      expect(item.id).toMatch(/^ymv:[0-9a-f-]{36}$/)
    }
  })

  it('items include expected ExerciseMeta-compatible fields', async () => {
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res  = await GET(makeRequest('/api/training/exercises/ymove'))
    const body = await res.json() as { items: Array<Record<string, unknown>> }
    for (const item of body.items) {
      expect(typeof item.id).toBe('string')
      expect(typeof item.name).toBe('string')
      expect(typeof item.bodyPart).toBe('string')
      expect(typeof item.equipment).toBe('string')
      expect(typeof item.target).toBe('string')
      expect(item.source).toBe('ymove')
    }
  })

  it('includes classification metadata', async () => {
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res  = await GET(makeRequest('/api/training/exercises/ymove'))
    const body = await res.json() as { items: Array<Record<string, unknown>> }
    for (const item of body.items) {
      expect(typeof item.movementFamilyId === 'string' || item.movementFamilyId === null).toBe(true)
      expect(Array.isArray(item.variations)).toBe(true)
      expect(typeof item.classification).toBe('object')
    }
  })

  it('includes pagination metadata', async () => {
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res  = await GET(makeRequest('/api/training/exercises/ymove'))
    const body = await res.json() as Record<string, unknown>
    expect(typeof body.total).toBe('number')
    expect(typeof body.page).toBe('number')
    expect(typeof body.limit).toBe('number')
    expect(typeof body.pages).toBe('number')
  })

  it('never returns raw ymove credentials or full authenticated URLs', async () => {
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res  = await GET(makeRequest('/api/training/exercises/ymove'))
    const text = await res.text()
    for (const pattern of ['api_key', 'apiKey', 'x-api-key', 'Authorization']) {
      expect(text.toLowerCase()).not.toContain(pattern.toLowerCase())
    }
  })
})

// ── Catalog endpoint — pagination limits ─────────────────────────────────────

describe('GET /api/training/exercises/ymove — pagination limits', () => {
  beforeEach(() => vi.stubEnv('YMOVE_CATALOG_ENABLED', 'true'))

  it('clamps limit to MAX_LIMIT (100)', async () => {
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res  = await GET(makeRequest('/api/training/exercises/ymove', { limit: '9999' }))
    const body = await res.json() as { limit: number }
    expect(body.limit).toBeLessThanOrEqual(100)
  })

  it('uses page=1 as default', async () => {
    const { GET } = await import('../app/api/training/exercises/ymove/route')
    const res  = await GET(makeRequest('/api/training/exercises/ymove'))
    const body = await res.json() as { page: number }
    expect(body.page).toBe(1)
  })
})

// ── Catalog endpoint — read-only contract ────────────────────────────────────

describe('GET /api/training/exercises/ymove — read-only', () => {
  it('route module exports only GET', async () => {
    const mod = await import('../app/api/training/exercises/ymove/route') as Record<string, unknown>
    expect(typeof mod.GET).toBe('function')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(mod[method]).toBeUndefined()
    }
  })
})

// ── Media route — native YMove bypass ────────────────────────────────────────

describe('GET .../media — native YMove bypass', () => {
  async function getMedia(exerciseId: string, video = false) {
    const { GET } = await import(`../app/api/training/exercises/[exerciseId]/media/route`)
    return GET(
      makeRequest(`/api/training/exercises/${exerciseId}/media`, video ? { video: 'true' } : {}),
      { params: Promise.resolve({ exerciseId }) },
    )
  }

  it('resolves a ymv: ID from the catalog without ExerciseDB lookup', async () => {
    const ymvId = 'ymv:aaaa0000-0000-0000-0000-000000000001'
    const res  = await getMedia(ymvId)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.source).toBe('ymove')
    expect(body.ymoveId).toBe('aaaa0000-0000-0000-0000-000000000001')
    expect(body.thumbnailMediaId).toBe('thumb-001')
    expect(body.fallbackGifUrl).toBeNull()
  })

  it('returns 404 for a ymv: ID not in the catalog', async () => {
    const ymvId = 'ymv:ffff0000-0000-0000-0000-000000000099'
    const res  = await getMedia(ymvId)
    expect(res.status).toBe(404)
  })

  it('returns thumbnailMediaId null when catalog row has no thumbnail', async () => {
    const ymvId = 'ymv:aaaa0000-0000-0000-0000-000000000003'
    const res  = await getMedia(ymvId)
    const body = await res.json() as Record<string, unknown>
    expect(body.thumbnailMediaId).toBeNull()
  })

  it('still resolves legacy ExerciseDB IDs (backward compatibility)', async () => {
    const res  = await getMedia('0025')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.source).toBe('exercisedb')
  })

  it('returns 404 for ExerciseDB IDs not in data/exercises.json', async () => {
    const res  = await getMedia('9999')
    expect(res.status).toBe(404)
  })
})
