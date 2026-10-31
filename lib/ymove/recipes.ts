import 'server-only'

const YMOVE_BASE = process.env.YMOVE_NUTRITION_URL ?? 'https://exercise-api.ymove.app/api/v2'
const FETCH_TIMEOUT_MS = 5000

// ── Types ─────────────────────────────────────────────────────────────────────

export interface YMoveRecipeSummary {
  id: string
  title: string
  description: string | null
  prepTimeMin: number | null
  cookTimeMin: number | null
  servings: number
  calories: number
  protein: number
  fat: number
  carbs: number
  mealType: string
  dietTags: string[]
  cuisineType: string | null
  difficulty: string | null
  imageUrl: string | null
  slug: string
}

export interface YMoveIngredient {
  id: string
  name: string
  quantity: number | null
  unit: string | null
  gramsEquivalent: number | null
  calories: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
  order: number
}

export interface YMoveRecipeDetail extends YMoveRecipeSummary {
  instructions: string[]
  ingredients: YMoveIngredient[]
}

export interface RecipeSearchParams {
  q?: string
  diet?: string
  mealType?: string
  minProtein?: number
  maxCalories?: number
  page?: number
  limit?: number
}

export interface RecipePagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function apiKey(): string {
  return process.env.YMOVE_API_KEY ?? ''
}

function authHeaders(): Record<string, string> {
  return { 'X-API-Key': apiKey() }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: authHeaders(),
      signal: controller.signal,
      next: { revalidate: 300 },
    })
  } finally {
    clearTimeout(timer)
  }
}

interface RawRecipe {
  id?: string
  title?: string
  description?: string | null
  prepTimeMin?: number | null
  cookTimeMin?: number | null
  servings?: number
  calories?: number
  protein?: number
  fat?: number
  carbs?: number
  mealType?: string
  dietTags?: string[]
  cuisineType?: string | null
  difficulty?: string | null
  imageUrl?: string | null
  slug?: string
  instructions?: string[]
  ingredients?: Array<{
    id?: string
    name?: string
    quantity?: number | null
    unit?: string | null
    gramsEquivalent?: number | null
    calories?: number | null
    protein?: number | null
    fat?: number | null
    carbs?: number | null
    order?: number
  }>
}

function mapSummary(r: RawRecipe): YMoveRecipeSummary | null {
  if (!r.id || !r.title) return null
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    prepTimeMin: r.prepTimeMin ?? null,
    cookTimeMin: r.cookTimeMin ?? null,
    servings: r.servings ?? 1,
    calories: r.calories ?? 0,
    protein: r.protein ?? 0,
    fat: r.fat ?? 0,
    carbs: r.carbs ?? 0,
    mealType: r.mealType ?? '',
    dietTags: Array.isArray(r.dietTags) ? r.dietTags : [],
    cuisineType: r.cuisineType ?? null,
    difficulty: r.difficulty ?? null,
    imageUrl: r.imageUrl ?? null,
    slug: r.slug ?? r.id,
  }
}

function mapDetail(r: RawRecipe): YMoveRecipeDetail | null {
  const summary = mapSummary(r)
  if (!summary) return null
  return {
    ...summary,
    instructions: Array.isArray(r.instructions) ? r.instructions.filter(Boolean) : [],
    ingredients: Array.isArray(r.ingredients)
      ? r.ingredients.map((ing) => ({
          id: ing.id ?? '',
          name: ing.name ?? '',
          quantity: ing.quantity ?? null,
          unit: ing.unit ?? null,
          gramsEquivalent: ing.gramsEquivalent ?? null,
          calories: ing.calories ?? null,
          protein: ing.protein ?? null,
          fat: ing.fat ?? null,
          carbs: ing.carbs ?? null,
          order: ing.order ?? 0,
        }))
      : [],
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

const DEFAULT_PAGINATION: RecipePagination = { page: 1, pageSize: 20, total: 0, totalPages: 0 }

export async function searchRecipes(
  params: RecipeSearchParams = {},
): Promise<{ recipes: YMoveRecipeSummary[]; pagination: RecipePagination }> {
  const qs = new URLSearchParams()
  if (params.q)           qs.set('q', params.q)
  if (params.diet)        qs.set('diet', params.diet)
  if (params.mealType)    qs.set('mealType', params.mealType)
  if (params.minProtein != null) qs.set('minProtein', String(params.minProtein))
  if (params.maxCalories != null) qs.set('maxCalories', String(params.maxCalories))
  qs.set('page',  String(params.page  ?? 1))
  qs.set('limit', String(params.limit ?? 20))

  const url = `${YMOVE_BASE}/recipes/search?${qs.toString()}`

  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) {
      console.error(`[ymove/recipes] search failed: HTTP ${res.status}`)
      return { recipes: [], pagination: DEFAULT_PAGINATION }
    }
    const data = await res.json() as { data?: RawRecipe[]; pagination?: RecipePagination }
    const recipes = (data.data ?? []).map(mapSummary).filter((r): r is YMoveRecipeSummary => r !== null)
    return {
      recipes,
      pagination: data.pagination ?? DEFAULT_PAGINATION,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('abort')) console.error(`[ymove/recipes] search error: ${msg}`)
    return { recipes: [], pagination: DEFAULT_PAGINATION }
  }
}

export async function getRecipe(id: string): Promise<YMoveRecipeDetail | null> {
  const url = `${YMOVE_BASE}/recipes/${encodeURIComponent(id)}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(url, {
        headers: authHeaders(),
        signal: controller.signal,
        next: { revalidate: 3600 },
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
    const data = await res.json() as { data?: RawRecipe }
    if (!data.data) return null
    return mapDetail(data.data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('abort')) console.error(`[ymove/recipes] getRecipe error: ${msg}`)
    return null
  }
}
