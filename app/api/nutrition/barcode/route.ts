import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FatSecretProvider } from '@/lib/nutrition/providers/fatsecret'
import { OpenFoodFactsProvider } from '@/lib/nutrition/providers/open-food-facts'
import { UsdaFoodDataProvider } from '@/lib/nutrition/providers/usda-fooddata'
import { prisma } from '@/lib/prisma'
import type { ExternalFoodDetail } from '@/lib/nutrition/providers/types'

const fatsecret = new FatSecretProvider()
const off = new OpenFoodFactsProvider()
const usda = new UsdaFoodDataProvider()

// EAN-13 (13-digit) ↔ UPC-A (12-digit) normalization.
// Scanners often return EAN-13 for products stored as UPC-A (and vice versa).
// A leading zero bridges them: "0" + UPC-A = EAN-13, EAN-13 without "0" = UPC-A.
function barcodeVariants(barcode: string): string[] {
  const clean = barcode.replace(/\s/g, '').replace(/^0+(?=\d{12}$)/, '')
  const variants = new Set<string>([barcode, clean])
  if (clean.length === 12) variants.add('0' + clean)      // UPC-A → EAN-13
  if (clean.length === 13 && clean.startsWith('0')) variants.add(clean.slice(1))  // EAN-13 → UPC-A
  return [...variants].filter(v => v.length >= 8)
}

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
    const existing = await prisma.foodItem.findFirst({ where: { barcode: barcodeKey } })
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const upc = req.nextUrl.searchParams.get('upc')?.trim()
  if (!upc) return NextResponse.json({ error: 'Missing upc' }, { status: 400 })

  const variants = barcodeVariants(upc)

  if (process.env.NODE_ENV === 'development') {
    console.log(`[nutrition/barcode] upc="${upc}" variants=[${variants.join(', ')}]`)
  }

  // 1. Check local cache for any barcode variant
  try {
    const cached = await prisma.foodItem.findFirst({
      where: { barcode: { in: variants } },
    })
    if (cached) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`  → cache hit (${cached.sourceProvider ?? 'library'})`)
      }
      return NextResponse.json({ result: foodItemToDetail(cached) })
    }
  } catch { /* DB unavailable — fall through to network */ }

  // 2. Fan out to all three barcode providers concurrently for every barcode variant.
  //    FatSecret has the broadest consumer barcode coverage; OFF is the barcode specialist;
  //    USDA covers US branded products with UPC. First non-null result wins.
  const lookups = variants.flatMap(bc => [
    fatsecret.searchByBarcode(bc).catch(() => null),
    off.searchByBarcode(bc).catch(() => null),
    usda.searchByBarcode(bc).catch(() => null),
  ])
  const allResults = await Promise.all(lookups)
  const result = allResults.find(r => r != null) ?? null

  if (result) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`  → found via ${result.provider}: "${result.name}"`)
    }
    // Ensure the matched barcode is recorded (use the original scanner value)
    if (!result.barcode) result.barcode = upc
    void cacheResult(result)
    return NextResponse.json({ result })
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('  → not found in any provider')
  }

  // 3. Genuinely not found — return the original barcode so the client can offer fallbacks
  return NextResponse.json(
    { notFound: true, barcode: upc, message: 'Barcode not found. Try searching by product name.' },
    { status: 404 },
  )
}
