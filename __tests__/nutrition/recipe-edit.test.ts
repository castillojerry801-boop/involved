/**
 * Recipe edit mode regression tests.
 *
 * Covers:
 *  - ingredientToDraft conversion (pre-population of edit form)
 *  - PATCH edit: owner updates name/servings/steps/ingredients
 *  - Permissions: non-owner cannot edit
 *  - Published recipe 409 revise gate
 *  - Published recipe with revise:true → 200 + moves to pending
 *  - Pending recipe edit moves back to draft
 *  - Nutrition recomputed correctly on edit (from DB food data)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ingredientToDraft } from '../../components/recipes/create-recipe-modal'
import type { RecipeDetail } from '../../components/recipes/recipe-detail'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockSupabase, mockPrisma } = vi.hoisted(() => {
  const mockSupabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'owner-id' } } }) },
  }
  const mockPrisma = {
    recipe: { findUnique: vi.fn(), update: vi.fn() },
    recipeIngredient: { deleteMany: vi.fn(), createMany: vi.fn() },
    recipeStep: { deleteMany: vi.fn(), createMany: vi.fn() },
    foodItem: { findMany: vi.fn().mockResolvedValue([]) },
    foodItemPortion: { findMany: vi.fn().mockResolvedValue([]) },
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

const PARAMS = { params: Promise.resolve({ id: 'recipe-id' }) }

function makeRecipe(overrides: Partial<{
  userId: string; status: string; servings: number
}> = {}) {
  return {
    id: 'recipe-id',
    userId: overrides.userId ?? 'owner-id',
    name: 'Original Name',
    status: overrides.status ?? 'draft',
    servings: overrides.servings ?? 4,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    saves: [],
    _count: { saves: 0 },
    ingredients: [],
    steps: [],
  }
}

function makePatch(body: unknown) {
  return new NextRequest('http://localhost/api/recipes/recipe-id', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function setupTransaction(updatedRecipe = makeRecipe()) {
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma))
  mockPrisma.recipe.update.mockResolvedValue(updatedRecipe)
  mockPrisma.recipeIngredient.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.recipeIngredient.createMany.mockResolvedValue({ count: 0 })
  mockPrisma.recipeStep.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.recipeStep.createMany?.mockResolvedValue?.({ count: 0 })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'owner-id' } } })
  mockPrisma.recipe.findUnique.mockResolvedValue(makeRecipe())
  mockPrisma.foodItem.findMany.mockResolvedValue([])
  mockPrisma.foodItemPortion.findMany.mockResolvedValue([])
  setupTransaction()
})

// ── ingredientToDraft unit tests ──────────────────────────────────────────────

describe('ingredientToDraft — form pre-population', () => {
  const savedIngredient: RecipeDetail['ingredients'][0] = {
    id: 'ing-1',
    foodItemId: 'food-uuid-chicken',
    name: 'Chicken Breast',
    quantity: 200,
    unit: 'g',
    notes: 'skinless',
    snapshotCalories: 330,
    snapshotProteinG: 62,
    snapshotCarbG: 0,
    snapshotFatG: 7.2,
  }

  it('copies all required fields', () => {
    const draft = ingredientToDraft(savedIngredient)
    expect(draft.foodItemId).toBe('food-uuid-chicken')
    expect(draft.name).toBe('Chicken Breast')
    expect(draft.quantity).toBe(200)
    expect(draft.unit).toBe('g')
    expect(draft.notes).toBe('skinless')
    expect(draft.snapshotCalories).toBe(330)
    expect(draft.snapshotProteinG).toBe(62)
    expect(draft.snapshotCarbG).toBe(0)
    expect(draft.snapshotFatG).toBe(7.2)
  })

  it('converts null notes to empty string', () => {
    const draft = ingredientToDraft({ ...savedIngredient, notes: null })
    expect(draft.notes).toBe('')
  })

  it('generates a unique key', () => {
    const a = ingredientToDraft(savedIngredient)
    const b = ingredientToDraft(savedIngredient)
    expect(a.key).toBeTruthy()
    expect(b.key).toBeTruthy()
    expect(a.key).not.toBe(b.key)
  })

  it('does not include _baseFood (synthesizeBaseFood will reconstruct it)', () => {
    const draft = ingredientToDraft(savedIngredient)
    expect('_baseFood' in draft).toBe(false)
  })

  it('handles external ingredient (foodItemId null)', () => {
    const draft = ingredientToDraft({ ...savedIngredient, foodItemId: null, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null })
    expect(draft.foodItemId).toBeNull()
    expect(draft.snapshotCalories).toBeNull()
  })
})

// ── PATCH edit: draft recipe owner ───────────────────────────────────────────

describe('PATCH edit — draft recipe', () => {
  it('updates name, servings, description, and steps', async () => {
    const req = makePatch({
      name: 'Updated Name',
      description: 'A great recipe',
      servings: 6,
      prepMinutes: 10,
      cookMinutes: 20,
      ingredients: [],
      steps: [
        { sortOrder: 0, body: 'Mix everything.' },
        { sortOrder: 1, body: 'Cook for 20 minutes.' },
      ],
    })

    const res = await recipesPatch(req, PARAMS)
    expect(res.status).toBe(200)

    const updateCall = mockPrisma.recipe.update.mock.calls[0][0]
    expect(updateCall.data.name).toBe('Updated Name')
    expect(updateCall.data.description).toBe('A great recipe')
    expect(updateCall.data.servings).toBe(6)
    expect(updateCall.data.prepMinutes).toBe(10)
    expect(updateCall.data.cookMinutes).toBe(20)
  })

  it('replaces ingredients on every edit', async () => {
    const req = makePatch({
      ingredients: [
        { foodItemId: null, name: 'Salt', quantity: 1, unit: 'tsp', snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null },
      ],
      steps: [],
    })

    const res = await recipesPatch(req, PARAMS)
    expect(res.status).toBe(200)
    // Existing ingredients deleted before inserting new ones
    expect(mockPrisma.recipeIngredient.deleteMany).toHaveBeenCalled()
    expect(mockPrisma.recipeIngredient.createMany).toHaveBeenCalled()
    const saved = mockPrisma.recipeIngredient.createMany.mock.calls[0][0].data[0]
    expect(saved.name).toBe('Salt')
    expect(saved.unit).toBe('tsp')
  })
})

// ── PATCH edit: permissions ───────────────────────────────────────────────────

describe('PATCH edit — permission checks', () => {
  it('returns 403 when non-owner attempts to edit', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'other-user' } } })
    const req = makePatch({ name: 'Hacked Name', ingredients: [], steps: [] })
    const res = await recipesPatch(req, PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    const req = makePatch({ name: 'x', ingredients: [], steps: [] })
    const res = await recipesPatch(req, PARAMS)
    expect(res.status).toBe(401)
  })
})

// ── PATCH edit: published recipe revise gate ──────────────────────────────────

describe('PATCH edit — published recipe revise gate', () => {
  beforeEach(() => {
    mockPrisma.recipe.findUnique.mockResolvedValue(makeRecipe({ status: 'published' }))
  })

  it('returns 409 published_recipe when revise flag is absent', async () => {
    const req = makePatch({ name: 'Updated', ingredients: [], steps: [] })
    const res = await recipesPatch(req, PARAMS)
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('published_recipe')
  })

  it('returns 200 and moves recipe to pending when revise:true is set', async () => {
    setupTransaction(makeRecipe({ status: 'pending' }))
    const req = makePatch({ name: 'Updated', revise: true, ingredients: [], steps: [] })
    const res = await recipesPatch(req, PARAMS)
    expect(res.status).toBe(200)

    const updateCall = mockPrisma.recipe.update.mock.calls[0][0]
    expect(updateCall.data.status).toBe('pending')
  })
})

// ── PATCH edit: pending recipe reverts to draft ───────────────────────────────

describe('PATCH edit — pending recipe', () => {
  it('returns 409 when editing pending recipe without revise flag', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(makeRecipe({ status: 'pending' }))
    const req = makePatch({ name: 'Revised', ingredients: [], steps: [] })
    const res = await recipesPatch(req, PARAMS)
    // Editing a pending recipe without revise:true requires confirmation (same gate as published)
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('published_recipe')
  })

  it('moves pending recipe back to draft when revise:true is set', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(makeRecipe({ status: 'pending' }))
    setupTransaction(makeRecipe({ status: 'draft' }))

    const req = makePatch({ name: 'Revised', revise: true, ingredients: [], steps: [] })
    const res = await recipesPatch(req, PARAMS)
    expect(res.status).toBe(200)

    const updateCall = mockPrisma.recipe.update.mock.calls[0][0]
    expect(updateCall.data.status).toBe('draft')
  })
})

// ── PATCH edit: nutrition recalculation on edit ───────────────────────────────

describe('PATCH edit — nutrition recalculated from DB food data', () => {
  const CHICKEN = {
    id: 'food-uuid-chicken',
    calories: 165 as unknown as import('@prisma/client/runtime/library').Decimal,
    proteinG: 31 as unknown as import('@prisma/client/runtime/library').Decimal,
    carbohydrateG: 0 as unknown as import('@prisma/client/runtime/library').Decimal,
    fatG: 3.6 as unknown as import('@prisma/client/runtime/library').Decimal,
    servingSize: 100 as unknown as import('@prisma/client/runtime/library').Decimal,
    servingUnit: 'g',
    householdUnit: null,
    unitsPerServing: null,
  }

  it('recalculates snapshot when owner edits ingredient quantity', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([CHICKEN])

    const req = makePatch({
      ingredients: [{
        foodItemId: 'food-uuid-chicken',
        name: 'Chicken Breast',
        quantity: 300,  // changed from original quantity
        unit: 'g',
        snapshotCalories: 999,  // stale — server must recompute
        snapshotProteinG: 999,
        snapshotCarbG: 999,
        snapshotFatG: 999,
      }],
      steps: [],
    })

    const res = await recipesPatch(req, PARAMS)
    expect(res.status).toBe(200)

    const saved = mockPrisma.recipeIngredient.createMany.mock.calls[0][0].data[0]
    // 300g / 100g * 165 = 495 cal
    expect(saved.snapshotCalories).toBeCloseTo(495, 0)
    expect(saved.snapshotProteinG).toBeCloseTo(93, 0)
  })

  it('clears nutrition snapshot when unit is changed to incompatible one', async () => {
    mockPrisma.foodItem.findMany.mockResolvedValue([CHICKEN])

    const req = makePatch({
      ingredients: [{
        foodItemId: 'food-uuid-chicken',
        name: 'Chicken Breast',
        quantity: 1,
        unit: 'cup',  // incompatible with gram-based food
        snapshotCalories: 165,
        snapshotProteinG: 31,
        snapshotCarbG: 0,
        snapshotFatG: 3.6,
      }],
      steps: [],
    })

    const res = await recipesPatch(req, PARAMS)
    expect(res.status).toBe(200)

    const saved = mockPrisma.recipeIngredient.createMany.mock.calls[0][0].data[0]
    expect(saved.snapshotCalories).toBeNull()
  })
})
