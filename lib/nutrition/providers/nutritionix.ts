import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const BASE_URL = 'https://trackapi.nutritionix.com/v2'

function headers() {
  return {
    'Content-Type': 'application/json',
    'x-app-id': process.env.NUTRITIONIX_APP_ID ?? '',
    'x-app-key': process.env.NUTRITIONIX_APP_KEY ?? '',
  }
}

// Nutritionix field names → our normalized shape
function mapFood(f: Record<string, unknown>): ExternalFoodDetail {
  return {
    provider: 'nutritionix',
    externalId: (f.nix_item_id as string) ?? (f.food_name as string),
    name: f.food_name as string,
    brand: f.brand_name as string | undefined,
    barcode: f.upc as string | undefined,
    servingSize: (f.serving_qty as number) ?? 1,
    servingUnit: f.serving_unit as string,
    coreNutrients: {
      calories: f.nf_calories as number,
      proteinG: f.nf_protein as number,
      carbohydrateG: f.nf_total_carbohydrate as number,
      fatG: f.nf_total_fat as number,
    },
    extendedNutrients: {
      fiberG: f.nf_dietary_fiber as number | undefined,
      sugarG: f.nf_sugars as number | undefined,
      sodiumMg: f.nf_sodium as number | undefined,
      saturatedFatG: f.nf_saturated_fat as number | undefined,
      cholesterolMg: f.nf_cholesterol as number | undefined,
    },
  }
}

export class NutritionixProvider implements FoodProvider {
  readonly name = 'Nutritionix'
  readonly providerId = 'nutritionix'

  async search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]> {
    const limit = options?.limit ?? 20
    const url = `${BASE_URL}/search/instant?query=${encodeURIComponent(query)}&detailed=true&branded=true&common=true`
    const res = await fetch(url, { headers: headers() })
    if (!res.ok) return []
    const data = await res.json() as { branded?: unknown[]; common?: unknown[] }

    const branded = (data.branded ?? []).slice(0, Math.ceil(limit / 2)) as Record<string, unknown>[]
    const common = (data.common ?? []).slice(0, Math.floor(limit / 2)) as Record<string, unknown>[]

    return [...branded, ...common].map(mapFood)
  }

  // Natural language: "2 scrambled eggs and a banana"
  async searchNatural(query: string): Promise<ExternalFoodDetail[]> {
    const res = await fetch(`${BASE_URL}/natural/nutrients`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query }),
    })
    if (!res.ok) return []
    const data = await res.json() as { foods?: unknown[] }
    return ((data.foods ?? []) as Record<string, unknown>[]).map(mapFood)
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    const res = await fetch(`${BASE_URL}/search/item?nix_item_id=${externalId}`, { headers: headers() })
    if (!res.ok) return null
    const data = await res.json() as { foods?: unknown[] }
    const f = (data.foods ?? [])[0] as Record<string, unknown> | undefined
    return f ? mapFood(f) : null
  }

  async searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null> {
    const res = await fetch(`${BASE_URL}/search/item?upc=${barcode}`, { headers: headers() })
    if (!res.ok) return null
    const data = await res.json() as { foods?: unknown[] }
    const f = (data.foods ?? [])[0] as Record<string, unknown> | undefined
    return f ? mapFood(f) : null
  }
}
