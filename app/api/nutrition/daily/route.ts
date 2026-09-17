import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dateParam = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const logDate = new Date(dateParam)

  const [entries, target] = await Promise.all([
    prisma.foodLogEntry.findMany({
      where: { userId: user.id, logDate },
      orderBy: { loggedAt: 'asc' },
    }),
    prisma.nutritionTarget.findFirst({
      where: { userId: user.id, effectiveDate: { lte: logDate } },
      orderBy: { effectiveDate: 'desc' },
    }),
  ])

  // Compute totals from snapshots × serving multiplier
  const totals = entries.reduce(
    (acc, e) => {
      const m = Number(e.servingMultiplier)
      acc.calories += Number(e.snapshotCaloriesPerServing) * m
      acc.proteinG += Number(e.snapshotProteinGPerServing) * m
      acc.carbohydrateG += Number(e.snapshotCarbohydrateGPerServing) * m
      acc.fatG += Number(e.snapshotFatGPerServing) * m
      return acc
    },
    { calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
  )

  return NextResponse.json({
    entries: entries.map(e => ({
      id: e.id,
      mealType: e.mealType,
      loggedAt: e.loggedAt,
      servingMultiplier: Number(e.servingMultiplier),
      foodName: e.snapshotFoodName,
      servingSize: Number(e.snapshotServingSize),
      servingUnit: e.snapshotServingUnit,
      calories: Math.round(Number(e.snapshotCaloriesPerServing) * Number(e.servingMultiplier)),
      proteinG: Math.round(Number(e.snapshotProteinGPerServing) * Number(e.servingMultiplier) * 10) / 10,
      carbohydrateG: Math.round(Number(e.snapshotCarbohydrateGPerServing) * Number(e.servingMultiplier) * 10) / 10,
      fatG: Math.round(Number(e.snapshotFatGPerServing) * Number(e.servingMultiplier) * 10) / 10,
    })),
    totals: {
      calories: Math.round(totals.calories),
      proteinG: Math.round(totals.proteinG * 10) / 10,
      carbohydrateG: Math.round(totals.carbohydrateG * 10) / 10,
      fatG: Math.round(totals.fatG * 10) / 10,
    },
    target: target
      ? {
          calories: Number(target.calories),
          proteinG: Number(target.proteinG),
          carbohydrateG: Number(target.carbohydrateG),
          fatG: Number(target.fatG),
        }
      : { calories: 2000, proteinG: 150, carbohydrateG: 250, fatG: 65 },
  })
}
