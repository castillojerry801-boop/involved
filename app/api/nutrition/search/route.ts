import { NextRequest, NextResponse } from 'next/server'
import { FOOD_PROVIDERS } from '@/lib/nutrition/providers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')?.trim()
  if (!query || query.length < 2) return NextResponse.json({ results: [] })

  // 1. Own food library (fastest — community-cached items)
  const cached = await prisma.foodItem.findMany({
    where: {
      name: { contains: query, mode: 'insensitive' },
      visibility: { in: ['verified', 'community'] },
    },
    take: 8,
  })

  const cachedResults = cached.map(f => ({
    provider: f.sourceProvider ?? 'library',
    externalId: f.id,
    name: f.name,
    brand: f.brand ?? undefined,
    servingSize: Number(f.servingSize),
    servingUnit: f.servingUnit,
    coreNutrients: {
      calories: Number(f.calories),
      proteinG: Number(f.proteinG),
      carbohydrateG: Number(f.carbohydrateG),
      fatG: Number(f.fatG),
    },
    source: 'library' as const,
  }))

  // 2. Fan out to all registered providers in parallel
  const externalSearches = FOOD_PROVIDERS.map(p =>
    p.search(query, { limit: 15 }).catch(() => [])
  )
  const providerResults = (await Promise.all(externalSearches)).flat()

  // 3. Dedupe by name+brand — prefer USDA over Open Food Facts for same item
  const seen = new Set<string>()
  const deduped = providerResults.filter(r => {
    const key = `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const results = [
    ...cachedResults,
    ...deduped.map(r => ({ ...r, source: 'external' as const })),
  ]

  return NextResponse.json({ results })
}

// Natural language (for future Nutritionix integration)
export async function POST(req: NextRequest) {
  const { query } = await req.json() as { query: string }
  if (!query?.trim()) return NextResponse.json({ results: [] })
  const results = await FOOD_PROVIDERS[0].search(query, { limit: 20 })
  return NextResponse.json({ results })
}
