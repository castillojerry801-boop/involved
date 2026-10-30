import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => Promise.resolve({ id: 'admin-user-id' }),
}))

vi.mock('@/lib/admin/auth', () => ({
  isAdmin: (_id: string) => true,
}))

const _mockMapping: Record<string, string | null> = {}
const _upsertCalls: Array<{ exerciseDbId: string; ymoveId: string | null }> = []
const _deleteCalls: string[] = []

vi.mock('@/lib/ymove/mapping', () => ({
  getAllMappings: () => Promise.resolve({ ..._mockMapping }),
  getAllMappingsWithMeta: () => Promise.resolve(
    Object.fromEntries(
      Object.entries(_mockMapping).map(([id, ymoveId]) => [id, { ymoveId, verifiedAt: null }]),
    ),
  ),
  upsertMapping: vi.fn().mockImplementation(
    (dbId: string, ymoveId: string | null) => {
      _upsertCalls.push({ exerciseDbId: dbId, ymoveId })
      _mockMapping[dbId] = ymoveId
      return Promise.resolve()
    },
  ),
  deleteMapping: vi.fn().mockImplementation((dbId: string) => {
    _deleteCalls.push(dbId)
    delete _mockMapping[dbId]
    return Promise.resolve()
  }),
}))

vi.mock('@/lib/exercises', () => ({
  exercises: [
    { id: '0026', name: 'barbell bench squat', equipment: 'barbell', bodyPart: 'chest', target: 'pectorals' },
    { id: '0043', name: 'dumbbell fly',        equipment: 'dumbbell', bodyPart: 'chest', target: 'pectorals' },
    { id: '0999', name: 'dumbbell curl',       equipment: 'dumbbell', bodyPart: 'upper arms', target: 'biceps brachii' },
  ],
  getExerciseById: (id: string) => {
    const map: Record<string, { id: string; name: string }> = {
      '0026': { id: '0026', name: 'barbell bench squat' },
      '0043': { id: '0043', name: 'dumbbell fly' },
      '0999': { id: '0999', name: 'dumbbell curl' },
    }
    return map[id]
  },
  getGifUrl: (id: string) => `https://cdn.example.com/gifs/${id}.gif`,
}))

vi.mock('@/lib/exercises/canonical', () => ({
  getInvolvedDisplayName: (_id: string, rawName: string) => rawName,
  getCanonicalByExerciseDbId: () => null,
  MOVEMENT_PATTERN_LABELS: {},
}))

vi.mock('@/lib/ymove/search', () => ({
  buildSearchQuery: () => 'bench press',
  rankCandidates: (candidates: unknown[]) => candidates,
  STARTER_BATCH_IDS: new Set(['0026']),
}))

// ── Route imports ─────────────────────────────────────────────────────────────

import { PATCH, DELETE as DELETE_ROUTE } from '@/app/api/admin/ymove-mapping/route'
import { GET as GET_SUGGESTIONS, POST as POST_SUGGESTIONS } from '@/app/api/admin/ymove-mapping/suggestions/route'
import { NextRequest } from 'next/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function setMapping(m: Record<string, string | null>) {
  Object.keys(_mockMapping).forEach(k => delete _mockMapping[k])
  Object.assign(_mockMapping, m)
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ymove-mapping', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ymove-mapping', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function suggestionsGetRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/ymove-mapping/suggestions')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

// ── PATCH /api/admin/ymove-mapping — conflict detection ───────────────────────

describe('PATCH /api/admin/ymove-mapping — conflict detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMapping({})
    _upsertCalls.length = 0
    _deleteCalls.length = 0
  })

  it('approves a clean mapping (200)', async () => {
    const res = await PATCH(patchRequest({ exerciseDbId: '0026', ymoveExerciseId: 'uuid-a' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean }
    expect(data.ok).toBe(true)
    expect(_upsertCalls).toHaveLength(1)
  })

  it('records a rejection (null) without conflict check (200)', async () => {
    const res = await PATCH(patchRequest({ exerciseDbId: '0026', ymoveExerciseId: null }))
    expect(res.status).toBe(200)
    expect(_upsertCalls[0]).toEqual({ exerciseDbId: '0026', ymoveId: null })
  })

  it('returns 409 when UUID is already mapped to a DIFFERENT exercise', async () => {
    setMapping({ '0026': 'uuid-taken' })

    const res = await PATCH(patchRequest({ exerciseDbId: '0043', ymoveExerciseId: 'uuid-taken' }))
    expect(res.status).toBe(409)

    const data = await res.json() as { conflict: boolean; existingDbId: string; existingName: string; message: string }
    expect(data.conflict).toBe(true)
    expect(data.existingDbId).toBe('0026')
    expect(typeof data.existingName).toBe('string')
    expect(data.existingName.length).toBeGreaterThan(0)
    // Mapping must NOT have been written
    expect(_upsertCalls).toHaveLength(0)
  })

  it('409 response includes a human-readable existingName (not just the ID)', async () => {
    setMapping({ '0026': 'uuid-taken' })

    const res = await PATCH(patchRequest({ exerciseDbId: '0043', ymoveExerciseId: 'uuid-taken' }))
    const data = await res.json() as { existingName?: string }
    // Must be a name string, not just the raw ID "0026"
    expect(data.existingName).toBeDefined()
    expect(data.existingName).not.toBe('0026')
  })

  it('forceOverwrite: true bypasses the conflict check (200)', async () => {
    setMapping({ '0026': 'uuid-taken' })

    const res = await PATCH(patchRequest({
      exerciseDbId: '0043',
      ymoveExerciseId: 'uuid-taken',
      forceOverwrite: true,
    }))
    expect(res.status).toBe(200)
    expect(_upsertCalls).toHaveLength(1)
    expect(_upsertCalls[0]).toEqual({ exerciseDbId: '0043', ymoveId: 'uuid-taken' })
  })

  it('re-mapping the SAME exercise to a new UUID does not conflict (200)', async () => {
    setMapping({ '0026': 'uuid-old' })

    const res = await PATCH(patchRequest({ exerciseDbId: '0026', ymoveExerciseId: 'uuid-new' }))
    expect(res.status).toBe(200)
    expect(_upsertCalls[0]).toEqual({ exerciseDbId: '0026', ymoveId: 'uuid-new' })
  })

  it('returns 400 when exerciseDbId is missing', async () => {
    const res = await PATCH(patchRequest({ ymoveExerciseId: 'uuid-a' }))
    expect(res.status).toBe(400)
    expect(_upsertCalls).toHaveLength(0)
  })
})

