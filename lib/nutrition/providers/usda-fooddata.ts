// USDA FoodData Central — free government database covering whole foods, SR Legacy,
// Foundation Foods, and branded packaged products (2.5M+ entries total).
// API key required (free): https://fdc.nal.usda.gov/api-key-signup
//
// Data type priority order:
//   Foundation Foods  — highest quality, lab-tested whole foods (banana, avocado, egg)
//   SR Legacy         — USDA Standard Reference, comprehensive whole/generic foods
//   Survey (FNDDS)    — foods as typically eaten (mixed dishes, restaurant items)
//   Branded           — packaged products with nutrition label data

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const BASE_URL = 'https://api.nal.usda.gov/fdc/v1'

// All four data types — whole foods live in Foundation/SR Legacy, not Branded
const ALL_DATA_TYPES = 'Foundation,SR Legacy,Survey (FNDDS),Branded'

// Nutrient IDs from USDA schema.
// Branded foods use 1008 for energy.
// Foundation / SR Legacy use 2047 (Atwater General) or 2048 (Atwater Specific) instead.
const NID = {
  // calories: try 1008 first, fall back to 2047, then 2048
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
} as const

// Data type rank — lower = higher priority in result list
const DATA_TYPE_RANK: Record<string, number> = {
  'Foundation':      0,
  'SR Legacy':       1,
  'Survey (FNDDS)':  2,
  'Branded':         3,
}

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

// USDA returns "BANANAS, RAW" or "Chicken, broilers or fryers, breast" — normalize to Title Case
function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(',')
    .map(part =>
      part.trim().replace(/\b([a-z])/g, c => c.toUpperCase())
    )
    .join(', ')
}

function mapFood(food: UsdaFood): ExternalFoodDetail {
  const isBranded = food.dataType === 'Branded'

  // Branded: nutrients are already per declared serving size.
  // Foundation / SR Legacy / Survey: nutrients are per 100g.
  // We always present results per 100g for non-branded whole foods —
  // users can adjust servings in the log modal.
  const servingSize = isBranded ? (food.servingSize ?? 100) : 100
  const servingUnit = isBranded
    ? (food.servingSizeUnit ?? 'g').toLowerCase()
    : 'g'

  const calories = getNutrient(food, NID.calories)
  const protein  = getNutrient(food, NID.protein)
  const carbs    = getNutrient(food, NID.carbs)
  const fat      = getNutrient(food, NID.fat)

  const brand = food.brandName ?? food.brandOwner

  return {
    provider: 'usda_fooddata',
    externalId: String(food.fdcId),
    name: titleCase(food.description),
    brand: brand ?? undefined,
    barcode: food.gtinUpc ?? undefined,
    servingSize,
    servingUnit,
    coreNutrients: {
      calories:      Math.round(calories),
      proteinG:      Math.round(protein * 10) / 10,
      carbohydrateG: Math.round(carbs * 10) / 10,
      fatG:          Math.round(fat * 10) / 10,
    },
    extendedNutrients: {
      fiberG:        getNutrient(food, NID.fiber)        || undefined,
      sugarG:        getNutrient(food, NID.sugar)        || undefined,
      sodiumMg:      getNutrient(food, NID.sodium)       || undefined,
      saturatedFatG: getNutrient(food, NID.saturatedFat) || undefined,
      transFatG:     getNutrient(food, NID.transFat)     || undefined,
      cholesterolMg: getNutrient(food, NID.cholesterol)  || undefined,
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

export class UsdaFoodDataProvider implements FoodProvider {
  readonly name = 'USDA FoodData Central'
  readonly providerId = 'usda_fooddata'

  private get apiKey() {
    return process.env.USDA_API_KEY ?? ''
  }

  async search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]> {
    if (!this.apiKey) return []
    // Fetch more than needed so we can filter and re-rank before slicing
    const fetchSize = Math.min((options?.limit ?? 20) * 3, 100)
    const url = new URL(`${BASE_URL}/foods/search`)
    url.searchParams.set('query', query)
    url.searchParams.set('api_key', this.apiKey)
    url.searchParams.set('dataType', ALL_DATA_TYPES)
    url.searchParams.set('pageSize', String(fetchSize))
    url.searchParams.set('sortBy', 'score')
    url.searchParams.set('sortOrder', 'desc')

    try {
      const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
      if (!res.ok) return []
      const data = await res.json() as { foods?: UsdaFood[] }
      const foods = data.foods ?? []

      // Filter out entries with no usable nutrition data
      const withData = foods.filter(hasUsableNutrition)

      // Re-rank: Foundation → SR Legacy → Survey → Branded
      // Within the same data type, USDA score ordering is preserved
      withData.sort((a, b) => {
        const ra = DATA_TYPE_RANK[a.dataType ?? 'Branded'] ?? 3
        const rb = DATA_TYPE_RANK[b.dataType ?? 'Branded'] ?? 3
        return ra - rb
      })

      // Dedupe within USDA results by normalized name
      const seen = new Set<string>()
      const deduped = withData.filter(f => {
        const key = titleCase(f.description).toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      return deduped.slice(0, options?.limit ?? 20).map(mapFood)
    } catch {
      return []
    }
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    if (!this.apiKey) return null
    try {
      const res = await fetch(`${BASE_URL}/food/${externalId}?api_key=${this.apiKey}`, {
        next: { revalidate: 3600 },
      })
      if (!res.ok) return null
      const food = await res.json() as UsdaFood
      return mapFood(food)
    } catch {
      return null
    }
  }

  async searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null> {
    if (!this.apiKey) return null
    try {
      const url = `${BASE_URL}/foods/search?query=${encodeURIComponent(barcode)}&api_key=${this.apiKey}&dataType=Branded&pageSize=1`
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json() as { foods?: UsdaFood[] }
      const food = data.foods?.[0]
      if (!food || food.gtinUpc !== barcode) return null
      return mapFood(food)
    } catch {
      return null
    }
  }
}
