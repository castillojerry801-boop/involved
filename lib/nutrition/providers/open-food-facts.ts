// Open Food Facts — completely free, no API key required.
// Great for packaged/branded foods and barcode lookups.

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const BASE_URL = 'https://world.openfoodfacts.org'

function mapProduct(p: Record<string, unknown>): ExternalFoodDetail | null {
  const n = (p.nutriments ?? {}) as Record<string, unknown>
  const calories = Number(n['energy-kcal_100g'] ?? n['energy-kcal_serving'] ?? 0)
  if (!calories && !p.product_name) return null

  const servingSize = Number(p.serving_quantity) || 100
  const servingUnit = (p.serving_unit as string) || 'g'
  const factor = servingSize / 100 // nutrients are per 100g

  return {
    provider: 'open_food_facts',
    externalId: (p.id as string) ?? (p.code as string),
    name: (p.product_name as string) || 'Unknown product',
    brand: p.brands as string | undefined,
    barcode: p.code as string | undefined,
    servingSize,
    servingUnit,
    coreNutrients: {
      calories: Math.round(calories * factor),
      proteinG: Math.round(Number(n['proteins_100g'] ?? 0) * factor * 10) / 10,
      carbohydrateG: Math.round(Number(n['carbohydrates_100g'] ?? 0) * factor * 10) / 10,
      fatG: Math.round(Number(n['fat_100g'] ?? 0) * factor * 10) / 10,
    },
    extendedNutrients: {
      fiberG: Number(n['fiber_100g'] ?? 0) * factor || undefined,
      sugarG: Number(n['sugars_100g'] ?? 0) * factor || undefined,
      sodiumMg: Number(n['sodium_100g'] ?? 0) * factor * 1000 || undefined,
      saturatedFatG: Number(n['saturated-fat_100g'] ?? 0) * factor || undefined,
    },
    ingredientsText: p.ingredients_text as string | undefined,
  }
}

export class OpenFoodFactsProvider implements FoodProvider {
  readonly name = 'Open Food Facts'
  readonly providerId = 'open_food_facts'

  async search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]> {
    const limit = options?.limit ?? 20
    const url = `${BASE_URL}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&page_size=${limit}&fields=id,code,product_name,brands,serving_quantity,serving_unit,nutriments`
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) return []
    const data = await res.json() as { products?: unknown[] }
    return ((data.products ?? []) as Record<string, unknown>[])
      .map(mapProduct)
      .filter(Boolean) as ExternalFoodResult[]
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    return this.searchByBarcode(externalId)
  }

  async searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null> {
    const res = await fetch(`${BASE_URL}/api/v0/product/${barcode}.json`)
    if (!res.ok) return null
    const data = await res.json() as { status: number; product?: unknown }
    if (data.status !== 1 || !data.product) return null
    return mapProduct(data.product as Record<string, unknown>)
  }
}
