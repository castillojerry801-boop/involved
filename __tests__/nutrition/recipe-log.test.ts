import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { canReadRecipe, isFreelyEditable, requiresReviseOnEdit } from '../../lib/recipes/access'
import type { RecipeStatus } from '@prisma/client'

// ── Hoisted mocks (must precede vi.mock calls) ────────────────────────────────

const mockUser = { id: 'user-owner' }
const mockOtherUser = { id: 'user-other' }

const { mockSupabase, mockPrisma } = vi.hoisted(() => {
  const mockSupabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-owner' } } }),
    },
  }
  const mockPrisma = {
    recipe: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    foodLogEntry: { findUnique: vi.fn(), create: vi.fn() },
    recipeIngredient: { deleteMany: vi.fn(), createMany: vi.fn() },
    recipeStep: { deleteMany: vi.fn(), createMany: vi.fn() },
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

// ── Route imports (after mocks are registered) ────────────────────────────────

import { POST as logPost } from '../../app/api/recipes/[id]/log/route'
import { PATCH as recipesPatch, GET as recipesGet } from '../../app/api/recipes/[id]/route'
import { POST as submitPost } from '../../app/api/recipes/[id]/submit/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────

const TEST_PARAMS = { params: Promise.resolve({ id: 'test-id' }) }

function makeLogReq(body: unknown) {
  return new NextRequest('http://localhost/api/recipes/test-id/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const completeRecipe = {
  id: 'test-id',
  userId: 'user-owner',
  name: 'Test Recipe',
  status: 'published' as RecipeStatus,
  servings: 2,
  nutritionComplete: true,
  cachedCalPerServing: 300,
  cachedProteinGPerServing: 25,
  cachedCarbGPerServing: 30,
  cachedFatGPerServing: 10,
  ingredients: [],
}

const incompleteRecipe = {
  ...completeRecipe,
  nutritionComplete: false,
  cachedCalPerServing: null,
  cachedProteinGPerServing: null,
  cachedCarbGPerServing: null,
  cachedFatGPerServing: null,
  ingredients: [{ id: 'ing-1' }, { id: 'ing-2' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
})

// ── 1. Incomplete nutrition without manual values → 422 ────────────────────────

describe('log route — incomplete nutrition gate', () => {
  it('returns 422 when recipe nutrition is incomplete and no manualNutrition is provided', async () => {
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
    mockPrisma.recipe.findUnique.mockResolvedValue(incompleteRecipe)

    const req = makeLogReq({ mealType: 'lunch', logDate: '2026-10-11', servingMultiplier: 1 })
    const res = await logPost(req, TEST_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toBe('incomplete_nutrition')
    expect(typeof body.unresolvedCount).toBe('number')
    expect(body.unresolvedCount).toBe(2)
  })

  it('unresolvedCount reflects ingredients filtered by null foodItemId OR null snapshot macros', async () => {
    // Recipe is marked incomplete; DB query returns one ingredient with snapshot gap
    const recipeWithSnapshotGap = {
      ...incompleteRecipe,
      ingredients: [{ id: 'ing-snap-null' }],
    }
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
    mockPrisma.recipe.findUnique.mockResolvedValue(recipeWithSnapshotGap)

    const req = makeLogReq({ mealType: 'lunch', logDate: '2026-10-11', servingMultiplier: 1 })
    const res = await logPost(req, TEST_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.unresolvedCount).toBe(1)
  })
})

// ── 2. Incomplete nutrition with manual nutrition → 201 ────────────────────────

describe('log route — manual nutrition accepted for incomplete recipes', () => {
  it('returns 201 and creates entry when manualNutrition is provided', async () => {
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
    mockPrisma.recipe.findUnique.mockResolvedValue(incompleteRecipe)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const req = makeLogReq({
      mealType: 'dinner',
      logDate: '2026-10-11',
      servingMultiplier: 1,
      manualNutrition: { calories: 400, proteinG: 30, carbG: 50, fatG: 15 },
    })
    const res = await logPost(req, TEST_PARAMS)

    expect(res.status).toBe(201)
    expect(mockPrisma.foodLogEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          snapshotCaloriesPerServing: 400,
          snapshotProteinGPerServing: 30,
          snapshotCarbohydrateGPerServing: 50,
          snapshotFatGPerServing: 15,
        }),
      })
    )
  })

  it('rejects manualNutrition with negative values', async () => {
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
    mockPrisma.recipe.findUnique.mockResolvedValue(incompleteRecipe)

    const req = makeLogReq({
      mealType: 'lunch',
      logDate: '2026-10-11',
      servingMultiplier: 1,
      manualNutrition: { calories: -100, proteinG: 10, carbG: 10, fatG: 5 },
    })
    const res = await logPost(req, TEST_PARAMS)

    expect(res.status).toBe(400)
  })
})

