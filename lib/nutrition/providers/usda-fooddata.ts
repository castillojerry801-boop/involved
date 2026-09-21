// USDA FoodData Central — free government database covering whole foods, SR Legacy,
// Foundation Foods, and branded packaged products (2.5M+ entries total).
// API key required (free): https://fdc.nal.usda.gov/api-key-signup

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const BASE_URL = 'https://api.nal.usda.gov/fdc/v1'
const ALL_DATA_TYPES = 'Foundation,SR Legacy,Survey (FNDDS),Branded'
const FETCH_TIMEOUT_MS = 5000

// Nutrient IDs from USDA FDC schema.
const NID = {
  calories:      [1008, 2047, 2048] as number[],
  protein:       1003,
  carbs:         1005,
  fat:           1004,
  fiber:         1079,
  sugar:         2000,
  sodium:        1093,
  saturatedFat:  1258,
  transFat:      1257,
  cholesterol:   1253,
  potassium:     1092,
  calcium:       1087,
  iron:          1089,
  vitaminD:      1110,
  vitaminC:      1162,
  vitaminA:      1104,
} as const

interface UsdaFood {
  fdcId: number
  description: string
  dataType?: string
  brandOwner?: string
  brandName?: string
  gtinUpc?: string
  servingSize?: number
  servingSizeUnit?: string
  householdServingFullText?: string
  foodCategory?: string
  publishedDate?: string
  foodNutrients: Array<{
    nutrientId: number
    nutrientName: string
    unitName: string
    value: number
  }>
}

function getNutrient(food: UsdaFood, id: number | number[]): number {
  if (Array.isArray(id)) {
    for (const nid of id) {
      const val = food.foodNutrients.find(n => n.nutrientId === nid)?.value
      if (val != null && val > 0) return val
    }
    return 0
  }
  return food.foodNutrients.find(n => n.nutrientId === id)?.value ?? 0
}

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(',')
    .map(part => part.trim().replace(/\b([a-z])/g, c => c.toUpperCase()))
    .join(', ')
}

// USDA sometimes returns 0.0 for vitamins and minerals as undetected values.
// Only include if clearly present.
function mineral(val: number): number | undefined {
  return val > 0 ? val : undefined
}

function mapFood(food: UsdaFood): ExternalFoodDetail {
  const isBranded = food.dataType === 'Branded'

  const servingSize = isBranded ? (food.servingSize ?? 100) : 100
  const servingUnit = isBranded
    ? (food.servingSizeUnit ?? 'g').toLowerCase()
    : 'g'

  const brand = food.brandName ?? food.brandOwner

  return {
    provider:    'usda_fooddata',
    externalId:  String(food.fdcId),
    name:        titleCase(food.description),
    brand:       brand ?? undefined,
    barcode:     food.gtinUpc ?? undefined,
    servingSize,
    servingUnit,
    householdServingText: food.householdServingFullText?.trim() || undefined,
    coreNutrients: {
      calories:      Math.round(getNutrient(food, NID.calories)),
      proteinG:      Math.round(getNutrient(food, NID.protein) * 10) / 10,
      carbohydrateG: Math.round(getNutrient(food, NID.carbs) * 10) / 10,
      fatG:          Math.round(getNutrient(food, NID.fat) * 10) / 10,
    },
    extendedNutrients: {
      fiberG:        mineral(getNutrient(food, NID.fiber)),
      sugarG:        mineral(getNutrient(food, NID.sugar)),
      sodiumMg:      mineral(getNutrient(food, NID.sodium)),
      saturatedFatG: mineral(getNutrient(food, NID.saturatedFat)),
      transFatG:     mineral(getNutrient(food, NID.transFat)),
      cholesterolMg: mineral(getNutrient(food, NID.cholesterol)),
      potassiumMg:   mineral(getNutrient(food, NID.potassium)),
      calciumMg:     mineral(getNutrient(food, NID.calcium)),
      ironMg:        mineral(getNutrient(food, NID.iron)),
      vitaminDMcg:   mineral(getNutrient(food, NID.vitaminD)),
      vitaminCMg:    mineral(getNutrient(food, NID.vitaminC)),
      vitaminAMcg:   mineral(getNutrient(food, NID.vitaminA)),
    },
  }
}

function hasUsableNutrition(food: UsdaFood): boolean {
  const cal = getNutrient(food, NID.calories)
  const protein = getNutrient(food, NID.protein)
  const carbs = getNutrient(food, NID.carbs)
  const fat = getNutrient(food, NID.fat)
  return cal > 0 || protein > 0 || carbs > 0 || fat > 0
}

