/**
 * Tests for:
 *   lib/ymove/catalog-curation.ts              — curation service
 *   app/api/admin/ymove-catalog/route.ts       — GET catalog list
 *   app/api/admin/ymove-catalog/[ymoveId]/route.ts — PATCH single action
 *   app/api/admin/ymove-catalog/bulk/route.ts  — POST bulk
 *   thumbnail enrichment in API routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

// ── Prisma mock ───────────────────────────────────────────────────────────────

const {
  mockFindUnique,
  mockFindMany,
  mockUpdate,
  mockUpdateMany,
  mockCount,
  mockGroupBy,
  mockPrisma,
} = vi.hoisted(() => {
  const mockFindUnique  = vi.fn()
  const mockFindMany    = vi.fn().mockResolvedValue([])
  const mockUpdate      = vi.fn().mockResolvedValue({})
  const mockUpdateMany  = vi.fn().mockResolvedValue({ count: 0 })
  const mockCount       = vi.fn().mockResolvedValue(0)
  const mockGroupBy     = vi.fn().mockResolvedValue([])
  const mockPrisma = {
    ymoveExerciseCatalog: {
      findUnique:  mockFindUnique,
      findMany:    mockFindMany,
      update:      mockUpdate,
      updateMany:  mockUpdateMany,
      count:       mockCount,
      groupBy:     mockGroupBy,
    },
  }
  return { mockFindUnique, mockFindMany, mockUpdate, mockUpdateMany, mockCount, mockGroupBy, mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// ── Auth mocks ────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockIsAdmin = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ getUser: (...a: unknown[]) => mockGetUser(...a) }))
vi.mock('@/lib/admin/auth',      () => ({ isAdmin: (...a: unknown[]) => mockIsAdmin(...a) }))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  getThumbnailMediaIds,
  applyCurationAction,
  applyBulkCuration,
  CurationValidationError,
} from '@/lib/ymove/catalog-curation'
import { GET  } from '@/app/api/admin/ymove-catalog/route'
import { PATCH } from '@/app/api/admin/ymove-catalog/[ymoveId]/route'
import { POST  } from '@/app/api/admin/ymove-catalog/bulk/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const YMOVE_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const YMOVE_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const YMOVE_C = 'cccccccc-0000-4000-8000-000000000003'
const MEDIA_A = 'mmmmmmmm-0000-4000-8000-000000000001'
const ADMIN_ID = 'admin-user-001'

const VALID_EXERCISE_ID = '0001' // must exist in the real exercise library

function catalogRow(overrides: Record<string, unknown> = {}) {
  return {
    ymoveId:          YMOVE_A,
    name:             'Barbell Squat',
    slug:             'barbell-squat',
    category:         'strength',
    equipment:        'barbell',
    difficulty:       'intermediate',
    primaryMuscleGroup: 'quadriceps',
    hasVideo:         true,
    thumbnailMediaId: MEDIA_A,
    syncedAt:         new Date(),
    curationStatus:   'pending_review',
    verifiedMediaFor: null,
    isDuplicateOf:    null,
    canonicalId:      null,
    curatorNotes:     null,
    curatedAt:        null,
    curatedBy:        null,
    ...overrides,
  }
}

function patchRequest(ymoveId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/ymove-catalog/${ymoveId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function bulkRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ymove-catalog/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/ymove-catalog')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ id: ADMIN_ID })
  mockIsAdmin.mockReturnValue(true)
  mockFindUnique.mockResolvedValue(catalogRow())
  mockFindMany.mockResolvedValue([])
  mockUpdate.mockResolvedValue({})
  mockUpdateMany.mockResolvedValue({ count: 0 })
  mockCount.mockResolvedValue(0)
  mockGroupBy.mockResolvedValue([])
})

// ── getThumbnailMediaIds ──────────────────────────────────────────────────────

describe('getThumbnailMediaIds', () => {
  it('returns empty map for empty input', async () => {
    const result = await getThumbnailMediaIds([])
    expect(result.size).toBe(0)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('returns map of ymoveId → thumbnailMediaId', async () => {
    mockFindMany.mockResolvedValueOnce([
      { ymoveId: YMOVE_A, thumbnailMediaId: MEDIA_A },
      { ymoveId: YMOVE_B, thumbnailMediaId: null },
    ])
    const result = await getThumbnailMediaIds([YMOVE_A, YMOVE_B, YMOVE_C])
    expect(result.get(YMOVE_A)).toBe(MEDIA_A)
    expect(result.get(YMOVE_B)).toBeNull()
    expect(result.has(YMOVE_C)).toBe(false) // not in DB
  })
})

// ── applyCurationAction ───────────────────────────────────────────────────────

describe('applyCurationAction', () => {
  it('rejects invalid ymoveId format', async () => {
    await expect(applyCurationAction('not-a-uuid', { type: 'approve' }, ADMIN_ID))
      .rejects.toMatchObject({ error: { code: 'INVALID_ACTION' } })
  })

  it('rejects unknown ymoveId (NOT_FOUND)', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    await expect(applyCurationAction(YMOVE_A, { type: 'approve' }, ADMIN_ID))
      .rejects.toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('approve sets curationStatus=approved', async () => {
    await applyCurationAction(YMOVE_A, { type: 'approve' }, ADMIN_ID)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { ymoveId: YMOVE_A },
      data: expect.objectContaining({ curationStatus: 'approved' }),
    }))
  })

  it('reject clears verifiedMediaFor and isDuplicateOf', async () => {
    await applyCurationAction(YMOVE_A, { type: 'reject' }, ADMIN_ID)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        curationStatus: 'rejected',
        verifiedMediaFor: null,
        isDuplicateOf: null,
      }),
    }))
  })

  it('reset sets curationStatus=pending_review and clears relationships', async () => {
    await applyCurationAction(YMOVE_A, { type: 'reset' }, ADMIN_ID)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        curationStatus: 'pending_review',
        verifiedMediaFor: null,
        isDuplicateOf: null,
      }),
    }))
  })

  it('set_notes truncates to 500 chars', async () => {
    const long = 'x'.repeat(600)
    await applyCurationAction(YMOVE_A, { type: 'set_notes', notes: long }, ADMIN_ID)
    const call = mockUpdate.mock.calls[0][0] as { data: { curatorNotes: string } }
    expect(call.data.curatorNotes?.length).toBeLessThanOrEqual(500)
  })

  it('set_notes with empty string sets null', async () => {
    await applyCurationAction(YMOVE_A, { type: 'set_notes', notes: '' }, ADMIN_ID)
    const call = mockUpdate.mock.calls[0][0] as { data: { curatorNotes: string | null } }
    expect(call.data.curatorNotes).toBeNull()
  })

  describe('mark_duplicate', () => {
    it('rejects invalid target UUID format', async () => {
      await expect(
        applyCurationAction(YMOVE_A, { type: 'mark_duplicate', isDuplicateOf: 'not-valid' }, ADMIN_ID),
      ).rejects.toMatchObject({ error: { code: 'INVALID_DUPLICATE_TARGET' } })
    })

    it('rejects target not in catalog', async () => {
      // First call: subject found; second call: target not found
      mockFindUnique
        .mockResolvedValueOnce(catalogRow())
        .mockResolvedValueOnce(null)
      await expect(
        applyCurationAction(YMOVE_A, { type: 'mark_duplicate', isDuplicateOf: YMOVE_B }, ADMIN_ID),
      ).rejects.toMatchObject({ error: { code: 'INVALID_DUPLICATE_TARGET' } })
    })

    it('rejects self-reference', async () => {
      await expect(
        applyCurationAction(YMOVE_A, { type: 'mark_duplicate', isDuplicateOf: YMOVE_A }, ADMIN_ID),
      ).rejects.toMatchObject({ error: { code: 'DUPLICATE_CYCLE' } })
    })

    it('detects cycle: A→B, B→A', async () => {
      // subject: A; target: B; B.isDuplicateOf = A → cycle
      mockFindUnique
        .mockResolvedValueOnce(catalogRow({ ymoveId: YMOVE_A }))  // subject found
        .mockResolvedValueOnce(catalogRow({ ymoveId: YMOVE_B }))  // target exists
        .mockResolvedValueOnce({ isDuplicateOf: YMOVE_A })        // B's chain entry
      await expect(
        applyCurationAction(YMOVE_A, { type: 'mark_duplicate', isDuplicateOf: YMOVE_B }, ADMIN_ID),
      ).rejects.toMatchObject({ error: { code: 'DUPLICATE_CYCLE' } })
    })

    it('applies valid mark_duplicate', async () => {
      mockFindUnique
        .mockResolvedValueOnce(catalogRow())                      // subject found
        .mockResolvedValueOnce(catalogRow({ ymoveId: YMOVE_B })) // target exists
        .mockResolvedValueOnce({ isDuplicateOf: null })           // chain ends
      await applyCurationAction(YMOVE_A, { type: 'mark_duplicate', isDuplicateOf: YMOVE_B }, ADMIN_ID)
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          curationStatus: 'duplicate',
          isDuplicateOf: YMOVE_B,
          verifiedMediaFor: null,
        }),
      }))
    })
  })

  describe('link_exercise', () => {
    it('rejects unknown ExerciseDB ID', async () => {
      await expect(
        applyCurationAction(YMOVE_A, { type: 'link_exercise', verifiedMediaFor: 'NONEXISTENT_9999' }, ADMIN_ID),
      ).rejects.toMatchObject({ error: { code: 'UNKNOWN_EXERCISE' } })
    })

    it('applies valid link_exercise and sets curationStatus=approved', async () => {
      await applyCurationAction(YMOVE_A, { type: 'link_exercise', verifiedMediaFor: VALID_EXERCISE_ID }, ADMIN_ID)
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          verifiedMediaFor: VALID_EXERCISE_ID,
          curationStatus: 'approved',
          isDuplicateOf: null,
        }),
      }))
    })
  })
})

// ── applyBulkCuration ─────────────────────────────────────────────────────────

describe('applyBulkCuration', () => {
  it('throws if more than 100 IDs', async () => {
    const ids = Array.from({ length: 101 }, (_, i) =>
      `${String(i).padStart(8, '0')}-0000-4000-8000-000000000001`,
    )
    await expect(applyBulkCuration(ids, 'approve', ADMIN_ID))
      .rejects.toBeInstanceOf(CurationValidationError)
  })

  it('filters invalid UUIDs and counts them as skipped', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 2 })
    const result = await applyBulkCuration([YMOVE_A, YMOVE_B, 'bad-uuid'], 'approve', ADMIN_ID)
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].ymoveId).toBe('bad-uuid')
  })

  it('approve calls updateMany with curationStatus=approved', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 2 })
    await applyBulkCuration([YMOVE_A, YMOVE_B], 'approve', ADMIN_ID)
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ymoveId: { in: [YMOVE_A, YMOVE_B] } },
      data: expect.objectContaining({ curationStatus: 'approved' }),
    }))
  })

  it('reject clears relationship fields', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 })
    await applyBulkCuration([YMOVE_A], 'reject', ADMIN_ID)
    const call = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data.verifiedMediaFor).toBeNull()
    expect(call.data.isDuplicateOf).toBeNull()
    expect(call.data.curationStatus).toBe('rejected')
  })

  it('returns correct applied count from updateMany', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 3 })
    const result = await applyBulkCuration([YMOVE_A, YMOVE_B, YMOVE_C], 'approve', ADMIN_ID)
    expect(result.applied).toBe(3)
    expect(result.skipped).toBe(0)
  })

  it('returns empty map for zero valid IDs', async () => {
    const result = await applyBulkCuration(['bad'], 'approve', ADMIN_ID)
    expect(result.applied).toBe(0)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })
})

// ── GET /api/admin/ymove-catalog ──────────────────────────────────────────────

describe('GET /api/admin/ymove-catalog', () => {
  it('returns 403 for unauthenticated user', async () => {
    mockGetUser.mockResolvedValueOnce(null)
    const res = await GET(getRequest())
    expect(res.status).toBe(403)
  })

  it('returns 403 for non-admin user', async () => {
    mockIsAdmin.mockReturnValueOnce(false)
    const res = await GET(getRequest())
    expect(res.status).toBe(403)
  })

  it('returns items and counts on success', async () => {
    mockFindMany.mockResolvedValueOnce([catalogRow()])
    mockCount.mockResolvedValueOnce(1)
    mockGroupBy.mockResolvedValueOnce([{ curationStatus: 'pending_review', _count: { _all: 1 } }])

    const res = await GET(getRequest())
    const data = await res.json() as { items: unknown[]; total: number; counts: StatusCounts }
    expect(res.status).toBe(200)
    expect(data.items).toHaveLength(1)
    expect(data.total).toBe(1)
    expect(data.counts.pending_review).toBe(1)
  })

  it('applies status filter correctly', async () => {
    mockFindMany.mockResolvedValueOnce([])
    mockCount.mockResolvedValueOnce(0)
    mockGroupBy.mockResolvedValueOnce([])

    await GET(getRequest({ status: 'approved' }))
    const call = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(call.where.curationStatus).toBe('approved')
  })

  it('applies name search filter', async () => {
    mockFindMany.mockResolvedValueOnce([])
    mockCount.mockResolvedValueOnce(0)
    mockGroupBy.mockResolvedValueOnce([])

    await GET(getRequest({ q: 'squat' }))
    const call = mockFindMany.mock.calls[0][0] as { where: { name?: Record<string, unknown> } }
    expect(call.where.name).toMatchObject({ contains: 'squat', mode: 'insensitive' })
  })

  it('clamps pageSize to max 50', async () => {
    mockFindMany.mockResolvedValueOnce([])
    mockCount.mockResolvedValueOnce(0)
    mockGroupBy.mockResolvedValueOnce([])

    await GET(getRequest({ pageSize: '999' }))
    const call = mockFindMany.mock.calls[0][0] as { take: number }
    expect(call.take).toBeLessThanOrEqual(50)
  })

  it('serializes dates as ISO strings', async () => {
    const now = new Date('2026-11-01T00:00:00.000Z')
    mockFindMany.mockResolvedValueOnce([catalogRow({ syncedAt: now, curatedAt: now })])
    mockCount.mockResolvedValueOnce(1)
    mockGroupBy.mockResolvedValueOnce([])

    const res = await GET(getRequest())
    const data = await res.json() as { items: Array<{ syncedAt: string; curatedAt: string }> }
    expect(data.items[0].syncedAt).toBe(now.toISOString())
    expect(data.items[0].curatedAt).toBe(now.toISOString())
  })
})

// ── PATCH /api/admin/ymove-catalog/[ymoveId] ──────────────────────────────────

describe('PATCH /api/admin/ymove-catalog/[ymoveId]', () => {
  it('returns 403 for non-admin', async () => {
    mockIsAdmin.mockReturnValueOnce(false)
    const res = await PATCH(
      patchRequest(YMOVE_A, { action: 'approve' }),
      { params: Promise.resolve({ ymoveId: YMOVE_A }) },
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when action is missing', async () => {
    const res = await PATCH(
      patchRequest(YMOVE_A, {}),
      { params: Promise.resolve({ ymoveId: YMOVE_A }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for mark_duplicate missing isDuplicateOf', async () => {
    const res = await PATCH(
      patchRequest(YMOVE_A, { action: 'mark_duplicate' }),
      { params: Promise.resolve({ ymoveId: YMOVE_A }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for link_exercise missing verifiedMediaFor', async () => {
    const res = await PATCH(
      patchRequest(YMOVE_A, { action: 'link_exercise' }),
      { params: Promise.resolve({ ymoveId: YMOVE_A }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when catalog entry not found', async () => {
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await PATCH(
      patchRequest(YMOVE_A, { action: 'approve' }),
      { params: Promise.resolve({ ymoveId: YMOVE_A }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns 422 for validation errors', async () => {
    // YMOVE_A → YMOVE_A is a self-cycle
    const res = await PATCH(
      patchRequest(YMOVE_A, { action: 'mark_duplicate', isDuplicateOf: YMOVE_A }),
      { params: Promise.resolve({ ymoveId: YMOVE_A }) },
    )
    expect(res.status).toBe(422)
    const data = await res.json() as { error: string; code: string }
    expect(data.code).toBe('DUPLICATE_CYCLE')
  })

  it('returns 200 on successful approve', async () => {
    const res = await PATCH(
      patchRequest(YMOVE_A, { action: 'approve' }),
      { params: Promise.resolve({ ymoveId: YMOVE_A }) },
    )
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean }
    expect(data.ok).toBe(true)
  })
})

// ── POST /api/admin/ymove-catalog/bulk ────────────────────────────────────────

describe('POST /api/admin/ymove-catalog/bulk', () => {
  it('returns 403 for non-admin', async () => {
    mockIsAdmin.mockReturnValueOnce(false)
    const res = await POST(bulkRequest({ action: 'approve', ymoveIds: [YMOVE_A], confirm: true }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when confirm is not true', async () => {
    const res = await POST(bulkRequest({ action: 'approve', ymoveIds: [YMOVE_A] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for unsupported bulk action (mark_duplicate)', async () => {
    const res = await POST(bulkRequest({ action: 'mark_duplicate', ymoveIds: [YMOVE_A], confirm: true }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing ymoveIds', async () => {
    const res = await POST(bulkRequest({ action: 'approve', confirm: true }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty ymoveIds array', async () => {
    const res = await POST(bulkRequest({ action: 'approve', ymoveIds: [], confirm: true }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for over 100 IDs', async () => {
    const ids = Array.from({ length: 101 }, (_, i) =>
      `${String(i).padStart(8, '0')}-0000-4000-8000-000000000001`,
    )
    const res = await POST(bulkRequest({ action: 'approve', ymoveIds: ids, confirm: true }))
    expect(res.status).toBe(400)
  })

  it('returns 200 with applied count on success', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 2 })
    const res = await POST(bulkRequest({ action: 'approve', ymoveIds: [YMOVE_A, YMOVE_B], confirm: true }))
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; applied: number }
    expect(data.ok).toBe(true)
    expect(data.applied).toBe(2)
  })

  it('bulk reject clears relationship fields via updateMany', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 })
    await POST(bulkRequest({ action: 'reject', ymoveIds: [YMOVE_A], confirm: true }))
    const call = mockUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data.verifiedMediaFor).toBeNull()
    expect(call.data.isDuplicateOf).toBeNull()
  })
})

// ── Sync durability: curation fields must not be in update clause ─────────────

describe('Sync durability', () => {
  it('curation field names are NOT exported from catalog-sync', async () => {
    const syncModule = await import('@/lib/ymove/catalog-sync')
    const exports = Object.keys(syncModule)
    // syncYmoveCatalog should exist; curation column names should not be in exports
    expect(exports).toContain('syncYmoveCatalog')
    // Ensure the module doesn't expose raw curation column names as constants
    const curFields = ['curationStatus', 'verifiedMediaFor', 'isDuplicateOf', 'canonicalId', 'curatorNotes']
    for (const field of curFields) {
      expect(exports).not.toContain(field)
    }
  })
})

// ── CurationValidationError ───────────────────────────────────────────────────

describe('CurationValidationError', () => {
  it('is instanceof Error', () => {
    const err = new CurationValidationError({ code: 'NOT_FOUND', message: 'test' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CurationValidationError')
  })

  it('exposes typed error code', () => {
    const err = new CurationValidationError({ code: 'DUPLICATE_CYCLE', message: 'cycle' })
    expect(err.error.code).toBe('DUPLICATE_CYCLE')
  })
})

// ── Public feature exposure guard ─────────────────────────────────────────────

describe('Public feature exposure', () => {
  it('catalog curation service has no default export (not a Next.js page/component)', async () => {
    const mod = await import('@/lib/ymove/catalog-curation')
    expect((mod as Record<string, unknown>).default).toBeUndefined()
  })
})

// ── TypeScript types ──────────────────────────────────────────────────────────

interface StatusCounts {
  pending_review: number
  approved: number
  rejected: number
  duplicate: number
}
