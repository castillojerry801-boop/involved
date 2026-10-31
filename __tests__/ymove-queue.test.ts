import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

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
  buildSearchQuery: (meta: { displayName: string }) => meta.displayName,
}))

vi.mock('@/lib/ymove/mapping', () => ({
  getAllMappingsWithMeta: vi.fn(),
}))

import { getAllMappingsWithMeta } from '@/lib/ymove/mapping'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { GET } from '@/app/api/admin/ymove-mapping/queue/route'
import { NextRequest } from 'next/server'

const mockMeta      = vi.mocked(getAllMappingsWithMeta)
const mockGetUser   = vi.mocked(getUser)
const mockIsAdmin   = vi.mocked(isAdmin)

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/ymove-mapping/queue')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

describe('GET /api/admin/ymove-mapping/queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ id: 'admin-user', email: 'admin@test.com' } as never)
    mockIsAdmin.mockReturnValue(true)
  })

  describe('authentication', () => {
    it('returns 403 when no user', async () => {
      mockGetUser.mockResolvedValue(null)
      mockMeta.mockResolvedValue({})
      const res = await GET(makeReq())
      expect(res.status).toBe(403)
    })

    it('returns 403 when not admin', async () => {
      mockIsAdmin.mockReturnValue(false)
      mockMeta.mockResolvedValue({})
      const res = await GET(makeReq())
      expect(res.status).toBe(403)
    })
  })

  describe('status computation', () => {
    it('marks exercise as unmapped when no meta entry', async () => {
      mockMeta.mockResolvedValue({})
      const res = await GET(makeReq({ mode: 'all', limit: '10' }))
      const data = await res.json() as { exercises: Array<{ exerciseDbId: string; queueStatus: string }> }
      expect(data.exercises.every(e => e.queueStatus === 'unmapped')).toBe(true)
    })

    it('marks exercise as rejected when ymoveId is null', async () => {
      mockMeta.mockResolvedValue({ EX001: { ymoveId: null, verifiedAt: null } })
      const res = await GET(makeReq({ mode: 'all', limit: '10' }))
      const data = await res.json() as { exercises: Array<{ exerciseDbId: string; queueStatus: string }> }
      expect(data.exercises.find(e => e.exerciseDbId === 'EX001')?.queueStatus).toBe('rejected')
    })

    it('marks exercise as approved_unverified when mapped with no verifiedAt', async () => {
      mockMeta.mockResolvedValue({ EX002: { ymoveId: 'ymove-uuid-1', verifiedAt: null } })
      const res = await GET(makeReq({ mode: 'all', limit: '10' }))
      const data = await res.json() as {
        exercises: Array<{ exerciseDbId: string; queueStatus: string; ymoveExerciseId: string | null }>
      }
      const ex2 = data.exercises.find(e => e.exerciseDbId === 'EX002')
      expect(ex2?.queueStatus).toBe('approved_unverified')
      expect(ex2?.ymoveExerciseId).toBe('ymove-uuid-1')
    })

    it('marks exercise as verified when mapped with verifiedAt set', async () => {
      mockMeta.mockResolvedValue({
        EX003: { ymoveId: 'ymove-uuid-2', verifiedAt: new Date('2026-10-01T00:00:00Z') },
      })
      const res = await GET(makeReq({ mode: 'all', limit: '10' }))
      const data = await res.json() as {
        exercises: Array<{ exerciseDbId: string; queueStatus: string; verifiedAt: string | null }>
      }
      const ex3 = data.exercises.find(e => e.exerciseDbId === 'EX003')
      expect(ex3?.queueStatus).toBe('verified')
      expect(ex3?.verifiedAt).toBe('2026-10-01T00:00:00.000Z')
    })
  })

  describe('mode filtering', () => {
    beforeEach(() => {
      mockMeta.mockResolvedValue({
        EX001: { ymoveId: null,           verifiedAt: null                              },
        EX002: { ymoveId: 'ymove-uuid-1', verifiedAt: null                              },
        EX003: { ymoveId: 'ymove-uuid-2', verifiedAt: new Date('2026-10-01T00:00:00Z') },
      })
    })

    it('needs_review excludes only verified exercises', async () => {
      const res = await GET(makeReq({ mode: 'needs_review', limit: '10' }))
      const ids = (await res.json() as { exercises: Array<{ exerciseDbId: string }> }).exercises.map(e => e.exerciseDbId)
      expect(ids).toContain('EX001')
      expect(ids).toContain('EX002')
      expect(ids).not.toContain('EX003')
      expect(ids).toContain('EX004')
      expect(ids).toContain('EX005')
    })

    it('verified includes only verified exercises', async () => {
      const res = await GET(makeReq({ mode: 'verified', limit: '10' }))
      const ids = (await res.json() as { exercises: Array<{ exerciseDbId: string }> }).exercises.map(e => e.exerciseDbId)
      expect(ids).toEqual(['EX003'])
    })

    it('unmapped includes unmapped and rejected but not approved or verified', async () => {
      const res = await GET(makeReq({ mode: 'unmapped', limit: '10' }))
      const ids = (await res.json() as { exercises: Array<{ exerciseDbId: string }> }).exercises.map(e => e.exerciseDbId)
      expect(ids).toContain('EX001')   // rejected
      expect(ids).toContain('EX004')   // unmapped
      expect(ids).toContain('EX005')   // unmapped
      expect(ids).not.toContain('EX002') // approved_unverified
      expect(ids).not.toContain('EX003') // verified
    })
  })

  describe('counts accuracy', () => {
    it('returns accurate counts regardless of mode param', async () => {
      mockMeta.mockResolvedValue({
        EX001: { ymoveId: null,           verifiedAt: null                              },
        EX002: { ymoveId: 'ymove-uuid-1', verifiedAt: null                              },
        EX003: { ymoveId: 'ymove-uuid-2', verifiedAt: new Date('2026-10-01T00:00:00Z') },
      })
      const res = await GET(makeReq({ mode: 'needs_review', limit: '10' }))
      const { counts } = await res.json() as { counts: { needs_review: number; verified: number; unmapped: number } }
      expect(counts.verified).toBe(1)      // EX003
      expect(counts.needs_review).toBe(4)  // EX001, EX002, EX004, EX005
      expect(counts.unmapped).toBe(3)      // EX001 (rejected), EX004, EX005
    })
  })

  describe('no duplicates', () => {
    it('returns each exercise exactly once', async () => {
      mockMeta.mockResolvedValue({})
      const res = await GET(makeReq({ mode: 'needs_review', limit: '200' }))
      const ids = (await res.json() as { exercises: Array<{ exerciseDbId: string }> }).exercises.map(e => e.exerciseDbId)
      expect(ids.length).toBe(new Set(ids).size)
    })
  })

  describe('pagination', () => {
    it('returns correct page slice and total', async () => {
      mockMeta.mockResolvedValue({})
      const res1 = await GET(makeReq({ mode: 'all', page: '1', limit: '2' }))
      const data1 = await res1.json() as { exercises: Array<{ exerciseDbId: string }>; total: number }
      expect(data1.total).toBe(5)
      expect(data1.exercises.length).toBe(2)
      expect(data1.exercises[0].exerciseDbId).toBe('EX001')

      const res2 = await GET(makeReq({ mode: 'all', page: '2', limit: '2' }))
      const data2 = await res2.json() as { exercises: Array<{ exerciseDbId: string }> }
      expect(data2.exercises.length).toBe(2)
      expect(data2.exercises[0].exerciseDbId).toBe('EX003')
    })

    it('returns partial last page', async () => {
      mockMeta.mockResolvedValue({})
      const res = await GET(makeReq({ mode: 'all', page: '3', limit: '2' }))
      const data = await res.json() as { exercises: Array<{ exerciseDbId: string }> }
      expect(data.exercises.length).toBe(1)
      expect(data.exercises[0].exerciseDbId).toBe('EX005')
    })
  })

  describe('search', () => {
    it('filters by display name case-insensitively', async () => {
      mockMeta.mockResolvedValue({})
      const res = await GET(makeReq({ mode: 'all', search: 'bench', limit: '10' }))
      const data = await res.json() as { exercises: Array<{ exerciseDbId: string }> }
      expect(data.exercises.length).toBe(1)
      expect(data.exercises[0].exerciseDbId).toBe('EX001')
    })

    it('returns all when search is empty', async () => {
      mockMeta.mockResolvedValue({})
      const res = await GET(makeReq({ mode: 'all', search: '', limit: '10' }))
      const data = await res.json() as { exercises: Array<{ exerciseDbId: string }> }
      expect(data.exercises.length).toBe(5)
    })
  })

  describe('data fidelity', () => {
    it('surfaces ymoveExerciseId and verifiedAt from mapping', async () => {
      const verifiedDate = new Date('2026-10-15T12:00:00Z')
      mockMeta.mockResolvedValue({
        EX004: { ymoveId: 'ymove-uuid-X', verifiedAt: verifiedDate },
      })
      const res = await GET(makeReq({ mode: 'verified', limit: '10' }))
      const data = await res.json() as {
        exercises: Array<{ exerciseDbId: string; ymoveExerciseId: string | null; verifiedAt: string | null }>
      }
      const ex = data.exercises.find(e => e.exerciseDbId === 'EX004')
      expect(ex?.ymoveExerciseId).toBe('ymove-uuid-X')
      expect(ex?.verifiedAt).toBe(verifiedDate.toISOString())
    })

    it('never returns ymoveExerciseId for rejected exercises', async () => {
      mockMeta.mockResolvedValue({ EX002: { ymoveId: null, verifiedAt: null } })
      const res = await GET(makeReq({ mode: 'unmapped', limit: '10' }))
      const data = await res.json() as {
        exercises: Array<{ exerciseDbId: string; ymoveExerciseId: string | null }>
      }
      expect(data.exercises.find(e => e.exerciseDbId === 'EX002')?.ymoveExerciseId).toBeNull()
    })
  })
})
