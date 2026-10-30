/**
 * Regression tests for the MatchReviewer feature.
 *
 * Tests cover:
 * - PATCH with verified=true sets verifiedAt via upsertMapping
 * - PATCH with verified=false does NOT set verifiedAt
 * - forceOverwrite still required when duplicate UUID + verified=true
 * - GET /api/admin/ymove-mapping returns verifiedAt per exercise
 * - GET /api/admin/ymove-mapping/suggestions returns verifiedAt per suggestion
 * - Candidate search returns scored results
 * - Video preview route charges only on ?preview= param (not on browse search)
 */

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
const _mockMeta: Record<string, { ymoveId: string | null; verifiedAt: Date | null }> = {}
const _upsertCalls: Array<{ exerciseDbId: string; ymoveId: string | null; verified: boolean }> = []

vi.mock('@/lib/ymove/mapping', () => ({
  getAllMappings: () => Promise.resolve({ ..._mockMapping }),
  getAllMappingsWithMeta: () => Promise.resolve({ ..._mockMeta }),
  upsertMapping: vi.fn().mockImplementation(
    (dbId: string, ymoveId: string | null, verified = false) => {
      _upsertCalls.push({ exerciseDbId: dbId, ymoveId, verified })
      _mockMapping[dbId] = ymoveId
      _mockMeta[dbId] = {
        ymoveId,
        verifiedAt: verified ? new Date('2026-01-01T00:00:00Z') : null,
      }
      return Promise.resolve()
    },
  ),
  deleteMapping: vi.fn().mockImplementation((dbId: string) => {
    delete _mockMapping[dbId]
    delete _mockMeta[dbId]
    return Promise.resolve()
  }),
}))

vi.mock('@/lib/ymove/client', () => ({
  searchYmoveCandidates: vi.fn().mockResolvedValue([
    {
      ymoveId: 'ymove-abc',
      name: 'Barbell Bench Press',
      score: 90,
      confidence: 'strong',
      matchReasons: ['name match'],
      penaltyReasons: [],
    },
  ]),
  getYmoveById: vi.fn().mockImplementation((ymoveId: string, includeVideo: boolean) => {
    if (!includeVideo) return Promise.resolve(null)
    return Promise.resolve({
      ymoveId,
      videoUrl: `https://cdn.ymove.app/${ymoveId}.mp4`,
      videoHlsUrl: null,
      videoDurationSecs: 12,
    })
  }),
}))

vi.mock('@/lib/exercises', () => ({
  exercises: [
    { id: '0026', name: 'barbell bench squat', equipment: 'barbell', bodyPart: 'chest', target: 'pectorals' },
    { id: '0043', name: 'dumbbell fly',        equipment: 'dumbbell', bodyPart: 'chest', target: 'pectorals' },
  ],
}))

vi.mock('@/lib/exercises/canonical', () => ({
  getInvolvedDisplayName: (_id: string, rawName: string) => rawName,
  getCanonicalByExerciseDbId: () => null,
  MOVEMENT_PATTERN_LABELS: {},
}))

vi.mock('@/lib/ymove/search', () => ({
  buildSearchQuery: () => 'bench press',
  rankCandidates: (candidates: unknown[]) =>
    (candidates as Array<{ ymoveId: string; name: string; score: number; confidence: string; matchReasons: string[]; penaltyReasons: string[] }>).map(c => ({
      ...c,
      alreadyMappedTo: null,
      alreadyMappedDbId: null,
    })),
  STARTER_BATCH_IDS: new Set(['0026']),
}))

vi.mock('@/lib/ymove/suggestions-store', () => ({
  loadSuggestions: () => ({
    generatedAt: '2026-01-01T00:00:00Z',
    summary: { total: 1, high_confidence: 1, needs_review: 0, unmatched: 0 },
    suggestions: [
      {
        exerciseDbId:    '0026',
        displayName:     'barbell bench squat',
        equipment:       'barbell',
        bodyPart:        'chest',
        target:          'pectorals',
        searchQuery:     'barbell bench squat',
        searchedAt:      '2026-01-01T00:00:00Z',
        status:          'high_confidence',
        topMatch:        { ymoveId: 'ymove-abc', name: 'Bench Press', score: 90, confidence: 'strong', matchReasons: [], penaltyReasons: [] },
        otherCandidates: [],
      },
    ],
  }),
}))

// ── Route imports (after mocks) ───────────────────────────────────────────────