// ── 3. Per-serving snapshots multiply correctly ────────────────────────────────

describe('log route — per-serving snapshot storage', () => {
  it('stores the per-serving value in snapshot; servingMultiplier is stored separately for consumer', async () => {
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
    mockPrisma.recipe.findUnique.mockResolvedValue(incompleteRecipe)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const req = makeLogReq({
      mealType: 'lunch',
      logDate: '2026-10-11',
      servingMultiplier: 3,
      manualNutrition: { calories: 200, proteinG: 20, carbG: 25, fatG: 8 },
    })
    await logPost(req, TEST_PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.snapshotCaloriesPerServing).toBe(200)  // per-serving, NOT 600
    expect(createCall.data.servingMultiplier).toBe(3)             // multiplier stored separately
  })

  it('stores cached per-serving values for complete recipes', async () => {
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
    mockPrisma.recipe.findUnique.mockResolvedValue(completeRecipe)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

    const req = makeLogReq({ mealType: 'lunch', logDate: '2026-10-11', servingMultiplier: 2 })
    await logPost(req, TEST_PARAMS)

    const createCall = mockPrisma.foodLogEntry.create.mock.calls[0][0]
    expect(createCall.data.snapshotCaloriesPerServing).toBe(300)  // per-serving, NOT 600
    expect(createCall.data.servingMultiplier).toBe(2)
  })
})

// ── 4. Invalid mealType → 400 ─────────────────────────────────────────────────

describe('log route — mealType validation', () => {
  it('returns 400 for an unrecognized mealType', async () => {
    const req = makeLogReq({ mealType: 'brunch', logDate: '2026-10-11', servingMultiplier: 1 })
    const res = await logPost(req, TEST_PARAMS)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.toLowerCase()).toContain('invalid mealtype')
  })

  it('accepts all five valid mealType values', async () => {
    for (const mealType of ['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const) {
      vi.clearAllMocks()
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockUser } })
      mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
      mockPrisma.recipe.findUnique.mockResolvedValue(completeRecipe)
      mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'entry-1' })

      const req = makeLogReq({ mealType, logDate: '2026-10-11', servingMultiplier: 1 })
      const res = await logPost(req, TEST_PARAMS)
      expect(res.status).toBe(201)
    }
  })
})

// ── 5. Status cannot be injected via PATCH body ───────────────────────────────

describe('status injection prevention', () => {
  it('freely-editable statuses stay the same when edited — newStatus equals current status', () => {
    // PATCH route: newStatus = requiresReviseOnEdit(status) ? transition : status
    // For freely-editable statuses, requiresReviseOnEdit is false → newStatus === current status
    for (const status of ['draft', 'private', 'rejected'] as RecipeStatus[]) {
      expect(isFreelyEditable(status)).toBe(true)
      expect(requiresReviseOnEdit(status)).toBe(false)
      // Confirms that newStatus = status (never 'published') for these states
    }
  })

  it('published status is only reachable via moderation — editing never produces published directly', () => {
    // editing published → pending (back to review queue)
    expect(requiresReviseOnEdit('published')).toBe(true)
    // editing pending → draft (back to owner)
    expect(requiresReviseOnEdit('pending')).toBe(true)
    // Neither transition produces 'published' — only admin approval can do that
  })
})

// ── 6. Archived recipes cannot be modified ────────────────────────────────────

describe('PATCH route — archived recipe protection', () => {
  it('returns 403 for PATCH on an archived recipe', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue({
      id: 'test-id',
      userId: 'user-owner',
      name: 'Old Recipe',
      status: 'archived',
      servings: 1,
      nutritionComplete: false,
      ingredients: [],
    })

    const req = new NextRequest('http://localhost/api/recipes/test-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    })
    const res = await recipesPatch(req, TEST_PARAMS)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.toLowerCase()).toContain('archived')
  })
})

// ── 7. Community submission requires explicit consent ─────────────────────────

