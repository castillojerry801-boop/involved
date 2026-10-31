// YMove Food Nutrition Provider
//
// YMove exposes a food database (~2.9M items, sourced mainly from Open Food Facts and USDA)
// at the same base URL and with the same API key as the YMove exercise API.
// All nutrition values in YMove responses are per-serving (not per-100g).
// Controlled by the YMOVE_NUTRITION_ENABLED env flag (disabled by default).

import 'server-only'
import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const YMOVE_BASE = process.env.YMOVE_NUTRITION_URL ?? 'https://exercise-api.ymove.app/api/v2'
const FETCH_TIMEOUT_MS = 5000

export function isYMoveNutritionEnabled(): boolean {
  return process.env.YMOVE_NUTRITION_ENABLED === 'true'
}

function apiKey(): string {
  return process.env.YMOVE_API_KEY ?? ''
}

function authHeaders(): Record<string, string> {
  return { 'X-API-Key': apiKey() }
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

function num(val: unknown): number | null {
  if (val == null) return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

interface YMoveFoodItem {
  id:                 string
  fdcId?:             string | null
  name?:              string | null
  displayName?:       string | null
  shortName?:         string | null
  brand?:             string | null
  servingDescription?: string | null
  servingSize?:       number | null
  calories?:          number | null
  protein?:           number | null
  carbs?:             number | null
  fat?:               number | null
  fiber?:             number | null
  sugar?:             number | null
  sodium?:            number | null
  cholesterol?:       number | null
  saturatedFat?:      number | null
  barcode?:           string | null
  source?:            string | null
}

function mapItem(item: YMoveFoodItem): ExternalFoodDetail | null {
  if (!item.id) return null

  // Calories/macros are already per-serving — no per-100g conversion needed.
  const calories = num(item.calories)
  const proteinG = num(item.protein)
  const carbG    = num(item.carbs)
  const fatG     = num(item.fat)

  const hasNutrition = (calories ?? 0) > 0 || (proteinG ?? 0) > 0 ||
    (carbG ?? 0) > 0 || (fatG ?? 0) > 0
  if (!hasNutrition) return null

  const name = (item.displayName ?? item.shortName ?? item.name ?? '').trim()
  if (!name) return null

  // Resolve serving size — already in grams per serving.
  // 100 is the conventional placeholder value (consistent with FatSecret behavior).
  // servingSizeIsEstimated: true (emitted below) signals that weight-based conversions
  // must not use this value as a verified gram weight. Unlike FatSecret, YMove's
  // getById will not correct this if the API also omits servingSize on the detail.
  let servingSize = num(item.servingSize)
  const servingSizeIsEstimated = servingSize == null || servingSize <= 0
  if (servingSizeIsEstimated) servingSize = 100

  // Always use YMove's own UUID as externalId. The detail endpoint (/foods/:id) requires
  // it — calling it with an fdcId causes a 404. externalId-based USDA dedup is not
  // implemented in the search route, so using fdcId here provides no benefit.
  const externalId = item.id

  return {
    provider: 'ymove',
    externalId,
    name,
    brand:   item.brand?.trim() || undefined,
    barcode: item.barcode ?? undefined,
    servingSize: servingSize!,
    servingUnit: 'g',
    householdServingText: item.servingDescription?.trim() || undefined,
    coreNutrients: {
      calories:      Math.round(calories ?? 0),
      proteinG:      Math.round((proteinG ?? 0) * 10) / 10,
      carbohydrateG: Math.round((carbG ?? 0) * 10) / 10,
      fatG:          Math.round((fatG ?? 0) * 10) / 10,
    },
    extendedNutrients: {
      fiberG:        num(item.fiber) ?? undefined,
      sugarG:        num(item.sugar) ?? undefined,
      sodiumMg:      num(item.sodium) ?? undefined,
      saturatedFatG: num(item.saturatedFat) ?? undefined,
      cholesterolMg: num(item.cholesterol) ?? undefined,
    },
    ...(servingSizeIsEstimated ? { servingSizeIsEstimated: true } : {}),
  }
}

const mapDetail = mapItem

// Normalize a barcode for comparison: strip whitespace and drop a single leading zero
// if the result would still be ≥8 digits (UPC-A/EAN-13 bridge).
function normalizeBarcode(b: string): string {
  const clean = b.replace(/\s/g, '')
  if (clean.length === 13 && clean.startsWith('0')) return clean.slice(1)
  return clean
}

export class YMoveNutritionProvider implements FoodProvider {
  readonly name       = 'YMove Foods'
  readonly providerId = 'ymove'

  async search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]> {
    if (!query.trim()) return []
    const limit = options?.limit ?? 20
    const url = `${YMOVE_BASE}/foods?q=${encodeURIComponent(query)}&limit=${limit}`
    try {
      const res = await fetchWithTimeout(url, {
        headers: authHeaders(),
        next: { revalidate: 300 },
      })
      if (!res.ok) {
        console.error(`[ymove] search failed: HTTP ${res.status} for query "${query}"`)
        return []
      }
      const data = await res.json() as { data?: unknown[] }
      return ((data.data ?? []) as YMoveFoodItem[])
        .map(mapItem)
        .filter((x): x is ExternalFoodDetail => x !== null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('abort')) console.error(`[ymove] search error: ${msg}`)
      return []
    }
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    try {
      const res = await fetchWithTimeout(`${YMOVE_BASE}/foods/${encodeURIComponent(externalId)}`, {
        headers: authHeaders(),
        next: { revalidate: 3600 },
      })
      if (!res.ok) return null
      const data = await res.json() as { data?: unknown }
      if (!data.data) return null
      return mapDetail(data.data as YMoveFoodItem)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('abort')) console.error(`[ymove] getById error: ${msg}`)
      return null
    }
  }

  async searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null> {
    try {
      const res = await fetchWithTimeout(`${YMOVE_BASE}/foods/barcode/${encodeURIComponent(barcode)}`, {
        headers: authHeaders(),
        next: { revalidate: 3600 },
      })
      if (!res.ok) return null
      const data = await res.json() as { data?: unknown }
      if (!data.data) return null
      const detail = mapDetail(data.data as YMoveFoodItem)
      if (!detail) return null

      // Reject if returned barcode is unrelated to what was queried.
      if (detail.barcode) {
        const returnedNorm = normalizeBarcode(detail.barcode)
        const queriedNorm  = normalizeBarcode(barcode)
        if (returnedNorm !== queriedNorm && detail.barcode !== barcode) return null
      }

      return detail
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('abort')) console.error(`[ymove] barcode error: ${msg}`)
      return null
    }
  }
}
