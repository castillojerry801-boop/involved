import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const dietaryPreference = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  }
  const dietaryAllergen = {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  }
  const dietaryExclusion = {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  }
  return {
    prisma: {
      $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
        fn({ dietaryPreference, dietaryAllergen, dietaryExclusion }),
      ),
      dietaryPreference,
      dietaryAllergen,
      dietaryExclusion,
    },
  }
})

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { GET, PATCH } from '../../app/api/nutrition/preferences/route'
import { NextRequest } from 'next/server'

const mockCreateClient = createClient as ReturnType<typeof vi.fn>
const mockFindUnique    = prisma.dietaryPreference.findUnique as ReturnType<typeof vi.fn>
const mockUpsert        = prisma.dietaryPreference.upsert    as ReturnType<typeof vi.fn>
const mockDeleteAllergens  = prisma.dietaryAllergen.deleteMany  as ReturnType<typeof vi.fn>
const mockCreateAllergens  = prisma.dietaryAllergen.createMany  as ReturnType<typeof vi.fn>
const mockDeleteExclusions = prisma.dietaryExclusion.deleteMany as ReturnType<typeof vi.fn>
const mockCreateExclusions = prisma.dietaryExclusion.createMany as ReturnType<typeof vi.fn>

function mockAuth(userId: string | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  })
}

function req(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/nutrition/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const SAMPLE_PREF = {
  id: 'pref-1',
  userId: 'user-1',
  approaches: ['keto'],
  mealsPerDay: 3,
  snacksPerDay: 1,
  notes: null,
  allergens: [{ id: 'a1', name: 'peanuts', severity: 'allergy', notes: null }],
  exclusions: [{ id: 'e1', ingredient: 'cilantro', reason: 'taste' }],
  createdAt: new Date(),
  updatedAt: new Date(),
}

interface MockPrefState {
  id: string
  approaches: string[]
  mealsPerDay: number | null
  snacksPerDay: number | null
  notes: string | null
  allergens: unknown[]
  exclusions: unknown[]
  createdAt: Date
  updatedAt: Date
}

// Default upsert result used by tests that only care about reaching 200
const DEFAULT_UPSERT_RESULT: MockPrefState = {
  id: 'pref-new',
  approaches: [],
  mealsPerDay: null,
  snacksPerDay: null,
  notes: null,
  allergens: [],
  exclusions: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindUnique.mockResolvedValue(null)
  // upsert is called inside $transaction; the final findUnique in the tx
  // returns the full record after writes. Set up upsert to return the id.
  mockUpsert.mockResolvedValue({ id: 'pref-new' })
  mockDeleteAllergens.mockResolvedValue({ count: 0 })
  mockCreateAllergens.mockResolvedValue({ count: 0 })
  mockDeleteExclusions.mockResolvedValue({ count: 0 })
  mockCreateExclusions.mockResolvedValue({ count: 0 })
})

// Helper: build a transaction mock where upsert + findUnique return a usable result
function makeTxMock(prefId = 'pref-new', overrides: Partial<MockPrefState> = {}) {
  const finalState = { ...DEFAULT_UPSERT_RESULT, id: prefId, ...overrides }
  return {
    dietaryPreference: {
      findUnique: vi.fn().mockResolvedValue(finalState),
      upsert: vi.fn().mockResolvedValue({ id: prefId }),
    },
    dietaryAllergen: { deleteMany: vi.fn(), createMany: vi.fn() },
    dietaryExclusion: { deleteMany: vi.fn(), createMany: vi.fn() },
  }
}

// ─── Authentication ───────────────────────────────────────────────────────────

describe('GET /api/nutrition/preferences — auth', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await GET(new NextRequest('http://localhost/api/nutrition/preferences'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with null preference when none exists', async () => {
    mockAuth('user-1')
    mockFindUnique.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/nutrition/preferences'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preference).toBeNull()
  })

  it('returns 200 with serialized preference when exists', async () => {
    mockAuth('user-1')
    mockFindUnique.mockResolvedValue(SAMPLE_PREF)
    const res = await GET(new NextRequest('http://localhost/api/nutrition/preferences'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preference.approaches).toEqual(['keto'])
    expect(body.preference.allergens).toHaveLength(1)
    expect(body.preference.allergens[0].name).toBe('peanuts')
  })

  it('GET queries using the authenticated user id, not a URL param', async () => {
    mockAuth('user-abc')
    mockFindUnique.mockResolvedValue(null)
    await GET(new NextRequest('http://localhost/api/nutrition/preferences'))
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-abc' } }),
    )
  })
})

describe('PATCH /api/nutrition/preferences — auth', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await PATCH(req({ approaches: ['keto'] }))
    expect(res.status).toBe(401)
  })
})

// ─── Conflict detection ───────────────────────────────────────────────────────

