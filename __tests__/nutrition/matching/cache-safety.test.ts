/**
 * Cache-bonus safety regression tests.
 *
 * Invariant: the +20 library-cache bonus applied in matcher.ts (step 7) must NEVER
 * allow a food to reach 'confident' when the semantic scorer would apply a –30
 * negative-pair penalty to it for the same query — even when it is the ONLY result.
 *
 * Architecture: the +20 is baked into baseScoreMap BEFORE scoreForIngredient() runs.
 * scoreForIngredient() then applies –30 on top. Net effect for a cached wrong food
 * (worst case: no competing result):
 *   base(~40) + 20 (cache) – 30 (penalty) = ~30, well below the confident threshold (85).
 *
 * A cached CORRECT food (no semantic penalty) CAN still be confident at high enough scores.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockPrisma, mockUsda, mockFatSecret, mockOff } = vi.hoisted(() => {
  const mockPrisma = {
    foodItem: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  }

  const mockUsda     = { providerId: 'usda_fooddata',    search: vi.fn().mockResolvedValue([]) }
  const mockFatSecret = { providerId: 'fatsecret',       search: vi.fn().mockResolvedValue([]) }
  const mockOff      = { providerId: 'open_food_facts',  search: vi.fn().mockResolvedValue([]) }

  return { mockPrisma, mockUsda, mockFatSecret, mockOff }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/nutrition/providers', () => ({
  FOOD_PROVIDERS: [mockUsda, mockFatSecret, mockOff],
}))

import { matchIngredient } from '@/lib/nutrition/matching/matcher'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a DB library row that getLibraryCandidates() will return. */
function makeLibraryItem(overrides: {
  id: string
  externalId: string
  name: string
  brand?: string | null
}) {
  return {
    id: overrides.id,
    externalId: overrides.externalId,
    name: overrides.name,
    brand: overrides.brand ?? null,
    barcode: null,
    servingSize: 100,
    servingUnit: 'g',
    householdServingText: null,
    householdUnit: null,
    unitsPerServing: null,
    calories: 150,
    proteinG: 25,
    carbohydrateG: 0,
    fatG: 5,
    sourceProvider: 'usda_fooddata',
    visibility: 'verified',
    lastSyncedAt: new Date(),
    nutrientsJson: null,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('cache-bonus safety invariant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.foodItem.findMany.mockResolvedValue([])
    mockUsda.search.mockResolvedValue([])
    mockFatSecret.search.mockResolvedValue([])
    mockOff.search.mockResolvedValue([])
  })

  // The dangerous scenario: wrong food in cache, NO correct food from providers.
  // The +20 cache bonus must NOT push the wrong food to 'confident' despite –30 penalty.

  it('cached "chicken thigh" as ONLY result for query "chicken breast" → NOT confident', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([
      makeLibraryItem({
        id: 'lib-thigh-1',
        externalId: 'usda-thigh-1',
        name: 'Chicken, broilers or fryers, thigh, meat only, raw',
      }),
    ])
    // All providers return nothing — wrong cached food is the only candidate
    // Result: base(~40) + 20 (cache) – 30 (negative pair "thigh" for "breast" query) = ~30 < 85

    const result = await matchIngredient({ ingredientName: 'chicken breast' })

    // Wrong cached food must NOT become confident
    expect(result.confidence).not.toBe('confident')
  })

  it('cached "cooked chicken" as ONLY result for query "raw chicken" → NOT confident', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([
      makeLibraryItem({
        id: 'lib-cooked-1',
        externalId: 'usda-cooked-1',
        name: 'Chicken, broilers or fryers, breast, cooked, roasted',
      }),
    ])
    // All providers return nothing

    const result = await matchIngredient({ ingredientName: 'raw chicken' })

    expect(result.confidence).not.toBe('confident')
  })

  it('cached "flavored yogurt" as ONLY result for query "plain Greek yogurt" → NOT confident', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([
      makeLibraryItem({
        id: 'lib-flavored-1',
        externalId: 'usda-flavored-1',
        name: 'Yogurt, Greek, strawberry, lowfat',
      }),
    ])
    // All providers return nothing

    const result = await matchIngredient({ ingredientName: 'plain Greek yogurt' })

    expect(result.confidence).not.toBe('confident')
  })

  it('cached "cooked pasta" as ONLY result for query "dry pasta" → NOT confident', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([
      makeLibraryItem({
        id: 'lib-cooked-pasta-1',
        externalId: 'usda-cooked-pasta-1',
        name: 'Pasta, cooked, enriched, without added salt',
      }),
    ])
    // All providers return nothing

    const result = await matchIngredient({ ingredientName: 'dry pasta' })

    expect(result.confidence).not.toBe('confident')
  })

  it('correctly cached "olive oil" as ONLY result for query "olive oil" → CAN be confident', async () => {
    // A correct cached food with no semantic penalty — the +20 bonus works as intended.
    mockPrisma.foodItem.findMany.mockResolvedValue([
      makeLibraryItem({
        id: 'lib-olive-1',
        externalId: 'usda-olive-1',
        name: 'Oil, olive, salad or cooking',
      }),
    ])
    // All providers return nothing

    const result = await matchIngredient({ ingredientName: 'olive oil' })

    // A semantically-correct cached hit should not be downgraded
    expect(result.confidence).not.toBe('no_match')
    expect(result.topMatch?.internalId).toBe('lib-olive-1')
  })

  it('wrong cached food loses to correct external provider result', async () => {
    // When the cache has wrong food AND providers return the right food,
    // the right food must win (negative-pair penalty drops the wrong food).
    mockPrisma.foodItem.findMany.mockResolvedValue([
      makeLibraryItem({
        id: 'lib-thigh-1',
        externalId: 'usda-thigh-1',
        name: 'Chicken, broilers or fryers, thigh, meat only, raw',
      }),
    ])
    mockUsda.search.mockResolvedValue([
      {
        provider: 'usda_fooddata',
        externalId: 'usda-breast-1',
        name: 'Chicken, broilers or fryers, breast, meat only, raw',
        servingSize: 100,
        servingUnit: 'g',
        coreNutrients: { calories: 110, proteinG: 23, carbohydrateG: 0, fatG: 2 },
        isGeneric: true,
      },
    ])

    const result = await matchIngredient({ ingredientName: 'chicken breast' })

    // Breast must beat thigh
    expect(result.topMatch?.name.toLowerCase()).toContain('breast')
  })
})
