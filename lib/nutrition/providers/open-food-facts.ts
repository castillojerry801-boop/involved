// Open Food Facts — completely free, no API key required.
// Great for packaged/branded foods and barcode lookups.
// OFF asks that apps send a descriptive User-Agent to identify traffic.

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const BASE_URL = 'https://world.openfoodfacts.org'

const BARCODE_FIELDS = [
  'code', 'product_name', 'brands', 'quantity',
  'nutriments', 'serving_size', 'serving_quantity',
  'image_front_url', 'nutrition_grades', 'nova_group',
  'ingredients_text',
].join(',')

const SEARCH_FIELDS = [
  'code', 'product_name', 'brands', 'serving_quantity',
  'nutriments', 'nutrition_grades',
].join(',')

const USER_AGENT = 'InvolvedApp/1.0 (https://getinvolved.app; castillojerry801@gmail.com)'

function num(val: unknown): number | null {
  if (val == null) return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

function mapProduct(p: Record<string, unknown>): ExternalFoodDetail | null {
  const n = (p.nutriments ?? {}) as Record<string, unknown>

  const cal100g = num(n['energy-kcal_100g'])
  const protein100g = num(n['proteins_100g'])
  const carbs100g = num(n['carbohydrates_100g'])
  const fat100g = num(n['fat_100g'])

  // Product name and at least some nutrient data required to be usable
  if (!p.product_name && cal100g == null) return null

  // serving_quantity is grams per serving (or ml — treated as grams for nutrition purposes)
  const servingGrams = num(p.serving_quantity) ?? 100
  const factor = servingGrams / 100

  const incompleteData = cal100g == null || protein100g == null ||
    carbs100g == null || fat100g == null

  // Reject entries that have no useful nutrition at all — they'd only clutter results
  const hasAnyNutrition = (cal100g ?? 0) > 0 || (protein100g ?? 0) > 0 ||
    (carbs100g ?? 0) > 0 || (fat100g ?? 0) > 0
  if (!hasAnyNutrition) return null

  // Extended nutrients — only include if the field actually has a value
  const fiber100g = num(n['fiber_100g']) ?? num(n['fibers_100g'])
  const sugars100g = num(n['sugars_100g'])
  const sodium100g = num(n['sodium_100g'])
  const satFat100g = num(n['saturated-fat_100g'])
  const transFat100g = num(n['trans-fat_100g'])
  const cholesterol100g = num(n['cholesterol_100g'])

  return {
    provider: 'open_food_facts',
    externalId: (p.code as string) ?? '',
    name: ((p.product_name as string) ?? '').trim() || 'Unknown product',
    brand: (p.brands as string | undefined)?.split(',')[0].trim(),
    barcode: p.code as string | undefined,
    servingSize: servingGrams,
    servingUnit: 'g',
    coreNutrients: {
      calories:      Math.round((cal100g ?? 0) * factor),
      proteinG:      Math.round((protein100g ?? 0) * factor * 10) / 10,
      carbohydrateG: Math.round((carbs100g ?? 0) * factor * 10) / 10,
      fatG:          Math.round((fat100g ?? 0) * factor * 10) / 10,
    },
    extendedNutrients: {
      fiberG:        fiber100g != null ? Math.round(fiber100g * factor * 10) / 10 : undefined,
      sugarG:        sugars100g != null ? Math.round(sugars100g * factor * 10) / 10 : undefined,
      sodiumMg:      sodium100g != null ? Math.round(sodium100g * factor * 1000) : undefined,
      saturatedFatG: satFat100g != null ? Math.round(satFat100g * factor * 10) / 10 : undefined,
      transFatG:     transFat100g != null ? Math.round(transFat100g * factor * 10) / 10 : undefined,
      cholesterolMg: cholesterol100g != null ? Math.round(cholesterol100g * factor * 1000) : undefined,
    },
    ingredientsText: p.ingredients_text as string | undefined,
    nutriScore:   (p.nutrition_grades as string | undefined)?.toUpperCase() ?? undefined,
    novaGroup:    num(p.nova_group) ?? undefined,
    imageUrl:     (p.image_front_url as string | undefined) ?? undefined,
    incompleteData,
  }
}

export class OpenFoodFactsProvider implements FoodProvider {
  readonly name = 'Open Food Facts'
  readonly providerId = 'open_food_facts'

  private headers = { 'User-Agent': USER_AGENT }

  async search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]> {
    if (!query.trim()) return []
    const limit = options?.limit ?? 20
    const url = `${BASE_URL}/api/v2/search?search_terms=${encodeURIComponent(query)}&json=1&page_size=${limit}&fields=${SEARCH_FIELDS}&sort_by=unique_scans_n`
    try {
      const res = await fetch(url, {
        headers: this.headers,
        next: { revalidate: 3600 },
      })
      if (!res.ok) return []
      const data = await res.json() as { products?: unknown[] }
      return ((data.products ?? []) as Record<string, unknown>[])
        .map(mapProduct)
        .filter((x): x is ExternalFoodDetail => x !== null)
    } catch {
      return []
    }
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    return this.searchByBarcode(externalId)
  }

  async searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null> {
    try {
      const url = `${BASE_URL}/api/v2/product/${encodeURIComponent(barcode)}?fields=${BARCODE_FIELDS}`
      const res = await fetch(url, { headers: this.headers })
      if (!res.ok) return null
      const data = await res.json() as { status: number; product?: unknown }
      // status: 0 = not found, status: 1 = found
      if (data.status !== 1 || !data.product) return null
      return mapProduct(data.product as Record<string, unknown>)
    } catch {
      return null
    }
  }
}
