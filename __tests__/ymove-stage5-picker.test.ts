/**
 * Stage 5 — Picker improvements
 *
 * Tests cover:
 * 1. Trainer programs page local ExercisePicker — YMove-first typeahead
 *    - Uses ymove API when flag on, ExDB API when off
 *    - Handles ymove response shape (items vs exercises)
 * 2. ExercisePicker equipment profile normalization
 *    - exdbToEqFamily is normalizeExdbEquipment from hierarchy-scorer (shared source)
 *    - Correct mapping for all known ExDB equipment strings
 *    - Unknown strings return null (never treated as compatible with everything)
 * 3. YMove API multi-family profile filter (?eqFamilies=)
 *    - Multiple families included in a single request
 *    - Items with eqFamily=null excluded when eqFamilies filter active
 *    - Composes correctly with single ?eqFamily= pill filter
 *    - Bodyweight included because it is always in the profile-derived set
 * 4. YMove API pagination
 *    - ?page and ?limit params respected
 *    - Response includes total, page, pages fields
 *    - Second page returns different offset
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

// ── Prisma mock ───────────────────────────────────────────────────────────────

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

import { GET as getYmove, _resetMovementCacheForTest } from '@/app/api/training/exercises/ymove/route'
import { NextRequest }      from 'next/server'

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

function makeRow(overrides: RowOverrides = {}) {
  return {
    ymoveId:            'ymoveId'            in overrides ? overrides.ymoveId!            : 'aabbccdd-0000-0000-0000-000000000001',
    name:               'name'               in overrides ? overrides.name!               : 'Barbell Back Squat',
    equipment:          'equipment'          in overrides ? overrides.equipment            : 'barbell',
    category:           'category'           in overrides ? overrides.category            : 'Legs',
    primaryMuscleGroup: 'primaryMuscleGroup' in overrides ? overrides.primaryMuscleGroup  : 'quadriceps',
    thumbnailMediaId:   'thumbnailMediaId'   in overrides ? overrides.thumbnailMediaId    : null,
    hasVideo:           'hasVideo'           in overrides ? overrides.hasVideo!           : false,
  }
}

// ── 1. Trainer programs page local picker — API integration ───────────────────

describe('Trainer programs ExercisePicker — YMove response shape', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, YMOVE_CATALOG_ENABLED: 'true' }
    mockFindMany.mockClear()
    mockCount.mockClear()
  })
  afterEach(() => { process.env = OLD_ENV })

  it('ymove route returns items with id, name, bodyPart, equipment fields', async () => {
    mockCount.mockResolvedValue(1)
    mockFindMany.mockResolvedValue([makeRow({ name: 'Barbell Squat', equipment: 'barbell' })])
    const res  = await getYmove(ymoveReq({ q: 'squat' }))
    const body = await res.json() as { items: Record<string, unknown>[] }
    const item = body.items[0]
    expect(item.id).toMatch(/^ymv:/)
    expect(item.name).toBe('Barbell Squat')
    expect(typeof item.bodyPart).toBe('string')
    expect(typeof item.equipment).toBe('string')
  })

  it('ymove route returns thumbnailMediaId field for picker thumbnails', async () => {
    mockCount.mockResolvedValue(1)
    const mediaId = 'media-uuid-abcd'
    mockFindMany.mockResolvedValue([makeRow({ thumbnailMediaId: mediaId })])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { items: Record<string, unknown>[] }
    expect(body.items[0].thumbnailMediaId).toBe(mediaId)
  })

  it('response has items (not exercises) key — required for trainer page parser', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as Record<string, unknown>
    expect(Object.keys(body)).toContain('items')
    expect(Object.keys(body)).not.toContain('exercises')
  })
})

// ── 2. Equipment profile normalization — shared source of truth ───────────────
// ExercisePicker.exdbToEqFamily is a re-export of normalizeExdbEquipment from
// lib/ymove/hierarchy-scorer, so both client and server use the same mapping.

import { exdbToEqFamily } from '@/components/training/ExercisePicker'
import { normalizeExdbEquipment } from '@/lib/ymove/hierarchy-scorer'

describe('exdbToEqFamily — shared source: must equal normalizeExdbEquipment', () => {
  const INPUTS = [
    'barbell', 'ez barbell', 'olympic barbell', 'trap bar', 'dumbbell',
    'smith machine', 'cable', 'kettlebell', 'leverage machine', 'band',
    'resistance band', 'body weight', 'weighted', 'assisted',
    // Unknown strings
    'stability ball', 'bosu ball', 'medicine ball', 'sled machine', '',
  ]

  for (const input of INPUTS) {
    it(`"${input || '(empty)'}" produces the same result from both functions`, () => {
      expect(exdbToEqFamily(input)).toBe(normalizeExdbEquipment(input))
    })
  }

  it('unknown equipment strings return null — not treated as compatible with anything', () => {
    expect(exdbToEqFamily('stability ball')).toBeNull()
    expect(exdbToEqFamily('bosu ball')).toBeNull()
    expect(exdbToEqFamily('medicine ball')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(exdbToEqFamily('BARBELL')).toBe('barbell')
    expect(exdbToEqFamily('Leverage Machine')).toBe('machine')
    expect(exdbToEqFamily('Body Weight')).toBe('bodyweight')
  })
})

// ── 3. YMove API multi-family profile filter (?eqFamilies=) ──────────────────

describe('GET /api/training/exercises/ymove — ?eqFamilies= multi-family filter', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, YMOVE_CATALOG_ENABLED: 'true' }
    mockFindMany.mockClear()
    mockCount.mockClear()
  })
  afterEach(() => { process.env = OLD_ENV })

  it('includes exercises from all requested families', async () => {
    const barbellRow  = makeRow({ ymoveId: 'aaaa0001-0000-0000-0000-000000000001', name: 'Barbell Squat',   equipment: 'barbell',   category: 'Legs' })
    const dumbbellRow = makeRow({ ymoveId: 'aaaa0002-0000-0000-0000-000000000002', name: 'Dumbbell Curl',   equipment: 'dumbbell',  category: 'Arms' })
    const cableRow    = makeRow({ ymoveId: 'aaaa0003-0000-0000-0000-000000000003', name: 'Cable Fly',       equipment: 'cable',     category: 'Chest' })
    const machineRow  = makeRow({ ymoveId: 'aaaa0004-0000-0000-0000-000000000004', name: 'Machine Press',   equipment: 'machine',   category: 'Chest' })
    mockCount.mockResolvedValue(4)
    mockFindMany.mockResolvedValue([barbellRow, dumbbellRow, cableRow, machineRow])

    const res  = await getYmove(ymoveReq({ eqFamilies: 'barbell,dumbbell,cable' }))
    const body = await res.json() as { items: { name: string }[] }
    const names = body.items.map(i => i.name)

    expect(names).toContain('Barbell Squat')   // barbell ✓
    expect(names).toContain('Dumbbell Curl')   // dumbbell ✓
    expect(names).toContain('Cable Fly')       // cable ✓
    expect(names).not.toContain('Machine Press')  // machine not in requested set
  })

  it('excludes items with eqFamily=null (unknown equipment)', async () => {
    // null equipment → eqFamily=null after classification
    const unknownRow = makeRow({ ymoveId: 'aaaa0005-0000-0000-0000-000000000005', name: 'Unknown Exercise', equipment: null, category: null })
    const barbellRow = makeRow({ ymoveId: 'aaaa0006-0000-0000-0000-000000000006', name: 'Barbell Deadlift', equipment: 'barbell', category: 'Back' })
    mockCount.mockResolvedValue(2)
    mockFindMany.mockResolvedValue([unknownRow, barbellRow])

    const res  = await getYmove(ymoveReq({ eqFamilies: 'barbell,dumbbell' }))
    const body = await res.json() as { items: { name: string }[] }
    const names = body.items.map(i => i.name)

    expect(names).toContain('Barbell Deadlift')
    expect(names).not.toContain('Unknown Exercise')  // null eqFamily excluded
  })

  it('bodyweight exercises pass through when bodyweight is in eqFamilies', async () => {
    const bwRow = makeRow({ ymoveId: 'aaaa0007-0000-0000-0000-000000000007', name: 'Push-Up', equipment: 'bodyweight', category: 'Chest' })
    mockCount.mockResolvedValue(1)
    mockFindMany.mockResolvedValue([bwRow])

    const res  = await getYmove(ymoveReq({ eqFamilies: 'barbell,bodyweight' }))
    const body = await res.json() as { items: { name: string }[] }
    expect(body.items.map(i => i.name)).toContain('Push-Up')
  })

  it('returns empty when no items match the requested families', async () => {
    const machineRow = makeRow({ ymoveId: 'aaaa0008-0000-0000-0000-000000000008', name: 'Machine Press', equipment: 'machine', category: 'Chest' })
    mockCount.mockResolvedValue(1)
    mockFindMany.mockResolvedValue([machineRow])

    const res  = await getYmove(ymoveReq({ eqFamilies: 'barbell,dumbbell' }))
    const body = await res.json() as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })

  it('composes with ?eqFamily= single-family pill: both filters apply', async () => {
    const barbellRow  = makeRow({ ymoveId: 'aaaa0009-0000-0000-0000-000000000009', name: 'Barbell Squat',  equipment: 'barbell',  category: 'Legs' })
    const dumbbellRow = makeRow({ ymoveId: 'aaaa000a-0000-0000-0000-00000000000a', name: 'Dumbbell Curl',  equipment: 'dumbbell', category: 'Arms' })
    mockCount.mockResolvedValue(2)
    mockFindMany.mockResolvedValue([barbellRow, dumbbellRow])

    // eqFamily=barbell (pill) + eqFamilies=barbell,dumbbell — only barbell passes both
    const res  = await getYmove(ymoveReq({ eqFamily: 'barbell', eqFamilies: 'barbell,dumbbell' }))
    const body = await res.json() as { items: { name: string }[] }
    const names = body.items.map(i => i.name)
    expect(names).toContain('Barbell Squat')
    expect(names).not.toContain('Dumbbell Curl')
  })

  it('no filter when eqFamilies is empty string', async () => {
    mockCount.mockResolvedValue(2)
    mockFindMany.mockResolvedValue([
      makeRow({ ymoveId: 'aaaa000b-0000-0000-0000-00000000000b', equipment: 'barbell' }),
      makeRow({ ymoveId: 'aaaa000c-0000-0000-0000-00000000000c', equipment: 'dumbbell' }),
    ])
    const res  = await getYmove(ymoveReq({ eqFamilies: '' }))
    const body = await res.json() as { items: unknown[] }
    expect(body.items).toHaveLength(2)
  })
})

// ── 4. YMove API pagination ───────────────────────────────────────────────────

describe('GET /api/training/exercises/ymove — pagination', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, YMOVE_CATALOG_ENABLED: 'true' }
    mockFindMany.mockClear()
    mockCount.mockClear()
  })
  afterEach(() => { process.env = OLD_ENV })

  it('response includes total, page, pages, limit fields', async () => {
    mockCount.mockResolvedValue(40)
    mockFindMany.mockResolvedValue([makeRow()])
    const res  = await getYmove(ymoveReq({ limit: '20', page: '1' }))
    const body = await res.json() as Record<string, unknown>
    expect(typeof body.total).toBe('number')
    expect(typeof body.page).toBe('number')
    expect(typeof body.pages).toBe('number')
    expect(typeof body.limit).toBe('number')
  })

  it('pages = ceil(total / limit)', async () => {
    mockCount.mockResolvedValue(45)
    mockFindMany.mockResolvedValue([])
    const res  = await getYmove(ymoveReq({ limit: '20', page: '1' }))
    const body = await res.json() as { pages: number }
    expect(body.pages).toBe(Math.ceil(45 / 20))
  })

  it('page 1 queries with offset=0', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq({ limit: '20', page: '1' }))
    const callArg = mockFindMany.mock.calls[0][0] as { skip: number; take: number }
    expect(callArg.skip).toBe(0)
    expect(callArg.take).toBe(20)
  })

  it('page 2 queries with offset=limit', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq({ limit: '20', page: '2' }))
    const callArg = mockFindMany.mock.calls[0][0] as { skip: number; take: number }
    expect(callArg.skip).toBe(20)
    expect(callArg.take).toBe(20)
  })

  it('default limit is 50 when not specified', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq())
    const callArg = mockFindMany.mock.calls[0][0] as { take: number }
    expect(callArg.take).toBe(50)
  })

  it('custom limit=20 is respected (mobile page size)', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq({ limit: '20' }))
    const callArg = mockFindMany.mock.calls[0][0] as { take: number }
    expect(callArg.take).toBe(20)
  })

  it('limit is capped at MAX_LIMIT=100', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq({ limit: '9999' }))
    const callArg = mockFindMany.mock.calls[0][0] as { take: number }
    expect(callArg.take).toBe(100)
  })

  it('page defaults to 1 when not specified', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    const res  = await getYmove(ymoveReq())
    const body = await res.json() as { page: number }
    expect(body.page).toBe(1)
  })
})

// ── 5. SQL-level eqFamilies pre-filtering — accurate pagination ───────────────
// The route must translate ?eqFamilies= to a SQL WHERE equipment IN [...] so that
// count() and pages are accurate (not reflecting the unfiltered catalog size).

describe('GET /api/training/exercises/ymove — SQL-level eqFamilies filter', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, YMOVE_CATALOG_ENABLED: 'true' }
    mockFindMany.mockClear()
    mockCount.mockClear()
  })
  afterEach(() => { process.env = OLD_ENV })

  it('passes equipment.in filter to findMany WHERE when ?eqFamilies= is set', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq({ eqFamilies: 'barbell,dumbbell' }))
    const callArg = mockFindMany.mock.calls[0][0] as { where: { equipment?: { in?: string[] } } }
    expect(callArg.where.equipment).toBeDefined()
    expect(callArg.where.equipment?.in).toContain('barbell')
    expect(callArg.where.equipment?.in).toContain('dumbbell')
  })

  it('passes equipment.in filter to count WHERE — so total reflects the filter', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq({ eqFamilies: 'barbell,dumbbell' }))
    const countArg = mockCount.mock.calls[0][0] as { where: { equipment?: { in?: string[] } } }
    expect(countArg.where.equipment?.in).toContain('barbell')
    expect(countArg.where.equipment?.in).toContain('dumbbell')
  })

  it('total in response reflects the SQL-filtered count (not catalog size)', async () => {
    // Simulate: catalog has 200 exercises, only 30 match barbell+dumbbell profile
    mockCount.mockResolvedValue(30)
    mockFindMany.mockResolvedValue([makeRow()])
    const res  = await getYmove(ymoveReq({ eqFamilies: 'barbell,dumbbell', limit: '20' }))
    const body = await res.json() as { total: number; pages: number }
    expect(body.total).toBe(30)
    expect(body.pages).toBe(Math.ceil(30 / 20))  // 2, not ceil(200/20)=10
  })

  it('includes all equipment strings for multi-entry families (band → band + mini band)', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq({ eqFamilies: 'band' }))
    const countArg = mockCount.mock.calls[0][0] as { where: { equipment?: { in?: string[] } } }
    expect(countArg.where.equipment?.in).toContain('band')
    expect(countArg.where.equipment?.in).toContain('mini band')
  })

  it('includes both bodyweight string variants for bodyweight family', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq({ eqFamilies: 'bodyweight' }))
    const countArg = mockCount.mock.calls[0][0] as { where: { equipment?: { in?: string[] } } }
    expect(countArg.where.equipment?.in).toContain('bodyweight')
    expect(countArg.where.equipment?.in).toContain('body weight')
  })

  it('no equipment filter when no eqFamilies param', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq())
    const countArg = mockCount.mock.calls[0][0] as { where: { equipment?: unknown } }
    expect(countArg.where.equipment).toBeUndefined()
  })

  it('?equipment= exact match takes priority over ?eqFamilies=', async () => {
    mockCount.mockResolvedValue(0)
    mockFindMany.mockResolvedValue([])
    await getYmove(ymoveReq({ equipment: 'barbell', eqFamilies: 'dumbbell,cable' }))
    const countArg = mockCount.mock.calls[0][0] as { where: { equipment?: { equals?: string; in?: string[] } } }
    // Should use equals (exact match), not in (multi-family)
    expect(countArg.where.equipment?.equals).toBe('barbell')
    expect(countArg.where.equipment?.in).toBeUndefined()
  })
})

// ── 6. Movement family filter — accurate SQL pagination ──────────────────────
// Movement family is a derived field (not stored in DB). The route must:
//   1. Build an in-memory classification index from the full catalog
//   2. Translate ?movement= to ymoveId IN (...) before the SQL query
//   3. Run count() against the ymoveId-filtered WHERE so total/pages are accurate
//   4. Paginate normally via skip/take on the correctly filtered set

describe('GET /api/training/exercises/ymove — movement filter pagination', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, YMOVE_CATALOG_ENABLED: 'true' }
    mockFindMany.mockClear()
    mockCount.mockClear()
    // Each test gets a fresh classification cache
    _resetMovementCacheForTest()
  })
  afterEach(() => {
    process.env = OLD_ENV
    _resetMovementCacheForTest()
  })

  // Exercise rows whose movement family is deterministic per the classifier rules:
  //   "Back Squat" contains "squat" → fam_squat
  //   "Goblet Squat" contains "squat" → fam_squat
  //   "Romanian Deadlift" contains "romanian" → fam_hip_hinge
  const SQUAT_ROW_1 = makeRow({ ymoveId: 'squat-0000-0000-0000-000000000001', name: 'Barbell Back Squat', equipment: 'barbell', category: 'Legs' })
  const SQUAT_ROW_2 = makeRow({ ymoveId: 'squat-0000-0000-0000-000000000002', name: 'Goblet Squat',       equipment: 'kettlebell', category: 'Legs' })
  const HINGE_ROW   = makeRow({ ymoveId: 'hinge-0000-0000-0000-000000000001', name: 'Romanian Deadlift', equipment: 'barbell', category: 'Back' })

  it('first request builds classification cache then runs data query', async () => {
    mockFindMany
      .mockResolvedValueOnce([SQUAT_ROW_1, SQUAT_ROW_2, HINGE_ROW]) // cache load
      .mockResolvedValue([SQUAT_ROW_1, SQUAT_ROW_2])                  // data query
    mockCount.mockResolvedValue(2)

    await getYmove(ymoveReq({ movement: 'fam_squat', limit: '20' }))

    // Two findMany calls: one for the classification cache, one for data
    expect(mockFindMany).toHaveBeenCalledTimes(2)
  })

  it('movement filter adds ymoveId IN to both count and findMany', async () => {
    mockFindMany
      .mockResolvedValueOnce([SQUAT_ROW_1, SQUAT_ROW_2, HINGE_ROW])
      .mockResolvedValue([])
    mockCount.mockResolvedValue(2)

    await getYmove(ymoveReq({ movement: 'fam_squat' }))

    const dataCall  = mockFindMany.mock.calls[1][0] as { where: Record<string, unknown> }
    const countCall = mockCount.mock.calls[0][0]    as { where: Record<string, unknown> }
    const idFilter  = dataCall.where.ymoveId as { in: string[] }

    // Both the data query and count see ymoveId IN (squat IDs only)
    expect(idFilter.in).toContain('squat-0000-0000-0000-000000000001')
    expect(idFilter.in).toContain('squat-0000-0000-0000-000000000002')
    expect(idFilter.in).not.toContain('hinge-0000-0000-0000-000000000001')
    expect((countCall.where.ymoveId as { in: string[] }).in).toContain('squat-0000-0000-0000-000000000001')
  })

  it('total and pages reflect movement-filtered count, not full catalog size', async () => {
    // Catalog has 3 rows but only 2 classify as fam_squat
    mockFindMany
      .mockResolvedValueOnce([SQUAT_ROW_1, SQUAT_ROW_2, HINGE_ROW])
      .mockResolvedValue([SQUAT_ROW_1])
    mockCount.mockResolvedValue(2) // DB returns filtered count

    const res  = await getYmove(ymoveReq({ movement: 'fam_squat', limit: '1' }))
    const body = await res.json() as { total: number; pages: number }

    expect(body.total).toBe(2)
    expect(body.pages).toBe(2) // ceil(2/1)
  })

  it('movement filter with no matches returns empty without a data DB query', async () => {
    mockFindMany.mockResolvedValueOnce([HINGE_ROW]) // cache: only hinge
    mockCount.mockResolvedValue(0)

    const res  = await getYmove(ymoveReq({ movement: 'fam_chest_press' }))
    const body = await res.json() as { items: unknown[]; total: number; pages: number }

    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
    expect(body.pages).toBe(0)
    // Early return after empty cache hit: no count or data query fired
    expect(mockCount).not.toHaveBeenCalled()
    expect(mockFindMany).toHaveBeenCalledTimes(1) // only cache load
  })

  it('page 2 uses correct DB offset within movement-filtered set', async () => {
    mockFindMany
      .mockResolvedValueOnce([SQUAT_ROW_1, SQUAT_ROW_2, HINGE_ROW])
      .mockResolvedValue([SQUAT_ROW_2])
    mockCount.mockResolvedValue(2)

    await getYmove(ymoveReq({ movement: 'fam_squat', limit: '1', page: '2' }))

    const dataCall = mockFindMany.mock.calls[1][0] as { skip: number; take: number }
    expect(dataCall.skip).toBe(1)  // (page-1) * limit = (2-1) * 1
    expect(dataCall.take).toBe(1)
  })

  it('warm cache is reused across consecutive requests', async () => {
    mockFindMany
      .mockResolvedValueOnce([SQUAT_ROW_1, SQUAT_ROW_2, HINGE_ROW])
      .mockResolvedValue([SQUAT_ROW_1, SQUAT_ROW_2])
    mockCount.mockResolvedValue(2)
    await getYmove(ymoveReq({ movement: 'fam_squat' }))

    // Second request should reuse the cache — only 1 findMany (data), not 2 (cache + data)
    mockFindMany.mockClear()
    mockCount.mockClear()
    mockFindMany.mockResolvedValue([SQUAT_ROW_1, SQUAT_ROW_2])
    mockCount.mockResolvedValue(2)

    await getYmove(ymoveReq({ movement: 'fam_squat' }))

    expect(mockFindMany).toHaveBeenCalledTimes(1)
  })

  it('movement + eqFamily composes: both filters appear in the WHERE clause', async () => {
    mockFindMany
      .mockResolvedValueOnce([SQUAT_ROW_1, SQUAT_ROW_2, HINGE_ROW])
      .mockResolvedValue([SQUAT_ROW_1])
    mockCount.mockResolvedValue(1)

    await getYmove(ymoveReq({ movement: 'fam_squat', eqFamily: 'barbell' }))

    const dataCall = mockFindMany.mock.calls[1][0] as { where: Record<string, unknown> }
    expect((dataCall.where.ymoveId as { in: string[] }).in).toContain('squat-0000-0000-0000-000000000001')
    expect(dataCall.where.equipment).toBeDefined()
  })
})

// ── 7. Template profile wiring — source verification ─────────────────────────
// Template pages must call /api/equipment-profiles (the user-profile endpoint),
// NOT /api/training/equipment (an exercise-type endpoint that returns no profiles).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Template pages — use correct equipment-profiles endpoint', () => {
  // __dirname is reliable regardless of shell cwd; process.cwd() varies by invocation
  const root = resolve(__dirname, '..')

  it('templates/new does not call the broken /api/training/equipment endpoint', () => {
    const src = readFileSync(`${root}/app/(app)/training/templates/new/page.tsx`, 'utf8')
    expect(src).not.toContain('/api/training/equipment')
  })

  it('templates/[id]/edit does not call the broken /api/training/equipment endpoint', () => {
    const src = readFileSync(`${root}/app/(app)/training/templates/[id]/edit/page.tsx`, 'utf8')
    expect(src).not.toContain('/api/training/equipment')
  })

  it('templates/new calls /api/equipment-profiles', () => {
    const src = readFileSync(`${root}/app/(app)/training/templates/new/page.tsx`, 'utf8')
    expect(src).toContain('/api/equipment-profiles')
  })

  it('templates/[id]/edit calls /api/equipment-profiles', () => {
    const src = readFileSync(`${root}/app/(app)/training/templates/[id]/edit/page.tsx`, 'utf8')
    expect(src).toContain('/api/equipment-profiles')
  })

  it('templates/new passes activeEquipmentStrings to ExercisePicker', () => {
    const src = readFileSync(`${root}/app/(app)/training/templates/new/page.tsx`, 'utf8')
    expect(src).toContain('activeEquipmentStrings')
  })

  it('templates/[id]/edit passes activeEquipmentStrings to ExercisePicker', () => {
    const src = readFileSync(`${root}/app/(app)/training/templates/[id]/edit/page.tsx`, 'utf8')
    expect(src).toContain('activeEquipmentStrings')
  })
})