describe('PATCH /api/nutrition/preferences — dietary conflict detection', () => {
  beforeEach(() => { mockAuth('user-1') })

  it('rejects vegan + carnivore (422)', async () => {
    const res = await PATCH(req({ approaches: ['vegan', 'carnivore'] }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/conflict/i)
    expect(body.conflicts).toHaveLength(1)
    expect(body.conflicts[0].approaches).toContain('vegan')
    expect(body.conflicts[0].approaches).toContain('carnivore')
  })

  it('rejects vegetarian + carnivore (422)', async () => {
    const res = await PATCH(req({ approaches: ['vegetarian', 'carnivore'] }))
    expect(res.status).toBe(422)
  })

  it('rejects plant_based + carnivore (422)', async () => {
    const res = await PATCH(req({ approaches: ['plant_based', 'carnivore'] }))
    expect(res.status).toBe(422)
  })

  it('rejects vegan + paleo (422)', async () => {
    const res = await PATCH(req({ approaches: ['vegan', 'paleo'] }))
    expect(res.status).toBe(422)
  })

  it('allows keto + dairy_free (compatible)', async () => {
    const txMock = makeTxMock('pref-new', { approaches: ['keto', 'dairy_free'] })
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    const res = await PATCH(req({ approaches: ['keto', 'dairy_free'] }))
    expect(res.status).toBe(200)
  })

  it('allows vegan alone (no conflict)', async () => {
    const txMock = makeTxMock('pref-new', { approaches: ['vegan'] })
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    const res = await PATCH(req({ approaches: ['vegan'] }))
    expect(res.status).toBe(200)
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('PATCH /api/nutrition/preferences — input validation', () => {
  beforeEach(() => { mockAuth('user-1') })

  it('rejects invalid dietary approach (400)', async () => {
    const res = await PATCH(req({ approaches: ['vegan', 'raw_food'] }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/raw_food/)
  })

  it('rejects non-array approaches (400)', async () => {
    const res = await PATCH(req({ approaches: 'keto' }))
    expect(res.status).toBe(400)
  })

  it('rejects mealsPerDay=0 (400)', async () => {
    const res = await PATCH(req({ mealsPerDay: 0 }))
    expect(res.status).toBe(400)
  })

  it('rejects mealsPerDay=21 (400)', async () => {
    const res = await PATCH(req({ mealsPerDay: 21 }))
    expect(res.status).toBe(400)
  })

  it('accepts snacksPerDay=0 (zero snacks is valid)', async () => {
    const txMock = makeTxMock('pref-new', { snacksPerDay: 0 })
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    const res = await PATCH(req({ snacksPerDay: 0 }))
    expect(res.status).toBe(200)
  })

  it('accepts mealsPerDay=null (clears the field)', async () => {
    const txMock = makeTxMock('pref-new', { mealsPerDay: null })
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    const res = await PATCH(req({ mealsPerDay: null }))
    expect(res.status).toBe(200)
  })

  it('rejects notes > 1000 chars (400)', async () => {
    const res = await PATCH(req({ notes: 'x'.repeat(1001) }))
    expect(res.status).toBe(400)
  })

  it('rejects allergen with invalid severity (400)', async () => {
    const res = await PATCH(req({
      allergens: [{ name: 'peanuts', severity: 'severe' }],
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/severity/i)
  })

  it('rejects allergen with empty name (400)', async () => {
    const res = await PATCH(req({
      allergens: [{ name: '', severity: 'allergy' }],
    }))
    expect(res.status).toBe(400)
  })

  it('rejects exclusion with empty ingredient (400)', async () => {
    const res = await PATCH(req({
      exclusions: [{ ingredient: '' }],
    }))
    expect(res.status).toBe(400)
  })

  it('rejects non-JSON body (400)', async () => {
    const badReq = new NextRequest('http://localhost/api/nutrition/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await PATCH(badReq)
    expect(res.status).toBe(400)
  })
})

// ─── Persistence ─────────────────────────────────────────────────────────────

describe('PATCH /api/nutrition/preferences — persistence', () => {
  beforeEach(() => { mockAuth('user-1') })

  it('calls upsert with the authenticated userId in where clause', async () => {
    const txMock = makeTxMock()
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    await PATCH(req({ approaches: ['high_protein'], mealsPerDay: 4 }))
    expect(txMock.dietaryPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({ userId: 'user-1', approaches: ['high_protein'] }),
      }),
    )
  })

  it('upsert update does not include userId (ownership is not user-settable)', async () => {
    const txMock = makeTxMock()
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    await PATCH(req({ mealsPerDay: 4 }))
    const call = txMock.dietaryPreference.upsert.mock.calls[0][0]
    expect(call.update).not.toHaveProperty('userId')
  })

  it('replaces allergens in full when provided', async () => {
    const txMock = makeTxMock('pref-existing')
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    await PATCH(req({
      allergens: [
        { name: 'peanuts', severity: 'allergy' },
        { name: 'tree nuts', severity: 'allergy' },
      ],
    }))
    expect(txMock.dietaryAllergen.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dietaryPreferenceId: 'pref-existing' } }),
    )
    expect(txMock.dietaryAllergen.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ name: 'peanuts', severity: 'allergy' }),
          expect.objectContaining({ name: 'tree nuts', severity: 'allergy' }),
        ]),
      }),
    )
  })

  it('normalizes allergen name to lowercase', async () => {
    const txMock = makeTxMock()
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    await PATCH(req({
      allergens: [{ name: 'Tree Nuts', severity: 'allergy' }],
    }))
    const createCall = txMock.dietaryAllergen.createMany.mock.calls[0][0]
    expect(createCall.data[0].name).toBe('tree nuts')
  })

  it('normalizes exclusion ingredient to lowercase', async () => {
    const txMock = makeTxMock()
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    await PATCH(req({
      exclusions: [{ ingredient: 'Cilantro', reason: 'taste' }],
    }))
    const createCall = txMock.dietaryExclusion.createMany.mock.calls[0][0]
    expect(createCall.data[0].ingredient).toBe('cilantro')
  })

  it('does not replace allergens when allergens key is omitted', async () => {
    const txMock = makeTxMock()
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    await PATCH(req({ mealsPerDay: 3 }))
    expect(txMock.dietaryAllergen.deleteMany).not.toHaveBeenCalled()
    expect(txMock.dietaryAllergen.createMany).not.toHaveBeenCalled()
  })

  it('does not replace exclusions when exclusions key is omitted', async () => {
    const txMock = makeTxMock()
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (fn: (tx: typeof txMock) => unknown) => fn(txMock),
    )
    await PATCH(req({ mealsPerDay: 3 }))
    expect(txMock.dietaryExclusion.deleteMany).not.toHaveBeenCalled()
  })
})
