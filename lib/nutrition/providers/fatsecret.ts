// FatSecret Platform API — largest global food database, Premier tier.
// OAuth 2.0 client credentials flow. Token cached in memory per process.
// Attribution: "Powered by FatSecret" must be displayed near search results
// that include FatSecret-sourced foods per their Terms of Service.

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail, AutocompleteResult } from './types'
import { parseHouseholdText } from './household-parser'
import { canonicalizeUnit } from '../conversion/units'
import { emit } from '@/lib/nutrition/telemetry'

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
  servingSizeIsEstimated: boolean
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
    let servingSizeIsEstimated = false

    if (perText.toLowerCase() === '100g') {
      // Normalized to 100g — standard for generic foods
      servingSize = 100
      servingUnit = 'g'
    } else {
      // "1 serving (65g)" or "1 piece (130g)" or "1 bar (2.07 oz)" or "1 cup (240ml)" etc.
      const gramMatch = perText.match(/([\d.]+)\s*g\b/i)
      const mlMatch   = perText.match(/([\d.]+)\s*ml\b/i)
      // oz parenthetical: "Per 1 bar (2.07 oz)" — convert to grams so the serving
      // size reflects the physical quantity instead of defaulting to 100g.
      const ozMatch   = perText.match(/([\d.]+)\s*oz\b/i)
      if (gramMatch) {
        servingSize = parseFloat(gramMatch[1])
        servingUnit = 'g'
      } else if (mlMatch) {
        servingSize = parseFloat(mlMatch[1])
        servingUnit = 'ml'
      } else if (ozMatch) {
        // 1 oz = 28.3495g; round to 1 decimal for clean storage
        servingSize = Math.round(parseFloat(ozMatch[1]) * 28.3495 * 10) / 10
        servingUnit = 'g'
      } else {
        // No gram/ml/oz found — servingSize stays at default 100, which is wrong for
        // count-noun foods like "1 pack" or "1 bag". Flag so enrichment can fetch the
        // real gram weight from the FatSecret detail API.
        servingSizeIsEstimated = true
      }
      // Extract human-readable part: "1 serving" from "1 serving (65g)"
      const labelMatch = perText.match(/^(.+?)\s*\(/)
      householdText = (labelMatch?.[1] ?? perText).trim() || undefined
    }

    return {
      calories: cal || 0, fat: fat || 0, carbs: carbs || 0, protein: protein || 0,
      servingSize, servingUnit, householdText, servingSizeIsEstimated,
    }
  } catch {
    return null
  }
}

// Candidate scoring for pickServing().
// Scores a single serving against the caller's requested inputUnit.
//   +100  exact unit match (measurement_description === inputUnit)
//   +50   semantic unit match — both are in a common synonym group
//           (e.g. 'strip' ≈ 'slice' ≈ 'piece'; 'large' ≈ 'piece')
//   +10   any non-100g count serving (natural consumer portion)
//     0   100g/ml metric baseline
function scoreServing(s: FatSecretServing, inputUnit?: string): number {
  const amount = parseFloat(s.metric_serving_amount ?? '0')
  const isMetric100 =
    amount === 100 &&
    (s.metric_serving_unit === 'g' || s.metric_serving_unit === 'ml')

  if (isMetric100) return 0

  let score = 10 // non-100g serving baseline

  if (!inputUnit) return score

  const iu = inputUnit.toLowerCase().trim()
  const desc = (s.measurement_description ?? '').toLowerCase().trim()
  const servDesc = (s.serving_description ?? '').toLowerCase().trim()

  // Exact match against measurement_description or serving_description word,
  // or canonical synonym match (tbsp === tablespoon, tsp === teaspoon, etc.)
  if (desc === iu || servDesc.includes(iu) || canonicalizeUnit(desc) === canonicalizeUnit(iu)) {
    return score + 100
  }

  // Semantic synonym groups: strip/slice/piece/rasher all refer to a single flat unit
  const countSynonyms = new Set(['strip', 'strips', 'slice', 'slices', 'rasher', 'rashers', 'piece', 'pieces', 'each'])
  const sizeQualifiers = new Set(['large', 'medium', 'small', 'xl', 'jumbo', 'mini', 'regular', 'standard'])

  if (
    (countSynonyms.has(iu) && (countSynonyms.has(desc) || sizeQualifiers.has(desc))) ||
    (sizeQualifiers.has(iu) && sizeQualifiers.has(desc)) ||
    (iu === 'piece' && (countSynonyms.has(desc) || sizeQualifiers.has(desc)))
  ) {
    return score + 50
  }

  return score
}

