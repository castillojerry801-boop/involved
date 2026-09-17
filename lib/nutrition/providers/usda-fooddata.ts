// USDA FoodData Central — free government database of US branded foods.
// 400k+ packaged products with verified nutrition label data.
// API key required (free): https://fdc.nal.usda.gov/api-key-signup

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const BASE_URL = 'https://api.nal.usda.gov/fdc/v1'

// Nutrient IDs from USDA schema
const NID = {
  calories:      1008,
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

interface UsdaFood {
  fdcId: number
  description: string
  brandOwner?: string
  brandName?: string
  gtinUpc?: string
  servingSize?: number
  servingSizeUnit?: string
  householdServingFullText?: string
  foodNutrients: Array<{
    nutrientId: number
    nutrientName: string
    unitName: string
    value: number
  }>
}

function getNutrient(food: UsdaFood, id: number): number {
  return food.foodNutrients.find(n => n.nutrientId === id)?.value ?? 0
}

function mapFood(food: UsdaFood): ExternalFoodDetail {
  const servingSize = food.servingSize ?? 100
  const servingUnit = (food.servingSizeUnit ?? 'g').toLowerCase()
  // USDA branded nutrients are already per-serving, not per 100g
  const calories = getNutrient(food, NID.calories)
  const protein = getNutrient(food, NID.protein)
  const carbs = getNutrient(food, NID.carbs)
  const fat = getNutrient(food, NID.fat)

  const brand = food.brandName ?? food.brandOwner

  return {
    provider: 'usda_fooddata',
    externalId: String(food.fdcId),
    name: food.description
      .split(',')
      .map(s => s.trim().replace(/\b\w/g, c => c.toUpperCase()))
      .join(', '),
    brand: brand ?? undefined,
    barcode: food.gtinUpc ?? undefined,
    servingSize,
    servingUnit,
    coreNutrients: {
      calories: Math.round(calories),
      proteinG: Math.round(protein * 10) / 10,
      carbohydrateG: Math.round(carbs * 10) / 10,
      fatG: Math.round(fat * 10) / 10,
    },
    extendedNutrients: {
      fiberG: getNutrient(food, NID.fiber) || undefined,
      sugarG: getNutrient(food, NID.sugar) || undefined,
      sodiumMg: getNutrient(food, NID.sodium) || undefined,
      saturatedFatG: getNutrient(food, NID.saturatedFat) || undefined,
      transFatG: getNutrient(food, NID.transFat) || undefined,
      cholesterolMg: getNutrient(food, NID.cholesterol) || undefined,
    },
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
    const limit = options?.limit ?? 20
    const url = `${BASE_URL}/foods/search?query=${encodeURIComponent(query)}&api_key=${this.apiKey}&dataType=Branded&pageSize=${limit}&sortBy=score&sortOrder=desc`
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } })
      if (!res.ok) return []
      const data = await res.json() as { foods?: UsdaFood[] }
      return (data.foods ?? []).map(mapFood)
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
      const url = `${BASE_URL}/foods/search?query=${barcode}&api_key=${this.apiKey}&dataType=Branded&pageSize=1`
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
