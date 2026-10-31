/**
 * Preflight regression tests for the 4-queue YMove reviewer.
 *
 * Preflight items verified by code inspection (not unit-testable in isolation):
 *   3+4. No skips — QUEUE_LIMIT=1400 loads all exercises in one request, eliminating
 *        offset-shift skipping. MatchReviewer advances queueIndex sequentially; verified
 *        items are removed from the array (next slides to current index); non-verified
 *        decisions advance index; reconsider updates in-place.
 *   5.   Accurate counts — verified increments verified+decrements needs_review in
 *        handleDecision. approved/rejected triggers refreshCounts() background call.
 *   6.   Unmapped search — unmapped exercises have topMatch=null so MatchReviewer shows
 *        "No candidates" + search bar; search calls /api/admin/ymove-mapping?search=...
 *   9.   Video allowance — queue API returns no videoUrl. UnusedYMoveTab uses thumbnail
 *        proxy only. Video loaded on explicit Play click via /api/admin/ymove-mapping?preview=
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

vi.mock('@/lib/ymove/mapping', () => ({
  getAllMappingsWithMeta: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  getUser: vi.fn(),
}))

vi.mock('@/lib/admin/auth', () => ({
  isAdmin: vi.fn(),
}))

vi.mock('@/lib/exercises', () => ({
  exercises: [
    { id: 'EX001', name: 'Bench Press',       equipment: 'barbell',     bodyPart: 'chest',      target: 'pectorals'  },
    { id: 'EX002', name: 'Squat',             equipment: 'barbell',     bodyPart: 'upper legs', target: 'quads'      },
    { id: 'EX003', name: 'Pull Up',           equipment: 'body weight', bodyPart: 'back',       target: 'lats'       },
    { id: 'EX004', name: 'Overhead Press',    equipment: 'barbell',     bodyPart: 'shoulders',  target: 'delts'      },
    { id: 'EX005', name: 'Romanian Deadlift', equipment: 'barbell',     bodyPart: 'upper legs', target: 'hamstrings' },
  ],
}))

vi.mock('@/lib/exercises/canonical', () => ({
  getInvolvedDisplayName: (_id: string, name: string) => name,
  getCanonicalByExerciseDbId: () => undefined,
  MOVEMENT_PATTERN_LABELS: {},
}))

vi.mock('@/lib/ymove/search', () => ({
  buildSearchQuery: (meta: { displayName: string }) => `search:${meta.displayName}`,
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

import { getAllMappingsWithMeta } from '@/lib/ymove/mapping'
import { getUser }  from '@/lib/supabase/server'
import { isAdmin }  from '@/lib/admin/auth'
import { GET }      from '@/app/api/admin/ymove-mapping/queue/route'
import { NextRequest } from 'next/server'

const mockMeta  = vi.mocked(getAllMappingsWithMeta)
const mockUser  = vi.mocked(getUser)
const mockAdmin = vi.mocked(isAdmin)

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/ymove-mapping/queue')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

type QueueBody = {
  exercises: Array<{
    exerciseDbId:         string
    queueStatus:          string
    ymoveExerciseId:      string | null
    verifiedAt:           string | null
    suggestedSearchQuery: string
    displayName:          string
  }>
  counts: { needs_review: number; verified: number; unmapped: number }
  total:  number
  page:   number
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUser.mockResolvedValue({ id: 'admin-1', email: 'admin@test.com' } as never)
  mockAdmin.mockReturnValue(true)
})

// ── Preflight 1: server authority / classification ───────────────────────────

describe('1. server authority — status derived from getAllMappingsWithMeta()', () => {
  it('exercise absent from meta → unmapped (never checked)', async () => {
    mockMeta.mockResolvedValue({})
    const body = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.exercises.every(e => e.queueStatus === 'unmapped')).toBe(true)
  })

  it('meta entry ymoveId set + verifiedAt null → approved_unverified (JSON-baseline or unverified DB row)', async () => {
    // getAllMappingsWithMeta applies DB-wins merge internally. When it returns
    // { ymoveId: 'X', verifiedAt: null }, the exercise is mapped but not visually verified.
    // Queue API must classify it approved_unverified — not unmapped, not verified.
    mockMeta.mockResolvedValue({ EX001: { ymoveId: 'ymove-abc', verifiedAt: null } })
    const body = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    const ex   = body.exercises.find(e => e.exerciseDbId === 'EX001')
    expect(ex?.queueStatus).toBe('approved_unverified')
    expect(ex?.ymoveExerciseId).toBe('ymove-abc')
  })

  it('meta entry ymoveId=null → rejected (DB null row overrides JSON baseline UUID)', async () => {
    // A DB row with ymoveId=null means the admin explicitly rejected this exercise.
    // getAllMappingsWithMeta returns null, beating any JSON-baseline entry.
    mockMeta.mockResolvedValue({ EX002: { ymoveId: null, verifiedAt: null } })
    const body = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    const ex   = body.exercises.find(e => e.exerciseDbId === 'EX002')
    expect(ex?.queueStatus).toBe('rejected')
    expect(ex?.ymoveExerciseId).toBeNull()
  })

  it('meta entry ymoveId set + verifiedAt set → verified', async () => {
    mockMeta.mockResolvedValue({
      EX003: { ymoveId: 'ymove-xyz', verifiedAt: new Date('2026-10-01T00:00:00Z') },
    })
    const body = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    const ex   = body.exercises.find(e => e.exerciseDbId === 'EX003')
    expect(ex?.queueStatus).toBe('verified')
    expect(ex?.ymoveExerciseId).toBe('ymove-xyz')
  })
})

// ── Preflight 2: verifiedAt preservation across reload ───────────────────────

describe('2. verifiedAt preservation — not reset by reload', () => {
  it('exercise with past verifiedAt → always verified regardless of how many times the API is called', async () => {
    const ts = new Date('2026-09-15T08:30:00Z')
    mockMeta.mockResolvedValue({ EX004: { ymoveId: 'ymove-def', verifiedAt: ts } })

    const b1 = await GET(makeReq({ mode: 'verified', limit: '10' })).then(r => r.json()) as QueueBody
    const b2 = await GET(makeReq({ mode: 'verified', limit: '10' })).then(r => r.json()) as QueueBody

    expect(b1.exercises.find(e => e.exerciseDbId === 'EX004')?.queueStatus).toBe('verified')
    expect(b1.exercises.find(e => e.exerciseDbId === 'EX004')?.verifiedAt).toBe(ts.toISOString())
    expect(b2.exercises.find(e => e.exerciseDbId === 'EX004')?.queueStatus).toBe('verified')
  })

  it('exercise with verifiedAt=null is always approved_unverified, never auto-promoted to verified', async () => {
    mockMeta.mockResolvedValue({ EX005: { ymoveId: 'ymove-ghi', verifiedAt: null } })
    const body = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    const ex   = body.exercises.find(e => e.exerciseDbId === 'EX005')
    expect(ex?.queueStatus).toBe('approved_unverified')
    expect(ex?.verifiedAt).toBeNull()
  })
})

// ── Preflight 3+4: pagination correctness / no skips ─────────────────────────

describe('3+4. no skips — large limit returns all exercises in one request', () => {
  it('limit=1400 returns all 5 exercises in a single request (no pagination needed)', async () => {
    mockMeta.mockResolvedValue({})
    const body = await GET(makeReq({ mode: 'all', limit: '1400' })).then(r => r.json()) as QueueBody
    expect(body.exercises.length).toBe(5)
    expect(body.total).toBe(5)
  })

  it('no duplicate exerciseDbIds at large limit', async () => {
    mockMeta.mockResolvedValue({})
    const body = await GET(makeReq({ mode: 'all', limit: '1400' })).then(r => r.json()) as QueueBody
    const ids  = body.exercises.map(e => e.exerciseDbId)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('verifying exercises reduces the needs_review total returned by the API', async () => {
    mockMeta.mockResolvedValue({
      EX001: { ymoveId: 'v1', verifiedAt: new Date() },
      EX002: { ymoveId: 'v2', verifiedAt: new Date() },
    })
    const r1 = await GET(makeReq({ mode: 'needs_review', limit: '1400' })).then(r => r.json()) as QueueBody
    expect(r1.total).toBe(3) // EX003, EX004, EX005

    mockMeta.mockResolvedValue({
      EX001: { ymoveId: 'v1', verifiedAt: new Date() },
      EX002: { ymoveId: 'v2', verifiedAt: new Date() },
      EX003: { ymoveId: 'v3', verifiedAt: new Date() }, // newly verified
    })
    const r2 = await GET(makeReq({ mode: 'needs_review', limit: '1400' })).then(r => r.json()) as QueueBody
    expect(r2.total).toBe(2)
  })
})

// ── Preflight 5: count invariants ─────────────────────────────────────────────

describe('5. accurate counts', () => {
  it('counts.verified + counts.needs_review = total exercises', async () => {
    mockMeta.mockResolvedValue({
      EX001: { ymoveId: null,  verifiedAt: null                              }, // rejected
      EX002: { ymoveId: 'abc', verifiedAt: null                              }, // approved_unverified
      EX003: { ymoveId: 'def', verifiedAt: new Date('2026-10-01T00:00:00Z') }, // verified
    })
    const body = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.counts.verified + body.counts.needs_review).toBe(5)
  })

  it('counts.unmapped ≤ counts.needs_review (unmapped is a subset of needs_review)', async () => {
    mockMeta.mockResolvedValue({
      EX001: { ymoveId: null,  verifiedAt: null },
      EX002: { ymoveId: 'abc', verifiedAt: null },
    })
    const body = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.counts.unmapped).toBeLessThanOrEqual(body.counts.needs_review)
  })

  it('verifying an exercise shifts one item from needs_review to verified in counts', async () => {
    mockMeta.mockResolvedValue({ EX001: { ymoveId: 'abc', verifiedAt: null } })
    const before = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody

    mockMeta.mockResolvedValue({ EX001: { ymoveId: 'abc', verifiedAt: new Date() } })
    const after = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody

    expect(after.counts.needs_review).toBe(before.counts.needs_review - 1)
    expect(after.counts.verified).toBe(before.counts.verified + 1)
  })
})

// ── Preflight 6: unmapped exercises have searchable metadata ─────────────────

describe('6. unmapped exercises are searchable', () => {
  it('unmapped exercises have ymoveExerciseId=null', async () => {
    mockMeta.mockResolvedValue({})
    const body = await GET(makeReq({ mode: 'unmapped', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.exercises.every(e => e.ymoveExerciseId === null)).toBe(true)
  })

  it('unmapped exercises have non-empty suggestedSearchQuery for use in candidate search', async () => {
    mockMeta.mockResolvedValue({})
    const body = await GET(makeReq({ mode: 'unmapped', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.exercises.every(e => e.suggestedSearchQuery.length > 0)).toBe(true)
  })

  it('unmapped exercise queueStatus is unmapped', async () => {
    mockMeta.mockResolvedValue({})
    const body = await GET(makeReq({ mode: 'unmapped', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.exercises.every(e => e.queueStatus === 'unmapped')).toBe(true)
  })
})

// ── Preflight 7: rejection persistence ───────────────────────────────────────

describe('7. rejection persistence', () => {
  beforeEach(() => {
    mockMeta.mockResolvedValue({ EX002: { ymoveId: null, verifiedAt: null } })
  })

  it('rejected exercise → queueStatus=rejected', async () => {
    const body = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.exercises.find(e => e.exerciseDbId === 'EX002')?.queueStatus).toBe('rejected')
  })

  it('rejected exercise appears in needs_review mode', async () => {
    const body = await GET(makeReq({ mode: 'needs_review', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.exercises.some(e => e.exerciseDbId === 'EX002')).toBe(true)
  })

  it('rejected exercise appears in unmapped mode', async () => {
    const body = await GET(makeReq({ mode: 'unmapped', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.exercises.some(e => e.exerciseDbId === 'EX002')).toBe(true)
  })

  it('rejected exercise does NOT appear in verified mode', async () => {
    const body = await GET(makeReq({ mode: 'verified', limit: '10' })).then(r => r.json()) as QueueBody
    expect(body.exercises.some(e => e.exerciseDbId === 'EX002')).toBe(false)
  })

  it('rejection persists across multiple API calls — no auto-reset without explicit reconsider', async () => {
    const b1 = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    const b2 = await GET(makeReq({ mode: 'all', limit: '10' })).then(r => r.json()) as QueueBody
    expect(b1.exercises.find(e => e.exerciseDbId === 'EX002')?.queueStatus).toBe('rejected')
    expect(b2.exercises.find(e => e.exerciseDbId === 'EX002')?.queueStatus).toBe('rejected')
  })
})

// ── Preflight 8: effective mapping includes JSON baseline ─────────────────────

describe('8. effective mapping — JSON-baseline UUID treated as mapped (not unused)', () => {
  it('exercise whose getAllMappingsWithMeta returns a ymoveId is approved_unverified, not unmapped', async () => {
    // getAllMappingsWithMeta already applies DB-wins merge. When it returns
    // { ymoveId: 'json-baseline-uuid', verifiedAt: null }, this is the result of the
    // JSON-baseline entry (no DB row overriding it). Queue API must classify it as
    // approved_unverified — it is effectively mapped and must NOT appear in the unmapped queue.
    mockMeta.mockResolvedValue({ EX001: { ymoveId: 'json-baseline-uuid', verifiedAt: null } })
    const umBody = await GET(makeReq({ mode: 'unmapped', limit: '10' })).then(r => r.json()) as QueueBody
    expect(umBody.exercises.some(e => e.exerciseDbId === 'EX001')).toBe(false)
  })

  it('JSON-baseline mapped exercise appears in needs_review but not unmapped', async () => {
    mockMeta.mockResolvedValue({ EX001: { ymoveId: 'json-baseline-uuid', verifiedAt: null } })

    const nrBody = await GET(makeReq({ mode: 'needs_review', limit: '10' })).then(r => r.json()) as QueueBody
    expect(nrBody.exercises.some(e => e.exerciseDbId === 'EX001')).toBe(true)

    const umBody = await GET(makeReq({ mode: 'unmapped', limit: '10' })).then(r => r.json()) as QueueBody
    expect(umBody.exercises.some(e => e.exerciseDbId === 'EX001')).toBe(false)
  })
})

// ── Preflight 10: admin authentication ───────────────────────────────────────

describe('10. admin authentication on queue endpoint', () => {
  it('returns 403 when no user session', async () => {
    mockUser.mockResolvedValue(null)
    mockMeta.mockResolvedValue({})
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns 403 when user is not an admin', async () => {
    mockAdmin.mockReturnValue(false)
    mockMeta.mockResolvedValue({})
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns 200 when user is an admin', async () => {
    mockMeta.mockResolvedValue({})
    const res = await GET(makeReq({ mode: 'all', limit: '5' }))
    expect(res.status).toBe(200)
  })

  it('body never exposed for unauthenticated requests', async () => {
    mockUser.mockResolvedValue(null)
    mockMeta.mockResolvedValue({})
    const body = await GET(makeReq()).then(r => r.json()) as { error?: string; exercises?: unknown[] }
    expect(body.exercises).toBeUndefined()
    expect(body.error).toBe('Forbidden')
  })
})