// ── DELETE /api/admin/ymove-mapping — reconsider path ─────────────────────────

describe('DELETE /api/admin/ymove-mapping — reconsider path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMapping({})
    _deleteCalls.length = 0
  })

  it('removes a mapping and returns 200', async () => {
    setMapping({ '0026': 'uuid-a' })

    const res = await DELETE_ROUTE(deleteRequest({ exerciseDbId: '0026' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean; exerciseDbId: string }
    expect(data.ok).toBe(true)
    expect(data.exerciseDbId).toBe('0026')
  })

  it('calling DELETE returns the mapping to pending state (exerciseDbId removed from DB)', async () => {
    setMapping({ '0026': null }) // previously rejected

    await DELETE_ROUTE(deleteRequest({ exerciseDbId: '0026' }))
    expect(_deleteCalls).toContain('0026')
  })

  it('returns 400 when exerciseDbId is missing', async () => {
    const res = await DELETE_ROUTE(deleteRequest({}))
    expect(res.status).toBe(400)
  })
})

// ── GET /api/admin/ymove-mapping/suggestions — enrichment ─────────────────────

const MOCK_SUGGESTIONS = {
  generatedAt: '2026-10-28T12:00:00Z',
  summary: { highConfidence: 1, needsReview: 0, unmatched: 0, total: 1 },
  suggestions: [
    {
      exerciseDbId: '0026',
      displayName:  'barbell bench squat',
      equipment:    'barbell',
      bodyPart:     'chest',
      target:       'pectorals',
      status:       'high_confidence' as const,
      topMatch: {
        ymoveId:       'ymove-uuid-bench',
        name:          'Barbell Bench Press',
        score:         95,
        confidence:    'strong' as const,
        matchReasons:  ['name_match'],
        penaltyReasons: [],
      },
    },
    {
      exerciseDbId: '0043',
      displayName:  'dumbbell fly',
      equipment:    'dumbbell',
      bodyPart:     'chest',
      target:       'pectorals',
      status:       'high_confidence' as const,
      topMatch: {
        ymoveId:       'ymove-uuid-bench', // same UUID — pipeline conflict
        name:          'Barbell Bench Press',
        score:         60,
        confidence:    'possible' as const,
        matchReasons:  [],
        penaltyReasons: ['equipment_mismatch'],
      },
    },
  ],
}

vi.mock('@/lib/ymove/suggestions-store', () => ({
  loadSuggestions: () => ({ ...MOCK_SUGGESTIONS }),
}))

describe('GET /api/admin/ymove-mapping/suggestions — reviewStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMapping({})
  })

  it('returns reviewStatus=pending when exercise has no mapping', async () => {
    setMapping({})
    const res = await GET_SUGGESTIONS(suggestionsGetRequest())
    const data = await res.json() as { suggestions: Array<{ exerciseDbId: string; reviewStatus: string }> }
    const s = data.suggestions.find(s => s.exerciseDbId === '0026')!
    expect(s.reviewStatus).toBe('pending')
  })

  it('returns reviewStatus=approved when active mapping matches suggested ymoveId', async () => {
    setMapping({ '0026': 'ymove-uuid-bench' })
    const res = await GET_SUGGESTIONS(suggestionsGetRequest())
    const data = await res.json() as { suggestions: Array<{ exerciseDbId: string; reviewStatus: string }> }
    const s = data.suggestions.find(s => s.exerciseDbId === '0026')!
    expect(s.reviewStatus).toBe('approved')
  })

  it('returns reviewStatus=rejected when mapping is null', async () => {
    setMapping({ '0026': null })
    const res = await GET_SUGGESTIONS(suggestionsGetRequest())
    const data = await res.json() as { suggestions: Array<{ exerciseDbId: string; reviewStatus: string }> }
    const s = data.suggestions.find(s => s.exerciseDbId === '0026')!
    expect(s.reviewStatus).toBe('rejected')
  })

  it('returns reviewStatus=overridden when active mapping has a different UUID', async () => {
    setMapping({ '0026': 'ymove-uuid-different' })
    const res = await GET_SUGGESTIONS(suggestionsGetRequest())
    const data = await res.json() as { suggestions: Array<{ exerciseDbId: string; reviewStatus: string }> }
    const s = data.suggestions.find(s => s.exerciseDbId === '0026')!
    expect(s.reviewStatus).toBe('overridden')
  })
})