// Pick the most useful serving for display, optionally guided by the caller's inputUnit.
//
// Scoring:
//   +100  exact unit match against measurement_description / serving_description
//   +50   semantic synonym match (strip ≈ slice ≈ piece; large/medium ≈ piece)
//   +10   any non-100g natural consumer portion
//     0   100g/ml metric baseline (never preferred when a count serving exists)
//
// When no inputUnit is provided, the function falls back to the original behaviour:
// first non-100g serving, then 100g, then arr[0].
function pickServing(servings: FatSecretServing | FatSecretServing[], inputUnit?: string): FatSecretServing {
  const arr = Array.isArray(servings) ? servings : [servings]
  if (arr.length === 0) return { serving_id: '', serving_description: '100g' }

  if (arr.length === 1) return arr[0]

  // Score all candidates and pick the highest scorer.
  let best = arr[0]
  let bestScore = scoreServing(arr[0], inputUnit)

  for (let i = 1; i < arr.length; i++) {
    const s = scoreServing(arr[i], inputUnit)
    if (s > bestScore) {
      bestScore = s
      best = arr[i]
    }
  }

  return best
}


function mapSearchResult(item: FatSecretSearchResult): ExternalFoodResult {
  const parsed = item.food_description ? parseDescription(item.food_description) : null

  let householdUnit: string | undefined
  let unitsPerServing: number | undefined
  if (parsed?.householdText) {
    const hParsed = parseHouseholdText(parsed.householdText)
    if (hParsed) {
      householdUnit = hParsed.householdUnit
      unitsPerServing = hParsed.unitsPerServing
    }
  }

  return {
    provider:    'fatsecret',
    externalId:  item.food_id,
    name:        item.food_name,
    brand:       item.brand_name ?? undefined,
    isGeneric:   item.food_type === 'Generic',
    servingSize: parsed?.servingSize ?? 100,
    servingUnit: parsed?.servingUnit ?? 'g',
    householdServingText: parsed?.householdText,
    householdUnit,
    unitsPerServing,
    // True when no gram/ml/oz was found in the description — servingSize is a placeholder
    // 100 that needs the detail API to resolve the real gram weight.
    servingSizeIsEstimated: parsed?.servingSizeIsEstimated ?? !parsed,
    coreNutrients: {
      calories:      Math.round(parsed?.calories ?? 0),
      proteinG:      Math.round((parsed?.protein ?? 0) * 10) / 10,
      carbohydrateG: Math.round((parsed?.carbs ?? 0) * 10) / 10,
      fatG:          Math.round((parsed?.fat ?? 0) * 10) / 10,
    },
  }
}

