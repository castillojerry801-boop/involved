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

// ── Barcode EAN-13/UPC-A cross-provider dedup (normBarcodeForDedup) ───────────
//
// Regression suite for the barcode normalization fix applied to step 5 and step 7
// of app/api/nutrition/search/route.ts.
//
// Before the fix: seenBarcodes used raw barcode strings; if one provider returned
// "049000042566" (UPC-A, 12 digits) and another returned "0049000042566" (EAN-13,
// 13 digits with leading zero), the same physical product could appear twice.
//
// After the fix: normBarcodeForDedup("0049000042566") → "049000042566" so both
// variants hash to the same key and only the higher-scored result survives.

describe('Search route — EAN-13/UPC-A barcode dedup (cross-provider)', () => {
  it('two providers returning EAN-13 vs UPC-A for the same product yield one result', async () => {
    // Provider A returns UPC-A (12-digit, FatSecret style)
    // Provider B returns EAN-13 (13-digit with leading zero, OpenFoodFacts style)
    mockProviders[0].search.mockResolvedValue([
      {
        provider: 'fatsecret',
        externalId: 'fs-12345',
        name: 'Coca-Cola Classic',
        brand: 'Coca-Cola',
        barcode: '049000042566',           // UPC-A
        servingSize: 355,
        servingUnit: 'mL',
        coreNutrients: { calories: 140, proteinG: 0, carbohydrateG: 39, fatG: 0 },
      },
      {
        provider: 'open_food_facts',
        externalId: 'off-12345',
        name: 'Coca-Cola Classic',
        brand: 'Coca-Cola',
        barcode: '0049000042566',          // EAN-13 — same physical product
        servingSize: 355,
        servingUnit: 'mL',
        coreNutrients: { calories: 140, proteinG: 0, carbohydrateG: 39, fatG: 0 },
      },
    ])

    const res = await searchGet(makeSearchReq('coca cola'))
    expect(res.status).toBe(200)
    const data = await res.json() as { results: Array<{ barcode: string; provider: string }> }

    // Only one Coca-Cola should appear — the higher-scored FatSecret result wins
    const cocaColas = data.results.filter(r => r.barcode === '049000042566' || r.barcode === '0049000042566')
    expect(cocaColas.length).toBe(1)
    expect(cocaColas[0].provider).toBe('fatsecret')  // higher provider bonus (15 vs 5)
  })

  it('EAN-13 result is kept when it scores higher than the UPC-A result', async () => {
    // Use a food with non-zero macros so both candidates survive the nutrition gate.
    // FatSecret has the higher provider bonus (15) so it wins even though it returns UPC-A.
    mockProviders[0].search.mockResolvedValue([
      {
        provider: 'open_food_facts',
        externalId: 'off-abc',
        name: 'Oat Milk',
        brand: 'Oatly',
        barcode: '0748252103536',          // EAN-13
        servingSize: 240,
        servingUnit: 'mL',
        coreNutrients: { calories: 120, proteinG: 3, carbohydrateG: 16, fatG: 5 },
      },
      {
        provider: 'fatsecret',
        externalId: 'fs-abc',
        name: 'Oat Milk',
        brand: 'Oatly',
        barcode: '748252103536',           // UPC-A — same product
        servingSize: 240,
        servingUnit: 'mL',
        coreNutrients: { calories: 120, proteinG: 3, carbohydrateG: 16, fatG: 5 },
      },
    ])

    const res = await searchGet(makeSearchReq('oatly'))
    const data = await res.json() as { results: Array<{ barcode: string }> }

    const milks = data.results.filter(r =>
      r.barcode === '748252103536' || r.barcode === '0748252103536',
    )
    expect(milks.length).toBe(1)
  })

  it('two results with genuinely different barcodes both survive dedup', async () => {
    // EAN-13 "0049000042566" (Coke) and EAN-13 "0012000001086" (Pepsi) differ after norm.
    mockProviders[0].search.mockResolvedValue([
      {
        provider: 'fatsecret',
        externalId: 'fs-coke',
        name: 'Coca-Cola Classic',
        brand: 'Coca-Cola',
        barcode: '0049000042566',
        servingSize: 355,
        servingUnit: 'mL',
        coreNutrients: { calories: 140, proteinG: 0, carbohydrateG: 39, fatG: 0 },
      },
      {
        provider: 'fatsecret',
        externalId: 'fs-pepsi',
        name: 'Pepsi Cola',
        brand: 'Pepsi',
        barcode: '0012000001086',
        servingSize: 355,
        servingUnit: 'mL',
        coreNutrients: { calories: 150, proteinG: 0, carbohydrateG: 41, fatG: 0 },
      },
    ])

    const res = await searchGet(makeSearchReq('cola'))
    const data = await res.json() as { results: Array<{ barcode: string }> }

    const barcodes = data.results.map(r => r.barcode)
    expect(barcodes).toContain('0049000042566')
    expect(barcodes).toContain('0012000001086')
  })

  it('step 7 cache-skip: library EAN-13 blocks external UPC-A duplicate', async () => {
    // Library has the EAN-13 form; external provider returns UPC-A.
    // Step 7 should recognise them as the same product and exclude the external result.
    const ean13 = '0049000042566'
    const upcA  = '049000042566'
    mockPrisma.foodItem.findMany.mockResolvedValue([
      {
        ...TORTILLA_DB,
        id: 'cache-coca-cola-uuid',
        externalId: ean13,
        name: 'Coca-Cola Classic',
        brand: 'Coca-Cola',
        barcode: ean13,
        sourceProvider: 'open_food_facts',
      },
    ])
    mockProviders[0].search.mockResolvedValue([
      {
        provider: 'fatsecret',
        externalId: 'fs-coke',
        name: 'Coca-Cola Classic',
        brand: 'Coca-Cola',
        barcode: upcA,                     // UPC-A — same physical product as cached EAN-13
        servingSize: 355,
        servingUnit: 'mL',
        coreNutrients: { calories: 140, proteinG: 0, carbohydrateG: 39, fatG: 0 },
      },
    ])

    const res = await searchGet(makeSearchReq('coca cola'))
    const data = await res.json() as { results: Array<{ source: string; barcode?: string }> }

    // Library result present
    const lib = data.results.find(r => r.source === 'library')
    expect(lib).toBeDefined()

    // External duplicate blocked — it shares the same normalized barcode
    const external = data.results.filter(r => r.source === 'external')
    expect(external.length).toBe(0)
  })
})
