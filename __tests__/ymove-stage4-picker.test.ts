/**
 * Stage 4 — YMove picker API layer
 *
 * Tests cover:
 * - GET /api/training/exercises/config — returns flag state, not NEXT_PUBLIC_ required
 * - GET /api/training/exercises/ymove — ExerciseMeta-compatible shape (secondaryMuscles,
 *   instructions, description, ymoveCategory)
 * - GET /api/training/exercises/ymove?eqFamily= — equipment family post-filter
 * - GET /api/training/exercises/ymove?movement= — movement family post-filter (pre-existing, verified)
 * - Duplicate prevention — items with curationStatus='duplicate' excluded
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

// Prisma mock — overridden per test
const mockFindMany = vi.fn()
const mockCount    = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ymoveExerciseCatalog: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count:    (...args: unknown[]) => mockCount(...args),
    },
  },
}))

import { GET as getConfig }  from '@/app/api/training/exercises/config/route'
import { GET as getYmove, _resetMovementCacheForTest } from '@/app/api/training/exercises/ymove/route'
import { NextRequest }       from 'next/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function ymoveReq(params: Record<string, string> = {}) {
  const sp = new URLSearchParams(params)
  return new NextRequest(`http://localhost/api/training/exercises/ymove?${sp}`)
}

type RowOverrides = Partial<{
  ymoveId: string
  name: string
  equipment: string | null
  category: string | null
  primaryMuscleGroup: string | null
  thumbnailMediaId: string | null
  hasVideo: boolean
}>

// Use 'key' in overrides checks so that explicit null overrides are preserved
// (null ?? default = default in JS, which would swallow intentional nulls)
function makeRow(overrides: RowOverrides = {}) {
  return {
    ymoveId:            'ymoveId'            in overrides ? overrides.ymoveId!            : 'aabbccdd-1122-3344-5566-778899aabbcc',
    name:               'name'               in overrides ? overrides.name!               : 'Barbell Back Squat',
    equipment:          'equipment'          in overrides ? overrides.equipment            : 'barbell',
    category:           'category'           in overrides ? overrides.category            : 'Legs',
    primaryMuscleGroup: 'primaryMuscleGroup' in overrides ? overrides.primaryMuscleGroup  : 'quadriceps',
    thumbnailMediaId:   'thumbnailMediaId'   in overrides ? overrides.thumbnailMediaId    : null,
    hasVideo:           'hasVideo'           in overrides ? overrides.hasVideo!           : false,
  }
}

// ── Config endpoint ───────────────────────────────────────────────────────────

describe('GET /api/training/exercises/config', () => {
  const OLD_ENV = process.env

  beforeEach(() => { process.env = { ...OLD_ENV } })
  afterEach(() => { process.env = OLD_ENV })

  it('returns { ymove: true } when YMOVE_CATALOG_ENABLED=true', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    const res  = await getConfig()
    const body = await res.json() as { ymove: boolean }
    expect(body.ymove).toBe(true)
  })

  it('returns { ymove: false } when flag is unset', async () => {
    delete process.env.YMOVE_CATALOG_ENABLED
    const res  = await getConfig()
    const body = await res.json() as { ymove: boolean }
    expect(body.ymove).toBe(false)
  })

  it('returns { ymove: false } when flag is set to something other than "true"', async () => {
    process.env.YMOVE_CATALOG_ENABLED = '1'
    const res  = await getConfig()
    const body = await res.json() as { ymove: boolean }
    expect(body.ymove).toBe(false)
  })

  it('includes Cache-Control header for CDN caching', async () => {
    const res = await getConfig()
    expect(res.headers.get('Cache-Control')).toMatch(/max-age/)
  })
})

// ── YMove route — flag guard ──────────────────────────────────────────────────

describe('GET /api/training/exercises/ymove — flag guard', () => {
  const OLD_ENV = process.env

  beforeEach(() => { process.env = { ...OLD_ENV } })
  afterEach(() => { process.env = OLD_ENV })

  it('returns 404 when YMOVE_CATALOG_ENABLED is not set', async () => {
    delete process.env.YMOVE_CATALOG_ENABLED
    const res = await getYmove(ymoveReq())
    expect(res.status).toBe(404)
  })

  it('returns 200 when YMOVE_CATALOG_ENABLED=true', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    const res = await getYmove(ymoveReq())
    expect(res.status).toBe(200)
  })
})

// ── YMove route — ExerciseMeta-compatible shape ───────────────────────────────

describe('GET /api/training/exercises/ymove — ExerciseMeta-compatible shape', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, YMOVE_CATALOG_ENABLED: 'true' }
    mockCount.mockResolvedValue(1)
  })
  afterEach(() => { process.env = OLD_ENV })

  it('items include secondaryMuscles, instructions, description as empty arrays/string', async () => {
    mockFindMany.mockResolvedValue([makeRow()])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { items: Record<string, unknown>[] }
    const item = body.items[0]
    expect(item.secondaryMuscles).toEqual([])
    expect(item.instructions).toEqual([])
    expect(item.description).toBe('')
  })

  it('items carry ymoveCategory from catalog category field', async () => {
    mockFindMany.mockResolvedValue([makeRow({ category: 'cardio' })])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { items: Record<string, unknown>[] }
    expect(body.items[0].ymoveCategory).toBe('cardio')
  })

  it('ymoveCategory is null when category is null', async () => {
    mockFindMany.mockResolvedValue([makeRow({ category: null })])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { items: Record<string, unknown>[] }
    expect(body.items[0].ymoveCategory).toBeNull()
  })

  it('items have ymv:-prefixed id', async () => {
    const uuid = 'aabbccdd-1122-3344-5566-778899aabbcc'
    mockFindMany.mockResolvedValue([makeRow({ ymoveId: uuid })])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { items: Record<string, unknown>[] }
    expect(body.items[0].id).toBe(`ymv:${uuid}`)
  })

  it('items include thumbnailMediaId (null when absent)', async () => {
    mockFindMany.mockResolvedValue([makeRow({ thumbnailMediaId: null })])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { items: Record<string, unknown>[] }
    expect(body.items[0].thumbnailMediaId).toBeNull()
  })

  it('items include thumbnailMediaId when present', async () => {
    const mediaId = 'media-uuid-1234'
    mockFindMany.mockResolvedValue([makeRow({ thumbnailMediaId: mediaId })])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { items: Record<string, unknown>[] }
    expect(body.items[0].thumbnailMediaId).toBe(mediaId)
  })

  it('source field is always "ymove"', async () => {
    mockFindMany.mockResolvedValue([makeRow()])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { items: Record<string, unknown>[] }
    expect(body.items[0].source).toBe('ymove')
  })
})

// ── YMove route — eqFamily filter ─────────────────────────────────────────────

describe('GET /api/training/exercises/ymove — eqFamily filter', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, YMOVE_CATALOG_ENABLED: 'true' }
    mockFindMany.mockClear()
    mockCount.mockResolvedValue(2)
    // Reset movement cache: the movement+eqFamily composition test triggers a cache
    // load as a side effect; reset ensures a clean slate for each test.
    _resetMovementCacheForTest()
  })
  afterEach(() => {
    process.env = OLD_ENV
    _resetMovementCacheForTest()
  })

  it('filters to barbell exercises when eqFamily=barbell', async () => {
    const barbellRow  = makeRow({ ymoveId: 'aaaa0001-0000-0000-0000-000000000001', name: 'Barbell Squat',  equipment: 'barbell' })
    const dumbbellRow = makeRow({ ymoveId: 'aaaa0002-0000-0000-0000-000000000002', name: 'Dumbbell Curl',  equipment: 'dumbbell' })
    mockFindMany.mockResolvedValue([barbellRow, dumbbellRow])
    const res  = await getYmove(ymoveReq({ eqFamily: 'barbell' }))
    const body = await res.json() as { items: { name: string }[] }
    const names = body.items.map(i => i.name)
    expect(names).toContain('Barbell Squat')
    expect(names).not.toContain('Dumbbell Curl')
  })

  it('returns all exercises when eqFamily is not set', async () => {
    const barbellRow  = makeRow({ ymoveId: 'aaaa0001-0000-0000-0000-000000000001', name: 'Barbell Squat',  equipment: 'barbell' })
    const dumbbellRow = makeRow({ ymoveId: 'aaaa0002-0000-0000-0000-000000000002', name: 'Dumbbell Curl',  equipment: 'dumbbell' })
    mockFindMany.mockResolvedValue([barbellRow, dumbbellRow])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { items: { name: string }[] }
    expect(body.items).toHaveLength(2)
  })

  it('returns empty items when eqFamily matches nothing', async () => {
    // 'dumbbell' equipment → eqFamily 'dumbbell' — should be excluded by barbell filter
    const dumbbellRow = makeRow({ ymoveId: 'aaaa0003-0000-0000-0000-000000000003', name: 'Dumbbell Lateral Raise', equipment: 'dumbbell' })
    mockFindMany.mockResolvedValue([dumbbellRow])
    const res  = await getYmove(ymoveReq({ eqFamily: 'barbell' }))
    const body = await res.json() as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })

  it('eqFamily and movement filters compose (both applied)', async () => {
    // barbell squat (barbell + lower_push) and barbell row (barbell + upper_pull_h)
    const squatRow = makeRow({ ymoveId: 'aaaa0004-0000-0000-0000-000000000004', name: 'Barbell Squat', equipment: 'barbell', category: 'Legs' })
    const rowRow   = makeRow({ ymoveId: 'aaaa0005-0000-0000-0000-000000000005', name: 'Barbell Row',  equipment: 'barbell', category: 'Back', primaryMuscleGroup: 'back' })
    mockFindMany.mockResolvedValue([squatRow, rowRow])
    const res  = await getYmove(ymoveReq({ eqFamily: 'barbell', movement: 'fam_squat' }))
    const body = await res.json() as { items: { name: string }[] }
    const names = body.items.map(i => i.name)
    expect(names).toContain('Barbell Squat')
    expect(names).not.toContain('Barbell Row')
  })
})

// ── YMove route — duplicate exclusion ─────────────────────────────────────────

describe('GET /api/training/exercises/ymove — duplicate exclusion', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, YMOVE_CATALOG_ENABLED: 'true' }
  })
  afterEach(() => { process.env = OLD_ENV })

  it('Prisma where clause excludes curationStatus=duplicate', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq())
    const callArg = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(callArg.where).toMatchObject({ NOT: { curationStatus: 'duplicate' } })
  })
})
