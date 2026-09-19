import { NextRequest, NextResponse } from 'next/server'
import { FOOD_PROVIDERS } from '@/lib/nutrition/providers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')?.trim()
  if (!query || query.length < 2) return NextResponse.json({ results: [] })

  // Split into individual terms so multi-word queries work across non-adjacent words.
  // e.g. "pure protein bar" finds "Pure Protein 1.76oz Bar Chocolate Deluxe"
  // Each term must appear in the name OR brand.
  const terms = query.split(/\s+/).filter(t => t.length >= 2)
  const termFilters = terms.map(t => ({
    OR: [
      { name: { contains: t, mode: 'insensitive' as const } },
      { brand: { contains: t, mode: 'insensitive' as const } },
    ],
  }))

  // 1. Own food library — community-cached items (from barcode scans + logged foods)
  const cached = await prisma.foodItem.findMany({
    where: {
      AND: termFilters,
      visibility: { in: ['verified', 'community'] },
    },
    orderBy: [{ lastSyncedAt: 'desc' }, { name: 'asc' }],
    take: 20,
  }).catch(() => [])

  const cachedResults = cached.map(f => ({
    provider: f.sourceProvider ?? 'library',
    externalId: f.id,
    name: f.name,
    brand: f.brand ?? undefined,
    barcode: f.barcode ?? undefined,
    servingSize: Number(f.servingSize),
    servingUnit: f.servingUnit,
    coreNutrients: {
      calories:      Number(f.calories),
      proteinG:      Number(f.proteinG),
      carbohydrateG: Number(f.carbohydrateG),
      fatG:          Number(f.fatG),
    },
    extendedNutrients: f.nutrientsJson ? (f.nutrientsJson as Record<string, number | undefined>) : undefined,
    source: 'library' as const,
  }))

  // 2. Fan out to all registered providers in parallel.
  // USDA (index 0) comes first — Foundation/SR Legacy results are ranked highest within USDA.
  const providerResults = (
    await Promise.all(FOOD_PROVIDERS.map(p => p.search(query, { limit: 20 }).catch(() => [])))
  ).flat()

  // 3. Drop results with zero usable nutrition
  const withNutrition = providerResults.filter(r =>
    r.coreNutrients.calories > 0 ||
    r.coreNutrients.proteinG > 0 ||
    r.coreNutrients.carbohydrateG > 0 ||
    r.coreNutrients.fatG > 0
  )

  // 4. Dedupe by name+brand — prefer earlier providers (USDA before OFF)
  const seen = new Set<string>()
  const deduped = withNutrition.filter(r => {
    const key = `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // 5. Skip items already covered by the local cache
  const cachedKeys = new Set(cachedResults.map(r => `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`))
  const external = deduped.filter(r => {
    const key = `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`
    return !cachedKeys.has(key)
  })

  const results = [
    ...cachedResults,
    ...external.map(r => ({ ...r, source: 'external' as const })),
  ]

  return NextResponse.json({ results })
}

// Natural language query — POST form, could be wired to AI later
export async function POST(req: NextRequest) {
  const { query } = await req.json() as { query: string }
  if (!query?.trim()) return NextResponse.json({ results: [] })
  const results = await FOOD_PROVIDERS[0].search(query, { limit: 20 })
  return NextResponse.json({ results })
}
