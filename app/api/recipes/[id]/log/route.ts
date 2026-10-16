import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { createClient } from '@/lib/supabase/server'
import { canReadRecipe } from '@/lib/recipes/access'
import { computeRecipeNutritionTotals, computeServingNutrition } from '@/lib/recipes/serving-calc'
import type { RecipeStatus, MealType, RecipeLogMode } from '@prisma/client'

const VALID_MEAL_TYPES = new Set<string>(['breakfast', 'lunch', 'dinner', 'snack', 'other'])

// Log a recipe as a food entry for a given date.
// The server ALWAYS recomputes macros from ingredient snapshots so that optional
// ingredient exclusions are authoritative and client-supplied calorie totals are
// never trusted.
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
    // IDs of optional ingredients the user chose to exclude from this log
    excludedIngredientIds?: string[]
    // When completeness is incomplete — caller may confirm and provide manual values
    confirmedEstimate?: boolean
    manualNutrition?: {
      calories: number
      proteinG: number
      carbG: number
      fatG: number
    }
    // Use recipe-level imported macros instead of manual entry
    useImported?: boolean
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

  const excludedIds: string[] = Array.isArray(body.excludedIngredientIds) ? body.excludedIngredientIds : []

  // Idempotency: return existing entry if this key was already used.
  // excludedIngredientIds are embedded in the key by the client so different
  // optional selections don't merge into the same idempotent entry.
  if (body.idempotencyKey) {
    const existing = await prisma.foodLogEntry.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
    })
    if (existing) return NextResponse.json({ entry: existing }, { status: 200 })
  }

  // Fetch recipe with ALL ingredients so the server can recompute macros
  // with the correct optional exclusions.
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      name: true,
      status: true,
      servings: true,
      nutritionComplete: true,
      importedCalPerServing: true,
      importedProteinGPerServing: true,
      importedCarbGPerServing: true,
      importedFatGPerServing: true,
      ingredients: {
        select: {
          id: true,
          name: true,
          quantity: true,
          unit: true,
          isOptional: true,
          isToTaste: true,
          snapshotCalories: true,
          snapshotProteinG: true,
          snapshotCarbG: true,
          snapshotFatG: true,
        },
      },
    },
  })

  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canReadRecipe(recipe.userId, recipe.status as RecipeStatus, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Validate excludedIngredientIds against this recipe's ingredients
  const ingredientMap = new Map(recipe.ingredients.map((i) => [i.id, i]))
  for (const exId of excludedIds) {
    const ing = ingredientMap.get(exId)
    if (!ing) {
      return NextResponse.json({ error: `Invalid ingredient ID: ${exId}` }, { status: 400 })
    }
    if (!ing.isOptional) {
      return NextResponse.json(
        { error: `Cannot exclude required ingredient: ${ing.name}` },
        { status: 400 },
      )
    }
  }

  // Build optionalIncluded: all optional IDs minus the excluded ones
  const excludedSet = new Set(excludedIds)
  const optionalIncluded = new Set(
    recipe.ingredients
      .filter((i) => i.isOptional && !excludedSet.has(i.id))
      .map((i) => i.id),
  )

  // Server-authoritative macro computation
  const ingredients = recipe.ingredients.map((i) => ({
    id: i.id,
    name: i.name,
    quantity: Number(i.quantity),
    unit: i.unit,
    isOptional: i.isOptional,
    isToTaste: i.isToTaste,
    snapshotCalories: i.snapshotCalories != null ? Number(i.snapshotCalories) : null,
    snapshotProteinG: i.snapshotProteinG != null ? Number(i.snapshotProteinG) : null,
    snapshotCarbG: i.snapshotCarbG != null ? Number(i.snapshotCarbG) : null,
    snapshotFatG: i.snapshotFatG != null ? Number(i.snapshotFatG) : null,
  }))

  const totals = computeRecipeNutritionTotals(ingredients, recipe.servings, optionalIncluded)

  // Determine log mode and macro values
  let calPerServing: number
  let proteinGPerServing: number
  let carbGPerServing: number
  let fatGPerServing: number
  let logMode: RecipeLogMode
  let estimateSourceNote: string | null = null

  if (totals.completeness === 'complete') {
    // All required (non-optional, non-to-taste) ingredients are resolved —
    // use the server-computed values directly.
    const serving = computeServingNutrition(totals, 1)
    calPerServing      = serving.calories
    proteinGPerServing = serving.proteinG
    carbGPerServing    = serving.carbG
    fatGPerServing     = serving.fatG
    logMode = 'ingredient_calculated'
  } else if (totals.completeness === 'estimated') {
    // Some optional/to-taste ingredients are unresolved — still log with the
    // partial server-computed estimate; no manual entry required.
    const serving = computeServingNutrition(totals, 1)
    calPerServing      = serving.calories
    proteinGPerServing = serving.proteinG
    carbGPerServing    = serving.carbG
    fatGPerServing     = serving.fatG
    logMode = 'ingredient_calculated'
  } else {
    // completeness === 'incomplete': required ingredients unresolved.
    // Need either confirmedEstimate (manual entry) or useImported.
    if (body.useImported) {
      if (
        recipe.importedCalPerServing == null ||
        recipe.importedProteinGPerServing == null ||
        recipe.importedCarbGPerServing == null ||
        recipe.importedFatGPerServing == null
      ) {
        return NextResponse.json(
          { error: 'No imported nutrition data available for this recipe' },
          { status: 422 },
        )
      }
      calPerServing      = Number(recipe.importedCalPerServing)
      proteinGPerServing = Number(recipe.importedProteinGPerServing)
      carbGPerServing    = Number(recipe.importedCarbGPerServing)
      fatGPerServing     = Number(recipe.importedFatGPerServing)
      logMode = 'user_confirmed_estimate'
      estimateSourceNote = 'imported'
    } else if (body.confirmedEstimate && body.manualNutrition) {
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
      logMode = 'user_confirmed_estimate'
    } else if (!body.confirmedEstimate && body.manualNutrition) {
      // Legacy path: manualNutrition provided without explicit confirmedEstimate flag — accept it
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
      logMode = 'user_confirmed_estimate'
    } else {
      // Incomplete and no manual/imported nutrition provided
      return NextResponse.json(
        {
          error: 'incomplete_nutrition',
          needsConfirmation: true,
          message:
            'This recipe has unresolved ingredients. Provide a manual nutrition estimate or use the imported values to continue logging.',
          unresolvedCount: totals.unresolvedCount,
          unresolvedIngredients: totals.unresolvedNames,
        },
        { status: 422 },
      )
    }
  }

  // Build the optionalIngredientOverrides JSON for the log entry
  const overridesJson = {
    excluded: excludedIds,
    ...(estimateSourceNote ? { source: estimateSourceNote } : {}),
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
        recipeLogMode: logMode,
        optionalIngredientOverrides: overridesJson,
        estimateSourceNote: estimateSourceNote,
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