// Strip characters that cause USDA to return HTTP 400.
// Apostrophes (%27) and certain other chars break USDA's query parser.
// Keep hyphens and spaces — USDA handles those correctly.
function normalizeQueryForUsda(query: string): string {
  return query
    .replace(/['''`]/g, ' ')  // apostrophes → space
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export class UsdaFoodDataProvider implements FoodProvider {
  readonly name = 'USDA FoodData Central'
  readonly providerId = 'usda_fooddata'

  private get apiKey() {
    return process.env.USDA_API_KEY ?? ''
  }

  async search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]> {
    if (!this.apiKey) return []

    const normalized = normalizeQueryForUsda(query)
    if (!normalized) return []

    // Fetch extra so we can filter and rank before slicing
    const fetchSize = Math.min((options?.limit ?? 20) * 3, 100)
    const url = new URL(`${BASE_URL}/foods/search`)
    url.searchParams.set('query', normalized)
    url.searchParams.set('api_key', this.apiKey)
    url.searchParams.set('dataType', ALL_DATA_TYPES)
    url.searchParams.set('pageSize', String(fetchSize))
    url.searchParams.set('sortBy', 'score')
    url.searchParams.set('sortOrder', 'desc')

    try {
      const res = await fetchWithTimeout(url.toString(), { next: { revalidate: 3600 } })
      if (!res.ok) {
        console.error(`[usda] search failed: HTTP ${res.status} for query "${normalized}"`)
        return []
      }
      const data = await res.json() as { foods?: UsdaFood[] }
      const foods = (data.foods ?? []).filter(hasUsableNutrition)

      // Score each result for intent-aware ranking.
      // Base score = USDA relevance position (reversed: first = highest).
      // We boost Foundation/SR Legacy only when they're actually relevant (not when
      // the query is clearly a brand/restaurant name).
      const queryLower = normalized.toLowerCase()
      const isBrandOrRestaurantQuery = foods.slice(0, 5).some(f =>
        f.dataType === 'Branded' || f.dataType === 'Survey (FNDDS)'
      )

      type Scored = { food: UsdaFood; rank: number }
      const scored: Scored[] = foods.map((food, idx) => {
        let rank = foods.length - idx  // higher = better USDA relevance position

        const nameLower = food.description.toLowerCase()
        const isExactish = nameLower.includes(queryLower) || queryLower.includes(nameLower.split(',')[0])

        if (isExactish) {
          // Exact or near-exact matches: give Foundation/SR Legacy a modest boost
          if (food.dataType === 'Foundation') rank += 20
          else if (food.dataType === 'SR Legacy') rank += 15
          else if (food.dataType === 'Survey (FNDDS)') rank += 10
          // Branded: no bonus, rely on USDA relevance score
        } else if (!isBrandOrRestaurantQuery) {
          // Generic whole-food query: prefer Foundation/SR Legacy
          if (food.dataType === 'Foundation') rank += 12
          else if (food.dataType === 'SR Legacy') rank += 8
        }
        // Brand/restaurant query: don't apply data-type bias — let USDA score determine order

        return { food, rank }
      })

      scored.sort((a, b) => b.rank - a.rank)

      // Dedupe by normalized description within USDA
      const seen = new Set<string>()
      const deduped = scored.filter(({ food }) => {
        const key = food.description.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      return deduped.slice(0, options?.limit ?? 20).map(({ food }) => mapFood(food))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[usda] search error: ${msg}`)
      return []
    }
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    if (!this.apiKey) return null
    try {
      const res = await fetchWithTimeout(
        `${BASE_URL}/food/${externalId}?api_key=${this.apiKey}`,
        { next: { revalidate: 3600 } }
      )
      if (!res.ok) return null
      const food = await res.json() as UsdaFood
      return mapFood(food)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[usda] getById error: ${msg}`)
      return null
    }
  }

  async searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null> {
    if (!this.apiKey) return null
    try {
      const url = `${BASE_URL}/foods/search?query=${encodeURIComponent(barcode)}&api_key=${this.apiKey}&dataType=Branded&pageSize=1`
      const res = await fetchWithTimeout(url)
      if (!res.ok) return null
      const data = await res.json() as { foods?: UsdaFood[] }
      const food = data.foods?.[0]
      if (!food || food.gtinUpc !== barcode) return null
      return mapFood(food)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[usda] searchByBarcode error: ${msg}`)
      return null
    }
  }
}
