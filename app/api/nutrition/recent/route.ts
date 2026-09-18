import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

// Returns the last 20 distinct foods the user has logged, for quick re-add.
// Deduped by (snapshotFoodName, sourceProvider) — most recent log wins.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const recent = await prisma.foodLogEntry.findMany({
    where: { userId: user.id },
    orderBy: { loggedAt: 'desc' },
    take: 200,
    select: {
      snapshotFoodName: true,
      snapshotServingSize: true,
      snapshotServingUnit: true,
      snapshotCaloriesPerServing: true,
      snapshotProteinGPerServing: true,
      snapshotCarbohydrateGPerServing: true,
      snapshotFatGPerServing: true,
      foodItem: {
        select: {
          id: true,
          brand: true,
          sourceProvider: true,
          externalId: true,
        },
      },
    },
  })

  // Dedup by food name — keep first (most recent) occurrence
  const seen = new Set<string>()
  const deduped = recent.filter(e => {
    const key = e.snapshotFoodName.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 20)

  return Response.json({
    foods: deduped.map(e => ({
      externalId: e.foodItem?.externalId ?? e.snapshotFoodName,
      provider: e.foodItem?.sourceProvider ?? 'library',
      name: e.snapshotFoodName,
      brand: e.foodItem?.brand ?? undefined,
      servingSize: Number(e.snapshotServingSize),
      servingUnit: e.snapshotServingUnit,
      coreNutrients: {
        calories: Number(e.snapshotCaloriesPerServing),
        proteinG: Number(e.snapshotProteinGPerServing),
        carbohydrateG: Number(e.snapshotCarbohydrateGPerServing),
        fatG: Number(e.snapshotFatGPerServing),
      },
    })),
  })
}