describe('GET /api/admin/ymove-mapping/suggestions — activeConflictName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMapping({})
  })

  it('includes activeConflictName when UUID is already in active mapping', async () => {
    // 0026 actively mapped to ymove-uuid-bench; 0043 suggests same UUID
    setMapping({ '0026': 'ymove-uuid-bench' })

    const res = await GET_SUGGESTIONS(suggestionsGetRequest())
    const data = await res.json() as {
      suggestions: Array<{
        exerciseDbId: string
        activeConflictDbId: string | null
        activeConflictName: string | null
      }>
    }

    const s = data.suggestions.find(s => s.exerciseDbId === '0043')!
    expect(s.activeConflictDbId).toBe('0026')
    // Must be a display name, not null
    expect(s.activeConflictName).not.toBeNull()
    expect(typeof s.activeConflictName).toBe('string')
  })

  it('activeConflictName is null when no UUID conflict exists', async () => {
    setMapping({})
    const res = await GET_SUGGESTIONS(suggestionsGetRequest())
    const data = await res.json() as {
      suggestions: Array<{ exerciseDbId: string; activeConflictName: string | null }>
    }
    const s = data.suggestions.find(s => s.exerciseDbId === '0026')!
    expect(s.activeConflictName).toBeNull()
  })

  it('activeConflictName is a human-readable name, not the raw ExerciseDB ID', async () => {
    setMapping({ '0026': 'ymove-uuid-bench' })

    const res = await GET_SUGGESTIONS(suggestionsGetRequest())
    const data = await res.json() as {
      suggestions: Array<{ exerciseDbId: string; activeConflictName: string | null }>
    }
    const s = data.suggestions.find(s => s.exerciseDbId === '0043')!
    // Should NOT be just the raw ID "0026"
    expect(s.activeConflictName).not.toBe('0026')
    // Should be a descriptive string
    expect(s.activeConflictName!.length).toBeGreaterThan(4)
  })

  it('suggestedConflictDbIds detects within-pipeline UUID collisions', async () => {
    setMapping({})
    const res = await GET_SUGGESTIONS(suggestionsGetRequest())
    const data = await res.json() as {
      suggestions: Array<{ exerciseDbId: string; suggestedConflictDbIds: string[] }>
    }
    // Both 0026 and 0043 suggest ymove-uuid-bench — each should see the other in suggestedConflictDbIds
    const s0026 = data.suggestions.find(s => s.exerciseDbId === '0026')!
    const s0043 = data.suggestions.find(s => s.exerciseDbId === '0043')!
    expect(s0026.suggestedConflictDbIds).toContain('0043')
    expect(s0043.suggestedConflictDbIds).toContain('0026')
  })
})

// ── POST /api/admin/ymove-mapping/suggestions — batch conflict details ─────────
// These tests verify the batch response tells the caller WHICH items were skipped
// and WHY, so the UI can show actionable feedback (not just a silent reload).

describe('POST /api/admin/ymove-mapping/suggestions — conflict response shape', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMapping({})
    _upsertCalls.length = 0
  })

  function batchRequest(approvals: unknown[]) {
    return new NextRequest('http://localhost/api/admin/ymove-mapping/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvals }),
    })
  }

  it('response includes approved + skipped counts when some conflict', async () => {
    setMapping({ '0099': 'uuid-conflict' })

    const res = await POST_SUGGESTIONS(batchRequest([
      { exerciseDbId: '0001', ymoveId: 'uuid-conflict' }, // conflict
      { exerciseDbId: '0002', ymoveId: 'uuid-clean' },    // clean
    ]))
    const data = await res.json() as { approved: number; skipped: number; conflicts: unknown[] }
    expect(data.approved).toBe(1)
    expect(data.skipped).toBe(1)
    expect(data.conflicts).toHaveLength(1)
  })

  it('conflict entry includes exerciseDbId and ymoveId for the skipped item', async () => {
    setMapping({ '0099': 'uuid-conflict' })

    const res = await POST_SUGGESTIONS(batchRequest([
      { exerciseDbId: '0001', ymoveId: 'uuid-conflict' },
    ]))
    const data = await res.json() as {
      conflicts: Array<{ exerciseDbId: string; ymoveId: string; reason: string }>
    }
    expect(data.conflicts[0].exerciseDbId).toBe('0001')
    expect(data.conflicts[0].ymoveId).toBe('uuid-conflict')
    expect(data.conflicts[0].reason).toMatch(/0099/)
  })
})
