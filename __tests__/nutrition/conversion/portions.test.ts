import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    foodItemPortion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// ── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.stubEnv('USDA_API_KEY', 'test-api-key')

import { fetchAndStoreUsdaPortions, lookupPortions } from '../../../lib/nutrition/conversion/portions'

// FoodItemPortion.foodItemId is @db.Uuid — tests that exercise Foundation/SR Legacy
// processing must use a valid UUID, otherwise the UUID guard returns [] early.
const VALID_FOOD_UUID = '550e8400-e29b-41d4-a716-446655440000'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.foodItemPortion.findFirst.mockResolvedValue(null) // No existing portions by default
  mockPrisma.foodItemPortion.findMany.mockResolvedValue([])
  mockPrisma.foodItemPortion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'generated-id',
    ...data,
  }))
  mockPrisma.foodItemPortion.upsert.mockRejectedValue(new Error('upsert should not be called in these tests'))
})

function makeFdcResponse(portions: Array<{
  id: number
  portionDescription: string
  gramWeight: number
  modifier?: string
  measureUnit?: { id: number; name: string; abbreviation?: string }
}>) {
  return {
    ok: true,
    json: async () => ({ foodPortions: portions }),
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('fetchAndStoreUsdaPortions', () => {
  it('USDA Branded food → returns [] (only Foundation/SR Legacy supported)', async () => {
    const result = await fetchAndStoreUsdaPortions('food-id', '12345', 'Branded')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('USDA Survey (FNDDS) → returns []', async () => {
    const result = await fetchAndStoreUsdaPortions('food-id', '12345', 'Survey (FNDDS)')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('null fdcDataType → returns []', async () => {
    const result = await fetchAndStoreUsdaPortions('food-id', '12345', null)
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('non-numeric fdcId → returns []', async () => {
    const result = await fetchAndStoreUsdaPortions('food-id', 'abc', 'Foundation')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('USDA Foundation food → fetches, maps, stores, returns portions', async () => {
    mockFetch.mockResolvedValueOnce(makeFdcResponse([
      {
        id: 100,
        portionDescription: '1 cup',
        gramWeight: 125.0,
        modifier: undefined,
        measureUnit: { id: 1, name: 'cup', abbreviation: 'c' },
      },
      {
        id: 101,
        portionDescription: '1 tbsp',
        gramWeight: 15.5,
        modifier: 'raw',
        measureUnit: { id: 2, name: 'tbsp', abbreviation: 'T' },
      },
    ]))

    mockPrisma.foodItemPortion.create
      .mockResolvedValueOnce({ id: 'p1', portionDescription: '1 cup', quantity: 1, unit: 'cup', gramWeight: 125.0, fdcPortionId: 100, sourceConfidence: 'usda_measured', preparationState: null })
      .mockResolvedValueOnce({ id: 'p2', portionDescription: '1 tbsp', quantity: 1, unit: 'tbsp', gramWeight: 15.5, fdcPortionId: 101, sourceConfidence: 'usda_measured', preparationState: 'raw' })

    const result = await fetchAndStoreUsdaPortions(VALID_FOOD_UUID, '99999', 'Foundation')

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch.mock.calls[0][0]).toContain('99999')
    expect(result).toHaveLength(2)
    expect(result[0].unit).toBe('cup')
    expect(result[0].gramWeight).toBe(125.0)
    expect(result[0].sourceConfidence).toBe('usda_measured')
    expect(result[1].unit).toBe('tbsp')
    expect(result[1].preparationState).toBe('raw')
  })

  it('USDA SR Legacy food → fetches and stores', async () => {
    mockFetch.mockResolvedValueOnce(makeFdcResponse([
      {
        id: 200,
        portionDescription: '1 slice',
        gramWeight: 28.0,
        modifier: undefined,
        measureUnit: { id: 3, name: 'slice' },
      },
    ]))

    mockPrisma.foodItemPortion.create.mockResolvedValueOnce({
      id: 'p3',
      portionDescription: '1 slice',
      quantity: 1,
      unit: 'slice',
      gramWeight: 28.0,
      fdcPortionId: 200,
      sourceConfidence: 'usda_measured',
      preparationState: null,
    })

    const result = await fetchAndStoreUsdaPortions(VALID_FOOD_UUID, '54321', 'SR Legacy')
    expect(result).toHaveLength(1)
    expect(result[0].unit).toBe('slice')
  })

  it('skip portions with gramWeight <= 0', async () => {
    mockFetch.mockResolvedValueOnce(makeFdcResponse([
      {
        id: 300,
        portionDescription: '1 cup',
        gramWeight: 0, // should be skipped
        measureUnit: { id: 1, name: 'cup' },
      },
      {
        id: 301,
        portionDescription: '1 tbsp',
        gramWeight: -5, // should be skipped
        measureUnit: { id: 2, name: 'tbsp' },
      },
      {
        id: 302,
        portionDescription: '1 piece',
        gramWeight: 50,
        measureUnit: { id: 3, name: 'piece' },
      },
    ]))

    mockPrisma.foodItemPortion.create.mockResolvedValueOnce({
      id: 'p4',
      portionDescription: '1 piece',
      quantity: 1,
      unit: 'piece',
      gramWeight: 50,
      fdcPortionId: 302,
      sourceConfidence: 'usda_measured',
      preparationState: null,
    })

    const result = await fetchAndStoreUsdaPortions(VALID_FOOD_UUID, '11111', 'Foundation')
    expect(result).toHaveLength(1)
    expect(result[0].unit).toBe('piece')
    expect(result[0].gramWeight).toBe(50)
    // Verify gramWeight=0 and negative were skipped (create called only once)
    expect(mockPrisma.foodItemPortion.create).toHaveBeenCalledTimes(1)
  })

  it('existing portions in DB → returns existing without re-fetching', async () => {
    // findFirst returns an existing portion
    mockPrisma.foodItemPortion.findFirst.mockResolvedValueOnce({ id: 'existing-p1' })
    mockPrisma.foodItemPortion.findMany.mockResolvedValueOnce([
      {
        id: 'existing-p1',
        portionDescription: '1 cup',
        quantity: 1,
        unit: 'cup',
        gramWeight: 120,
        fdcPortionId: 999,
        sourceConfidence: 'usda_measured',
        preparationState: null,
      },
    ])

    const result = await fetchAndStoreUsdaPortions(VALID_FOOD_UUID, '99999', 'Foundation')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('existing-p1')
  })

  it('modifier "raw" → preparationState="raw"', async () => {
    mockFetch.mockResolvedValueOnce(makeFdcResponse([
      {
        id: 400,
        portionDescription: '1 cup',
        gramWeight: 100,
        modifier: 'raw',
        measureUnit: { id: 1, name: 'cup' },
      },
    ]))

    mockPrisma.foodItemPortion.create.mockResolvedValueOnce({
      id: 'p5',
      portionDescription: '1 cup',
      quantity: 1,
      unit: 'cup',
      gramWeight: 100,
      fdcPortionId: 400,
      sourceConfidence: 'usda_measured',
      preparationState: 'raw',
    })

    const result = await fetchAndStoreUsdaPortions(VALID_FOOD_UUID, '22222', 'Foundation')
    expect(result[0].preparationState).toBe('raw')
  })

  it('modifier "large" (size adjective) → preparationState=null', async () => {
    mockFetch.mockResolvedValueOnce(makeFdcResponse([
      {
        id: 500,
        portionDescription: '1 large',
        gramWeight: 75,
        modifier: 'large',
        measureUnit: { id: 4, name: 'unit' },
      },
    ]))

    // The create is called with preparationState: null
    mockPrisma.foodItemPortion.create.mockResolvedValueOnce({
      id: 'p6',
      portionDescription: '1 large',
      quantity: 1,
      unit: 'unit',
      gramWeight: 75,
      fdcPortionId: 500,
      sourceConfidence: 'usda_measured',
      preparationState: null,
    })

    const result = await fetchAndStoreUsdaPortions(VALID_FOOD_UUID, '33333', 'Foundation')
    expect(result[0].preparationState).toBeNull()

    // Verify that what was passed to create had preparationState: null
    const createArg = mockPrisma.foodItemPortion.create.mock.calls[0][0].data
    expect(createArg.preparationState).toBeNull()
  })

  it('modifier "medium" (size adjective) → preparationState=null', async () => {
    mockFetch.mockResolvedValueOnce(makeFdcResponse([
      {
        id: 600,
        portionDescription: '1 medium',
        gramWeight: 55,
        modifier: 'medium',
        measureUnit: { id: 4, name: 'unit' },
      },
    ]))

    mockPrisma.foodItemPortion.create.mockResolvedValueOnce({
      id: 'p7',
      portionDescription: '1 medium',
      quantity: 1,
      unit: 'unit',
      gramWeight: 55,
      fdcPortionId: 600,
      sourceConfidence: 'usda_measured',
      preparationState: null,
    })

    const result = await fetchAndStoreUsdaPortions(VALID_FOOD_UUID, '44444', 'Foundation')
    expect(result[0].preparationState).toBeNull()
    const createArg = mockPrisma.foodItemPortion.create.mock.calls[0][0].data
    expect(createArg.preparationState).toBeNull()
  })

  it('returns [] when USDA API key is missing', async () => {
    vi.stubEnv('USDA_API_KEY', '')
    const result = await fetchAndStoreUsdaPortions(VALID_FOOD_UUID, '99999', 'Foundation')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
    // Restore
    vi.stubEnv('USDA_API_KEY', 'test-api-key')
  })

  // ── UUID guard — prevents Postgres "invalid input syntax for type uuid" ───────
  // FoodItemPortion.foodItemId is @db.Uuid. Passing a non-UUID foodItemId (e.g.
  // FatSecret numeric ID "2917" or USDA fdcId "171513") causes a Postgres throw
  // that propagates through resolveIngredientFactor and bypasses Part C fallback.
  it('non-UUID foodItemId (FatSecret numeric ID) → returns [] without querying DB', async () => {
    const result = await fetchAndStoreUsdaPortions('2917', '2917', 'Foundation')
    expect(result).toEqual([])
    expect(mockPrisma.foodItemPortion.findFirst).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('non-UUID foodItemId (USDA numeric string) → returns [] without querying DB', async () => {
    const result = await fetchAndStoreUsdaPortions('171513', '171513', 'SR Legacy')
    expect(result).toEqual([])
    expect(mockPrisma.foodItemPortion.findFirst).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('valid UUID foodItemId → still queries DB normally', async () => {
    // Explicitly override any queued mock values from prior tests
    mockPrisma.foodItemPortion.findFirst.mockResolvedValue(null)
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await fetchAndStoreUsdaPortions(VALID_FOOD_UUID, '99999', 'Foundation')
    expect(result).toEqual([])
    expect(mockPrisma.foodItemPortion.findFirst).toHaveBeenCalledWith({
      where: { foodItemId: VALID_FOOD_UUID },
    })
  })
})

describe('lookupPortions — UUID guard', () => {
  it('non-UUID foodItemId → returns [] without querying DB', async () => {
    const result = await lookupPortions('2917', 'piece')
    expect(result).toEqual([])
    expect(mockPrisma.foodItemPortion.findMany).not.toHaveBeenCalled()
  })

  it('non-UUID USDA fdcId → returns [] without querying DB', async () => {
    const result = await lookupPortions('171513', 'strip')
    expect(result).toEqual([])
    expect(mockPrisma.foodItemPortion.findMany).not.toHaveBeenCalled()
  })

  it('valid UUID foodItemId → queries DB normally', async () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000'
    mockPrisma.foodItemPortion.findMany.mockResolvedValueOnce([])
    const result = await lookupPortions(validUUID, 'piece')
    expect(result).toEqual([])
    expect(mockPrisma.foodItemPortion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ foodItemId: validUUID }) })
    )
  })
})
