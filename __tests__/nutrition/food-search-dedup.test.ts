/**
 * Library search result identity and food log deduplication tests.
 *
 * Covers:
 *  - Library search returns externalId = original provider ID (not internal UUID)
 *  - Library search returns internalId = DB UUID (for recipe ingredient FK)
 *  - External results have no internalId
 *  - Log route dedup: second log of same library food reuses existing FoodItem
 *  - Log route dedup: no cascade duplicates when library result is logged
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockSupabase, mockPrisma, mockProviders } = vi.hoisted(() => {
  const mockSupabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  }
  const mockPrisma = {
    foodItem: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    foodLogEntry: { create: vi.fn() },
  }
  const mockProviders = [
    {
      providerId: 'fatsecret',
      search: vi.fn().mockResolvedValue([]),
    },
  ]
  return { mockSupabase, mockPrisma, mockProviders }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/nutrition/providers', () => ({ FOOD_PROVIDERS: mockProviders }))
vi.mock('@/lib/nutrition/privacy-guard', () => ({
  isSensitiveQuery: vi.fn().mockReturnValue(false),
  PRIVACY_REJECTION_MESSAGE: 'blocked',
}))

import { GET as searchGet } from '../../app/api/nutrition/search/route'
import { POST as logPost } from '../../app/api/nutrition/log/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSearchReq(query: string) {
  return new NextRequest(`http://localhost/api/nutrition/search?q=${encodeURIComponent(query)}`)
}

function makeLogReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/nutrition/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// A library FoodItem as stored in the DB.
const TORTILLA_DB = {
  id: '26326aae-a49d-45d5-be08-9f113a431b5d',        // internal UUID
  externalId: '0044946190364',                         // original OFF barcode
  sourceProvider: 'open_food_facts',
  name: 'Ready-to-Cook Flour Tortillas',
  brand: 'Tortilla Land',
  barcode: '0044946190364',
  servingSize: { toNumber: () => 47, valueOf: () => 47 } as unknown as import('@prisma/client/runtime/library').Decimal,
  servingUnit: 'g',
  householdServingText: '1 tortilla',
  householdUnit: 'tortilla',
  unitsPerServing: { toNumber: () => 1, valueOf: () => 1 } as unknown as import('@prisma/client/runtime/library').Decimal,
  calories: { toNumber: () => 146 } as unknown as import('@prisma/client/runtime/library').Decimal,
  proteinG: { toNumber: () => 3.6 } as unknown as import('@prisma/client/runtime/library').Decimal,
  carbohydrateG: { toNumber: () => 26 } as unknown as import('@prisma/client/runtime/library').Decimal,
  fatG: { toNumber: () => 2.8 } as unknown as import('@prisma/client/runtime/library').Decimal,
  nutrientsJson: null,
  visibility: 'community',
  lastSyncedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mockPrisma.foodItem.findMany.mockResolvedValue([])
  mockPrisma.foodItem.findFirst.mockResolvedValue(null)
  mockPrisma.foodItem.create.mockResolvedValue({ id: 'new-food-uuid' })
  mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })
  mockProviders[0].search.mockResolvedValue([])
})

// ── Search route identity tests ───────────────────────────────────────────────

describe('Search route — library result identity', () => {
  it('library result returns original externalId (barcode), not DB UUID', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([TORTILLA_DB])

    const res = await searchGet(makeSearchReq('tortilla'))
    expect(res.status).toBe(200)
    const data = await res.json() as { results: Array<{ externalId: string; internalId?: string; source: string }> }

    const lib = data.results.find(r => r.source === 'library')
    expect(lib).toBeDefined()
    // externalId = original barcode for provider dedup
    expect(lib!.externalId).toBe('0044946190364')
    // internalId = DB UUID for recipe ingredient FK
    expect(lib!.internalId).toBe('26326aae-a49d-45d5-be08-9f113a431b5d')
  })

  it('library result carries household unit fields', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([TORTILLA_DB])

    const res = await searchGet(makeSearchReq('tortilla'))
    const data = await res.json() as { results: Array<{ householdUnit?: string; unitsPerServing?: number }> }
    const lib = data.results[0]
    expect(lib.householdUnit).toBe('tortilla')
    expect(lib.unitsPerServing).toBe(1)
  })

  it('food with null externalId falls back to DB UUID as externalId', async () => {
    const aiVisionFood = {
      ...TORTILLA_DB,
      id: 'ai-vision-uuid-123',
      externalId: null,          // ai_vision foods have no external ID
      sourceProvider: 'ai_vision',
    }
    mockPrisma.foodItem.findMany.mockResolvedValue([aiVisionFood])

    const res = await searchGet(makeSearchReq('tortilla'))
    const data = await res.json() as { results: Array<{ externalId: string; internalId: string }> }
    const lib = data.results[0]
    // Falls back to the DB UUID for both fields
    expect(lib.externalId).toBe('ai-vision-uuid-123')
    expect(lib.internalId).toBe('ai-vision-uuid-123')
  })
})

// ── Log route dedup: prevents cascade duplicates ──────────────────────────────

describe('Log route — dedup with original externalId', () => {
  it('logging a food with the original barcode deduplicates against existing DB record', async () => {
    // Simulate: Tortilla Land already exists in DB with barcode as externalId
    mockPrisma.foodItem.findFirst.mockResolvedValue({ id: '26326aae-a49d-45d5-be08-9f113a431b5d' })

    const req = makeLogReq({
      mealType: 'lunch',
      logDate: '2026-10-13',
      foodName: 'Ready-to-Cook Flour Tortillas',
      brand: 'Tortilla Land',
      barcode: '0044946190364',
      servingMultiplier: 1,
      servingSize: 47,
      servingUnit: 'g',
      calories: 146,
      proteinG: 3.6,
      carbohydrateG: 26,
      fatG: 2.8,
      sourceProvider: 'open_food_facts',
      externalId: '0044946190364',    // original barcode (as now returned by search route)
      householdUnit: 'tortilla',
      unitsPerServing: 1,
    })

    const res = await logPost(req)
    expect(res.status).toBe(201)

    // Dedup found the existing record — no new FoodItem created
    expect(mockPrisma.foodItem.findFirst).toHaveBeenCalledWith({
      where: { sourceProvider: 'open_food_facts', externalId: '0044946190364' },
    })
    expect(mockPrisma.foodItem.create).not.toHaveBeenCalled()
  })

  it('logging a food with a UUID externalId (pre-fix cascade scenario) still creates no duplicate if found', async () => {
    // The UUID-as-externalId scenario: the cascaded record (af372903-...) has UUID as its own externalId
    const cascadeUuid = 'af372903-0c25-4bca-826f-1a7d8c868517'
    mockPrisma.foodItem.findFirst.mockResolvedValue({ id: cascadeUuid })

    const req = makeLogReq({
      mealType: 'lunch',
      logDate: '2026-10-13',
      foodName: 'Ready-to-Cook Flour Tortillas',
      servingMultiplier: 1,
      servingSize: 47,
      servingUnit: 'g',
      calories: 146,
      proteinG: 3.6,
      carbohydrateG: 26,
      fatG: 2.8,
      sourceProvider: 'open_food_facts',
      externalId: cascadeUuid,    // existing cascade record's externalId
    })

    const res = await logPost(req)
    expect(res.status).toBe(201)
    expect(mockPrisma.foodItem.create).not.toHaveBeenCalled()
  })

  it('logging a new food creates a new FoodItem with correct fields', async () => {
    mockPrisma.foodItem.findFirst.mockResolvedValue(null)  // not in DB yet

    const req = makeLogReq({
      mealType: 'breakfast',
      logDate: '2026-10-13',
      foodName: 'Ready-to-Cook Flour Tortillas',
      brand: 'Tortilla Land',
      barcode: '0044946190364',
      servingMultiplier: 2,
      servingSize: 47,
      servingUnit: 'g',
      calories: 146,
      proteinG: 3.6,
      carbohydrateG: 26,
      fatG: 2.8,
      sourceProvider: 'open_food_facts',
      externalId: '0044946190364',
      householdUnit: 'tortilla',
      unitsPerServing: 1,
      householdServingText: '1 tortilla',
    })

    const res = await logPost(req)
    expect(res.status).toBe(201)

    expect(mockPrisma.foodItem.create).toHaveBeenCalledTimes(1)
    const created = mockPrisma.foodItem.create.mock.calls[0][0].data
    expect(created.externalId).toBe('0044946190364')
    expect(created.householdUnit).toBe('tortilla')
    expect(created.unitsPerServing).toBe(1)
    expect(created.householdServingText).toBe('1 tortilla')
  })
})
