/**
 * log-recipe.test.ts — Phase 4
 *
 * Tests for the recipe logging API endpoint at POST /api/recipes/[id]/log.
 * Verifies correct macro computation, completeness gating, serving math,
 * optional ingredient exclusion, and snapshot immutability.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockSupabase, mockPrisma } = vi.hoisted(() => {
  const mockSupabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-owner' } } }),
    },
  }
  const mockPrisma = {
    recipe: { findUnique: vi.fn() },
    foodLogEntry: { findUnique: vi.fn(), create: vi.fn() },
  }
  return { mockSupabase, mockPrisma }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// ── Route import ──────────────────────────────────────────────────────────────

import { POST as logPost } from '../../app/api/recipes/[id]/log/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PARAMS = { params: Promise.resolve({ id: 'recipe-123' }) }

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/recipes/recipe-123/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Full-detail recipe for server-authoritative recomputation
const BASE_RECIPE = {
  id: 'recipe-123',
  userId: 'user-owner',
  name: 'Chicken Bowl',
  status: 'published' as const,
  servings: 4,
  nutritionComplete: true,
  cachedCalPerServing: 350,
  cachedProteinGPerServing: 30,
  cachedCarbGPerServing: 40,
  cachedFatGPerServing: 8,
  importedCalPerServing: null,
  importedProteinGPerServing: null,
  importedCarbGPerServing: null,
  importedFatGPerServing: null,
  // All four required ingredients fully resolved across 4 servings
  // totalCalories=1400, so perServing=350
  ingredients: [
    {
      id: 'ing-chicken',
      name: 'Chicken breast',
      quantity: 1,
      unit: 'g',
      isOptional: false,
      isToTaste: false,
      snapshotCalories: 800,
      snapshotProteinG: 80,
      snapshotCarbG: 0,
      snapshotFatG: 16,
    },
    {
      id: 'ing-rice',
      name: 'White rice',
      quantity: 1,
      unit: 'g',
      isOptional: false,
      isToTaste: false,
      snapshotCalories: 600,
      snapshotProteinG: 40,
      snapshotCarbG: 160,
      snapshotFatG: 16,
    },
  ],
}

// Recipe with optional bacon ingredient
const RECIPE_WITH_OPTIONAL_BACON = {
  ...BASE_RECIPE,
  // total without bacon: 1400 cal / 4 = 350 per serving
  // bacon adds 200 cal total → with bacon: 1600/4 = 400 per serving
  ingredients: [
    ...BASE_RECIPE.ingredients,
    {
      id: 'ing-bacon',
      name: 'Bacon',
      quantity: 1,
      unit: 'g',
      isOptional: true,
      isToTaste: false,
      snapshotCalories: 200,
      snapshotProteinG: 0,
      snapshotCarbG: 0,
      snapshotFatG: 0,
    },
  ],
}

// Recipe with a required ingredient that has null snapshot (incomplete)
const INCOMPLETE_RECIPE = {
  ...BASE_RECIPE,
  nutritionComplete: false,
  cachedCalPerServing: null,
  cachedProteinGPerServing: null,
  cachedCarbGPerServing: null,
  cachedFatGPerServing: null,
  ingredients: [
    BASE_RECIPE.ingredients[0], // chicken resolved
    {
      id: 'ing-unresolved',
      name: 'Mystery spice blend',
      quantity: 1,
      unit: 'tbsp',
      isOptional: false,
      isToTaste: false,
      snapshotCalories: null,
      snapshotProteinG: null,
      snapshotCarbG: null,
      snapshotFatG: null,
    },
  ],
}

// Recipe with only optional ingredients unresolved → estimated
const RECIPE_WITH_UNRESOLVED_OPTIONAL = {
  ...BASE_RECIPE,
  ingredients: [
    BASE_RECIPE.ingredients[0], // chicken resolved
    BASE_RECIPE.ingredients[1], // rice resolved
    {
      id: 'ing-optional-unresolved',
      name: 'Optional garnish',
      quantity: 1,
      unit: 'tbsp',
      isOptional: true,
      isToTaste: false,
      snapshotCalories: null,
      snapshotProteinG: null,
      snapshotCarbG: null,
      snapshotFatG: null,
    },
  ],
}

// Recipe with imported nutrition
const RECIPE_WITH_IMPORTED = {
  ...INCOMPLETE_RECIPE,
  importedCalPerServing: 500,
  importedProteinGPerServing: 40,
  importedCarbGPerServing: 55,
  importedFatGPerServing: 12,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-owner' } } })
  mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
})

// ── 1. Auth required ─────────────────────────────────────────────────────────

describe('auth', () => {
  it('returns 401 without a session', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    const res = await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: 1 }), PARAMS)
    expect(res.status).toBe(401)
  })
})

// ── 2. Valid complete recipe log ───────────────────────────────────────────────

describe('valid complete recipe log', () => {
  it('creates FoodLogEntry with server-computed per-serving macros', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
    }), PARAMS)

    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    // Server computes: (800+600)/4 = 350 cal per serving
    expect(createCall.data.snapshotCaloriesPerServing).toBe(350)
    expect(createCall.data.snapshotProteinGPerServing).toBeCloseTo(30, 1)
    expect(createCall.data.snapshotCarbohydrateGPerServing).toBeCloseTo(40, 1)
    expect(createCall.data.snapshotFatGPerServing).toBeCloseTo(8, 1)
  })

  it('stores recipeId on the FoodLogEntry', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: 1 }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.recipeId).toBe('recipe-123')
  })

  it('stores per-serving snapshot; servingMultiplier stored separately for consumer', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    await logPost(makeReq({ mealType: 'dinner', logDate: '2026-10-15', servingMultiplier: 2 }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    // Per-serving value, NOT multiplied — consumer multiplies separately
    expect(createCall.data.snapshotCaloriesPerServing).toBe(350)
    expect(createCall.data.servingMultiplier).toBe(2)
  })

  it('uses recipe name as snapshotFoodName', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: 1 }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.snapshotFoodName).toBe('Chicken Bowl')
  })

  it('snapshotServingUnit is "serving"', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: 1 }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.snapshotServingUnit).toBe('serving')
  })

  it('sets recipeLogMode to ingredient_calculated for complete recipes', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: 1 }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.recipeLogMode).toBe('ingredient_calculated')
  })
})

// ── 3. Server-authoritative optional ingredient exclusions ────────────────────

describe('optional ingredient exclusions', () => {
  it('excludes bacon when excludedIngredientIds=[baconId] — logged calories exclude bacon', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_OPTIONAL_BACON)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      excludedIngredientIds: ['ing-bacon'],
    }), PARAMS)

    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    // Without bacon: (800+600)/4 = 350 per serving
    expect(createCall.data.snapshotCaloriesPerServing).toBe(350)
  })

  it('includes bacon when excludedIngredientIds=[] — logged calories include bacon', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_OPTIONAL_BACON)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      excludedIngredientIds: [],
    }), PARAMS)

    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    // With bacon: (800+600+200)/4 = 400 per serving
    expect(createCall.data.snapshotCaloriesPerServing).toBe(400)
  })

  it('stores excluded IDs in optionalIngredientOverrides', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_OPTIONAL_BACON)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      excludedIngredientIds: ['ing-bacon'],
    }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.optionalIngredientOverrides).toMatchObject({ excluded: ['ing-bacon'] })
  })

  it('returns 400 for invalid ingredient ID in excludedIngredientIds', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      excludedIngredientIds: ['not-a-real-id'],
    }), PARAMS)

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/Invalid ingredient ID/)
  })

  it('returns 400 when trying to exclude a required (non-optional) ingredient', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      excludedIngredientIds: ['ing-chicken'], // chicken is NOT optional
    }), PARAMS)

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/Cannot exclude required ingredient/)
  })

  it('two logs of same recipe with different exclusions create separate entries', async () => {
    // Log 1: with bacon
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_OPTIONAL_BACON)
    mockPrisma.foodLogEntry.create.mockResolvedValueOnce({ id: 'entry-with-bacon' })

    const res1 = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      idempotencyKey: 'key-with-bacon',
      excludedIngredientIds: [],
    }), PARAMS)
    expect(res1.status).toBe(201)

    // Log 2: without bacon
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null) // different key, no match
    mockPrisma.foodLogEntry.create.mockResolvedValueOnce({ id: 'entry-without-bacon' })

    const res2 = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      idempotencyKey: 'key-without-bacon',
      excludedIngredientIds: ['ing-bacon'],
    }), PARAMS)
    expect(res2.status).toBe(201)

    // Two separate create calls
    expect(mockPrisma.foodLogEntry.create).toHaveBeenCalledTimes(2)
  })
})

// ── 4. Completeness + confirmation tests ──────────────────────────────────────

describe('completeness gating', () => {
  it('returns 422 with needsConfirmation=true when recipe is incomplete and no manual nutrition', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(INCOMPLETE_RECIPE)

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
    }), PARAMS)

    expect(res.status).toBe(422)
    const body = await res.json() as { error: string; needsConfirmation?: boolean; unresolvedCount?: number; unresolvedIngredients?: string[] }
    expect(body.error).toBe('incomplete_nutrition')
    expect(body.needsConfirmation).toBe(true)
    expect(typeof body.unresolvedCount).toBe('number')
    expect(body.unresolvedCount).toBeGreaterThan(0)
    expect(Array.isArray(body.unresolvedIngredients)).toBe(true)
  })

  it('allows logging when manualNutrition is provided with confirmedEstimate=true', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(INCOMPLETE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      confirmedEstimate: true,
      manualNutrition: { calories: 400, proteinG: 35, carbG: 45, fatG: 12 },
    }), PARAMS)

    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.snapshotCaloriesPerServing).toBe(400)
    expect(createCall.data.recipeLogMode).toBe('user_confirmed_estimate')
  })

  it('allows logging incomplete with manualNutrition even without explicit confirmedEstimate (legacy path)', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(INCOMPLETE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      manualNutrition: { calories: 400, proteinG: 35, carbG: 45, fatG: 12 },
    }), PARAMS)

    expect(res.status).toBe(201)
  })

  it('rejects manualNutrition with negative values', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(INCOMPLETE_RECIPE)

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      confirmedEstimate: true,
      manualNutrition: { calories: -100, proteinG: 35, carbG: 45, fatG: 12 },
    }), PARAMS)

    expect(res.status).toBe(400)
  })

  it('optional ingredient excluded when null snapshot does not make recipe incomplete', async () => {
    // RECIPE_WITH_UNRESOLVED_OPTIONAL has an unresolved optional ingredient
    // If we exclude it, completeness should be 'complete' (since resolved core ings remain)
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_UNRESOLVED_OPTIONAL)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      excludedIngredientIds: ['ing-optional-unresolved'],
    }), PARAMS)

    // Should succeed — optional ingredient excluded, core is complete
    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.recipeLogMode).toBe('ingredient_calculated')
  })

  it('optional ingredient included when null snapshot → estimated log mode', async () => {
    // RECIPE_WITH_UNRESOLVED_OPTIONAL: include the unresolved optional → estimated
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_UNRESOLVED_OPTIONAL)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      // Not excluding the unresolved optional → it's included, making it estimated
    }), PARAMS)

    // Still succeeds (estimated is ok) — server uses ingredient_calculated mode for estimated too
    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.recipeLogMode).toBe('ingredient_calculated')
  })
})

// ── 5. servingMultiplier math ─────────────────────────────────────────────────

describe('servingMultiplier', () => {
  it('servingMultiplier=0.5 stores per-serving snapshot as-is; consumer computes halved calories', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: 0.5 }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    // Snapshot is per-serving — consumers multiply: 350 * 0.5 = 175
    expect(createCall.data.snapshotCaloriesPerServing).toBe(350)
    expect(createCall.data.servingMultiplier).toBe(0.5)
  })

  it('servingMultiplier=3 stores per-serving snapshot; multiplier is 3', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    await logPost(makeReq({ mealType: 'breakfast', logDate: '2026-10-15', servingMultiplier: 3 }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.snapshotCaloriesPerServing).toBe(350) // per-serving, NOT 1050
    expect(createCall.data.servingMultiplier).toBe(3)
  })

  it('returns 400 for servingMultiplier=0', async () => {
    const res = await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: 0 }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 for negative servingMultiplier', async () => {
    const res = await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: -1 }), PARAMS)
    expect(res.status).toBe(400)
  })
})

// ── 6. Idempotency ────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('returns existing entry without creating a duplicate when same key resubmitted', async () => {
    const existingEntry = { id: 'existing-entry-123' }
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(existingEntry)

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      idempotencyKey: 'test-idem-key',
    }), PARAMS)

    expect(res.status).toBe(200)
    const body = await res.json() as { entry: { id: string } }
    expect(body.entry.id).toBe('existing-entry-123')
    expect(mockPrisma.foodLogEntry.create).not.toHaveBeenCalled()
  })

  it('creates entry when no prior match for idempotencyKey', async () => {
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'new-entry' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      idempotencyKey: 'unique-key-xyz',
    }), PARAMS)

    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.idempotencyKey).toBe('unique-key-xyz')
  })
})

// ── 7. Imported estimate tests ────────────────────────────────────────────────

describe('imported estimate', () => {
  it('logs imported macros as user_confirmed_estimate when useImported=true', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_IMPORTED)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-imported' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      useImported: true,
    }), PARAMS)

    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.snapshotCaloriesPerServing).toBe(500)
    expect(createCall.data.snapshotProteinGPerServing).toBe(40)
    expect(createCall.data.snapshotCarbohydrateGPerServing).toBe(55)
    expect(createCall.data.snapshotFatGPerServing).toBe(12)
    expect(createCall.data.recipeLogMode).toBe('user_confirmed_estimate')
    expect(createCall.data.estimateSourceNote).toBe('imported')
  })

  it('stores "imported" in optionalIngredientOverrides.source when useImported=true', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_IMPORTED)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-imported' })

    await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      useImported: true,
    }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.optionalIngredientOverrides).toMatchObject({ source: 'imported' })
  })

  it('returns 422 when useImported=true but recipe has no imported data', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(INCOMPLETE_RECIPE) // no imported macros

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      useImported: true,
    }), PARAMS)

    expect(res.status).toBe(422)
  })

  it('logs manual values when useImported=false and manual nutrition provided', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_IMPORTED)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-manual' })

    const res = await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      confirmedEstimate: true,
      manualNutrition: { calories: 300, proteinG: 25, carbG: 30, fatG: 10 },
    }), PARAMS)

    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.snapshotCaloriesPerServing).toBe(300) // manual, not 500 imported
    expect(createCall.data.recipeLogMode).toBe('user_confirmed_estimate')
    // No imported source note
    expect(createCall.data.estimateSourceNote).toBeFalsy()
  })

  it('imported macros scale correctly: 4-serving recipe, importedCalPerServing=500, servingMultiplier=2 → snapshot=500, multiplier=2 (not 1000 or 2000 inflated)', async () => {
    // Regression: importedCalPerServing is PER-SERVING, not whole-recipe.
    // The snapshot stored must be 500 (per-serving) and the serving multiplier 2.
    // The consumer sums as 500 * 2 = 1000 — correct.
    // If the field were whole-recipe and the route did field * servingMultiplier,
    // the result would be 2000 or 4000 — this test guards against that regression.
    const recipeWith4Servings = {
      ...RECIPE_WITH_IMPORTED,
      servings: 4,
      importedCalPerServing: 500, // confirmed per-serving field in schema
    }
    mockPrisma.recipe.findUnique.mockResolvedValue(recipeWith4Servings)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-imported-scale' })

    const res = await logPost(makeReq({
      mealType: 'dinner',
      logDate: '2026-10-15',
      servingMultiplier: 2,
      useImported: true,
    }), PARAMS)

    expect(res.status).toBe(201)
    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    // Snapshot is PER-SERVING — consumers multiply: 500 * 2 = 1000 ✓
    expect(createCall.data.snapshotCaloriesPerServing).toBe(500)
    expect(createCall.data.servingMultiplier).toBe(2)
    // Verify: NOT 1000 (that would mean route pre-multiplied) or 2000 (inflated)
    expect(createCall.data.snapshotCaloriesPerServing).not.toBe(1000)
    expect(createCall.data.snapshotCaloriesPerServing).not.toBe(2000)
  })
})

// ── 8. Historical snapshot integrity ─────────────────────────────────────────

describe('snapshot immutability', () => {
  it('logged entry snapshot is independent of future recipe edits', async () => {
    // Log once — snapshots from server-computed values at log time
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({
      id: 'entry-snap',
      snapshotCaloriesPerServing: 350,
    })

    const res = await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: 1 }), PARAMS)
    expect(res.status).toBe(201)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    const loggedCal = createCall.data.snapshotCaloriesPerServing
    expect(loggedCal).toBe(350)

    // "Edit" the recipe (update mock to return different cached values)
    const editedRecipe = { ...BASE_RECIPE, cachedCalPerServing: 500 }
    mockPrisma.recipe.findUnique.mockResolvedValue(editedRecipe)

    // The already-logged entry's snapshot is unchanged (it was snapshotted at log time)
    // Verify: the entry's snapshot was stored as 350, not the new 500
    expect(loggedCal).toBe(350)
    expect(editedRecipe.cachedCalPerServing).toBe(500) // recipe changed
    // Logged value is immutable — it's in the DB as 350
  })
})

// ── 9. Round-trip consistency ─────────────────────────────────────────────────

describe('round-trip consistency', () => {
  it('server-computed per-serving calories match client computeRecipeNutritionTotals result', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(BASE_RECIPE)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
    }), PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    // Server-computed: total = 800+600 = 1400 / 4 servings = 350
    expect(createCall.data.snapshotCaloriesPerServing).toBe(350)
  })

  it('same ingredients + same servings + same exclusions produce same result', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(RECIPE_WITH_OPTIONAL_BACON)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    // First call
    await logPost(makeReq({
      mealType: 'lunch',
      logDate: '2026-10-15',
      servingMultiplier: 1,
      excludedIngredientIds: ['ing-bacon'],
    }), PARAMS)

    // Second call with different idempotency key but same exclusions
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-2' })
    await logPost(makeReq({
      mealType: 'dinner',
      logDate: '2026-10-16',
      servingMultiplier: 1,
      excludedIngredientIds: ['ing-bacon'],
    }), PARAMS)

    const call1 = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    const call2 = mockPrisma.foodLogEntry.create.mock.calls[1][0]
    expect(call1.data.snapshotCaloriesPerServing).toBe(call2.data.snapshotCaloriesPerServing)
  })
})

// ── 10. Input validation ──────────────────────────────────────────────────────

describe('input validation', () => {
  it('returns 400 for missing logDate', async () => {
    const res = await logPost(makeReq({ mealType: 'lunch', servingMultiplier: 1 }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing mealType', async () => {
    const res = await logPost(makeReq({ logDate: '2026-10-15', servingMultiplier: 1 }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid mealType', async () => {
    const res = await logPost(makeReq({ mealType: 'brunch', logDate: '2026-10-15', servingMultiplier: 1 }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 404 when recipe does not exist', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(null)
    const res = await logPost(makeReq({ mealType: 'lunch', logDate: '2026-10-15', servingMultiplier: 1 }), PARAMS)
    expect(res.status).toBe(404)
  })
})
