import { NextRequest, NextResponse } from 'next/server'
import { OpenFoodFactsProvider } from '@/lib/nutrition/providers/open-food-facts'
import { UsdaFoodDataProvider } from '@/lib/nutrition/providers/usda-fooddata'
import { prisma } from '@/lib/prisma'
import type { ExternalFoodDetail } from '@/lib/nutrition/providers/types'

const off = new OpenFoodFactsProvider()
const usda = new UsdaFoodDataProvider()

// Rebuild an ExternalFoodDetail from a cached FoodItem row
function foodItemToDetail(item: {
  id: string; name: string; brand: string | null; barcode: string | null
  servingSize: unknown; servingUnit: string
  calories: unknown; proteinG: unknown; carbohydrateG: unknown; fatG: unknown
  nutrientsJson: unknown; sourceProvider: string | null; externalId: string | null
}): ExternalFoodDetail {
  const ext = (item.nutrientsJson ?? {}) as Record<string, number>
  return {
    provider: item.sourceProvider ?? 'library',
    externalId: item.externalId ?? item.id,
    name: item.name,
    brand: item.brand ?? undefined,
    barcode: item.barcode ?? undefined,
    servingSize: Number(item.servingSize),
    servingUnit: item.servingUnit,
    coreNutrients: {
      calories:      Number(item.calories),
      proteinG:      Number(item.proteinG),
      carbohydrateG: Number(item.carbohydrateG),
      fatG:          Number(item.fatG),
    },
    extendedNutrients: Object.keys(ext).length > 0 ? ext : undefined,
  }
}

// Cache a barcode result in FoodItem so future lookups skip the network call
async function cacheResult(result: ExternalFoodDetail) {
  const barcodeKey = result.barcode ?? undefined
  if (!barcodeKey) return
  try {
    const existing = await prisma.foodItem.findFirst({
      where: { barcode: barcodeKey },
    })
    if (existing) {
      await prisma.foodItem.update({
        where: { id: existing.id },
        data: { lastSyncedAt: new Date() },
      })
      return
    }
    await prisma.foodItem.create({
      data: {
        name: result.name,
        brand: result.brand ?? null,
        barcode: barcodeKey,
        sourceCategory: 'external_api',
        sourceProvider: result.provider,
        externalId: result.externalId,
        lastSyncedAt: new Date(),
        visibility: 'community',
        servingSize: result.servingSize,
        servingUnit: result.servingUnit,
        calories: result.coreNutrients.calories,
        proteinG: result.coreNutrients.proteinG,
        carbohydrateG: result.coreNutrients.carbohydrateG,
        fatG: result.coreNutrients.fatG,
        nutrientsJson: result.extendedNutrients ?? undefined,
      },
    })
  } catch { /* non-critical */ }
}

export async function GET(req: NextRequest) {
  const upc = req.nextUrl.searchParams.get('upc')?.trim()
  if (!upc) return NextResponse.json({ error: 'Missing upc' }, { status: 400 })

  // 1. Check local cache — barcode data changes slowly, any cached entry is fine
  try {
    const cached = await prisma.foodItem.findFirst({ where: { barcode: upc } })
    if (cached) {
      return NextResponse.json({ result: foodItemToDetail(cached) })
    }
  } catch { /* DB unavailable — fall through to network */ }

  // 2. OFF is the barcode specialist — try it first
  const offResult = await off.searchByBarcode(upc)
  if (offResult) {
    void cacheResult(offResult)
    return NextResponse.json({ result: offResult })
  }

  // 3. USDA as a fallback (some US branded products are indexed by UPC)
  const usdaResult = await usda.searchByBarcode(upc)
  if (usdaResult) {
    void cacheResult(usdaResult)
    return NextResponse.json({ result: usdaResult })
  }

  // 4. Genuinely not found — tell the client to fall back to manual search
  return NextResponse.json(
    { notFound: true, barcode: upc, message: 'Barcode not found. Try searching by product name.' },
    { status: 404 },
  )
}
