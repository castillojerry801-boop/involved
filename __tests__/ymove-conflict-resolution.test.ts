/**
 * Tests for the YMove UUID conflict resolution system.
 *
 * Tests cover:
 * - GET /api/admin/ymove-mapping/transfer  — returns owners (DB + JSON-only) + destState
 * - POST move_here  — DB mapping transfer with null override for revoked
 * - POST move_here  — JSON-baseline transfer writes explicit null DB override
 * - POST move_here  — selective revoke when multiple owners
 * - POST move_here  — stale detection (DB row changed)
 * - POST move_here  — stale detection (JSON-only entry now has DB row)
 * - POST move_here  — stale detection (destination changed concurrently)
 * - POST move_here  — stale detection (new owner appeared since panel loaded)
 * - POST use_for_both  — shared UUID, existing owners preserved
 * - POST  — verified flag propagates to verifiedAt
 * - POST  — revoked exercises have null ymoveId (ExerciseDB fallback restored)
 * - POST  — admin auth enforced on both GET and POST
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => Promise.resolve({ id: 'admin-user-id' }),
}))

vi.mock('@/lib/admin/auth', () => ({
  isAdmin: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/exercises/canonical', () => ({
  getInvolvedDisplayName: (_id: string, name: string) => name,
  getCanonicalByExerciseDbId: () => null,
  MOVEMENT_PATTERN_LABELS: {},
}))

vi.mock('@/lib/exercises', () => ({
  exercises: [
    { id: 'A001', name: 'band front raise',         equipment: 'band',     bodyPart: 'shoulders', target: 'front delts' },
    { id: 'A002', name: 'resistance band front raise', equipment: 'band',  bodyPart: 'shoulders', target: 'front delts' },
    { id: 'A003', name: 'cable front raise',         equipment: 'cable',   bodyPart: 'shoulders', target: 'front delts' },
    { id: 'A004', name: 'json only exercise',        equipment: 'barbell', bodyPart: 'chest',     target: 'pectorals' },
  ],
  getGifUrl: (id: string) => `https://example.com/gifs/${id}.gif`,
}))

// Backing stores exposed so tests can set up pre-conditions
const _mockDb: Record<string, { ymoveId: string | null; verifiedAt: Date | null; updatedAt: Date }> = {}
// JSON baseline exercises that have no DB row
const _jsonBaseline: Record<string, string> = {}

vi.mock('@/lib/ymove/mapping', () => {
  type StaleErr = Error & { code: string; exerciseDbId: string; reason?: string }

  function makeStale(exerciseDbId: string, msg: string, reason?: string): StaleErr {
    return Object.assign(new Error(msg), { code: 'STALE', exerciseDbId, reason })
  }

  return {
    getConflictOwners: vi.fn().mockImplementation(async (ymoveId: string) => {
      const owners: Array<{
        exerciseDbId: string; ymoveId: string; verifiedAt: Date | null
        updatedAt: Date; isJsonOnly: boolean
      }> = []

      // DB owners
      for (const [id, row] of Object.entries(_mockDb)) {
        if (row.ymoveId === ymoveId) {
          owners.push({ exerciseDbId: id, ymoveId, verifiedAt: row.verifiedAt, updatedAt: row.updatedAt, isJsonOnly: false })
        }
      }
      // JSON-only owners (no DB row)
      for (const [id, jYmoveId] of Object.entries(_jsonBaseline)) {
        if (jYmoveId === ymoveId && !(id in _mockDb)) {
          owners.push({ exerciseDbId: id, ymoveId, verifiedAt: null, updatedAt: new Date(0), isJsonOnly: true })
        }
      }
      return owners
    }),

    getMappingRow: vi.fn().mockImplementation(async (exerciseDbId: string) => {
      const row = _mockDb[exerciseDbId]
      if (!row) return null
      return { ymoveId: row.ymoveId, updatedAt: row.updatedAt }
    }),

    transferMapping: vi.fn().mockImplementation(async (opts: {
      destExerciseDbId:      string
      ymoveId:               string
      action:                'move_here' | 'use_for_both'
      revokeFromDbIds:       string[]
      isJsonOnlyIds:         string[]
      verified:              boolean
      expectedUpdatedAts:    Record<string, string>
      expectedDestUpdatedAt: string | null
      expectedOwnerDbIds:    string[]
    }) => {
      const {
        destExerciseDbId, ymoveId, action, revokeFromDbIds, isJsonOnlyIds, verified,
        expectedUpdatedAts, expectedDestUpdatedAt, expectedOwnerDbIds,
      } = opts
      const jsonOnlySet = new Set(isJsonOnlyIds)

      // New-owner detection (move_here only)
      if (action === 'move_here' && expectedOwnerDbIds.length > 0) {
        const expectedSet = new Set(expectedOwnerDbIds)
        for (const [id, row] of Object.entries(_mockDb)) {
          if (row.ymoveId === ymoveId && !expectedSet.has(id) && id !== destExerciseDbId) {
            throw makeStale(id, `New owner appeared: ${id}`, 'new_owner')
          }
        }
      }

      // Source staleness checks
      for (const revokeDbId of revokeFromDbIds) {
        if (jsonOnlySet.has(revokeDbId)) {
          if (_mockDb[revokeDbId]) throw makeStale(revokeDbId, `Concurrent change: ${revokeDbId} now has DB row`)
        } else {
          const expected = expectedUpdatedAts[revokeDbId]
          const row = _mockDb[revokeDbId]
          if (expected && (!row || row.updatedAt.toISOString() !== expected)) {
            throw makeStale(revokeDbId, `Stale mapping for ${revokeDbId}`)
          }
        }
      }

      // Destination staleness check
      const destRow = _mockDb[destExerciseDbId]
      if (expectedDestUpdatedAt === null) {
        if (destRow) throw makeStale(destExerciseDbId, `Destination mapped concurrently`, 'destination_changed')
      } else {
        if (!destRow || destRow.updatedAt.toISOString() !== expectedDestUpdatedAt) {
          throw makeStale(destExerciseDbId, `Destination changed: ${destExerciseDbId}`, 'destination_changed')
        }
      }

      if (action === 'move_here') {
        for (const revokeDbId of revokeFromDbIds) {
          _mockDb[revokeDbId] = { ymoveId: null, verifiedAt: null, updatedAt: new Date() }
        }
      }

      const verifiedAt = verified ? new Date('2026-01-01T00:00:00Z') : null
      _mockDb[destExerciseDbId] = { ymoveId, verifiedAt, updatedAt: new Date() }

      return { revoked: action === 'move_here' ? revokeFromDbIds : [], assigned: destExerciseDbId, verifiedAt }
    }),
  }
})

// ── Route imports ─────────────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/ymove-mapping/transfer/route'
import { NextRequest } from 'next/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearState() {
  Object.keys(_mockDb).forEach(k => delete _mockDb[k])
  Object.keys(_jsonBaseline).forEach(k => delete _jsonBaseline[k])
}

function getReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/ymove-mapping/transfer')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ymove-mapping/transfer', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

const YMOVE_UUID = 'ymove-uuid-1111-2222-3333-444444444444'

// ── GET — conflict owners ──────────────────────────────────────────────────────

describe('GET /api/admin/ymove-mapping/transfer — conflict owners', () => {
  beforeEach(clearState)

  it('returns 400 when ymoveId is missing', async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(400)
  })

  it('returns empty owners array when no mapping exists for the UUID', async () => {
    const res = await GET(getReq({ ymoveId: YMOVE_UUID }))
    expect(res.status).toBe(200)
    const data = await res.json() as { owners: unknown[] }
    expect(data.owners).toHaveLength(0)
  })

  it('returns DB owner with enriched exercise metadata and gifUrl', async () => {
    _mockDb['A001'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: new Date('2026-06-01T00:00:00Z') }

    const res = await GET(getReq({ ymoveId: YMOVE_UUID }))
    expect(res.status).toBe(200)
    const data = await res.json() as { owners: Array<{
      exerciseDbId: string; displayName: string; bodyPart: string; equipment: string
      gifUrl: string; verifiedAt: string | null; updatedAt: string | null; isJsonOnly: boolean
    }> }
    expect(data.owners).toHaveLength(1)
    const owner = data.owners[0]
    expect(owner.exerciseDbId).toBe('A001')
    expect(owner.displayName).toBe('band front raise')
    expect(owner.bodyPart).toBe('shoulders')
    expect(owner.equipment).toBe('band')
    expect(owner.gifUrl).toBe('https://example.com/gifs/A001.gif')
    expect(owner.verifiedAt).toBeNull()
    expect(owner.updatedAt).toBe('2026-06-01T00:00:00.000Z')
    expect(owner.isJsonOnly).toBe(false)
  })

  it('returns JSON-only owner with isJsonOnly=true and null updatedAt', async () => {
    _jsonBaseline['A004'] = YMOVE_UUID

    const res = await GET(getReq({ ymoveId: YMOVE_UUID }))
    expect(res.status).toBe(200)
    const data = await res.json() as { owners: Array<{ exerciseDbId: string; isJsonOnly: boolean; updatedAt: string | null }> }
    const owner = data.owners.find(o => o.exerciseDbId === 'A004')
    expect(owner).toBeDefined()
    expect(owner?.isJsonOnly).toBe(true)
    expect(owner?.updatedAt).toBeNull()
  })

  it('returns both DB and JSON-only owners for the same UUID', async () => {
    _mockDb['A001'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: new Date() }
    _jsonBaseline['A004'] = YMOVE_UUID

    const res = await GET(getReq({ ymoveId: YMOVE_UUID }))
    expect(res.status).toBe(200)
    const data = await res.json() as { owners: Array<{ exerciseDbId: string }> }
    expect(data.owners).toHaveLength(2)
    expect(data.owners.map(o => o.exerciseDbId).sort()).toEqual(['A001', 'A004'].sort())
  })

  it('returns verifiedAt as ISO string for a verified owner', async () => {
    _mockDb['A001'] = { ymoveId: YMOVE_UUID, verifiedAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date() }
    const res = await GET(getReq({ ymoveId: YMOVE_UUID }))
    const data = await res.json() as { owners: Array<{ exerciseDbId: string; verifiedAt: string | null }> }
    expect(data.owners[0].verifiedAt).toBe('2026-10-01T00:00:00.000Z')
  })
})

// ── POST — admin auth ──────────────────────────────────────────────────────────

describe('POST /api/admin/ymove-mapping/transfer — admin auth', () => {
  it('returns 403 when user is not admin', async () => {
    const { isAdmin } = await import('@/lib/admin/auth')
    vi.mocked(isAdmin).mockReturnValueOnce(false)
    const res = await POST(postReq({ action: 'move_here', destExerciseDbId: 'A001', ymoveId: YMOVE_UUID, revokeFromDbIds: ['A002'] }))
    expect(res.status).toBe(403)
  })
})

// ── POST — validation ──────────────────────────────────────────────────────────

describe('POST /api/admin/ymove-mapping/transfer — input validation', () => {
  it('returns 400 for unknown action', async () => {
    const res = await POST(postReq({ action: 'delete_all', destExerciseDbId: 'A001', ymoveId: YMOVE_UUID }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when destExerciseDbId is missing', async () => {
    const res = await POST(postReq({ action: 'use_for_both', ymoveId: YMOVE_UUID }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when ymoveId is missing', async () => {
    const res = await POST(postReq({ action: 'use_for_both', destExerciseDbId: 'A001' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for move_here with empty revokeFromDbIds', async () => {
    const res = await POST(postReq({ action: 'move_here', destExerciseDbId: 'A001', ymoveId: YMOVE_UUID, revokeFromDbIds: [] }))
    expect(res.status).toBe(400)
  })
})

// ── POST move_here — DB owner ─────────────────────────────────────────────────

describe('POST move_here — DB mapping transfer', () => {
  beforeEach(clearState)

  it('revokes existing DB owner and assigns to destination', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00Z')
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt }

    const res = await POST(postReq({
      action:             'move_here',
      destExerciseDbId:   'A001',
      ymoveId:            YMOVE_UUID,
      revokeFromDbIds:    ['A002'],
      isJsonOnlyIds:      [],
      verified:           false,
      expectedUpdatedAts:    { A002: updatedAt.toISOString() },
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A002'],
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; revoked: string[]; assigned: string }
    expect(data.ok).toBe(true)
    expect(data.revoked).toEqual(['A002'])
    expect(data.assigned).toBe('A001')

    // Revoked exercise now has null ymoveId (ExerciseDB fallback restored)
    expect(_mockDb['A002']?.ymoveId).toBeNull()
    expect(_mockDb['A001']?.ymoveId).toBe(YMOVE_UUID)
  })

  it('sets verifiedAt on destination when verified=true', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00Z')
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt }

    const res = await POST(postReq({
      action:             'move_here',
      destExerciseDbId:   'A001',
      ymoveId:            YMOVE_UUID,
      revokeFromDbIds:    ['A002'],
      isJsonOnlyIds:      [],
      verified:           true,
      expectedUpdatedAts:    { A002: updatedAt.toISOString() },
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A002'],
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as { verifiedAt: string | null }
    expect(data.verifiedAt).not.toBeNull()
    expect(_mockDb['A001']?.verifiedAt).not.toBeNull()
  })

  it('clears verifiedAt on revoked exercise', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00Z')
    // A002 was previously verified
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: new Date('2026-08-01T00:00:00Z'), updatedAt }

    await POST(postReq({
      action:             'move_here',
      destExerciseDbId:   'A001',
      ymoveId:            YMOVE_UUID,
      revokeFromDbIds:    ['A002'],
      isJsonOnlyIds:      [],
      verified:           false,
      expectedUpdatedAts:    { A002: updatedAt.toISOString() },
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A002'],
    }))

    // Revoked exercise's verifiedAt is cleared
    expect(_mockDb['A002']?.verifiedAt).toBeNull()
  })

  it('selectively revokes only chosen owners (multiple owners scenario)', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00Z')
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt }
    _mockDb['A003'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt }

    const res = await POST(postReq({
      action:             'move_here',
      destExerciseDbId:   'A001',
      ymoveId:            YMOVE_UUID,
      revokeFromDbIds:    ['A002'],           // only revoke A002, not A003
      isJsonOnlyIds:      [],
      verified:           false,
      expectedUpdatedAts:    { A002: updatedAt.toISOString() },
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A002', 'A003'],  // both were visible in the panel
    }))

    expect(res.status).toBe(200)
    // A002 revoked, A003 untouched
    expect(_mockDb['A002']?.ymoveId).toBeNull()
    expect(_mockDb['A003']?.ymoveId).toBe(YMOVE_UUID)
    expect(_mockDb['A001']?.ymoveId).toBe(YMOVE_UUID)
  })
})

// ── POST move_here — JSON-baseline transfer ───────────────────────────────────

describe('POST move_here — JSON baseline null override', () => {
  beforeEach(clearState)

  it('writes an explicit null DB row for a JSON-only entry (preventing baseline resurface)', async () => {
    _jsonBaseline['A004'] = YMOVE_UUID
    // No DB row for A004

    const res = await POST(postReq({
      action:             'move_here',
      destExerciseDbId:   'A001',
      ymoveId:            YMOVE_UUID,
      revokeFromDbIds:       ['A004'],
      isJsonOnlyIds:         ['A004'],
      verified:              false,
      expectedUpdatedAts:    {},
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A004'],
    }))

    expect(res.status).toBe(200)
    // A004 now has an explicit null DB override
    expect(_mockDb['A004']?.ymoveId).toBeNull()
    expect(_mockDb['A001']?.ymoveId).toBe(YMOVE_UUID)
  })
})

// ── POST — stale conflict detection ──────────────────────────────────────────

describe('POST — stale conflict detection', () => {
  beforeEach(clearState)

  it('returns 409 {stale:true} when DB row updatedAt does not match expected', async () => {
    const realUpdatedAt = new Date('2026-09-15T00:00:00Z')
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: realUpdatedAt }

    const res = await POST(postReq({
      action:             'move_here',
      destExerciseDbId:   'A001',
      ymoveId:            YMOVE_UUID,
      revokeFromDbIds:    ['A002'],
      isJsonOnlyIds:      [],
      verified:           false,
      // Caller thinks it was updated earlier than it actually was
      expectedUpdatedAts:    { A002: new Date('2026-09-01T00:00:00Z').toISOString() },
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A002'],
    }))

    expect(res.status).toBe(409)
    const data = await res.json() as { stale: boolean; exerciseDbId: string }
    expect(data.stale).toBe(true)
    expect(data.exerciseDbId).toBe('A002')
    // Nothing should have been written
    expect(_mockDb['A001']).toBeUndefined()
    expect(_mockDb['A002']?.ymoveId).toBe(YMOVE_UUID)
  })

  it('returns 409 {stale:true} when JSON-only entry now has a DB row (concurrent write)', async () => {
    _jsonBaseline['A004'] = YMOVE_UUID
    // Simulate concurrent change: DB row now exists for A004
    _mockDb['A004'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: new Date() }

    const res = await POST(postReq({
      action:             'move_here',
      destExerciseDbId:   'A001',
      ymoveId:            YMOVE_UUID,
      revokeFromDbIds:       ['A004'],
      isJsonOnlyIds:         ['A004'],
      verified:              false,
      expectedUpdatedAts:    {},
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A004'],
    }))

    expect(res.status).toBe(409)
    const data = await res.json() as { stale: boolean }
    expect(data.stale).toBe(true)
    // Destination must not have been written
    expect(_mockDb['A001']).toBeUndefined()
  })
})

// ── POST use_for_both ─────────────────────────────────────────────────────────

describe('POST use_for_both — shared UUID assignment', () => {
  beforeEach(clearState)

  it('assigns destination without revoking existing owner', async () => {
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: new Date() }

    const res = await POST(postReq({
      action:           'use_for_both',
      destExerciseDbId: 'A001',
      ymoveId:          YMOVE_UUID,
      revokeFromDbIds:       [],
      isJsonOnlyIds:         [],
      verified:              false,
      expectedUpdatedAts:    {},
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    [],
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as { revoked: string[] }
    // No revocations for use_for_both
    expect(data.revoked).toHaveLength(0)
    // A002 still mapped
    expect(_mockDb['A002']?.ymoveId).toBe(YMOVE_UUID)
    // A001 also mapped now
    expect(_mockDb['A001']?.ymoveId).toBe(YMOVE_UUID)
  })

  it('sets verifiedAt on destination when verified=true', async () => {
    const res = await POST(postReq({
      action:           'use_for_both',
      destExerciseDbId: 'A001',
      ymoveId:          YMOVE_UUID,
      revokeFromDbIds:       [],
      isJsonOnlyIds:         [],
      verified:              true,
      expectedUpdatedAts:    {},
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    [],
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as { verifiedAt: string | null }
    expect(data.verifiedAt).not.toBeNull()
  })

  it('does not set verifiedAt when verified=false', async () => {
    const res = await POST(postReq({
      action:                'use_for_both',
      destExerciseDbId:      'A001',
      ymoveId:               YMOVE_UUID,
      revokeFromDbIds:       [],
      isJsonOnlyIds:         [],
      verified:              false,
      expectedUpdatedAts:    {},
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    [],
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as { verifiedAt: string | null }
    expect(data.verifiedAt).toBeNull()
    expect(_mockDb['A001']?.verifiedAt).toBeNull()
  })
})

// ── ExerciseDB fallback verification ─────────────────────────────────────────

describe('ExerciseDB fallback after transfer', () => {
  beforeEach(clearState)

  it('revoked exercise has null ymoveId (media route will use ExerciseDB GIF)', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00Z')
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt }

    await POST(postReq({
      action:             'move_here',
      destExerciseDbId:   'A001',
      ymoveId:            YMOVE_UUID,
      revokeFromDbIds:    ['A002'],
      isJsonOnlyIds:      [],
      verified:           false,
      expectedUpdatedAts:    { A002: updatedAt.toISOString() },
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A002'],
    }))

    // The revoked DB row has ymoveId = null.
    // getAllMappings() merges JSON + DB (DB wins), so A002 will return null → ExerciseDB fallback.
    expect(_mockDb['A002']?.ymoveId).toBeNull()
  })

  it('GET returns correct displayName from exercises lib', async () => {
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: new Date() }

    const res = await GET(getReq({ ymoveId: YMOVE_UUID }))
    const data = await res.json() as { owners: Array<{ displayName: string }> }
    expect(data.owners[0].displayName).toBe('resistance band front raise')
  })
})

// ── GET — destState ────────────────────────────────────────────────────────────

describe('GET /api/admin/ymove-mapping/transfer — destState', () => {
  beforeEach(clearState)

  it('returns destState.updatedAt as null when dest has no DB row', async () => {
    const res = await GET(getReq({ ymoveId: YMOVE_UUID, destExerciseDbId: 'A001' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { destState: { updatedAt: string | null } }
    expect(data.destState).toBeDefined()
    expect(data.destState.updatedAt).toBeNull()
  })

  it('returns destState.updatedAt as ISO string when dest has a DB row', async () => {
    const updatedAt = new Date('2026-09-20T12:00:00Z')
    _mockDb['A001'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt }

    const res = await GET(getReq({ ymoveId: YMOVE_UUID, destExerciseDbId: 'A001' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { destState: { updatedAt: string | null } }
    expect(data.destState.updatedAt).toBe('2026-09-20T12:00:00.000Z')
  })

  it('returns destState.updatedAt as null when destExerciseDbId param is absent', async () => {
    const res = await GET(getReq({ ymoveId: YMOVE_UUID }))
    expect(res.status).toBe(200)
    const data = await res.json() as { destState: { updatedAt: string | null } }
    expect(data.destState.updatedAt).toBeNull()
  })
})

// ── POST — destination staleness detection ────────────────────────────────────

describe('POST — destination staleness detection', () => {
  beforeEach(clearState)

  it('returns 409 when dest had no DB row but one appeared concurrently (expectedDestUpdatedAt: null)', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00Z')
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt }
    // Concurrently, someone mapped A001 (the destination) to something
    _mockDb['A001'] = { ymoveId: 'other-uuid', verifiedAt: null, updatedAt: new Date() }

    const res = await POST(postReq({
      action:                'move_here',
      destExerciseDbId:      'A001',
      ymoveId:               YMOVE_UUID,
      revokeFromDbIds:       ['A002'],
      isJsonOnlyIds:         [],
      verified:              false,
      expectedUpdatedAts:    { A002: updatedAt.toISOString() },
      expectedDestUpdatedAt: null,      // reviewer expected no DB row for dest
      expectedOwnerDbIds:    ['A002'],
    }))

    expect(res.status).toBe(409)
    const data = await res.json() as { stale: boolean }
    expect(data.stale).toBe(true)
    // Source must not have been revoked
    expect(_mockDb['A002']?.ymoveId).toBe(YMOVE_UUID)
  })

  it('returns 409 when dest DB row updatedAt changed concurrently', async () => {
    const srcUpdatedAt  = new Date('2026-09-01T00:00:00Z')
    const destUpdatedAt = new Date('2026-09-10T00:00:00Z')
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: srcUpdatedAt }
    _mockDb['A001'] = { ymoveId: 'draft-ymove', verifiedAt: null, updatedAt: destUpdatedAt }

    // Reviewer opened the panel when dest updatedAt was 2026-09-05 (stale now)
    const staleDestTime = new Date('2026-09-05T00:00:00Z').toISOString()

    const res = await POST(postReq({
      action:                'move_here',
      destExerciseDbId:      'A001',
      ymoveId:               YMOVE_UUID,
      revokeFromDbIds:       ['A002'],
      isJsonOnlyIds:         [],
      verified:              false,
      expectedUpdatedAts:    { A002: srcUpdatedAt.toISOString() },
      expectedDestUpdatedAt: staleDestTime,
      expectedOwnerDbIds:    ['A002'],
    }))

    expect(res.status).toBe(409)
    const data = await res.json() as { stale: boolean; exerciseDbId: string }
    expect(data.stale).toBe(true)
    expect(data.exerciseDbId).toBe('A001')
    // Source must not have been revoked
    expect(_mockDb['A002']?.ymoveId).toBe(YMOVE_UUID)
  })
})

// ── POST — new-owner detection ─────────────────────────────────────────────────

describe('POST move_here — new-owner detection', () => {
  beforeEach(clearState)

  it('returns 409 when a new owner of the same UUID appeared since the panel loaded', async () => {
    const updatedAt = new Date('2026-09-01T00:00:00Z')
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt }
    // Concurrently, A003 also got assigned the same ymoveId (not in the panel snapshot)
    _mockDb['A003'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: new Date() }

    const res = await POST(postReq({
      action:                'move_here',
      destExerciseDbId:      'A001',
      ymoveId:               YMOVE_UUID,
      revokeFromDbIds:       ['A002'],
      isJsonOnlyIds:         [],
      verified:              false,
      expectedUpdatedAts:    { A002: updatedAt.toISOString() },
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A002'],  // A003 was not seen in the panel
    }))

    expect(res.status).toBe(409)
    const data = await res.json() as { stale: boolean }
    expect(data.stale).toBe(true)
    // Nothing should have been written
    expect(_mockDb['A001']).toBeUndefined()
    expect(_mockDb['A002']?.ymoveId).toBe(YMOVE_UUID)
  })

  it('does NOT return 409 for use_for_both when a new owner appeared (no revoke intent)', async () => {
    _mockDb['A002'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: new Date() }
    // A003 appeared concurrently — irrelevant for use_for_both (no revoke)
    _mockDb['A003'] = { ymoveId: YMOVE_UUID, verifiedAt: null, updatedAt: new Date() }

    const res = await POST(postReq({
      action:                'use_for_both',
      destExerciseDbId:      'A001',
      ymoveId:               YMOVE_UUID,
      revokeFromDbIds:       [],
      isJsonOnlyIds:         [],
      verified:              false,
      expectedUpdatedAts:    {},
      expectedDestUpdatedAt: null,
      expectedOwnerDbIds:    ['A002'],  // A003 not in snapshot — but use_for_both skips new-owner check
    }))

    expect(res.status).toBe(200)
    expect(_mockDb['A001']?.ymoveId).toBe(YMOVE_UUID)
    expect(_mockDb['A002']?.ymoveId).toBe(YMOVE_UUID)  // untouched
    expect(_mockDb['A003']?.ymoveId).toBe(YMOVE_UUID)  // untouched
  })
})