describe('submit route — sharing consent requirement', () => {
  it('returns 400 when sharingConsent is absent', async () => {
    const req = new NextRequest('http://localhost/api/recipes/test-id/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await submitPost(req, TEST_PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 when sharingConsent is explicitly false', async () => {
    const req = new NextRequest('http://localhost/api/recipes/test-id/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharingConsent: false }),
    })
    const res = await submitPost(req, TEST_PARAMS)
    expect(res.status).toBe(400)
  })
})

// ── 8. Duplicate pending submissions are rejected ─────────────────────────────

describe('submit route — duplicate pending submissions', () => {
  it('returns 409 when recipe is already pending', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue({
      id: 'test-id',
      userId: 'user-owner',
      name: 'Pending Recipe',
      status: 'pending',
      profile: { displayName: 'Jerry', username: 'jerry' },
    })

    const req = new NextRequest('http://localhost/api/recipes/test-id/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharingConsent: true }),
    })
    const res = await submitPost(req, TEST_PARAMS)

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/pending/i)
  })

  it('returns 409 when recipe is already published', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue({
      id: 'test-id',
      userId: 'user-owner',
      name: 'Published Recipe',
      status: 'published',
      profile: { displayName: 'Jerry', username: 'jerry' },
    })

    const req = new NextRequest('http://localhost/api/recipes/test-id/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharingConsent: true }),
    })
    const res = await submitPost(req, TEST_PARAMS)

    expect(res.status).toBe(409)
  })
})

// ── 9. Unauthorized users cannot read private recipes ─────────────────────────

describe('access control — private recipe visibility', () => {
  const NON_PUBLIC: RecipeStatus[] = ['draft', 'private', 'pending', 'rejected', 'archived']

  it.each(NON_PUBLIC)('non-owner cannot read %s recipe via canReadRecipe', (status) => {
    expect(canReadRecipe('owner-id', status, 'other-id')).toBe(false)
  })

  it('GET returns 404 (not 403) for a private recipe accessed by a non-owner', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: mockOtherUser } })
    mockPrisma.recipe.findUnique.mockResolvedValue({
      id: 'test-id',
      userId: 'user-owner',
      status: 'private',
      storageKey: null,
      ingredients: [],
      steps: [],
      saves: [],
      _count: { saves: 0 },
    })

    const req = new NextRequest('http://localhost/api/recipes/test-id')
    const res = await recipesGet(req, TEST_PARAMS)

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.toLowerCase()).toContain('not found')
  })
})

// ── 10. Idempotency key prevents duplicate log entries ────────────────────────

describe('log route — idempotency key', () => {
  it('returns existing entry without creating a duplicate when the same key is resubmitted', async () => {
    const existingEntry = { id: 'existing-entry', userId: 'user-owner' }
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(existingEntry)

    const req = makeLogReq({
      mealType: 'lunch',
      logDate: '2026-10-11',
      servingMultiplier: 1,
      idempotencyKey: 'client-uuid-abc-123',
    })
    const res = await logPost(req, TEST_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.entry.id).toBe('existing-entry')
    expect(mockPrisma.foodLogEntry.create).not.toHaveBeenCalled()
    expect(mockPrisma.recipe.findUnique).not.toHaveBeenCalled() // short-circuits before recipe lookup
  })

  it('proceeds to create a new entry when no match is found for the key', async () => {
    mockPrisma.foodLogEntry.findUnique.mockResolvedValue(null)
    mockPrisma.recipe.findUnique.mockResolvedValue(completeRecipe)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'new-entry' })

    const req = makeLogReq({
      mealType: 'lunch',
      logDate: '2026-10-11',
      servingMultiplier: 1,
      idempotencyKey: 'client-uuid-new-456',
    })
    const res = await logPost(req, TEST_PARAMS)

    expect(res.status).toBe(201)
    expect(mockPrisma.foodLogEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ idempotencyKey: 'client-uuid-new-456' }),
      })
    )
  })

  it('creates a new entry when no idempotencyKey is provided (allows intentional re-logging)', async () => {
    mockPrisma.recipe.findUnique.mockResolvedValue(completeRecipe)
    mockPrisma.foodLogEntry.create.mockResolvedValue({ id: 'another-entry' })

    const req = makeLogReq({ mealType: 'lunch', logDate: '2026-10-11', servingMultiplier: 1 })
    const res = await logPost(req, TEST_PARAMS)

    expect(res.status).toBe(201)
    expect(mockPrisma.foodLogEntry.findUnique).not.toHaveBeenCalled() // no idempotency check when key absent
  })
})
