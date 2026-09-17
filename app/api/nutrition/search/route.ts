import { NextRequest, NextResponse } from 'next/server'
import { FOOD_PROVIDERS } from '@/lib/nutrition/providers'

const openFoodFacts = FOOD_PROVIDERS[0]
import { prisma } from '@/lib/prisma'

// Search our own food library first, then fall back to Open Food Facts
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')?.trim()
  if (!query || query.length < 2) return NextResponse.json({ results: [] })

  // 1. Check our cached food library
  const cached = await prisma.foodItem.findMany({
    where: {
      name: { contains: query, mode: 'insensitive' },
      visibility: { in: ['verified', 'community'] },
    },
    take: 10,
  })

  const cachedResults = cached.map(f => ({
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
    extendedNutrients: f.nutrientsJson as Record<string, number> | undefined,
    source: 'library' as const,
  }))

  // 2. Pull from Open Food Facts to fill remaining slots
  const externalResults = await openFoodFacts.search(query, { limit: 20 - cachedResults.length })

  const results = [
    ...cachedResults,
    ...externalResults.map(r => ({ ...r, source: 'external' as const })),
  ]

  return NextResponse.json({ results })
}

// Natural language (for future Nutritionix integration)
export async function POST(req: NextRequest) {
  const { query } = await req.json() as { query: string }
  if (!query?.trim()) return NextResponse.json({ results: [] })
  // Falls back to regular search until Nutritionix is enabled
  const results = await openFoodFacts.search(query, { limit: 20 })
  return NextResponse.json({ results })
}
