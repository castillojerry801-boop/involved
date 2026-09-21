// NIH Dietary Supplement Label Database (DSLD) — free, no API key required.
// Purpose-built for supplements: protein powders, vitamins, creatine, herbs, etc.
// Label data is pulled directly from product labels, so serving info is accurate.
// https://api.ods.od.nih.gov/dsld/
//
// Working endpoints (confirmed 2026-09-20):
//   Search:  GET /v9/search-filter?q={term}&size={n}
//   Detail:  GET /v9/label/{id}
// Barcode lookup via DSLD is not supported — upcSku exists in detail but there
// is no search-by-barcode path to reach the product without already knowing the ID.

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const BASE_URL = 'https://api.ods.od.nih.gov/dsld/v9'
const FETCH_TIMEOUT_MS = 5000

// Search response: { hits: Array<{ _id, _score, _source }>, stats: { count } }
interface DsldSearchHit {
  _id: string
  _score: number
  _source: {
    fullName: string
    brandName?: string
  }
}

// Detail response from /v9/label/{id}
interface DsldLabel {
  id: number
  fullName: string
  brandName?: string
  upcSku?: string
  servingsPerContainer?: number
  servingSizes?: Array<{
    minQuantity?: number
    maxQuantity?: number
    unit?: string
    notes?: string
  }>
  ingredientRows?: Array<{
    name: string
    category?: string
    quantity?: Array<{
      quantity?: number
      unit?: string
      servingSizeUnit?: string
    }>
  }>
}

// Map DSLD ingredient row names (lowercased) → our nutrient accumulator keys
const NUTRIENT_MAP: Record<string, keyof NutrientAccum> = {
  'calories':           'calories',
  'energy':             'calories',
  'total fat':          'fatG',
  'fat':                'fatG',
  'total carbohydrate': 'carbohydrateG',
  'total carbohydrates':'carbohydrateG',
  'total carbs':        'carbohydrateG',
  'carbohydrate':       'carbohydrateG',
  'protein':            'proteinG',
  'dietary fiber':      'fiberG',
  'fiber':              'fiberG',
  'total sugars':       'sugarG',
  'sugars':             'sugarG',
  'added sugars':       'sugarG',
  'sodium':             'sodiumMg',
  'saturated fat':      'saturatedFatG',
  'trans fat':          'transFatG',
  'cholesterol':        'cholesterolMg',
}

interface NutrientAccum {
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  fiberG: number
  sugarG: number
  sodiumMg: number
  saturatedFatG: number
  transFatG: number
  cholesterolMg: number
}

function extractNutrients(rows: DsldLabel['ingredientRows']): NutrientAccum | null {
  if (!rows?.length) return null
  const acc: NutrientAccum = {
    calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0,
    fiberG: 0, sugarG: 0, sodiumMg: 0, saturatedFatG: 0, transFatG: 0, cholesterolMg: 0,
  }
  let found = false
  for (const row of rows) {
    const key = NUTRIENT_MAP[row.name.toLowerCase().trim()]
    if (!key) continue
    const qty = row.quantity?.[0]?.quantity
    if (qty == null) continue
    acc[key] += qty
    found = true
  }
  return found ? acc : null
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

function mapLabel(label: DsldLabel): ExternalFoodDetail {
  const nutrients = extractNutrients(label.ingredientRows)

  // Serving size from servingSizes array
  let servingSize = 1
  let servingUnit = 'serving'
  let householdServingText: string | undefined

  const sz = label.servingSizes?.[0]
  if (sz) {
    const qty = sz.minQuantity ?? sz.maxQuantity
    if (qty != null && qty > 0) servingSize = qty
    if (sz.unit) {
      const u = sz.unit.toLowerCase()
      if (u.startsWith('gram')) servingUnit = 'g'
      else if (u.startsWith('ml') || u.includes('milliliter')) servingUnit = 'ml'
      else servingUnit = sz.unit
    }
    if (sz.notes?.trim()) householdServingText = sz.notes.trim()
  }

  return {
    provider: 'nih_dsld',
    externalId: String(label.id),
    name: label.fullName,
    brand: label.brandName ?? undefined,
    servingSize,
    servingUnit,
    householdServingText,
    servingsPerContainer: label.servingsPerContainer ?? undefined,
    coreNutrients: {
      calories:      Math.round(nutrients?.calories ?? 0),
      proteinG:      Math.round((nutrients?.proteinG ?? 0) * 10) / 10,
      carbohydrateG: Math.round((nutrients?.carbohydrateG ?? 0) * 10) / 10,
      fatG:          Math.round((nutrients?.fatG ?? 0) * 10) / 10,
    },
    extendedNutrients: nutrients ? {
      fiberG:        nutrients.fiberG        || undefined,
      sugarG:        nutrients.sugarG        || undefined,
      sodiumMg:      nutrients.sodiumMg      || undefined,
      saturatedFatG: nutrients.saturatedFatG || undefined,
      transFatG:     nutrients.transFatG     || undefined,
      cholesterolMg: nutrients.cholesterolMg || undefined,
    } : undefined,
  }
}

export class NihDsldProvider implements FoodProvider {
  readonly name = 'NIH DSLD'
  readonly providerId = 'nih_dsld'

  async search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]> {
    try {
      const url = `${BASE_URL}/search-filter?q=${encodeURIComponent(query)}&size=${options?.limit ?? 20}`
      const res = await fetchWithTimeout(url, { next: { revalidate: 3600 } })
      if (!res.ok) {
        console.error(`[dsld] search failed: HTTP ${res.status} for query "${query}"`)
        return []
      }
      const data = await res.json() as { hits?: DsldSearchHit[] }
      return (data.hits ?? []).map(hit => ({
        provider: 'nih_dsld',
        externalId: hit._id,
        name: hit._source.fullName,
        brand: hit._source.brandName ?? undefined,
        servingSize: 1,
        servingUnit: 'serving',
        // Nutrition not available in search stubs — fetched on detail view
        coreNutrients: { calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('abort')) console.error(`[dsld] search error: ${msg}`)
      return []
    }
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/label/${externalId}`, {
        next: { revalidate: 3600 },
      })
      if (!res.ok) return null
      const label = await res.json() as DsldLabel
      return mapLabel(label)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('abort')) console.error(`[dsld] getById error: ${msg}`)
      return null
    }
  }

  // DSLD does not expose a barcode search endpoint.
  async searchByBarcode(_barcode: string): Promise<ExternalFoodDetail | null> {
    return null
  }
}
