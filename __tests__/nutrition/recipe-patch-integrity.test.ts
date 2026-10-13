/**
 * PATCH /api/recipes/[id] — server-side snapshot integrity tests.
 *
 * Verifies that the server ignores client-supplied snapshots for library
 * ingredients and recomputes them from the actual DB FoodItem data.
 * External ingredients (foodItemId null) use validated client values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockSupabase, mockPrisma } = vi.hoisted(() => {
  const mockSupabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-owner' } } }) },
  }
  const mockPrisma = {
    recipe: { findUnique: vi.fn(), update: vi.fn() },
    recipeIngredient: { deleteMany: vi.fn(), createMany: vi.fn() },
    recipeStep: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodItem: { findMany: vi.fn() },
    $transaction: vi.fn(),
  }
  return { mockSupabase, mockPrisma }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/recipes/image', () => ({
  generateSignedUrl: vi.fn().mockResolvedValue(null),
  generateSignedUrls: vi.fn().mockResolvedValue({}),
}))

import { PATCH as recipesPatch } from '../../app/api/recipes/[id]/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_PARAMS = { params: Promise.resolve({ id: 'recipe-id' }) }

// A draft recipe the owner can freely edit.
// Includes all fields serializeRecipe() needs so PATCH can complete successfully.
const draftRecipe = {
  id: 'recipe-id',
  userId: 'user-owner',
  name: 'Test Recipe',
  status: 'draft',
  servings: 2,
  nutritionComplete: false,
  cachedCalPerServing: null,
  cachedProteinGPerServing: null,
  cachedCarbGPerServing: null,
  cachedFatGPerServing: null,
  description: null,
  prepMinutes: null,
  cookMinutes: null,
  imageUrl: null,
  sharingConsent: false,
  creatorName: null,
  rejectionReason: null,
  isAiGenerated: false,
  createdAt: new Date('2026-10-01'),
  updatedAt: new Date('2026-10-01'),
  saves: [],
  _count: { saves: 0 },
  ingredients: [],
  steps: [],
}

// DB FoodItem for chicken breast — 100g serving, 165 cal
const CHICKEN_FOOD_ITEM = {
  id: 'food-uuid-chicken',
  calories: 165 as unknown as import('@prisma/client/runtime/library').Decimal,
  proteinG: 31 as unknown as import('@prisma/client/runtime/library').Decimal,
  carbohydrateG: 0 as unknown as import('@prisma/client/runtime/library').Decimal,
  fatG: 3.6 as unknown as import('@prisma/client/runtime/library').Decimal,
  servingSize: 100 as unknown as import('@prisma/client/runtime/library').Decimal,
  servingUnit: 'g',
}

function makePatchReq(body: unknown) {
  return new NextRequest('http://localhost/api/recipes/recipe-id', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function setupTransaction() {
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma))
  mockPrisma.recipe.update.mockResolvedValue(draftRecipe)
  mockPrisma.recipeIngredient.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.recipeIngredient.createMany.mockResolvedValue({ count: 1 })
  mockPrisma.recipeStep.deleteMany.mockResolvedValue({ count: 0 })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-owner' } } })
  mockPrisma.recipe.findUnique.mockResolvedValue(draftRecipe)
  setupTransaction()
})

// ── Server ignores inflated client snapshot for library items ─────────────────

describe('PATCH — library ingredient snapshot recomputation', () => {
  it('recomputes snapshot from DB food data, ignoring client-supplied calorie inflation', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([CHICKEN_FOOD_ITEM])

    const req = makePatchReq({
      ingredients: [{
        foodItemId: 'food-uuid-chicken',
        name: 'Chicken Breast',
        quantity: 200,    // 200g = 2x the 100g serving
        unit: 'g',
        // Client submits inflated values — should be ignored
        snapshotCalories: 9999,
        snapshotProteinG: 9999,
        snapshotCarbG: 9999,
        snapshotFatG: 9999,
      }],
    })

    const res = await recipesPatch(req, TEST_PARAMS)
    expect(res.status).toBe(200)

    const createCall = mockPrisma.recipeIngredient.createMany.mock.calls[0][0]
    const saved = createCall.data[0]

    // Server recomputes: 200g / 100g * 165 cal = 330 cal
    expect(saved.snapshotCalories).toBeCloseTo(330, 0)
    expect(saved.snapshotProteinG).toBeCloseTo(62, 0)
    expect(saved.snapshotFatG).toBeCloseTo(7.2, 1)
    // foodItemId is preserved
    expect(saved.foodItemId).toBe('food-uuid-chicken')
  })

  it('stores null snapshots when unit is incompatible with the food serving unit', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([CHICKEN_FOOD_ITEM])  // g-based food

    const req = makePatchReq({
      ingredients: [{
        foodItemId: 'food-uuid-chicken',
        name: 'Chicken Breast',
        quantity: 1,
        unit: 'cup',    // cups cannot convert to grams — incompatible
        snapshotCalories: 165,
        snapshotProteinG: 31,
        snapshotCarbG: 0,
        snapshotFatG: 3.6,
      }],
    })

    const res = await recipesPatch(req, TEST_PARAMS)
    expect(res.status).toBe(200)

    const createCall = mockPrisma.recipeIngredient.createMany.mock.calls[0][0]
    const saved = createCall.data[0]

    expect(saved.snapshotCalories).toBeNull()
    expect(saved.snapshotProteinG).toBeNull()
    expect(saved.foodItemId).toBe('food-uuid-chicken')  // link preserved even when unit incompatible
  })

  it('clears foodItemId when the linked food no longer exists in DB', async () => {
    // findMany returns empty — orphaned reference
    mockPrisma.foodItem.findMany.mockResolvedValue([])

    const req = makePatchReq({
      ingredients: [{
        foodItemId: 'food-uuid-stale',
        name: 'Deleted Food',
        quantity: 100,
        unit: 'g',
        snapshotCalories: 200,
        snapshotProteinG: 20,
        snapshotCarbG: 5,
        snapshotFatG: 8,
      }],
    })

    const res = await recipesPatch(req, TEST_PARAMS)
    expect(res.status).toBe(200)

    const createCall = mockPrisma.recipeIngredient.createMany.mock.calls[0][0]
    const saved = createCall.data[0]

    expect(saved.foodItemId).toBeNull()           // stale link cleared
    expect(saved.snapshotCalories).toBeNull()     // nutrition cleared too
  })
})

// ── External ingredients use validated client snapshots ───────────────────────

describe('PATCH — external ingredient snapshot passthrough', () => {
  it('stores client-supplied snapshots for external items (foodItemId null)', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([])  // no library items to fetch

    const req = makePatchReq({
      ingredients: [{
        foodItemId: null,
        name: 'Lean Ground Beef (Kirkland)',
        quantity: 112,
        unit: 'g',
        snapshotCalories: 200,
        snapshotProteinG: 24,
        snapshotCarbG: 0,
        snapshotFatG: 11,
      }],
    })

    const res = await recipesPatch(req, TEST_PARAMS)
    expect(res.status).toBe(200)

    const createCall = mockPrisma.recipeIngredient.createMany.mock.calls[0][0]
    const saved = createCall.data[0]

    expect(saved.foodItemId).toBeNull()
    expect(saved.snapshotCalories).toBe(200)
    expect(saved.snapshotProteinG).toBe(24)
  })

  it('rejects external ingredients with invalid snapshot values (negative calories)', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([])

    const req = makePatchReq({
      ingredients: [{
        foodItemId: null,
        name: 'Bad Food',
        quantity: 100,
        unit: 'g',
        snapshotCalories: -50,    // invalid
        snapshotProteinG: 10,
        snapshotCarbG: 5,
        snapshotFatG: 3,
      }],
    })

    const res = await recipesPatch(req, TEST_PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid ingredient nutrition')
  })

  it('accepts null snapshots for external free-text ingredients', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([])

    const req = makePatchReq({
      ingredients: [{
        foodItemId: null,
        name: 'mystery spice',
        quantity: 1,
        unit: 'tsp',
        snapshotCalories: null,
        snapshotProteinG: null,
        snapshotCarbG: null,
        snapshotFatG: null,
      }],
    })

    const res = await recipesPatch(req, TEST_PARAMS)
    expect(res.status).toBe(200)

    const createCall = mockPrisma.recipeIngredient.createMany.mock.calls[0][0]
    const saved = createCall.data[0]

    expect(saved.snapshotCalories).toBeNull()
    expect(saved.foodItemId).toBeNull()
  })
})

// ── Mixed recipe (library + external) ────────────────────────────────────────

describe('PATCH — mixed library and external ingredients', () => {
  it('recomputes library snapshot, passes through external snapshot', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([CHICKEN_FOOD_ITEM])

    const req = makePatchReq({
      ingredients: [
        {
          foodItemId: 'food-uuid-chicken',
          name: 'Chicken Breast',
          quantity: 150,   // 150g → 1.5 servings → 247.5 cal
          unit: 'g',
          snapshotCalories: 9999,   // ignored for library item
          snapshotProteinG: 9999,
          snapshotCarbG: 9999,
          snapshotFatG: 9999,
        },
        {
          foodItemId: null,
          name: 'Hot Sauce',
          quantity: 10,
          unit: 'ml',
          snapshotCalories: 5,      // accepted for external item
          snapshotProteinG: 0,
          snapshotCarbG: 1,
          snapshotFatG: 0,
        },
      ],
    })

    const res = await recipesPatch(req, TEST_PARAMS)
    expect(res.status).toBe(200)

    const createCall = mockPrisma.recipeIngredient.createMany.mock.calls[0][0]
    const [chicken, sauce] = createCall.data

    // Chicken: server recomputed 150/100 * 165 = 247.5
    expect(chicken.snapshotCalories).toBeCloseTo(247.5, 0)
    expect(chicken.foodItemId).toBe('food-uuid-chicken')

    // Hot sauce: client snapshot preserved
    expect(sauce.snapshotCalories).toBe(5)
    expect(sauce.foodItemId).toBeNull()
  })
})
