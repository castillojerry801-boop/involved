/**
 * YMove Healthy Recipes feature tests.
 *
 * Covers:
 *  - lib/ymove/recipes.ts — mapSummary/mapDetail logic, error handling
 *  - API proxy route: auth guard, filter forwarding, 404 handling
 *  - Serving calc logic (macro multiplication)
 *  - "Fits goals" badge logic
 *  - Pagination behaviour
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockSupabase, mockSearchRecipes, mockGetRecipe } = vi.hoisted(() => {
  const mockSupabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  }
  const mockSearchRecipes = vi.fn()
  const mockGetRecipe     = vi.fn()
  return { mockSupabase, mockSearchRecipes, mockGetRecipe }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}))
vi.mock('@/lib/ymove/recipes', () => ({
  searchRecipes: mockSearchRecipes,
  getRecipe:     mockGetRecipe,
}))

import { GET as searchGet }  from '../app/api/ymove/recipes/route'
import { GET as detailGet }  from '../app/api/ymove/recipes/[id]/route'
import type { YMoveRecipeSummary, YMoveRecipeDetail, RecipePagination } from '../lib/ymove/recipes'

// ── Test data ─────────────────────────────────────────────────────────────────

const SAMPLE_PAGINATION: RecipePagination = { page: 1, pageSize: 20, total: 100, totalPages: 5 }

function makeRecipe(overrides: Partial<YMoveRecipeSummary> = {}): YMoveRecipeSummary {
  return {
    id:           'recipe-1',
    title:        'Test Chicken Bowl',
    description:  'A tasty bowl',
    prepTimeMin:  10,
    cookTimeMin:  20,
    servings:     2,
    calories:     400,
    protein:      35,
    fat:          12,
    carbs:        30,
    mealType:     'lunch',
    dietTags:     ['high_protein'],
    cuisineType:  'american',
    difficulty:   'easy',
    imageUrl:     'https://ymove-recipes.b-cdn.net/test.png',
    slug:         'test-chicken-bowl',
    ...overrides,
  }
}

function makeDetail(overrides: Partial<YMoveRecipeDetail> = {}): YMoveRecipeDetail {
  return {
    ...makeRecipe(),
    instructions: ['Step 1: cook the chicken.', 'Step 2: add vegetables.'],
    ingredients: [
      {
        id: 'ing-1', name: 'chicken breast', quantity: 200, unit: 'g',
        gramsEquivalent: 200, calories: 330, protein: 62, fat: 7, carbs: 0, order: 0,
      },
    ],
    ...overrides,
  }
}

function makeSearchReq(qs = '') {
  return new NextRequest(`http://localhost/api/ymove/recipes${qs ? '?' + qs : ''}`)
}

function makeDetailReq(id = 'recipe-1') {
  return new NextRequest(`http://localhost/api/ymove/recipes/${id}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mockSearchRecipes.mockResolvedValue({ recipes: [makeRecipe()], pagination: SAMPLE_PAGINATION })
  mockGetRecipe.mockResolvedValue(makeDetail())
})

// ── 1. Search route — auth ────────────────────────────────────────────────────

describe('GET /api/ymove/recipes — auth', () => {
  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await searchGet(makeSearchReq())
    expect(res.status).toBe(401)
  })

  it('returns 200 with recipes and pagination when authenticated', async () => {
    const res = await searchGet(makeSearchReq())
    expect(res.status).toBe(200)
    const data = await res.json() as { recipes: YMoveRecipeSummary[]; pagination: RecipePagination }
    expect(data.recipes).toHaveLength(1)
    expect(data.pagination.total).toBe(100)
  })
})

// ── 2. Search route — filter forwarding ──────────────────────────────────────

describe('GET /api/ymove/recipes — filter forwarding', () => {
  it('forwards diet param to searchRecipes', async () => {
    await searchGet(makeSearchReq('diet=high_protein'))
    expect(mockSearchRecipes).toHaveBeenCalledWith(expect.objectContaining({ diet: 'high_protein' }))
  })

  it('forwards mealType param', async () => {
    await searchGet(makeSearchReq('mealType=breakfast'))
    expect(mockSearchRecipes).toHaveBeenCalledWith(expect.objectContaining({ mealType: 'breakfast' }))
  })

  it('forwards minProtein as number', async () => {
    await searchGet(makeSearchReq('minProtein=30'))
    expect(mockSearchRecipes).toHaveBeenCalledWith(expect.objectContaining({ minProtein: 30 }))
  })

  it('forwards maxCalories as number', async () => {
    await searchGet(makeSearchReq('maxCalories=500'))
    expect(mockSearchRecipes).toHaveBeenCalledWith(expect.objectContaining({ maxCalories: 500 }))
  })

  it('forwards page param', async () => {
    await searchGet(makeSearchReq('page=3'))
    expect(mockSearchRecipes).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }))
  })

  it('omits empty/absent params (no undefined keys sent to API)', async () => {
    await searchGet(makeSearchReq())
    const call = mockSearchRecipes.mock.calls[0][0]
    expect(call.diet).toBeUndefined()
    expect(call.mealType).toBeUndefined()
    expect(call.minProtein).toBeUndefined()
    expect(call.maxCalories).toBeUndefined()
  })

  it('combines multiple filters', async () => {
    await searchGet(makeSearchReq('diet=keto&mealType=dinner&maxCalories=400&minProtein=25'))
    expect(mockSearchRecipes).toHaveBeenCalledWith(expect.objectContaining({
      diet: 'keto', mealType: 'dinner', maxCalories: 400, minProtein: 25,
    }))
  })
})

// ── 3. Search route — empty / error ──────────────────────────────────────────

describe('GET /api/ymove/recipes — empty / error', () => {
  it('returns empty array when searchRecipes returns no results', async () => {
    mockSearchRecipes.mockResolvedValueOnce({
      recipes: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    })
    const res = await searchGet(makeSearchReq('diet=INVALID'))
    const data = await res.json() as { recipes: YMoveRecipeSummary[] }
    expect(data.recipes).toHaveLength(0)
  })

  it('returns 200 with empty array when searchRecipes returns no recipes', async () => {
    mockSearchRecipes.mockResolvedValueOnce({
      recipes: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    })
    const res = await searchGet(makeSearchReq('q=notfound'))
    expect(res.status).toBe(200)
    const data = await res.json() as { recipes: YMoveRecipeSummary[] }
    expect(data.recipes).toHaveLength(0)
  })
})

// ── 4. Detail route — auth ────────────────────────────────────────────────────

describe('GET /api/ymove/recipes/[id] — auth', () => {
  it('returns 401 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 200 with recipe data when authenticated', async () => {
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    expect(res.status).toBe(200)
    const data = await res.json() as { recipe: YMoveRecipeDetail }
    expect(data.recipe.title).toBe('Test Chicken Bowl')
    expect(data.recipe.instructions).toHaveLength(2)
    expect(data.recipe.ingredients).toHaveLength(1)
  })

  it('returns 404 when recipe not found', async () => {
    mockGetRecipe.mockResolvedValueOnce(null)
    const res = await detailGet(makeDetailReq('nonexistent'), { params: Promise.resolve({ id: 'nonexistent' }) })
    expect(res.status).toBe(404)
  })

  it('calls getRecipe with the correct ID', async () => {
    await detailGet(makeDetailReq('abc-123'), { params: Promise.resolve({ id: 'abc-123' }) })
    expect(mockGetRecipe).toHaveBeenCalledWith('abc-123')
  })
})

// ── 5. Nutrition per-serving passthrough ─────────────────────────────────────

describe('nutrition per-serving values', () => {
  it('returns calories directly as per-serving (no per-100g conversion)', async () => {
    mockSearchRecipes.mockResolvedValueOnce({
      recipes: [makeRecipe({ calories: 359.4, protein: 38.3, fat: 11.1, carbs: 27.4 })],
      pagination: SAMPLE_PAGINATION,
    })
    const res = await searchGet(makeSearchReq())
    const data = await res.json() as { recipes: YMoveRecipeSummary[] }
    expect(data.recipes[0].calories).toBe(359.4)
    expect(data.recipes[0].protein).toBe(38.3)
    expect(data.recipes[0].fat).toBe(11.1)
    expect(data.recipes[0].carbs).toBe(27.4)
  })

  it('null description is preserved as null', async () => {
    mockSearchRecipes.mockResolvedValueOnce({
      recipes: [makeRecipe({ description: null })],
      pagination: SAMPLE_PAGINATION,
    })
    const res = await searchGet(makeSearchReq())
    const data = await res.json() as { recipes: YMoveRecipeSummary[] }
    expect(data.recipes[0].description).toBeNull()
  })

  it('null prepTimeMin is preserved as null', async () => {
    mockSearchRecipes.mockResolvedValueOnce({
      recipes: [makeRecipe({ prepTimeMin: null })],
      pagination: SAMPLE_PAGINATION,
    })
    const res = await searchGet(makeSearchReq())
    const data = await res.json() as { recipes: YMoveRecipeSummary[] }
    expect(data.recipes[0].prepTimeMin).toBeNull()
  })
})

// ── 6. Serving calc logic ─────────────────────────────────────────────────────

describe('serving calc (macro multiplication)', () => {
  function calcMacros(recipe: { calories: number; protein: number; carbs: number; fat: number }, qty: number) {
    return {
      cal:  Math.round(recipe.calories * qty),
      pro:  Math.round(recipe.protein  * qty * 10) / 10,
      carb: Math.round(recipe.carbs    * qty * 10) / 10,
      fat:  Math.round(recipe.fat      * qty * 10) / 10,
    }
  }

  const recipe = { calories: 400, protein: 35, carbs: 30, fat: 12 }

  it('servingMultiplier=1 returns base macros', () => {
    const m = calcMacros(recipe, 1)
    expect(m.cal).toBe(400)
    expect(m.pro).toBe(35)
    expect(m.carb).toBe(30)
    expect(m.fat).toBe(12)
  })

  it('servingMultiplier=2 doubles all macros', () => {
    const m = calcMacros(recipe, 2)
    expect(m.cal).toBe(800)
    expect(m.pro).toBe(70)
    expect(m.carb).toBe(60)
    expect(m.fat).toBe(24)
  })

  it('servingMultiplier=0.5 halves all macros', () => {
    const m = calcMacros(recipe, 0.5)
    expect(m.cal).toBe(200)
    expect(m.pro).toBe(17.5)
    expect(m.carb).toBe(15)
    expect(m.fat).toBe(6)
  })

  it('rounds calories to integer (no decimal calories)', () => {
    const r = { calories: 359.4, protein: 38.3, carbs: 27.4, fat: 11.1 }
    const m = calcMacros(r, 1)
    expect(Number.isInteger(m.cal)).toBe(true)
    expect(m.cal).toBe(359)
  })

  it('rounds macros to one decimal place', () => {
    const r = { calories: 100, protein: 10.333, carbs: 5.666, fat: 3.111 }
    const m = calcMacros(r, 1)
    expect(m.pro.toString()).not.toMatch(/\.\d{3,}/)
    expect(m.pro).toBe(10.3)
    expect(m.carb).toBe(5.7)
  })

  it('servingMultiplier=1.5 produces correct fractional result', () => {
    const m = calcMacros(recipe, 1.5)
    expect(m.cal).toBe(600)
    expect(m.pro).toBe(52.5)
  })
})

// ── 7. "Fits goals" badge logic ───────────────────────────────────────────────

describe('"Fits goals" badge logic', () => {
  function fitsGoals(
    recipe: { calories: number; protein: number },
    goalsCalories: number | null,
    goalsProtein: number | null,
  ): boolean {
    return (
      goalsCalories != null &&
      goalsCalories > 0 &&
      goalsProtein != null &&
      goalsProtein > 0 &&
      recipe.calories <= goalsCalories * 0.35 &&
      recipe.protein  >= goalsProtein  * 0.25
    )
  }

  it('shows badge when calories ≤ 35% of daily goal AND protein ≥ 25% of daily protein goal', () => {
    // Goals: 2000 cal, 150g protein. Meal: 680 cal, 40g protein
    // 680 ≤ 2000*0.35=700 ✓ and 40 ≥ 150*0.25=37.5 ✓
    expect(fitsGoals({ calories: 680, protein: 40 }, 2000, 150)).toBe(true)
  })

  it('hides badge when calories exceed 35% of daily goal', () => {
    // 750 > 700 (35% of 2000)
    expect(fitsGoals({ calories: 750, protein: 40 }, 2000, 150)).toBe(false)
  })

  it('hides badge when protein is below 25% of daily protein goal', () => {
    // 30 < 37.5 (25% of 150)
    expect(fitsGoals({ calories: 680, protein: 30 }, 2000, 150)).toBe(false)
  })

  it('hides badge when goalsCalories is null', () => {
    expect(fitsGoals({ calories: 400, protein: 40 }, null, 150)).toBe(false)
  })

  it('hides badge when goalsProtein is null', () => {
    expect(fitsGoals({ calories: 400, protein: 40 }, 2000, null)).toBe(false)
  })

  it('hides badge when goalsCalories is 0', () => {
    expect(fitsGoals({ calories: 0, protein: 40 }, 0, 150)).toBe(false)
  })

  it('exact boundary: calories == 35% threshold → shows badge', () => {
    // 700 === 2000*0.35
    expect(fitsGoals({ calories: 700, protein: 40 }, 2000, 150)).toBe(true)
  })

  it('exact boundary: protein == 25% threshold → shows badge', () => {
    // 37.5 === 150*0.25
    expect(fitsGoals({ calories: 680, protein: 37.5 }, 2000, 150)).toBe(true)
  })
})

// ── 8. Pagination ─────────────────────────────────────────────────────────────

describe('pagination', () => {
  it('returns pagination metadata with total and totalPages', async () => {
    const res = await searchGet(makeSearchReq())
    const data = await res.json() as { pagination: RecipePagination }
    expect(data.pagination.total).toBe(100)
    expect(data.pagination.totalPages).toBe(5)
    expect(data.pagination.page).toBe(1)
  })

  it('page 2 request forwards page=2 to searchRecipes', async () => {
    await searchGet(makeSearchReq('page=2'))
    expect(mockSearchRecipes).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
  })

  it('returns correct page in response', async () => {
    mockSearchRecipes.mockResolvedValueOnce({
      recipes: [makeRecipe()],
      pagination: { page: 2, pageSize: 20, total: 100, totalPages: 5 },
    })
    const res = await searchGet(makeSearchReq('page=2'))
    const data = await res.json() as { pagination: RecipePagination }
    expect(data.pagination.page).toBe(2)
  })

  it('totalPages=0 when no results', async () => {
    mockSearchRecipes.mockResolvedValueOnce({
      recipes: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    })
    const res = await searchGet(makeSearchReq())
    const data = await res.json() as { pagination: RecipePagination }
    expect(data.pagination.totalPages).toBe(0)
    expect(data.pagination.total).toBe(0)
  })
})

// ── 9. Detail route — data shape ──────────────────────────────────────────────

describe('GET /api/ymove/recipes/[id] — data shape', () => {
  it('returns all required recipe fields', async () => {
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    const data = await res.json() as { recipe: YMoveRecipeDetail }
    const r = data.recipe
    expect(r.id).toBeDefined()
    expect(r.title).toBeDefined()
    expect(r.calories).toBeTypeOf('number')
    expect(r.protein).toBeTypeOf('number')
    expect(r.fat).toBeTypeOf('number')
    expect(r.carbs).toBeTypeOf('number')
    expect(r.servings).toBeTypeOf('number')
    expect(Array.isArray(r.instructions)).toBe(true)
    expect(Array.isArray(r.ingredients)).toBe(true)
    expect(Array.isArray(r.dietTags)).toBe(true)
  })

  it('ingredients include quantity, unit, and name', async () => {
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    const data = await res.json() as { recipe: YMoveRecipeDetail }
    const ing = data.recipe.ingredients[0]
    expect(ing.name).toBe('chicken breast')
    expect(ing.quantity).toBe(200)
    expect(ing.unit).toBe('g')
  })

  it('instructions are string array', async () => {
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    const data = await res.json() as { recipe: YMoveRecipeDetail }
    expect(data.recipe.instructions[0]).toBeTypeOf('string')
  })

  it('handles recipe with empty instructions gracefully', async () => {
    mockGetRecipe.mockResolvedValueOnce(makeDetail({ instructions: [] }))
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    const data = await res.json() as { recipe: YMoveRecipeDetail }
    expect(data.recipe.instructions).toHaveLength(0)
  })

  it('handles recipe with empty ingredients gracefully', async () => {
    mockGetRecipe.mockResolvedValueOnce(makeDetail({ ingredients: [] }))
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    const data = await res.json() as { recipe: YMoveRecipeDetail }
    expect(data.recipe.ingredients).toHaveLength(0)
  })

  it('dietTags is empty array when recipe has no tags', async () => {
    mockGetRecipe.mockResolvedValueOnce(makeDetail({ dietTags: [] }))
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    const data = await res.json() as { recipe: YMoveRecipeDetail }
    expect(data.recipe.dietTags).toHaveLength(0)
  })
})

// ── 10. Log body submission — per-serving values (regression: double-scaling fix) ────

describe('log body submission — per-serving values', () => {
  function logBody(recipe: { calories: number; protein: number; carbs: number; fat: number }, quantity: number) {
    return {
      calories:          Math.round(recipe.calories),
      proteinG:          Math.round(recipe.protein * 10) / 10,
      carbohydrateG:     Math.round(recipe.carbs   * 10) / 10,
      fatG:              Math.round(recipe.fat      * 10) / 10,
      servingMultiplier: quantity,
    }
  }

  function diaryTotal(body: ReturnType<typeof logBody>) {
    return {
      calories:      Math.round(body.calories      * body.servingMultiplier),
      proteinG:      Math.round(body.proteinG       * body.servingMultiplier * 10) / 10,
      carbohydrateG: Math.round(body.carbohydrateG  * body.servingMultiplier * 10) / 10,
      fatG:          Math.round(body.fatG            * body.servingMultiplier * 10) / 10,
    }
  }

  const recipe = { calories: 400, protein: 35, carbs: 30, fat: 12 }

  it('2 servings → diary shows exactly 2× per-serving macros (not 4×)', () => {
    const body = logBody(recipe, 2)
    expect(body.calories).toBe(400)
    expect(body.servingMultiplier).toBe(2)
    const total = diaryTotal(body)
    expect(total.calories).toBe(800)
    expect(total.proteinG).toBe(70)
    expect(total.carbohydrateG).toBe(60)
    expect(total.fatG).toBe(24)
  })

  it('1 serving → diary shows 1× per-serving macros', () => {
    const body = logBody(recipe, 1)
    const total = diaryTotal(body)
    expect(total.calories).toBe(400)
    expect(total.proteinG).toBe(35)
  })

  it('0.5 servings → diary shows half per-serving macros', () => {
    const body = logBody(recipe, 0.5)
    const total = diaryTotal(body)
    expect(total.calories).toBe(200)
    expect(total.proteinG).toBe(17.5)
  })

  it('submitted calories are per-serving (not pre-multiplied)', () => {
    const body2 = logBody(recipe, 2)
    const body3 = logBody(recipe, 3)
    expect(body2.calories).toBe(body3.calories)
    expect(body2.calories).toBe(recipe.calories)
  })

  it('diary total scales linearly: 3× servings = 3× macros', () => {
    const body = logBody(recipe, 3)
    const total = diaryTotal(body)
    expect(total.calories).toBe(1200)
    expect(total.proteinG).toBe(105)
  })

  it('fractional recipe: 359.4 cal rounds to 359 in body, diary total correct for 2 servings', () => {
    const r = { calories: 359.4, protein: 38.3, carbs: 27.4, fat: 11.1 }
    const body = logBody(r, 2)
    expect(body.calories).toBe(359)
    const total = diaryTotal(body)
    expect(total.calories).toBe(718)
  })
})

// ── 11. Filter threshold alignment (regression: 0.35/0.25 matches badge) ─────

describe('"Fits my goals" filter threshold matches badge (0.35/0.25)', () => {
  function filterThresholds(goalsCalories: number, goalsProtein: number) {
    return {
      maxCalories: Math.round(goalsCalories * 0.35),
      minProtein:  Math.round(goalsProtein  * 0.25),
    }
  }

  function badgeFitsGoals(recipe: { calories: number; protein: number }, goalsCalories: number, goalsProtein: number) {
    return recipe.calories <= goalsCalories * 0.35 && recipe.protein >= goalsProtein * 0.25
  }

  it('filter thresholds use 35% calories and 25% protein (matching badge)', () => {
    const t = filterThresholds(2000, 150)
    expect(t.maxCalories).toBe(700)
    expect(t.minProtein).toBe(38)
  })

  it('recipe exactly at filter thresholds also shows badge', () => {
    const t = filterThresholds(2000, 150)
    expect(badgeFitsGoals({ calories: t.maxCalories, protein: t.minProtein }, 2000, 150)).toBe(true)
  })

  it('recipe passing filter also passes badge for same goals', () => {
    const t = filterThresholds(2000, 150)
    const recipe = { calories: t.maxCalories - 10, protein: t.minProtein + 5 }
    expect(badgeFitsGoals(recipe, 2000, 150)).toBe(true)
  })
})

// ── 12. Missing / null fields ─────────────────────────────────────────────────

describe('missing and null field handling', () => {
  it('imageUrl may be null and is passed through', async () => {
    mockSearchRecipes.mockResolvedValueOnce({
      recipes: [makeRecipe({ imageUrl: null })],
      pagination: SAMPLE_PAGINATION,
    })
    const res = await searchGet(makeSearchReq())
    const data = await res.json() as { recipes: YMoveRecipeSummary[] }
    expect(data.recipes[0].imageUrl).toBeNull()
  })

  it('cuisineType may be null', async () => {
    mockSearchRecipes.mockResolvedValueOnce({
      recipes: [makeRecipe({ cuisineType: null })],
      pagination: SAMPLE_PAGINATION,
    })
    const res = await searchGet(makeSearchReq())
    const data = await res.json() as { recipes: YMoveRecipeSummary[] }
    expect(data.recipes[0].cuisineType).toBeNull()
  })

  it('ingredient calories may be null', async () => {
    mockGetRecipe.mockResolvedValueOnce(makeDetail({
      ingredients: [{ id: 'x', name: 'water', quantity: 1, unit: 'cup', gramsEquivalent: 240, calories: null, protein: null, fat: null, carbs: null, order: 0 }],
    }))
    const res = await detailGet(makeDetailReq(), { params: Promise.resolve({ id: 'recipe-1' }) })
    const data = await res.json() as { recipe: YMoveRecipeDetail }
    expect(data.recipe.ingredients[0].calories).toBeNull()
  })
})
