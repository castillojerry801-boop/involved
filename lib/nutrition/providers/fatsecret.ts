// FatSecret Platform API — largest global food database, Premier tier.
// OAuth 2.0 client credentials flow. Token cached in memory per process.
// Attribution: "Powered by FatSecret" must be displayed near search results
// that include FatSecret-sourced foods per their Terms of Service.

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail, AutocompleteResult } from './types'

const BASE_URL = 'https://platform.fatsecret.com/rest/server.api'
const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token'
const FETCH_TIMEOUT_MS = 5000

interface FatSecretToken {
  access_token: string
  expires_at: number
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
  food_type?: string
  brand_name?: string
  food_url?: string
  servings?: { serving: FatSecretServing | FatSecretServing[] }
}

interface FatSecretSearchResult {
  food_id: string
  food_name: string
  food_type?: string
  brand_name?: string
  food_description?: string
}

let cachedToken: FatSecretToken | null = null

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access_token
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=basic',
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`FatSecret token failed: ${res.status}`)
    const data = await res.json() as { access_token: string; expires_in: number }
    cachedToken = {
      access_token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
    }
    return cachedToken.access_token
  } finally {
    clearTimeout(timer)
  }
}

// Parse FatSecret inline description:
// "Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g"
// "Per 1 serving (65g) - Calories: 240kcal | Fat: 9g | Carbs: 24g | Protein: 20g"
function parseDescription(desc: string): {
  calories: number; fat: number; carbs: number; protein: number
  servingSize: number; servingUnit: string; householdText: string | undefined
} | null {
  try {
    const cal     = parseFloat(desc.match(/Calories:\s*([\d.]+)/i)?.[1] ?? '')
    const fat     = parseFloat(desc.match(/Fat:\s*([\d.]+)/i)?.[1] ?? '')
    const carbs   = parseFloat(desc.match(/Carbs:\s*([\d.]+)/i)?.[1] ?? '')
    const protein = parseFloat(desc.match(/Protein:\s*([\d.]+)/i)?.[1] ?? '')
    if (isNaN(cal) && isNaN(protein) && isNaN(carbs) && isNaN(fat)) return null

    // Detect serving context from the "Per X" prefix
    const perMatch = desc.match(/^Per\s+(.+?)\s+-\s+/i)
    const perText = perMatch?.[1] ?? '100g'

    let servingSize = 100
    let servingUnit = 'g'
    let householdText: string | undefined

    if (perText.toLowerCase() === '100g') {
      // Normalized to 100g — standard for generic foods
      servingSize = 100
      servingUnit = 'g'
    } else {
      // "1 serving (65g)" or "1 piece (130g)" or "1 cup (240ml)" etc.
      const gramMatch = perText.match(/([\d.]+)\s*g\b/i)
      const mlMatch   = perText.match(/([\d.]+)\s*ml\b/i)
      if (gramMatch) {
        servingSize = parseFloat(gramMatch[1])
        servingUnit = 'g'
      } else if (mlMatch) {
        servingSize = parseFloat(mlMatch[1])
        servingUnit = 'ml'
      }
      // Extract human-readable part: "1 serving" from "1 serving (65g)"
      const labelMatch = perText.match(/^(.+?)\s*\(/)
      householdText = (labelMatch?.[1] ?? perText).trim() || undefined
    }

    return {
      calories: cal || 0, fat: fat || 0, carbs: carbs || 0, protein: protein || 0,
      servingSize, servingUnit, householdText,
    }
  } catch {
    return null
  }
}

// Pick the most useful serving for display.
// Preference: first serving that represents a real consumer portion (not 100g).
// Fallback: 100g metric serving. Final fallback: first serving.
function pickServing(servings: FatSecretServing | FatSecretServing[]): FatSecretServing {
  const arr = Array.isArray(servings) ? servings : [servings]
  if (arr.length === 0) return { serving_id: '', serving_description: '100g' }

  // Prefer a natural serving (not the 100g metric one) when available
  const natural = arr.find(s => {
    const amount = parseFloat(s.metric_serving_amount ?? '0')
    return amount > 0 && amount !== 100
  })
  if (natural) return natural

  // Fall back to 100g metric serving
  const per100 = arr.find(s =>
    s.metric_serving_unit === 'g' &&
    parseFloat(s.metric_serving_amount ?? '0') === 100
  )
  if (per100) return per100

  return arr[0]
}

function mapSearchResult(item: FatSecretSearchResult): ExternalFoodResult {
  const parsed = item.food_description ? parseDescription(item.food_description) : null

  return {
    provider:    'fatsecret',
    externalId:  item.food_id,
    name:        item.food_name,
    brand:       item.brand_name ?? undefined,
    servingSize: parsed?.servingSize ?? 100,
    servingUnit: parsed?.servingUnit ?? 'g',
    householdServingText: parsed?.householdText,
    coreNutrients: {
      calories:      Math.round(parsed?.calories ?? 0),
      proteinG:      Math.round((parsed?.protein ?? 0) * 10) / 10,
      carbohydrateG: Math.round((parsed?.carbs ?? 0) * 10) / 10,
      fatG:          Math.round((parsed?.fat ?? 0) * 10) / 10,
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

  // Build household serving text from description + metric amount
  let householdServingText: string | undefined
  if (serving?.serving_description) {
    const desc = serving.serving_description.trim()
    // If description already contains gram info or is "100g", skip
    if (!desc.match(/^\d+\s*g$/i) && desc !== '100g') {
      householdServingText = desc
    }
  }

  return {
    provider:    'fatsecret',
    externalId:  food.food_id,
    name:        food.food_name,
    brand:       food.brand_name ?? undefined,
    servingSize,
    servingUnit,
    householdServingText,
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

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      try {
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok) return null
        const data = await res.json() as T & { error?: { code: number; message: string } }

        // Detect FatSecret API-level errors (returned as HTTP 200 with error body)
        if (data && typeof data === 'object' && 'error' in data && data.error) {
          const err = data.error as { code: number; message: string }
          if (err.code === 21) {
            console.warn('[fatsecret] IP allowlist restriction (Error 21) — propagation pending')
          } else {
            console.error(`[fatsecret] API error ${err.code}: ${err.message}`)
          }
          return null
        }

        return data as T
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('abort')) {
        console.error(`[fatsecret] request error: ${msg}`)
      } else {
        console.warn('[fatsecret] request timed out')
      }
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
    const data = await this.request<{ food_id?: { value?: string } }>({
      method: 'food.find_id_for_barcode',
      barcode,
    })
    const foodId = data?.food_id?.value
    if (!foodId) return null
    return this.getById(foodId)
  }

  // Returns name-only suggestions (no nutrition) — useful for type-ahead UX.
  // FatSecret autocomplete does not return IDs; callers should follow with search().
  async autocomplete(query: string, options?: { limit?: number }): Promise<AutocompleteResult[]> {
    const data = await this.request<{
      suggestions?: { suggestion?: string | string[] }
    }>({
      method: 'foods.autocomplete',
      expression: query,
      max_results: String(options?.limit ?? 10),
    })
    if (!data?.suggestions?.suggestion) return []
    const list = Array.isArray(data.suggestions.suggestion)
      ? data.suggestions.suggestion
      : [data.suggestions.suggestion]
    return list.map(name => ({ name }))
  }
}