import { GET, PATCH } from '@/app/api/admin/ymove-mapping/route'
import { GET as GET_SUGGESTIONS } from '@/app/api/admin/ymove-mapping/suggestions/route'
import { NextRequest } from 'next/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearState() {
  Object.keys(_mockMapping).forEach(k => delete _mockMapping[k])
  Object.keys(_mockMeta).forEach(k => delete _mockMeta[k])
  _upsertCalls.length = 0
}

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/ymove-mapping', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/ymove-mapping')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function suggestionsReq() {
  return new NextRequest('http://localhost/api/admin/ymove-mapping/suggestions')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/ymove-mapping — verified flag (MatchReviewer)', () => {
  beforeEach(clearState)

  it('passes verified=true to upsertMapping when flag is set', async () => {
    const res = await PATCH(patchReq({ exerciseDbId: '0026', ymoveExerciseId: 'ymove-abc', verified: true }))
    expect(res.status).toBe(200)
    const data = await res.json() as { verified: boolean }
    expect(data.verified).toBe(true)
    const call = _upsertCalls.find(c => c.exerciseDbId === '0026')
    expect(call?.verified).toBe(true)
  })

  it('passes verified=false (default) when flag is omitted', async () => {
    const res = await PATCH(patchReq({ exerciseDbId: '0026', ymoveExerciseId: 'ymove-abc' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { verified: boolean }
    expect(data.verified).toBe(false)
    const call = _upsertCalls.find(c => c.exerciseDbId === '0026')
    expect(call?.verified).toBe(false)
  })

  it('verified=true is blocked by 409 if duplicate UUID (no forceOverwrite)', async () => {
    _mockMapping['0043'] = 'ymove-abc'
    _mockMeta['0043'] = { ymoveId: 'ymove-abc', verifiedAt: null }

    const res = await PATCH(patchReq({ exerciseDbId: '0026', ymoveExerciseId: 'ymove-abc', verified: true }))
    expect(res.status).toBe(409)
    // Must NOT have written anything
    expect(_upsertCalls.length).toBe(0)
  })

  it('verified=true with forceOverwrite=true succeeds and sets verified', async () => {
    _mockMapping['0043'] = 'ymove-abc'
    _mockMeta['0043'] = { ymoveId: 'ymove-abc', verifiedAt: null }

    const res = await PATCH(patchReq({
      exerciseDbId: '0026',
      ymoveExerciseId: 'ymove-abc',
      forceOverwrite: true,
      verified: true,
    }))
    expect(res.status).toBe(200)
    const call = _upsertCalls.find(c => c.exerciseDbId === '0026')
    expect(call?.verified).toBe(true)
  })
})

describe('PATCH /api/admin/ymove-mapping — explicit confirmation semantics', () => {
  beforeEach(clearState)

  it('video-loaded-but-not-confirmed state must send verified=false (not verified=true)', async () => {
    // UI sends verified=false when video played but ownerConfirmed is false.
    // The route must persist that correctly — verifiedAt stays null.
    const res = await PATCH(patchReq({
      exerciseDbId: '0026',
      ymoveExerciseId: 'ymove-abc',
      verified: false,   // ← video played, owner NOT confirmed
    }))
    expect(res.status).toBe(200)
    const call = _upsertCalls.find(c => c.exerciseDbId === '0026')
    expect(call?.verified).toBe(false)
    expect(_mockMeta['0026']?.verifiedAt).toBeNull()
  })

  it('only verified=true (owner explicitly confirmed) sets verifiedAt', async () => {
    const res = await PATCH(patchReq({
      exerciseDbId: '0026',
      ymoveExerciseId: 'ymove-abc',
      verified: true,   // ← owner explicitly confirmed in the UI
    }))
    expect(res.status).toBe(200)
    expect(_mockMeta['0026']?.verifiedAt).not.toBeNull()
  })

  it('forceOverwrite without verified=true does not set verifiedAt (duplicate override, no confirmation)', async () => {
    _mockMapping['0043'] = 'ymove-abc'
    _mockMeta['0043'] = { ymoveId: 'ymove-abc', verifiedAt: null }

    const res = await PATCH(patchReq({
      exerciseDbId: '0026',
      ymoveExerciseId: 'ymove-abc',
      forceOverwrite: true,
      verified: false,  // ← override approved without visual confirmation
    }))
    expect(res.status).toBe(200)
    expect(_mockMeta['0026']?.verifiedAt).toBeNull()
  })

  it('replacing an existing mapping without verified=true resets verifiedAt to null', async () => {
    // Exercise was previously verified
    _mockMapping['0026'] = 'ymove-xyz'
    _mockMeta['0026'] = { ymoveId: 'ymove-xyz', verifiedAt: new Date('2026-01-01T00:00:00Z') }

    // Now replace with a different ymoveId without re-verifying
    const res = await PATCH(patchReq({
      exerciseDbId: '0026',
      ymoveExerciseId: 'ymove-new',
      verified: false,
    }))
    expect(res.status).toBe(200)
    // verifiedAt must be cleared — new UUID, not yet confirmed
    expect(_mockMeta['0026']?.verifiedAt).toBeNull()
  })
})

describe('GET /api/admin/ymove-mapping — approved queue (mapped exercises for reviewer)', () => {
  beforeEach(clearState)

  it('returns mapped exercises that can be used to build the approved review queue', async () => {
    _mockMapping['0026'] = 'ymove-abc'
    _mockMeta['0026'] = { ymoveId: 'ymove-abc', verifiedAt: null }

    const res = await GET(getReq({ status: 'mapped', limit: '500' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { exercises: Array<{ exerciseDbId: string; ymoveExerciseId: string | null; verifiedAt: string | null }> }
    const ex = data.exercises.find(e => e.exerciseDbId === '0026')
    expect(ex).toBeDefined()
    expect(ex?.ymoveExerciseId).toBe('ymove-abc')
    expect(ex?.verifiedAt).toBeNull()
  })

  it('returns verifiedAt for exercises confirmed with video', async () => {
    _mockMapping['0026'] = 'ymove-abc'
    _mockMeta['0026'] = { ymoveId: 'ymove-abc', verifiedAt: new Date('2026-10-01T00:00:00Z') }

    const res = await GET(getReq({ status: 'mapped', ids: '0026' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { exercises: Array<{ exerciseDbId: string; verifiedAt: string | null }> }
    const ex = data.exercises.find(e => e.exerciseDbId === '0026')
    expect(ex?.verifiedAt).toBe('2026-10-01T00:00:00.000Z')
  })

  it('does not return unmapped exercises in status=mapped filter', async () => {
    // 0026 is unmapped (not in mockMapping)
    const res = await GET(getReq({ status: 'mapped' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { exercises: Array<{ exerciseDbId: string }> }
    const ex = data.exercises.find(e => e.exerciseDbId === '0026')
    expect(ex).toBeUndefined()
  })
})

describe('GET /api/admin/ymove-mapping — verifiedAt in exercise list', () => {
  beforeEach(clearState)

  it('returns verifiedAt=null for an exercise mapped without video verification', async () => {
    _mockMapping['0026'] = 'ymove-abc'
    _mockMeta['0026'] = { ymoveId: 'ymove-abc', verifiedAt: null }

    const res = await GET(getReq({ ids: '0026' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { exercises: Array<{ exerciseDbId: string; verifiedAt: string | null }> }
    const ex = data.exercises.find(e => e.exerciseDbId === '0026')
    expect(ex?.verifiedAt).toBeNull()
  })

  it('returns verifiedAt as ISO string for an exercise verified with video', async () => {
    _mockMapping['0026'] = 'ymove-abc'
    _mockMeta['0026'] = { ymoveId: 'ymove-abc', verifiedAt: new Date('2026-01-01T00:00:00Z') }

    const res = await GET(getReq({ ids: '0026' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { exercises: Array<{ exerciseDbId: string; verifiedAt: string | null }> }
    const ex = data.exercises.find(e => e.exerciseDbId === '0026')
    expect(ex?.verifiedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('GET /api/admin/ymove-mapping/suggestions — verifiedAt in suggestion list', () => {
  beforeEach(clearState)

  it('returns verifiedAt=null for unverified pending suggestion', async () => {
    const res = await GET_SUGGESTIONS(suggestionsReq())
    expect(res.status).toBe(200)
    const data = await res.json() as { suggestions: Array<{ exerciseDbId: string; verifiedAt: string | null }> }
    const s = data.suggestions.find(s => s.exerciseDbId === '0026')
    expect(s?.verifiedAt).toBeNull()
  })

  it('returns verifiedAt as ISO string after video-verified approval', async () => {
    _mockMapping['0026'] = 'ymove-abc'
    _mockMeta['0026'] = { ymoveId: 'ymove-abc', verifiedAt: new Date('2026-03-15T10:00:00Z') }

    const res = await GET_SUGGESTIONS(suggestionsReq())
    expect(res.status).toBe(200)
    const data = await res.json() as { suggestions: Array<{ exerciseDbId: string; verifiedAt: string | null }> }
    const s = data.suggestions.find(s => s.exerciseDbId === '0026')
    expect(s?.verifiedAt).toBe('2026-03-15T10:00:00.000Z')
  })
})

describe('GET /api/admin/ymove-mapping?preview= — video-on-demand route', () => {
  it('returns videoUrl for a known ymove ID (charges quota)', async () => {
    const res = await GET(getReq({ preview: 'ymove-abc' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { videoUrl: string }
    expect(data.videoUrl).toContain('ymove-abc')
  })

  it('does NOT return videoUrl on a candidate search (browse mode)', async () => {
    const res = await GET(getReq({ search: 'bench press', exerciseId: '0026' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { candidates: Array<{ ymoveId: string; videoUrl?: string }> }
    // Browse search never has videoUrl on candidates
    for (const c of data.candidates) {
      expect((c as { videoUrl?: string }).videoUrl).toBeUndefined()
    }
  })
})
