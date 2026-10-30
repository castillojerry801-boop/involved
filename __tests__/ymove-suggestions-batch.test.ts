import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => Promise.resolve({ id: 'admin-user-id' }),
}))

vi.mock('@/lib/admin/auth', () => ({
  isAdmin: (_id: string) => true,
}))

vi.mock('@/lib/ymove/suggestions-store', () => ({
  loadSuggestions: () => null,
}))

// Shared mapping state for upsertMapping tracking
const _mockMapping: Record<string, string | null> = {}
const _upsertCalls: Array<{ exerciseDbId: string; ymoveId: string | null }> = []

vi.mock('@/lib/ymove/mapping', () => ({
  getAllMappings: () => Promise.resolve({ ..._mockMapping }),
  upsertMapping: vi.fn().mockImplementation(
    (dbId: string, ymoveId: string | null) => {
      _upsertCalls.push({ exerciseDbId: dbId, ymoveId })
      _mockMapping[dbId] = ymoveId
      return Promise.resolve()
    },
  ),
}))

import { POST } from '@/app/api/admin/ymove-mapping/suggestions/route'
import { NextRequest } from 'next/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(approvals: unknown) {
  return new NextRequest('http://localhost/api/admin/ymove-mapping/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvals }),
  })
}

function setActiveMapping(m: Record<string, string | null>) {
  Object.keys(_mockMapping).forEach(k => delete _mockMapping[k])
  Object.assign(_mockMapping, m)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/ymove-mapping/suggestions — batch approval conflict detection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActiveMapping({})
    _upsertCalls.length = 0
  })

  it('approves a single valid mapping', async () => {
    const res = await POST(makeRequest([
      { exerciseDbId: '0025', ymoveId: 'uuid-a' },
    ]))
    const data = await res.json() as { ok: boolean; approved: number; skipped: number }
    expect(data.ok).toBe(true)
    expect(data.approved).toBe(1)
    expect(data.skipped).toBe(0)
    expect(_upsertCalls).toHaveLength(1)
    expect(_upsertCalls[0]).toEqual({ exerciseDbId: '0025', ymoveId: 'uuid-a' })
  })

  it('rejects empty approvals array with 400', async () => {
    const res = await POST(makeRequest([]))
    expect(res.status).toBe(400)
  })

  // ── Within-batch UUID deduplication ─────────────────────────────────────────

  it('skips second approval when two exercises target the same YMove UUID', async () => {
    const res = await POST(makeRequest([
      { exerciseDbId: '0088', ymoveId: 'uuid-calf-raise' },
      { exerciseDbId: '1371', ymoveId: 'uuid-calf-raise' }, // duplicate UUID
    ]))
    const data = await res.json() as { approved: number; skipped: number; conflicts: unknown[] }
    expect(data.approved).toBe(1)
    expect(data.skipped).toBe(1)
    expect(data.conflicts).toHaveLength(1)
    // Only the first one was written
    expect(_upsertCalls).toHaveLength(1)
    expect(_upsertCalls[0].exerciseDbId).toBe('0088')
  })

  it('includes the conflict reason for within-batch duplicate', async () => {
    const res = await POST(makeRequest([
      { exerciseDbId: '0088', ymoveId: 'uuid-dup' },
      { exerciseDbId: '1371', ymoveId: 'uuid-dup' },
    ]))
    const data = await res.json() as { conflicts: Array<{ reason: string }> }
    expect(data.conflicts[0].reason).toMatch(/duplicate/i)
  })

  // ── Active mapping conflict ─────────────────────────────────────────────────

  it('skips approval when UUID is already mapped to a DIFFERENT exercise', async () => {
    setActiveMapping({ '0025': 'uuid-taken' }) // 0025 already uses uuid-taken

    const res = await POST(makeRequest([
      { exerciseDbId: '0043', ymoveId: 'uuid-taken' }, // try to map 0043 to same UUID
    ]))
    const data = await res.json() as { approved: number; skipped: number; conflicts: unknown[] }
    expect(data.approved).toBe(0)
    expect(data.skipped).toBe(1)
    expect(_upsertCalls).toHaveLength(0)
  })

  it('allows overwriting an existing mapping for the SAME exercise', async () => {
    setActiveMapping({ '0025': 'uuid-old' }) // 0025 previously mapped to uuid-old

    const res = await POST(makeRequest([
      { exerciseDbId: '0025', ymoveId: 'uuid-new' }, // re-map to a new UUID
    ]))
    const data = await res.json() as { approved: number; skipped: number }
    expect(data.approved).toBe(1)
    expect(data.skipped).toBe(0)
    expect(_upsertCalls[0]).toEqual({ exerciseDbId: '0025', ymoveId: 'uuid-new' })
  })

  it('processes valid approvals that follow a skipped conflict', async () => {
    setActiveMapping({ '0099': 'uuid-conflict' })

    const res = await POST(makeRequest([
      { exerciseDbId: '0001', ymoveId: 'uuid-conflict' }, // conflict — skipped
      { exerciseDbId: '0002', ymoveId: 'uuid-ok-1' },    // valid
      { exerciseDbId: '0003', ymoveId: 'uuid-ok-2' },    // valid
    ]))
    const data = await res.json() as { approved: number; skipped: number }
    expect(data.approved).toBe(2)
    expect(data.skipped).toBe(1)
    expect(_upsertCalls.map(c => c.exerciseDbId)).toEqual(['0002', '0003'])
  })

  it('returns conflict list with exerciseDbId and ymoveId for each skipped item', async () => {
    const res = await POST(makeRequest([
      { exerciseDbId: 'a', ymoveId: 'uuid-x' },
      { exerciseDbId: 'b', ymoveId: 'uuid-x' }, // within-batch dup
    ]))
    const data = await res.json() as {
      conflicts: Array<{ exerciseDbId: string; ymoveId: string; reason: string }>
    }
    expect(data.conflicts[0].exerciseDbId).toBe('b')
    expect(data.conflicts[0].ymoveId).toBe('uuid-x')
    expect(typeof data.conflicts[0].reason).toBe('string')
  })
})
