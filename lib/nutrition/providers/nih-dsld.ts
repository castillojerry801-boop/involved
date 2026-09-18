// NIH Dietary Supplement Label Database (DSLD) — free, no API key required.
// Purpose-built for supplements: protein powders, vitamins, creatine, herbs, etc.
// Label data is pulled directly from product labels, so serving info is accurate.
// https://api.ods.od.nih.gov/dsld/

import type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'

const BASE_URL = 'https://api.ods.od.nih.gov/dsld/v9'

interface DsldProduct {
  id: number
  productName: string
  brandName?: string
  upcSku?: string
  servingSize?: string
  servingsPerContainer?: number
  ingredients?: DsldIngredient[]
}

interface DsldIngredient {
  name: string
  quantity?: number
  unit?: string
}

interface DsldSearchHit {
  _id: string
  _source: {
    productName: string
    brandName?: string
    upcSku?: string
  }
}

// Map DSLD ingredient names to our nutrient fields
const NUTRIENT_MAP: Record<string, keyof NutrientAccum> = {
  'calories':          'calories',
  'energy':            'calories',
  'total fat':         'fatG',
  'fat':               'fatG',
  'total carbohydrate':'carbohydrateG',
  'total carbs':       'carbohydrateG',
  'carbohydrate':      'carbohydrateG',
  'protein':           'proteinG',
  'dietary fiber':     'fiberG',
  'fiber':             'fiberG',
  'total sugars':      'sugarG',
  'sugars':            'sugarG',
  'sodium':            'sodiumMg',
  'saturated fat':     'saturatedFatG',
  'trans fat':         'transFatG',
  'cholesterol':       'cholesterolMg',
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

function extractNutrients(ingredients: DsldIngredient[]): NutrientAccum {
  const acc: NutrientAccum = {
    calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0,
    fiberG: 0, sugarG: 0, sodiumMg: 0, saturatedFatG: 0, transFatG: 0, cholesterolMg: 0,
  }

  for (const ing of ingredients) {
    const key = NUTRIENT_MAP[ing.name.toLowerCase().trim()]
    if (key && ing.quantity != null) {
      acc[key] += ing.quantity
    }
  }

  return acc
}

function mapProduct(product: DsldProduct): ExternalFoodDetail {
  const nutrients = product.ingredients ? extractNutrients(product.ingredients) : null

  // Parse serving size string e.g. "1 scoop (30g)" → 30, "g"
  let servingSize = 100
  let servingUnit = 'serving'
  if (product.servingSize) {
    const gramMatch = product.servingSize.match(/([\d.]+)\s*g\b/i)
    const mlMatch   = product.servingSize.match(/([\d.]+)\s*ml\b/i)
    if (gramMatch) { servingSize = parseFloat(gramMatch[1]); servingUnit = 'g' }
    else if (mlMatch) { servingSize = parseFloat(mlMatch[1]); servingUnit = 'ml' }
    else {
      const numMatch = product.servingSize.match(/^([\d.]+)/)
      if (numMatch) servingSize = parseFloat(numMatch[1])
    }
  }

  return {
    provider: 'nih_dsld',
    externalId: String(product.id),
    name: product.productName,
    brand: product.brandName ?? undefined,
    barcode: product.upcSku ?? undefined,
    servingSize,
    servingUnit,
    servingsPerContainer: product.servingsPerContainer ?? undefined,
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
      const url = new URL(`${BASE_URL}/products/search`)
      url.searchParams.set('q', query)
      url.searchParams.set('size', String(options?.limit ?? 20))

      const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
      if (!res.ok) return []

      const data = await res.json() as { hits?: { hits?: DsldSearchHit[] } }
      const hits = data.hits?.hits ?? []

      return hits.map(hit => ({
        provider: 'nih_dsld',
        externalId: hit._id,
        name: hit._source.productName,
        brand: hit._source.brandName ?? undefined,
        barcode: hit._source.upcSku ?? undefined,
        servingSize: 1,
        servingUnit: 'serving',
        coreNutrients: { calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
      }))
    } catch {
      return []
    }
  }

  async getById(externalId: string): Promise<ExternalFoodDetail | null> {
    try {
      const res = await fetch(`${BASE_URL}/products/${externalId}`, {
        next: { revalidate: 3600 },
      })
      if (!res.ok) return null
      const product = await res.json() as DsldProduct
      return mapProduct(product)
    } catch {
      return null
    }
  }

  async searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null> {
    try {
      const url = new URL(`${BASE_URL}/products/search`)
      url.searchParams.set('q', barcode)
      url.searchParams.set('size', '1')

      const res = await fetch(url.toString())
      if (!res.ok) return null

      const data = await res.json() as { hits?: { hits?: DsldSearchHit[] } }
      const hit = data.hits?.hits?.[0]
      if (!hit) return null

      // Verify barcode matches before returning
      if (hit._source.upcSku && hit._source.upcSku !== barcode) return null

      return this.getById(hit._id)
    } catch {
      return null
    }
  }
}
