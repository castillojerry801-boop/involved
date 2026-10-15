import { prisma } from '@/lib/prisma'
import type { PortionSourceConfidence } from '@prisma/client'
import { normalizeUnit } from './units'

export interface StoredPortion {
  id: string
  portionDescription: string
  quantity: number
  unit: string
  gramWeight: number
  fdcPortionId: number | null
  sourceConfidence: PortionSourceConfidence
  preparationState: string | null
}

// Size adjectives that should NOT be treated as preparation states.
const SIZE_ADJECTIVES = new Set(['large', 'medium', 'small', 'extra large', 'xl', 'lg', 'sm', 'med'])

const BASE_URL = 'https://api.nal.usda.gov/fdc/v1'
const FETCH_TIMEOUT_MS = 5000

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

interface UsdaFoodPortion {
  id: number
  portionDescription: string
  gramWeight: number
  modifier?: string
  measureUnit?: {
    id: number
    name: string
    abbreviation?: string
  }
}

interface UsdaFoodResponse {
  foodPortions?: UsdaFoodPortion[]
}

// Parse the leading number from a portion description like "1 cup" or "0.5 tbsp".
// Defaults to 1 if no number found.
function parseQuantityFromDescription(desc: string): number {
  const match = desc.match(/^(\d+(?:\.\d+)?(?:\/\d+)?)/)
  if (!match) return 1
  // Handle simple fractions like "1/2"
  if (match[1].includes('/')) {
    const parts = match[1].split('/')
    const num = parseFloat(parts[0])
    const den = parseFloat(parts[1])
    if (den !== 0) return num / den
  }
  return parseFloat(match[1])
}

// Fetch and store USDA portions for a food item.
// Only fires if:
//   - food.sourceProvider === 'usda_fooddata'
//   - food.externalId exists and is numeric
//   - food.fdcDataType is 'Foundation' or 'SR Legacy' (these have reliable portions)
//   - No portions exist yet in DB for this food
// Stores in food_item_portions with sourceConfidence = 'usda_measured'.
// Returns the stored portions, or [] if not applicable.
export async function fetchAndStoreUsdaPortions(
  foodItemId: string,
  fdcId: string,
  fdcDataType: string | null,
): Promise<StoredPortion[]> {
  // Only fetch for Foundation and SR Legacy — Branded and Survey data types lack reliable portions
  if (!fdcDataType || (fdcDataType !== 'Foundation' && fdcDataType !== 'SR Legacy')) {
    return []
  }

  // fdcId must be numeric
  if (!fdcId || !/^\d+$/.test(fdcId.trim())) {
    return []
  }

  // Check if portions already exist for this food
  const existing = await prisma.foodItemPortion.findFirst({
    where: { foodItemId },
  })
  if (existing) {
    // Portions already exist — return them all
    const all = await prisma.foodItemPortion.findMany({ where: { foodItemId } })
    return all.map(mapDbPortion)
  }

  const apiKey = process.env.USDA_API_KEY ?? ''
  if (!apiKey) return []

  try {
    const url = `${BASE_URL}/food/${fdcId.trim()}?api_key=${apiKey}`
    const res = await fetchWithTimeout(url)
    if (!res.ok) {
      console.error(`[portions] USDA fetch failed: HTTP ${res.status} for fdcId ${fdcId}`)
      return []
    }

    const data = await res.json() as UsdaFoodResponse
    const rawPortions = data.foodPortions ?? []

    // Filter out invalid portions
    const validPortions = rawPortions.filter((p) => p.gramWeight > 0)
    if (validPortions.length === 0) return []

    // Map to DB insert shape
    const toInsert = validPortions.map((p) => {
      const unitName = p.measureUnit?.name ?? ''
      const normalizedUnit = normalizeUnit(unitName)
      const quantity = parseQuantityFromDescription(p.portionDescription)
      const modifier = p.modifier?.trim().toLowerCase()
      const preparationState =
        modifier && modifier.length > 0 && !SIZE_ADJECTIVES.has(modifier) ? modifier : null

      return {
        foodItemId,
        portionDescription: p.portionDescription,
        quantity,
        unit: normalizedUnit,
        gramWeight: p.gramWeight,
        fdcPortionId: p.id,
        sourceConfidence: 'usda_measured' as PortionSourceConfidence,
        preparationState,
      }
    })

    // Store portions, skipping any with a duplicate fdcPortionId
    const created: StoredPortion[] = []
    for (const item of toInsert) {
      // Check for existing portion with same fdcPortionId (idempotent on retry)
      if (item.fdcPortionId != null) {
        const existing = await prisma.foodItemPortion.findFirst({
          where: { foodItemId, fdcPortionId: item.fdcPortionId },
        })
        if (existing) {
          created.push(mapDbPortion(existing))
          continue
        }
      }
      const stored = await prisma.foodItemPortion.create({ data: item })
      created.push(mapDbPortion(stored))
    }

    return created
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[portions] fetchAndStoreUsdaPortions error: ${msg}`)
    return []
  }
}

// Look up FoodItemPortion records for a food by unit, optionally filtered by preparationState.
// Returns all matching portions sorted by best match.
export async function lookupPortions(
  foodItemId: string,
  unit: string,
  preparationState?: string,
): Promise<StoredPortion[]> {
  const normalizedUnit = normalizeUnit(unit)

  const portions = await prisma.foodItemPortion.findMany({
    where: {
      foodItemId,
      unit: normalizedUnit,
      ...(preparationState ? { preparationState } : {}),
    },
  })

  // Sort: usda_measured first, then manufacturer_declared, others after
  portions.sort((a, b) => {
    const order: Record<string, number> = {
      usda_measured: 0,
      manufacturer_declared: 1,
      density_derived: 2,
      reference_table: 3,
    }
    return (order[a.sourceConfidence] ?? 99) - (order[b.sourceConfidence] ?? 99)
  })

  return portions.map(mapDbPortion)
}

function mapDbPortion(p: {
  id: string
  portionDescription: string
  quantity: unknown
  unit: string
  gramWeight: unknown
  fdcPortionId: number | null
  sourceConfidence: PortionSourceConfidence
  preparationState: string | null
}): StoredPortion {
  return {
    id: p.id,
    portionDescription: p.portionDescription,
    quantity: Number(p.quantity),
    unit: p.unit,
    gramWeight: Number(p.gramWeight),
    fdcPortionId: p.fdcPortionId,
    sourceConfidence: p.sourceConfidence,
    preparationState: p.preparationState,
  }
}
