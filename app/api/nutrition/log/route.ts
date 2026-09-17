import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    mealType: string
    logDate: string
    foodName: string
    brand?: string
    barcode?: string
    servingMultiplier: number
    servingSize: number
    servingUnit: string
    calories: number
    proteinG: number
    carbohydrateG: number
    fatG: number
    extendedNutrients?: Record<string, number>
    sourceProvider?: string
    externalId?: string
  }

  // Cache this food in the shared library (community visibility = searchable by all users)
  // Deduplicates on externalId + provider so we don't create duplicates
  let foodItemId: string | undefined

  const existingFood = body.externalId && body.sourceProvider
    ? await prisma.foodItem.findFirst({
        where: { sourceProvider: body.sourceProvider, externalId: body.externalId },
      })
    : null

  if (existingFood) {
    foodItemId = existingFood.id
  } else {
    const newFood = await prisma.foodItem.create({
      data: {
        name: body.foodName,
        brand: body.brand ?? null,
        barcode: body.barcode ?? null,
        sourceCategory: body.sourceProvider ? 'external_api' : 'user_created',
        sourceProvider: body.sourceProvider ?? null,
        externalId: body.externalId ?? null,
        visibility: 'community', // shared with all users immediately
        createdById: user.id,
        servingSize: body.servingSize,
        servingUnit: body.servingUnit,
        calories: body.calories,
        proteinG: body.proteinG,
        carbohydrateG: body.carbohydrateG,
        fatG: body.fatG,
        nutrientsJson: body.extendedNutrients ?? undefined,
      },
    })
    foodItemId = newFood.id
  }

  const entry = await prisma.foodLogEntry.create({
    data: {
      userId: user.id,
      logDate: new Date(body.logDate),
      mealType: body.mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other',
      servingMultiplier: body.servingMultiplier,
      foodItemId,
      snapshotFoodName: body.brand ? `${body.foodName} (${body.brand})` : body.foodName,
      snapshotServingSize: body.servingSize,
      snapshotServingUnit: body.servingUnit,
      snapshotCaloriesPerServing: body.calories,
      snapshotProteinGPerServing: body.proteinG,
      snapshotCarbohydrateGPerServing: body.carbohydrateG,
      snapshotFatGPerServing: body.fatG,
      snapshotNutrientsJson: body.extendedNutrients ?? undefined,
    },
  })

  return NextResponse.json({ entry }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json() as { id: string }
  await prisma.foodLogEntry.deleteMany({ where: { id, userId: user.id } })
  return NextResponse.json({ ok: true })
}
