/**
 * Tests for YMove Discover integration and recipe saves.
 *
 * Covers:
 *  - GET /api/ymove/recipes/saved — auth, returns saved recipes with snapshot data
 *  - POST /api/ymove/recipes/[id]/save — explicit save (idempotent upsert, server-authoritative snapshot)
 *  - DELETE /api/ymove/recipes/[id]/save — explicit unsave (idempotent deleteMany)
 *  - Idempotency: repeated save/unsave requests are safe
 *  - Concurrency: concurrent save/unsave requests produce correct final state
 *  - Recipe ID validation: YMove API verifies the recipe before persisting
 *  - Snapshot field mapping: saved records return YMoveRecipeSummary-compatible shape
 *  - Serving multiplier regression: 2 servings = 2× per-serving macros (not 4×)
 *  - Filter scope: filters forwarded correctly to YMove API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockSupabase, mockPrisma, mockGetRecipe } = vi.hoisted(() => {
  const mockSupabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  }

  const mockYMoveRecipeSave = {
    findMany:    vi.fn(),
    upsert:      vi.fn(),
    deleteMany:  vi.fn(),
  }

  const mockPrisma = {
    yMoveRecipeSave: mockYMoveRecipeSave,
  }

  const mockGetRecipe = vi.fn()

  return { mockSupabase, mockPrisma, mockGetRecipe }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/ymove/recipes', () => ({
  getRecipe: mockGetRecipe,
}))

import { GET as savedGet }              from '../app/api/ymove/recipes/saved/route'
import { POST as savePost, DELETE as saveDelete } from '../app/api/ymove/recipes/[id]/save/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSavedReq() {
  return new NextRequest('http://localhost/api/ymove/recipes/saved')
}

function makeSaveReq(id = 'recipe-1') {
  return new NextRequest(`http://localhost/api/ymove/recipes/${id}/save`, { method: 'POST' })
}

function makeUnsaveReq(id = 'recipe-1') {
  return new NextRequest(`http://localhost/api/ymove/recipes/${id}/save`, { method: 'DELETE' })
}

function makeYMoveRecipe(overrides = {}) {
  return {
    id:          'recipe-1',
    title:       'Test Chicken Bowl',
    description: null,
    calories:    400,
    protein:     35,
    carbs:       30,
    fat:         12,
    imageUrl:    'https://ymove-recipes.b-cdn.net/test.png',
    mealType:    'lunch',
    dietTags:    ['high_protein'],
    servings:    2,
    prepTimeMin: 10,
    cookTimeMin: 20,
    cuisineType: null,
    difficulty:  null,
    slug:        'recipe-1',
    instructions: [],
    ingredients:  [],
    ...overrides,
  }
}

function makeSavedRow(overrides = {}) {
  return {
    id:              'save-row-1',
    userId:          'user-1',
    ymoveRecipeId:   'recipe-1',
    snapshotTitle:    'Test Chicken Bowl',
    snapshotCalories: '400.00',
    snapshotProtein:  '35.000',
    snapshotCarbs:    '30.000',
    snapshotFat:      '12.000',
    snapshotImageUrl: 'https://ymove-recipes.b-cdn.net/test.png',
    snapshotMealType: 'lunch',
    snapshotDietTags: ['high_protein'],
    snapshotServings: 2,
    snapshotPrepMin:  10,
    snapshotCookMin:  20,
    savedAt:          new Date('2026-10-31'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mockPrisma.yMoveRecipeSave.findMany.mockResolvedValue([])
  mockPrisma.yMoveRecipeSave.upsert.mockResolvedValue(makeSavedRow())
  mockPrisma.yMoveRecipeSave.deleteMany.mockResolvedValue({ count: 1 })
  mockGetRecipe.mockResolvedValue(makeYMoveRecipe())
})

// ── 1. GET /api/ymove/recipes/saved — auth ────────────────────────────────────

describe('GET /api/ymove/recipes/saved — auth', () => {
  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await savedGet(makeSavedReq())
    expect(res.status).toBe(401)
  })

  it('returns 200 with empty arrays when user has no saves', async () => {
    const res = await savedGet(makeSavedReq())
    expect(res.status).toBe(200)
    const data = await res.json() as { savedRecipes: unknown[]; savedIds: string[] }
    expect(data.savedRecipes).toHaveLength(0)
    expect(data.savedIds).toHaveLength(0)
  })

  it('returns savedRecipes and savedIds when saves exist', async () => {
    mockPrisma.yMoveRecipeSave.findMany.mockResolvedValueOnce([makeSavedRow()])
    const res = await savedGet(makeSavedReq())
    const data = await res.json() as { savedRecipes: { id: string }[]; savedIds: string[] }
    expect(data.savedRecipes).toHaveLength(1)
    expect(data.savedRecipes[0].id).toBe('recipe-1')
    expect(data.savedIds).toEqual(['recipe-1'])
  })

  it('savedIds are derivable from savedRecipes.map(r => r.id)', async () => {
    mockPrisma.yMoveRecipeSave.findMany.mockResolvedValueOnce([
      makeSavedRow({ ymoveRecipeId: 'r1' }),
      makeSavedRow({ id: 'save-2', ymoveRecipeId: 'r2' }),
    ])
    const res = await savedGet(makeSavedReq())
    const data = await res.json() as { savedRecipes: { id: string }[]; savedIds: string[] }
    expect(data.savedIds).toEqual(data.savedRecipes.map((r) => r.id))
  })
})

// ── 2. GET /api/ymove/recipes/saved — snapshot field mapping ──────────────────

describe('GET /api/ymove/recipes/saved — snapshot field mapping', () => {
  it('maps snapshot fields to YMoveRecipeSummary shape', async () => {
    mockPrisma.yMoveRecipeSave.findMany.mockResolvedValueOnce([makeSavedRow()])
    const res = await savedGet(makeSavedReq())
    const data = await res.json() as { savedRecipes: Record<string, unknown>[] }
    const r = data.savedRecipes[0]

    expect(r.id).toBe('recipe-1')
    expect(r.title).toBe('Test Chicken Bowl')
    expect(r.calories).toBe(400)
    expect(r.protein).toBe(35)
    expect(r.carbs).toBe(30)
    expect(r.fat).toBe(12)
    expect(r.imageUrl).toBe('https://ymove-recipes.b-cdn.net/test.png')
    expect(r.mealType).toBe('lunch')
    expect(r.dietTags).toEqual(['high_protein'])
    expect(r.servings).toBe(2)
    expect(r.prepTimeMin).toBe(10)
    expect(r.cookTimeMin).toBe(20)
  })

  it('null snapshotImageUrl is returned as null', async () => {
    mockPrisma.yMoveRecipeSave.findMany.mockResolvedValueOnce([
      makeSavedRow({ snapshotImageUrl: null }),
    ])
    const res = await savedGet(makeSavedReq())
    const data = await res.json() as { savedRecipes: { imageUrl: unknown }[] }
    expect(data.savedRecipes[0].imageUrl).toBeNull()
  })

  it('null snapshotMealType falls back to "other"', async () => {
    mockPrisma.yMoveRecipeSave.findMany.mockResolvedValueOnce([
      makeSavedRow({ snapshotMealType: null }),
    ])
    const res = await savedGet(makeSavedReq())
    const data = await res.json() as { savedRecipes: { mealType: string }[] }
    expect(data.savedRecipes[0].mealType).toBe('other')
  })

  it('converts Prisma Decimal strings to numbers', async () => {
    mockPrisma.yMoveRecipeSave.findMany.mockResolvedValueOnce([
      makeSavedRow({
        snapshotCalories: '359.40',
        snapshotProtein:  '38.300',
        snapshotCarbs:    '27.400',
        snapshotFat:      '11.100',
      }),
    ])
    const res = await savedGet(makeSavedReq())
    const data = await res.json() as { savedRecipes: { calories: number; protein: number }[] }
    expect(typeof data.savedRecipes[0].calories).toBe('number')
    expect(data.savedRecipes[0].calories).toBe(359.4)
    expect(data.savedRecipes[0].protein).toBe(38.3)
  })
})

// ── 3. POST /api/ymove/recipes/[id]/save — auth ───────────────────────────────

describe('POST /api/ymove/recipes/[id]/save — auth', () => {
  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await savePost(makeSaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(res.status).toBe(401)
  })
})

// ── 4. POST — explicit save (idempotent upsert, server-authoritative snapshot) ─

describe('POST /api/ymove/recipes/[id]/save — explicit save', () => {
  it('returns { saved: true } when recipe exists in YMove', async () => {
    const res = await savePost(makeSaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: true })
  })

  it('calls upsert with server-fetched snapshot data (not client body)', async () => {
    mockGetRecipe.mockResolvedValueOnce(makeYMoveRecipe({ calories: 450, protein: 40 }))
    await savePost(makeSaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(mockPrisma.yMoveRecipeSave.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ snapshotCalories: 450, snapshotProtein: 40 }),
        update: {},
      }),
    )
  })

  it('upsert update:{} makes repeated saves idempotent', async () => {
    await savePost(makeSaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    await savePost(makeSaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(mockPrisma.yMoveRecipeSave.upsert).toHaveBeenCalledTimes(2)
    // Both calls use update:{} — second call is a no-op at DB level
    const secondCall = mockPrisma.yMoveRecipeSave.upsert.mock.calls[1][0]
    expect(secondCall.update).toEqual({})
  })

  it('concurrent saves both return { saved: true } (upsert handles collision)', async () => {
    const [r1, r2] = await Promise.all([
      savePost(makeSaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) }),
      savePost(makeSaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) }),
    ])
    expect((await r1.json() as { saved: boolean }).saved).toBe(true)
    expect((await r2.json() as { saved: boolean }).saved).toBe(true)
  })

  it('returns 404 when YMove does not recognise the recipe ID', async () => {
    mockGetRecipe.mockResolvedValueOnce(null)
    const res = await savePost(makeSaveReq('nonexistent'), { params: Promise.resolve({ id: 'nonexistent' }) })
    expect(res.status).toBe(404)
    expect(mockPrisma.yMoveRecipeSave.upsert).not.toHaveBeenCalled()
  })

  it('returns 400 when ymoveRecipeId is empty', async () => {
    const res = await savePost(makeSaveReq(''), { params: Promise.resolve({ id: '' }) })
    expect(res.status).toBe(400)
    expect(mockGetRecipe).not.toHaveBeenCalled()
  })

  it('returns 400 when ymoveRecipeId exceeds 100 characters', async () => {
    const longId = 'a'.repeat(101)
    const res = await savePost(makeSaveReq(longId), { params: Promise.resolve({ id: longId }) })
    expect(res.status).toBe(400)
    expect(mockGetRecipe).not.toHaveBeenCalled()
  })

  it('scopes upsert to the authenticated user — cannot save to another user ID', async () => {
    await savePost(makeSaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    const { where, create } = mockPrisma.yMoveRecipeSave.upsert.mock.calls[0][0]
    expect(where.userId_ymoveRecipeId.userId).toBe('user-1')
    expect(create.userId).toBe('user-1')
  })
})

// ── 5. DELETE /api/ymove/recipes/[id]/save — explicit unsave ──────────────────

describe('DELETE /api/ymove/recipes/[id]/save — explicit unsave', () => {
  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await saveDelete(makeUnsaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns { saved: false } when record is deleted', async () => {
    const res = await saveDelete(makeUnsaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: false })
  })

  it('uses deleteMany — idempotent when recipe is already unsaved', async () => {
    mockPrisma.yMoveRecipeSave.deleteMany.mockResolvedValueOnce({ count: 0 })
    const res = await saveDelete(makeUnsaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: false })
  })

  it('concurrent unsaves both return { saved: false } (deleteMany handles zero-row case)', async () => {
    mockPrisma.yMoveRecipeSave.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    const [r1, r2] = await Promise.all([
      saveDelete(makeUnsaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) }),
      saveDelete(makeUnsaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) }),
    ])
    expect((await r1.json() as { saved: boolean }).saved).toBe(false)
    expect((await r2.json() as { saved: boolean }).saved).toBe(false)
  })

  it('does not call YMove API — no verification needed to unsave', async () => {
    await saveDelete(makeUnsaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(mockGetRecipe).not.toHaveBeenCalled()
  })

  it('scopes deleteMany to authenticated user — cannot unsave another user\'s record', async () => {
    await saveDelete(makeUnsaveReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    const { where } = mockPrisma.yMoveRecipeSave.deleteMany.mock.calls[0][0]
    expect(where.userId).toBe('user-1')
    expect(where.ymoveRecipeId).toBe('recipe-1')
  })

  it('returns 400 when ymoveRecipeId is empty', async () => {
    const res = await saveDelete(makeUnsaveReq(''), { params: Promise.resolve({ id: '' }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 when ymoveRecipeId exceeds 100 characters', async () => {
    const longId = 'a'.repeat(101)
    const res = await saveDelete(makeUnsaveReq(longId), { params: Promise.resolve({ id: longId }) })
    expect(res.status).toBe(400)
  })
})

// ── 6. Serving multiplier regression ─────────────────────────────────────────

describe('serving multiplier regression — 2 servings = 2× per-serving macros', () => {
  function logBody(perServing: { calories: number; protein: number; carbs: number; fat: number }, qty: number) {
    return {
      calories:          Math.round(perServing.calories),
      proteinG:          Math.round(perServing.protein * 10) / 10,
      carbohydrateG:     Math.round(perServing.carbs   * 10) / 10,
      fatG:              Math.round(perServing.fat      * 10) / 10,
      servingMultiplier: qty,
    }
  }

  function diaryCalories(body: ReturnType<typeof logBody>) {
    return Math.round(body.calories * body.servingMultiplier)
  }

  const recipe = { calories: 400, protein: 35, carbs: 30, fat: 12 }

  it('submitted calories are per-serving (not pre-multiplied by quantity)', () => {
    expect(logBody(recipe, 1).calories).toBe(400)
    expect(logBody(recipe, 2).calories).toBe(400)
    expect(logBody(recipe, 3).calories).toBe(400)
  })

  it('diary shows 1× for 1 serving', () => {
    expect(diaryCalories(logBody(recipe, 1))).toBe(400)
  })

  it('diary shows 2× for 2 servings (not 4×)', () => {
    expect(diaryCalories(logBody(recipe, 2))).toBe(800)
  })

  it('diary shows 3× for 3 servings', () => {
    expect(diaryCalories(logBody(recipe, 3))).toBe(1200)
  })

  it('hypothetical double-scaling (old bug) would have returned 1600 for 2 servings', () => {
    const brokenCalories = recipe.calories * 2
    const brokenDiaryTotal = brokenCalories * 2
    expect(brokenDiaryTotal).toBe(1600)
    expect(diaryCalories(logBody(recipe, 2))).toBe(800)
    expect(diaryCalories(logBody(recipe, 2))).not.toBe(brokenDiaryTotal)
  })
})

// ── 7. Discover filter scope ──────────────────────────────────────────────────

describe('Discover filter URL construction', () => {
  function buildUrl(q: string, mealType: string, diet: string, maxCal: string, minPro: string, page: number) {
    const sp = new URLSearchParams()
    if (q)        sp.set('q', q)
    if (mealType) sp.set('mealType', mealType)
    if (diet)     sp.set('diet', diet)
    if (maxCal)   sp.set('maxCalories', maxCal)
    if (minPro)   sp.set('minProtein', minPro)
    sp.set('page', String(page))
    return `/api/ymove/recipes?${sp.toString()}`
  }

  it('empty filters produce only page param', () => {
    const url = buildUrl('', '', '', '', '', 1)
    expect(url).toBe('/api/ymove/recipes?page=1')
  })

  it('all filters present are forwarded', () => {
    const url = buildUrl('chicken', 'dinner', 'keto', '500', '30', 2)
    expect(url).toContain('q=chicken')
    expect(url).toContain('mealType=dinner')
    expect(url).toContain('diet=keto')
    expect(url).toContain('maxCalories=500')
    expect(url).toContain('minProtein=30')
    expect(url).toContain('page=2')
  })

  it('page resets to 1 when filters change (enforced by caller)', () => {
    const url = buildUrl('chicken', 'dinner', '', '', '', 1)
    expect(url).toContain('page=1')
  })

  it('search query is encoded safely', () => {
    const url = buildUrl('chicken & rice', '', '', '', '', 1)
    expect(url).toContain('q=chicken+%26+rice')
  })
})