function mapFoodDetail(food: FatSecretFood, inputUnit?: string): ExternalFoodDetail {
  const serving = food.servings?.serving
    ? pickServing(food.servings.serving, inputUnit)
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

  // Extract countable unit from FatSecret's measurement_description and number_of_units fields.
  // These are more precise than parsing the description string.
  let householdUnit: string | undefined
  let unitsPerServing: number | undefined
  if (serving?.measurement_description) {
    const noun = serving.measurement_description.trim()
    if (noun) {
      householdUnit = noun
      const n = parseFloat(serving?.number_of_units ?? '1')
      if (n > 0 && Number.isFinite(n)) unitsPerServing = n
    }
  } else if (householdServingText) {
    // Fall back to parsing the household text
    const hParsed = parseHouseholdText(householdServingText)
    if (hParsed) {
      householdUnit = hParsed.householdUnit
      unitsPerServing = hParsed.unitsPerServing
    }
  }

  return {
    provider:    'fatsecret',
    externalId:  food.food_id,
    name:        food.food_name,
    brand:       food.brand_name ?? undefined,
    isGeneric:   food.food_type === 'Generic',
    servingSize,
    servingUnit,
    householdServingText,
    householdUnit,
    unitsPerServing,
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

  private _lastRequestStatus: { status: import('@/lib/nutrition/telemetry').ProviderStatus; httpStatus?: number; errorCode?: number } = { status: 'ok' }

  private async request<T>(params: Record<string, string>): Promise<T | null> {
    if (!this.clientId || !this.clientSecret) {
      this._lastRequestStatus = { status: 'auth_fail' }
      return null
    }
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
        if (!res.ok) {
          this._lastRequestStatus = {
            status: res.status === 429 ? 'rate_limited' : 'http_error',
            httpStatus: res.status,
          }
          return null
        }
        const data = await res.json() as T & { error?: { code: number; message: string } }

        // Detect FatSecret API-level errors (returned as HTTP 200 with error body)
        if (data && typeof data === 'object' && 'error' in data && data.error) {
          const err = data.error as { code: number; message: string }
          if (err.code === 21) {
            console.warn('[fatsecret] IP allowlist restriction (Error 21) — propagation pending')
            this._lastRequestStatus = { status: 'ip_restricted', errorCode: 21 }
          } else {
            console.error(`[fatsecret] API error ${err.code}: ${err.message}`)
            this._lastRequestStatus = { status: 'http_error', errorCode: err.code }
          }
          return null
        }

        this._lastRequestStatus = { status: 'ok' }
        return data as T
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('abort')) {
        console.error(`[fatsecret] request error: ${msg}`)
        this._lastRequestStatus = { status: 'http_error' }
      } else {
        console.warn('[fatsecret] request timed out')
        this._lastRequestStatus = { status: 'timeout' }
      }
      return null
    }
  }

  async search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]> {
    const start = Date.now()
    const data = await this.request<{
      foods?: { food?: FatSecretSearchResult | FatSecretSearchResult[]; max_results?: string }
    }>({
      method: 'foods.search',
      search_expression: query,
      max_results: String(options?.limit ?? 20),
      page_number: '0',
    })
    if (!data?.foods?.food) {
      const s = this._lastRequestStatus
      emit({
        kind: 'provider_search',
        provider: 'fatsecret',
        query: query.slice(0, 80),
        status: s.status === 'ok' ? 'empty' : s.status,
        resultCount: 0,
        latencyMs: Date.now() - start,
        httpStatus: s.httpStatus,
        errorCode: s.errorCode,
      })
      return []
    }
    const foods = Array.isArray(data.foods.food) ? data.foods.food : [data.foods.food]
    const results = foods.map(mapSearchResult)
    emit({
      kind: 'provider_search',
      provider: 'fatsecret',
      query: query.slice(0, 80),
      status: 'ok',
      resultCount: results.length,
      latencyMs: Date.now() - start,
    })
    return results
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    const start = Date.now()
    const data = await this.request<{ food?: FatSecretFood }>({
      method: 'food.get.v4',
      food_id: externalId,
    })
    if (!data?.food) {
      const s = this._lastRequestStatus
      emit({
        kind: 'provider_detail',
        provider: 'fatsecret',
        status: s.status === 'ok' ? 'empty' : s.status,
        latencyMs: Date.now() - start,
        httpStatus: s.httpStatus,
        errorCode: s.errorCode,
      })
      return null
    }
    emit({ kind: 'provider_detail', provider: 'fatsecret', status: 'ok', latencyMs: Date.now() - start })
    return mapFoodDetail(data.food)
  }

  // Like getById but passes inputUnit to pickServing() for semantically-aware
  // serving selection. Used by enrichFatSecretMatch() so that e.g. "3 strips"
  // prefers the "1 strip" serving over other count servings.
  async getByIdForEnrichment(externalId: string, inputUnit: string): Promise<ExternalFoodDetail | null> {
    const data = await this.request<{ food?: FatSecretFood }>({
      method: 'food.get.v4',
      food_id: externalId,
    })
    if (!data?.food) return null
    return mapFoodDetail(data.food, inputUnit)
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
