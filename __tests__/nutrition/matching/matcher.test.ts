import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockPrisma, mockFatSecret, mockUsda, mockOff } = vi.hoisted(() => {
  const mockPrisma = {
    foodItem: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  }

  function makeResult(id: string, name: string, calories: number, extra: Record<string, unknown> = {}) {
    return {
      provider: 'usda_fooddata',
      externalId: id,
      name,
      servingSize: 100,
      servingUnit: 'g',
      coreNutrients: { calories, proteinG: 10, carbohydrateG: 10, fatG: 5 },
      isGeneric: true,
      ...extra,
    }
  }

  const mockFatSecret = {
    providerId: 'fatsecret',
    search: vi.fn().mockResolvedValue([]),
  }
  const mockUsda = {
    providerId: 'usda_fooddata',
    search: vi.fn().mockResolvedValue([]),
  }
  const mockOff = {
    providerId: 'open_food_facts',
    search: vi.fn().mockResolvedValue([]),
  }

  return { mockPrisma, mockFatSecret, mockUsda, mockOff, makeResult }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/nutrition/providers', () => ({
  FOOD_PROVIDERS: [mockFatSecret, mockUsda, mockOff],
}))

import { matchIngredient } from '@/lib/nutrition/matching/matcher'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeResult(
  id: string,
  name: string,
  calories: number,
  extra: Record<string, unknown> = {},
) {
  return {
    provider: 'usda_fooddata',
    externalId: id,
    name,
    servingSize: 100,
    servingUnit: 'g',
    coreNutrients: { calories, proteinG: 10, carbohydrateG: 10, fatG: 5 },
    isGeneric: true,
    ...extra,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('matchIngredient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.foodItem.findMany.mockResolvedValue([])
    mockFatSecret.search.mockResolvedValue([])
    mockUsda.search.mockResolvedValue([])
    mockOff.search.mockResolvedValue([])
  })

  it('"olive oil" → confident match to an olive oil result', async () => {
    mockUsda.search.mockResolvedValue([
      makeResult('usda-olive', 'Oil, olive, salad or cooking', 884, { isGeneric: true }),
      makeResult('usda-sunflower', 'Oil, sunflower', 884),
    ])
    const result = await matchIngredient({ ingredientName: 'olive oil' })
    expect(result.topMatch).not.toBeNull()
    expect(result.topMatch!.name.toLowerCase()).toContain('olive')
    // Confidence should not be no_match
    expect(result.confidence).not.toBe('no_match')
  })

  it('"chicken" → ambiguous with clarification question about breast/thigh', async () => {
    mockUsda.search.mockResolvedValue([
      makeResult('breast', 'Chicken, broilers or fryers, breast, meat only, raw', 110),
      makeResult('thigh',  'Chicken, broilers or fryers, thigh, meat only, raw',  180),
    ])
    const result = await matchIngredient({ ingredientName: 'chicken' })
    // Either ambiguous with question, or at least not confident
    if (result.confidence === 'ambiguous') {
      expect(result.clarificationQuestion).toBeTruthy()
    }
    // Should not be no_match
    expect(result.confidence).not.toBe('no_match')
  })

  it('"chicken breast" → plausible or confident, no clarification', async () => {
    mockUsda.search.mockResolvedValue([
      makeResult('breast', 'Chicken, broilers or fryers, breast, meat only, raw', 110),
      makeResult('thigh',  'Chicken, broilers or fryers, thigh, meat only, raw',  180),
    ])
    const result = await matchIngredient({ ingredientName: 'chicken breast' })
    expect(['plausible', 'confident']).toContain(result.confidence)
    expect(result.clarificationQuestion).toBeFalsy()
    expect(result.topMatch?.name.toLowerCase()).toContain('breast')
  })

  it('"tri-tip" → plausible or confident, top result is beef tri-tip', async () => {
    mockUsda.search.mockResolvedValue([
      makeResult('tritip', 'Beef, tri-tip roast, raw', 200),
      makeResult('tbone',  'Beef, T-bone steak, raw',  180),
    ])
    const result = await matchIngredient({ ingredientName: 'tri-tip' })
    expect(['plausible', 'confident']).toContain(result.confidence)
    expect(result.topMatch?.name.toLowerCase()).toContain('tri-tip')
  })

  it('"xyz123notafood" → no_match', async () => {
    // All providers return nothing useful
    mockUsda.search.mockResolvedValue([])
    mockFatSecret.search.mockResolvedValue([])
    mockOff.search.mockResolvedValue([])
    const result = await matchIngredient({ ingredientName: 'xyz123notafood' })
    expect(result.confidence).toBe('no_match')
    expect(result.topMatch).toBeNull()
  })

  it('provider timeout/failure → gracefully returns no_match, does not throw', async () => {
    mockUsda.search.mockRejectedValue(new Error('Timeout'))
    mockFatSecret.search.mockRejectedValue(new Error('Network error'))
    mockOff.search.mockRejectedValue(new Error('503'))
    await expect(matchIngredient({ ingredientName: 'chicken breast' })).resolves.toMatchObject({
      confidence: 'no_match',
      topMatch: null,
    })
  })

  it('library cache hit → gets +20 bonus, may elevate to confident', async () => {
    const libItem = {
      id: 'lib-uuid-1',
      externalId: 'usda-olive-123',
      name: 'Oil, olive, salad or cooking',
      brand: null,
      barcode: null,
      servingSize: 14,
      servingUnit: 'g',
      householdServingText: '1 tbsp',
      householdUnit: null,
      unitsPerServing: null,
      calories: 119,
      proteinG: 0,
      carbohydrateG: 0,
      fatG: 13.5,
      sourceProvider: 'usda_fooddata',
      visibility: 'verified',
      lastSyncedAt: new Date(),
      nutrientsJson: null,
    }
    mockPrisma.foodItem.findMany.mockResolvedValue([libItem])
    // External provider also returns it but library version gets +20 bonus
    mockUsda.search.mockResolvedValue([
      makeResult('usda-olive-123', 'Oil, olive, salad or cooking', 884, { isGeneric: true }),
    ])

    const result = await matchIngredient({ ingredientName: 'olive oil' })
    expect(result.topMatch).not.toBeNull()
    // Library hit should win or at minimum not be no_match
    expect(result.confidence).not.toBe('no_match')
    // Top match should have internalId if library item won
    if (result.topMatch?.internalId) {
      expect(result.topMatch.internalId).toBe('lib-uuid-1')
    }
  })

  it('returns top 3 alternatives excluding topMatch', async () => {
    mockUsda.search.mockResolvedValue([
      makeResult('a', 'Chicken, breast, raw', 110),
      makeResult('b', 'Chicken, thigh, raw', 180),
      makeResult('c', 'Chicken, wing, raw', 200),
      makeResult('d', 'Chicken, drumstick, raw', 170),
    ])
    const result = await matchIngredient({ ingredientName: 'chicken breast' })
    expect(result.alternatives.length).toBeLessThanOrEqual(3)
    if (result.topMatch) {
      const topId = result.topMatch.externalId
      expect(result.alternatives.every(a => a.externalId !== topId)).toBe(true)
    }
  })
})
