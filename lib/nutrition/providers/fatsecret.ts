// FatSecret Platform API — largest global food database, 5,000 calls/day free.
// Uses OAuth 2.0 client credentials flow. Token is cached in memory per process.
// Attribution required per FatSecret terms — show "Powered by FatSecret" near food search.

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const BASE_URL = 'https://platform.fatsecret.com/rest/server.api'
const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token'

interface FatSecretToken {
  access_token: string
  expires_at: number // ms timestamp
}

interface FatSecretServing {
  serving_id: string
  serving_description: string
  serving_url?: string
  metric_serving_amount?: string
  metric_serving_unit?: string
  number_of_units?: string
  measurement_description?: string
  calories?: string
  carbohydrate?: string
  protein?: string
  fat?: string
  saturated_fat?: string
  trans_fat?: string
  cholesterol?: string
  sodium?: string
  fiber?: string
  sugar?: string
  added_sugars?: string
  monounsaturated_fat?: string
  polyunsaturated_fat?: string
}

interface FatSecretFood {
  food_id: string
  food_name: string
  food_type?: string // 'Generic' | 'Brand'
  brand_name?: string
  food_url?: string
  servings?: { serving: FatSecretServing | FatSecretServing[] }
}

interface FatSecretSearchResult {
  food_id: string
  food_name: string
  food_type?: string
  brand_name?: string
  food_description?: string // "Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g"
}

// Singleton token cache — avoids re-fetching on every request within a warm function instance
let cachedToken: FatSecretToken | null = null

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access_token
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'basic',
  })

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!res.ok) throw new Error(`FatSecret token request failed: ${res.status}`)

  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
  return cachedToken.access_token
}

// Parse the inline description string FatSecret returns in search results.
// Format: "Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g"
function parseDescription(desc: string): { calories: number; fat: number; carbs: number; protein: number } | null {
  try {
    const cal     = parseFloat(desc.match(/Calories:\s*([\d.]+)/i)?.[1] ?? '')
    const fat     = parseFloat(desc.match(/Fat:\s*([\d.]+)/i)?.[1] ?? '')
    const carbs   = parseFloat(desc.match(/Carbs:\s*([\d.]+)/i)?.[1] ?? '')
    const protein = parseFloat(desc.match(/Protein:\s*([\d.]+)/i)?.[1] ?? '')
    if (isNaN(cal) && isNaN(protein) && isNaN(carbs) && isNaN(fat)) return null
    return { calories: cal || 0, fat: fat || 0, carbs: carbs || 0, protein: protein || 0 }
  } catch {
    return null
  }
}

// Pick the best serving — prefer "100g" or "1 serving" for generic foods
function pickServing(servings: FatSecretServing | FatSecretServing[]): FatSecretServing {
  const arr = Array.isArray(servings) ? servings : [servings]
  // Prefer 100g serving for normalized comparison
  const per100 = arr.find(s =>
    s.metric_serving_unit === 'g' &&
    parseFloat(s.metric_serving_amount ?? '0') === 100
  )
  if (per100) return per100
  // Fall back to first serving
  return arr[0]
}

function mapSearchResult(item: FatSecretSearchResult): ExternalFoodResult {
  const macros = item.food_description ? parseDescription(item.food_description) : null

  return {
    provider: 'fatsecret',
    externalId: item.food_id,
    name: item.food_name,
    brand: item.brand_name ?? undefined,
    servingSize: 100,
    servingUnit: 'g',
    coreNutrients: {
      calories:      Math.round(macros?.calories ?? 0),
      proteinG:      Math.round((macros?.protein ?? 0) * 10) / 10,
      carbohydrateG: Math.round((macros?.carbs ?? 0) * 10) / 10,
      fatG:          Math.round((macros?.fat ?? 0) * 10) / 10,
    },
  }
}

function mapFoodDetail(food: FatSecretFood): ExternalFoodDetail {
  const serving = food.servings?.serving
    ? pickServing(food.servings.serving)
    : null

  const servingSize = serving?.metric_serving_amount
    ? parseFloat(serving.metric_serving_amount)
    : 100
  const servingUnit = (serving?.metric_serving_unit ?? 'g').toLowerCase()

  const calories = parseFloat(serving?.calories ?? '0') || 0
  const protein  = parseFloat(serving?.protein ?? '0') || 0
  const carbs    = parseFloat(serving?.carbohydrate ?? '0') || 0
  const fat      = parseFloat(serving?.fat ?? '0') || 0

  return {
    provider: 'fatsecret',
    externalId: food.food_id,
    name: food.food_name,
    brand: food.brand_name ?? undefined,
    servingSize,
    servingUnit,
    coreNutrients: {
      calories:      Math.round(calories),
      proteinG:      Math.round(protein * 10) / 10,
      carbohydrateG: Math.round(carbs * 10) / 10,
      fatG:          Math.round(fat * 10) / 10,
    },
    extendedNutrients: {
      fiberG:        parseFloat(serving?.fiber ?? '') || undefined,
      sugarG:        parseFloat(serving?.sugar ?? '') || undefined,
      sodiumMg:      parseFloat(serving?.sodium ?? '') || undefined,
      saturatedFatG: parseFloat(serving?.saturated_fat ?? '') || undefined,
      transFatG:     parseFloat(serving?.trans_fat ?? '') || undefined,
      cholesterolMg: parseFloat(serving?.cholesterol ?? '') || undefined,
    },
  }
}

export class FatSecretProvider implements FoodProvider {
  readonly name = 'FatSecret'
  readonly providerId = 'fatsecret'

  private get clientId()     { return process.env.FATSECRET_CLIENT_ID ?? '' }
  private get clientSecret() { return process.env.FATSECRET_CLIENT_SECRET ?? '' }

  private async request<T>(params: Record<string, string>): Promise<T | null> {
    if (!this.clientId || !this.clientSecret) return null
    try {
      const token = await getAccessToken(this.clientId, this.clientSecret)
      const url = new URL(BASE_URL)
      for (const [k, v] of Object.entries({ ...params, format: 'json' })) {
        url.searchParams.set(k, v)
      }
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      return await res.json() as T
    } catch {
      return null
    }
  }

  async search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]> {
    const data = await this.request<{
      foods?: { food?: FatSecretSearchResult | FatSecretSearchResult[]; max_results?: string }
    }>({
      method: 'foods.search',
      search_expression: query,
      max_results: String(options?.limit ?? 20),
      page_number: '0',
    })

    if (!data?.foods?.food) return []
    const foods = Array.isArray(data.foods.food) ? data.foods.food : [data.foods.food]
    return foods.map(mapSearchResult)
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    const data = await this.request<{ food?: FatSecretFood }>({
      method: 'food.get.v4',
      food_id: externalId,
    })
    if (!data?.food) return null
    return mapFoodDetail(data.food)
  }

  async searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null> {
    // FatSecret barcode lookup via food.find_id_for_barcode
    const data = await this.request<{ food_id?: { value?: string } }>({
      method: 'food.find_id_for_barcode',
      barcode,
    })
    const foodId = data?.food_id?.value
    if (!foodId) return null
    return this.getById(foodId)
  }
}
