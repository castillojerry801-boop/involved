import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { createClient } from '@/lib/supabase/server'
import { canReadRecipe } from '@/lib/recipes/access'
import type { RecipeStatus, MealType } from '@prisma/client'

const VALID_MEAL_TYPES = new Set<string>(['breakfast', 'lunch', 'dinner', 'snack', 'other'])

// Log a recipe as a food entry for a given date.
// If the recipe has incomplete nutrition, a manual estimate is required.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as {
    mealType: MealType
    logDate: string
    servingMultiplier: number
    idempotencyKey?: string
    // Required when recipe.nutritionComplete is false
    manualNutrition?: {
      calories: number
      proteinG: number
      carbG: number
      fatG: number
    }
  }

  if (!body.logDate || !body.mealType || !body.servingMultiplier || body.servingMultiplier <= 0) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  if (!VALID_MEAL_TYPES.has(body.mealType)) {
    return NextResponse.json(
      { error: `Invalid mealType "${body.mealType}". Must be one of: breakfast, lunch, dinner, snack, other` },
      { status: 400 },
    )
  }

  // Idempotency: return existing entry if this key was already used
  if (body.idempotencyKey) {
    const existing = await prisma.foodLogEntry.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
    })
    if (existing) return NextResponse.json({ entry: existing }, { status: 200 })
  }

  const recipe = await prisma.recipe.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      name: true,
      status: true,
      servings: true,
      nutritionComplete: true,
      cachedCalPerServing: true,
      cachedProteinGPerServing: true,
      cachedCarbGPerServing: true,
      cachedFatGPerServing: true,
      // Count ingredients that are unresolved: no food item match OR missing any macro snapshot
      ingredients: {
        where: {
          OR: [
            { foodItemId: null },
            { snapshotCalories: null },
            { snapshotProteinG: null },
            { snapshotCarbG: null },
            { snapshotFatG: null },
          ],
        },
        select: { id: true },
      },
    },
  })

  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canReadRecipe(recipe.userId, recipe.status as RecipeStatus, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Determine nutrition values to snapshot
  let calPerServing: number
  let proteinGPerServing: number
  let carbGPerServing: number
  let fatGPerServing: number

  if (recipe.nutritionComplete) {
    calPerServing     = Number(recipe.cachedCalPerServing!)
    proteinGPerServing = Number(recipe.cachedProteinGPerServing!)
    carbGPerServing    = Number(recipe.cachedCarbGPerServing!)
    fatGPerServing     = Number(recipe.cachedFatGPerServing!)
  } else {
    if (!body.manualNutrition) {
      return NextResponse.json(
        {
          error: 'incomplete_nutrition',
          message:
            'This recipe has unresolved ingredients. Provide a manual nutrition estimate to continue logging.',
          unresolvedCount: recipe.ingredients.length,
        },
        { status: 422 },
      )
    }
    const m = body.manualNutrition
    if (
      typeof m.calories !== 'number' || m.calories < 0 ||
      typeof m.proteinG !== 'number' || m.proteinG < 0 ||
      typeof m.carbG !== 'number' || m.carbG < 0 ||
      typeof m.fatG !== 'number' || m.fatG < 0
    ) {
      return NextResponse.json({ error: 'Invalid manual nutrition values' }, { status: 400 })
    }
    calPerServing      = m.calories
    proteinGPerServing = m.proteinG
    carbGPerServing    = m.carbG
    fatGPerServing     = m.fatG
  }

  try {
    const entry = await prisma.foodLogEntry.create({
      data: {
        userId: user.id,
        recipeId: id,
        logDate: new Date(body.logDate),
        mealType: body.mealType,
        servingMultiplier: body.servingMultiplier,
        idempotencyKey: body.idempotencyKey ?? null,
        snapshotFoodName: recipe.name,
        snapshotServingSize: 1,
        snapshotServingUnit: 'serving',
        snapshotCaloriesPerServing: calPerServing,
        snapshotProteinGPerServing: proteinGPerServing,
        snapshotCarbohydrateGPerServing: carbGPerServing,
        snapshotFatGPerServing: fatGPerServing,
      },
    })
    return NextResponse.json({ entry }, { status: 201 })
  } catch (err) {
    // Unique constraint violation on idempotency_key: two simultaneous requests with the same key.
    // The DB constraint is the authoritative guard — return the entry the winning request created.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      body.idempotencyKey
    ) {
      const existing = await prisma.foodLogEntry.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
      })
      if (existing) return NextResponse.json({ entry: existing }, { status: 200 })
    }
    throw err
  }
}
