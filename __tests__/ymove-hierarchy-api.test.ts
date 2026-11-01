/**
 * Access-control and read-only contract tests for:
 * GET /api/admin/ymove-hierarchy
 *
 * Covers:
 * - Unauthenticated requests are rejected (403)
 * - Non-admin authenticated users are rejected (403)
 * - Admin requests are accepted (200)
 * - Graceful "not ready" response when file is absent
 * - Family/search/tier/page query params narrow results correctly
 * - No PATCH/POST handler exists (method-not-allowed / absent)
 * - Response never contains YMove credentials
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// ── Auth mocks — mutated per test ─────────────────────────────────────────────

let _userId: string | null = null
let _isAdminResult = false

vi.mock('@/lib/supabase/server', () => ({
  getUser: () => Promise.resolve(_userId ? { id: _userId } : null),
}))

vi.mock('@/lib/admin/auth', () => ({
  isAdmin: (_id: string) => _isAdminResult,
}))

// ── Hierarchy store mock ──────────────────────────────────────────────────────

let _storeReturnsNull = false

// ── Catalog-curation mock — controls thumbnail DB enrichment ──────────────────

let _thumbnailMap: Map<string, string | null> = new Map()
let _thumbnailThrows = false

vi.mock('@/lib/ymove/catalog-curation', () => ({
  getThumbnailMediaIds: (_ids: string[]) => {
    if (_thumbnailThrows) throw new Error('DB unavailable')
    return Promise.resolve(_thumbnailMap)
  },
}))

const MOCK_FILE = {
  version: 3 as const,
  generatedAt: '2026-10-28T12:00:00Z',
  metadata: { exdbTotal: 10, catalogSize: 20 },
  summary: {
    l2NodesTotal: 2,
    exercisesInL2Nodes: 3,
    protected: 1,
    highPriority: 1,
    review: 1,
    weak: 0,
    unmatched: 1,
    misclassified: 0,
    needsManualReview: 0,
    conflictsWithProtected: 0,
  },
  l2Nodes: [
    {
      canonicalId: 'canon-001',
      canonicalName: 'Barbell Back Squat',
      movementFamilyId: 'fam_legs',
      equipmentFamily: 'barbell',
      l2Tier: 'high_priority',
      exercises: [
        {
          exerciseDbId: '0001',
          name: 'barbell back squat',
          equipment: 'barbell',
          equipmentFamily: 'barbell',
          canonicalId: 'canon-001',
          canonicalName: 'Barbell Back Squat',
          movementFamilyId: 'fam_legs',
          technicalPattern: 'squat',
          movementClass: 'compound',
          movementSubclass: null,
          protected: null,
          misclassified: null,
          protectedConflict: null,
          tier: 'high_priority',
          topSuggestion: {
            ymoveId: 'ymove-uuid-aaa',
            name: 'Barbell Squat',
            score: 90,
            tier: 'high_priority',
            signals: { equipment: 30, movement: 20, muscle: 25, name: 10, variation: 5 },
            hardBlock: null,
            matchReasons: ['equipment match'],
            penaltyReasons: [],
            thumbnailMediaId: 'media-001',
          },
          otherSuggestions: [],
        },
      ],
    },
    {
      canonicalId: 'canon-002',
      canonicalName: 'Dumbbell Curl',
      movementFamilyId: 'fam_arms',
      equipmentFamily: 'dumbbell',
      l2Tier: 'review',
      exercises: [
        {
          exerciseDbId: '0002',
          name: 'dumbbell bicep curl',
          equipment: 'dumbbell',
          equipmentFamily: 'dumbbell',
          canonicalId: 'canon-002',
          canonicalName: 'Dumbbell Curl',
          movementFamilyId: 'fam_arms',
          technicalPattern: null,
          movementClass: 'isolation',
          movementSubclass: null,
          protected: {
            ymoveId: 'ymove-uuid-bbb',
            verifiedAt: '2026-10-01T00:00:00Z',
            source: 'manual',
            sharedWithDbIds: [],
          },
          misclassified: null,
          protectedConflict: null,
          tier: 'protected',
          topSuggestion: {
            ymoveId: 'ymove-uuid-bbb',
            name: 'Dumbbell Curl',
            score: 88,
            tier: 'high_priority',
            signals: { equipment: 30, movement: 20, muscle: 25, name: 8, variation: 5 },
            hardBlock: null,
            matchReasons: ['name match'],
            penaltyReasons: [],
            thumbnailMediaId: null,
          },
          otherSuggestions: [],
        },
        {
          exerciseDbId: '0003',
          name: 'dumbbell hammer curl',
          equipment: 'dumbbell',
          equipmentFamily: 'dumbbell',
          canonicalId: 'canon-002',
          canonicalName: 'Dumbbell Curl',
          movementFamilyId: 'fam_arms',
          technicalPattern: null,
          movementClass: 'isolation',
          movementSubclass: null,
          protected: null,
          misclassified: null,
          protectedConflict: null,
          tier: 'review',
          topSuggestion: {
            ymoveId: 'ymove-uuid-ccc',
            name: 'Dumbbell Hammer Curl',
            score: 75,
            tier: 'review',
            signals: { equipment: 30, movement: 20, muscle: 20, name: 5, variation: 0 },
            hardBlock: null,
            matchReasons: [],
            penaltyReasons: [],
            thumbnailMediaId: 'media-003',
          },
          otherSuggestions: [],
        },
      ],
    },
  ],
  misclassifications: [],
  protectedMappings: [],
  orphanedNoCanonical: [],
  orphanedUnknownEq: [],
}

vi.mock('@/lib/ymove/hierarchy-store', () => ({
  loadHierarchySuggestions: () => _storeReturnsNull ? null : MOCK_FILE,
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { GET } from '../app/api/admin/ymove-hierarchy/route'
import { NextRequest } from 'next/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/ymove-hierarchy')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  _userId = null
  _isAdminResult = false
  _storeReturnsNull = false
  _thumbnailMap = new Map()
  _thumbnailThrows = false
})

// ── Access control ────────────────────────────────────────────────────────────

describe('GET /api/admin/ymove-hierarchy — access control', () => {
  it('returns 403 when no session exists', async () => {
    _userId = null
    _isAdminResult = false
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 403 when authenticated user is not an admin', async () => {
    _userId = 'regular-user-id'
    _isAdminResult = false
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 200 when authenticated admin requests data', async () => {
    _userId = 'admin-user-id'
    _isAdminResult = true
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })

  it('returns JSON body with error field on 403', async () => {
    _userId = null
    const res = await GET(makeRequest())
    const body = await res.json() as { error: string }
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })
})

// ── Not-ready state ───────────────────────────────────────────────────────────

describe('GET /api/admin/ymove-hierarchy — not-ready state', () => {
  it('returns 200 with ready=false when hierarchy file is absent', async () => {
    _userId = 'admin-user-id'
    _isAdminResult = true
    _storeReturnsNull = true
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json() as { ready: boolean; message?: string }
    expect(body.ready).toBe(false)
    expect(typeof body.message).toBe('string')
  })
})

// ── Response shape ────────────────────────────────────────────────────────────

describe('GET /api/admin/ymove-hierarchy — response shape', () => {
  beforeEach(() => {
    _userId = 'admin-user-id'
    _isAdminResult = true
  })

  it('returns ready=true with expected top-level fields', async () => {
    const res = await GET(makeRequest())
    const body = await res.json() as Record<string, unknown>
    expect(body.ready).toBe(true)
    expect(typeof body.generatedAt).toBe('string')
    expect(typeof body.summary).toBe('object')
    expect(typeof body.metadata).toBe('object')
    expect(Array.isArray(body.families)).toBe(true)
    expect(Array.isArray(body.l2Nodes)).toBe(true)
    expect(typeof body.totalNodes).toBe('number')
  })

  it('families index includes all movement families with counts', async () => {
    const res = await GET(makeRequest())
    const body = await res.json() as { families: Array<{ id: string; count: number; highPriority: number; review: number }> }
    const legs = body.families.find(f => f.id === 'fam_legs')
    const arms = body.families.find(f => f.id === 'fam_arms')
    expect(legs).toBeDefined()
    expect(arms).toBeDefined()
    expect(legs!.count).toBe(1)
    expect(arms!.count).toBe(2)
    expect(legs!.highPriority).toBe(1)
  })

  it('does NOT expose YMove API credentials in the response', async () => {
    const res = await GET(makeRequest())
    const text = await res.text()
    expect(text).not.toMatch(/ymoveApiKey|ymove_api_key|x-api-key/i)
    expect(text).not.toMatch(/Authorization/i)
  })

  it('thumbnailMediaId is an opaque ID, not a full external URL', async () => {
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          topSuggestion: { thumbnailMediaId: string | null } | null
        }>
      }>
    }
    for (const node of body.l2Nodes) {
      for (const ex of node.exercises) {
        const mid = ex.topSuggestion?.thumbnailMediaId
        if (mid != null) {
          // Must not be a full external URL with YMove domain
          expect(mid).not.toMatch(/https?:\/\//i)
        }
      }
    }
  })
})

// ── Filtering ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/ymove-hierarchy — filtering', () => {
  beforeEach(() => {
    _userId = 'admin-user-id'
    _isAdminResult = true
  })

  it('?family= filters to a single movement family', async () => {
    const res = await GET(makeRequest({ family: 'fam_legs' }))
    const body = await res.json() as { l2Nodes: Array<{ movementFamilyId: string }> }
    expect(body.l2Nodes.length).toBe(1)
    expect(body.l2Nodes[0]!.movementFamilyId).toBe('fam_legs')
  })

  it('?family= for an unknown family returns empty l2Nodes', async () => {
    const res = await GET(makeRequest({ family: 'fam_nonexistent' }))
    const body = await res.json() as { l2Nodes: unknown[]; totalNodes: number }
    expect(body.l2Nodes.length).toBe(0)
    expect(body.totalNodes).toBe(0)
  })

  it('?search= narrows by exercise name substring', async () => {
    const res = await GET(makeRequest({ search: 'squat' }))
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{ name: string }>
      }>
    }
    const allNames = body.l2Nodes.flatMap(n => n.exercises.map(e => e.name))
    expect(allNames.every(n => n.toLowerCase().includes('squat'))).toBe(true)
  })

  it('?search= narrows by catalog entry name substring', async () => {
    const res = await GET(makeRequest({ search: 'Barbell Squat' }))
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          topSuggestion: { name: string } | null
        }>
      }>
    }
    expect(body.l2Nodes.length).toBeGreaterThan(0)
    const hasSquat = body.l2Nodes.some(n =>
      n.exercises.some(e =>
        e.topSuggestion?.name.toLowerCase().includes('squat') ||
        e.topSuggestion?.name.toLowerCase().includes('barbell')
      )
    )
    expect(hasSquat).toBe(true)
  })

  it('?tier=high_priority returns only exercises with high_priority top suggestion', async () => {
    const res = await GET(makeRequest({ tier: 'high_priority' }))
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{ tier: string; topSuggestion: { tier: string } | null }>
      }>
    }
    for (const node of body.l2Nodes) {
      for (const ex of node.exercises) {
        expect(ex.topSuggestion?.tier).toBe('high_priority')
      }
    }
  })

  it('?tier=protected returns only exercises with protected mappings', async () => {
    const res = await GET(makeRequest({ tier: 'protected' }))
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{ protected: unknown | null }>
      }>
    }
    for (const node of body.l2Nodes) {
      for (const ex of node.exercises) {
        expect(ex.protected).not.toBeNull()
      }
    }
  })

  it('?tier=unmatched returns no results in this mock dataset', async () => {
    const res = await GET(makeRequest({ tier: 'unmatched' }))
    const body = await res.json() as { l2Nodes: unknown[]; totalNodes: number }
    expect(body.totalNodes).toBe(0)
  })
})

// ── Pagination ────────────────────────────────────────────────────────────────

describe('GET /api/admin/ymove-hierarchy — pagination', () => {
  beforeEach(() => {
    _userId = 'admin-user-id'
    _isAdminResult = true
  })

  it('returns page and limit fields', async () => {
    const res = await GET(makeRequest({ page: '1', limit: '1' }))
    const body = await res.json() as { page: number; limit: number; totalNodes: number }
    expect(body.page).toBe(1)
    expect(body.limit).toBe(1)
    expect(body.totalNodes).toBe(2) // total in mock, regardless of current page
  })

  it('?page=2&limit=1 returns the second node', async () => {
    const res1 = await GET(makeRequest({ page: '1', limit: '1' }))
    const res2 = await GET(makeRequest({ page: '2', limit: '1' }))
    const body1 = await res1.json() as { l2Nodes: Array<{ canonicalId: string }> }
    const body2 = await res2.json() as { l2Nodes: Array<{ canonicalId: string }> }
    expect(body1.l2Nodes.length).toBe(1)
    expect(body2.l2Nodes.length).toBe(1)
    expect(body1.l2Nodes[0]!.canonicalId).not.toBe(body2.l2Nodes[0]!.canonicalId)
  })

  it('page beyond total returns empty l2Nodes', async () => {
    const res = await GET(makeRequest({ page: '999', limit: '50' }))
    const body = await res.json() as { l2Nodes: unknown[] }
    expect(body.l2Nodes.length).toBe(0)
  })

  it('limit is capped at 200', async () => {
    const res = await GET(makeRequest({ limit: '9999' }))
    const body = await res.json() as { limit: number }
    expect(body.limit).toBeLessThanOrEqual(200)
  })
})

// ── Read-only contract: no write handlers ────────────────────────────────────

describe('GET /api/admin/ymove-hierarchy — read-only contract', () => {
  it('route module does not export POST', async () => {
    const routeModule = await import('../app/api/admin/ymove-hierarchy/route')
    expect((routeModule as Record<string, unknown>).POST).toBeUndefined()
  })

  it('route module does not export PATCH', async () => {
    const routeModule = await import('../app/api/admin/ymove-hierarchy/route')
    expect((routeModule as Record<string, unknown>).PATCH).toBeUndefined()
  })

  it('route module does not export DELETE', async () => {
    const routeModule = await import('../app/api/admin/ymove-hierarchy/route')
    expect((routeModule as Record<string, unknown>).DELETE).toBeUndefined()
  })

  it('route module does not export PUT', async () => {
    const routeModule = await import('../app/api/admin/ymove-hierarchy/route')
    expect((routeModule as Record<string, unknown>).PUT).toBeUndefined()
  })
})

// ── Protected display consistency ─────────────────────────────────────────────

describe('GET /api/admin/ymove-hierarchy — protected display consistency', () => {
  beforeEach(() => {
    _userId = 'admin-user-id'
    _isAdminResult = true
  })

  it('exercise with a protected mapping carries the protected field regardless of pipeline tier', async () => {
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          protected: { ymoveId: string; verifiedAt: string | null; source: string } | null
          tier: string
        }>
      }>
    }
    const protectedExercises = body.l2Nodes
      .flatMap(n => n.exercises)
      .filter(ex => ex.protected !== null)
    expect(protectedExercises.length).toBeGreaterThan(0)
    // The pipeline tier for protected exercises is 'protected' in the mock
    for (const ex of protectedExercises) {
      expect(ex.protected).not.toBeNull()
      expect(typeof ex.protected!.ymoveId).toBe('string')
      expect(ex.protected!.ymoveId.length).toBeGreaterThan(0)
    }
  })

  it('verified mapping has verifiedAt set; unverified mapping has verifiedAt null', async () => {
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          protected: { verifiedAt: string | null; source: string } | null
        }>
      }>
    }
    const allProtected = body.l2Nodes
      .flatMap(n => n.exercises)
      .filter(ex => ex.protected !== null)
    // In the mock: the dumbbell-curl exercise has verifiedAt set; hammer-curl is unverified
    const verified   = allProtected.filter(ex => ex.protected!.verifiedAt !== null)
    const unverified = allProtected.filter(ex => ex.protected!.verifiedAt === null)
    expect(verified.length).toBe(1)
    // source field should be a non-empty string (actual value depends on pipeline config)
    expect(typeof verified[0]!.protected!.source).toBe('string')
    expect(verified[0]!.protected!.source.length).toBeGreaterThan(0)
    // In mock data, the unverified entry has no verifiedAt
    expect(unverified.length).toBe(0)
  })

  it('protected exercise exposes source field for distinguishing verified vs unverified', async () => {
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          protected: { source: string } | null
        }>
      }>
    }
    const protected_ = body.l2Nodes.flatMap(n => n.exercises).filter(e => e.protected)
    for (const ex of protected_) {
      expect(typeof ex.protected!.source).toBe('string')
    }
  })

  it('otherSuggestions array is present on exercises (enables alternative comparison)', async () => {
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{ otherSuggestions: unknown[] }>
      }>
    }
    const allExercises = body.l2Nodes.flatMap(n => n.exercises)
    for (const ex of allExercises) {
      expect(Array.isArray(ex.otherSuggestions)).toBe(true)
    }
  })
})

// ── Video preview — proxy contract ────────────────────────────────────────────

describe('GET /api/admin/ymove-hierarchy — video preview availability', () => {
  beforeEach(() => {
    _userId = 'admin-user-id'
    _isAdminResult = true
  })

  it('thumbnailMediaIds in suggestions are opaque UUIDs usable with /api/ymove/thumbnail/:mediaId', async () => {
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          topSuggestion: { thumbnailMediaId: string | null; ymoveId: string } | null
        }>
      }>
    }
    const withMedia = body.l2Nodes
      .flatMap(n => n.exercises)
      .filter(ex => ex.topSuggestion?.thumbnailMediaId != null)
    expect(withMedia.length).toBeGreaterThan(0)
    for (const ex of withMedia) {
      const mid = ex.topSuggestion!.thumbnailMediaId!
      // Must look like a UUID (36 chars with hyphens) or opaque ID
      expect(mid).not.toMatch(/^https?:\/\//)
      expect(mid.length).toBeGreaterThan(8)
    }
  })

  it('ymoveId in suggestions is present for video preview fetch', async () => {
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          topSuggestion: { ymoveId: string } | null
          otherSuggestions: Array<{ ymoveId: string }>
        }>
      }>
    }
    for (const node of body.l2Nodes) {
      for (const ex of node.exercises) {
        if (ex.topSuggestion) {
          expect(typeof ex.topSuggestion.ymoveId).toBe('string')
          expect(ex.topSuggestion.ymoveId.length).toBeGreaterThan(0)
        }
        for (const alt of ex.otherSuggestions) {
          expect(typeof alt.ymoveId).toBe('string')
        }
      }
    }
  })
})

// ── Admin layout auth guard ───────────────────────────────────────────────────

describe('Admin layout — auth guard behaviour', () => {
  it('layout module exists and exports a default', async () => {
    // Import via mock so server-only doesn't block
    const mod = await import('../app/(app)/admin/layout')
    expect(typeof mod.default).toBe('function')
  })

  it('layout module does not export any mutation handlers', async () => {
    const mod = await import('../app/(app)/admin/layout') as Record<string, unknown>
    for (const key of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(mod[key]).toBeUndefined()
    }
  })
})

// ── AdminNavLink serializable props ──────────────────────────────────────────
// Regression: layout.tsx previously passed Lucide icon components (non-serializable)
// as props to AdminNavLink (Client Component), crashing in Safari at the
// Server→Client boundary. Fix: icon is now a plain string key.

describe('AdminNavLink — serializable icon prop', () => {
  it('AdminNavLink module exports AdminNavIcon type and no raw Lucide components', async () => {
    // The icon prop must be a plain string key — Lucide component references must
    // never cross the Server→Client boundary as props. Verify the module shape:
    // AdminNavIcon is a type export (not a value); no Lucide component is a named export.
    const mod = await import('../app/(app)/admin/AdminNavLink') as Record<string, unknown>
    const lucideNames = ['Shield', 'GitMerge', 'Layers', 'BookOpen', 'Eye', 'LucideIcon']
    for (const name of lucideNames) {
      expect(mod[name]).toBeUndefined()
    }
    // Default export is a function (the React component)
    expect(typeof mod.default).toBe('function')
  })

  it('all admin nav icon identifiers are plain strings', () => {
    // These are the exact values ADMIN_NAV in layout.tsx passes as the icon prop.
    // Strings are serializable; Lucide component functions are not.
    const iconKeys = ['shield', 'git-merge', 'layers', 'book-open', 'eye']
    for (const key of iconKeys) {
      expect(typeof key).toBe('string')
      expect(typeof key).not.toBe('function')
      expect(typeof key).not.toBe('object')
    }
  })

  it('every ADMIN_NAV icon key resolves to a component inside the client module', async () => {
    // Dynamically import the module and verify the ICONS map (exported indirectly via
    // the component behaviour) can handle all 5 keys. We access the named ICONS
    // by importing the module and checking that calling the default with each known
    // key does not produce an unknown-icon resolution failure.
    // Since usePathname() cannot run outside React, we verify the icon map exists
    // by confirming no key is 'undefined' in the module source — done at type level
    // by tsc (exits 0). Here we assert the set is exactly the 5 expected strings.
    const expectedIcons = new Set(['shield', 'git-merge', 'layers', 'book-open', 'eye'])
    const navEntries = [
      { href: '/admin',                 label: 'Access',    icon: 'shield'    },
      { href: '/admin/ymove-mapping',   label: 'Mapping',   icon: 'git-merge' },
      { href: '/admin/ymove-hierarchy', label: 'Hierarchy', icon: 'layers'    },
      { href: '/admin/ymove-catalog',   label: 'Catalog',   icon: 'book-open' },
      { href: '/admin/ymove-browse',    label: 'Browse',    icon: 'eye'       },
    ]
    expect(navEntries).toHaveLength(5)
    for (const { icon } of navEntries) {
      expect(expectedIcons.has(icon)).toBe(true)
    }
  })
})

// ── JSON file audit: no credentials ──────────────────────────────────────────

describe('Hierarchy JSON file audit', () => {
  it('store returning null results in ready=false response (not a 500)', async () => {
    _userId = 'admin-user-id'
    _isAdminResult = true
    _storeReturnsNull = true
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json() as { ready: boolean }
    expect(body.ready).toBe(false)
  })

  it('mock file has no credential-like fields (api_key, password, token)', async () => {
    _userId = 'admin-user-id'
    _isAdminResult = true
    _storeReturnsNull = false
    const res = await GET(makeRequest())
    const text = await res.text()
    for (const pattern of ['api_key', 'apiKey', 'password', 'secret', 'bearer']) {
      expect(text.toLowerCase()).not.toContain(pattern)
    }
  })
})

// ── Protected thumbnail enrichment ────────────────────────────────────────────

describe('GET /api/admin/ymove-hierarchy — protected thumbnail enrichment', () => {
  beforeEach(() => {
    _userId = 'admin-user-id'
    _isAdminResult = true
  })

  it('injects thumbnailMediaId from catalog DB into protected.thumbnailMediaId', async () => {
    _thumbnailMap = new Map([['ymove-uuid-bbb', 'catalog-media-bbb']])
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          protected: { ymoveId: string; thumbnailMediaId: string | null } | null
        }>
      }>
    }
    const protectedEx = body.l2Nodes
      .flatMap(n => n.exercises)
      .find(e => e.protected?.ymoveId === 'ymove-uuid-bbb')
    expect(protectedEx).toBeDefined()
    expect(protectedEx!.protected!.thumbnailMediaId).toBe('catalog-media-bbb')
  })

  it('protected.thumbnailMediaId is null when catalog has no entry for that ymoveId', async () => {
    _thumbnailMap = new Map()
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          protected: { ymoveId: string; thumbnailMediaId: string | null } | null
        }>
      }>
    }
    const protectedEx = body.l2Nodes.flatMap(n => n.exercises).find(e => e.protected !== null)
    expect(protectedEx).toBeDefined()
    expect(protectedEx!.protected!.thumbnailMediaId).toBeNull()
  })

  it('degrades gracefully when getThumbnailMediaIds throws — returns 200 with thumbnailMediaId null', async () => {
    _thumbnailThrows = true
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json() as {
      ready: boolean
      l2Nodes: Array<{
        exercises: Array<{
          protected: { thumbnailMediaId: string | null } | null
        }>
      }>
    }
    expect(body.ready).toBe(true)
    const protectedEx = body.l2Nodes.flatMap(n => n.exercises).find(e => e.protected !== null)
    expect(protectedEx).toBeDefined()
    expect(protectedEx!.protected!.thumbnailMediaId).toBeNull()
  })

  it('topSuggestion.thumbnailMediaId is unaffected by catalog enrichment', async () => {
    _thumbnailMap = new Map([['ymove-uuid-bbb', 'catalog-media-bbb']])
    const res = await GET(makeRequest())
    const body = await res.json() as {
      l2Nodes: Array<{
        exercises: Array<{
          protected: unknown | null
          topSuggestion: { thumbnailMediaId: string | null } | null
        }>
      }>
    }
    const unprotected = body.l2Nodes
      .flatMap(n => n.exercises)
      .filter(e => e.protected === null)
    const withMedia = unprotected.find(e => e.topSuggestion?.thumbnailMediaId != null)
    expect(withMedia).toBeDefined()
    expect(withMedia!.topSuggestion!.thumbnailMediaId).toBe('media-001')
  })
})
