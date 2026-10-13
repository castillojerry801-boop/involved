import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { generateSignedUrl } from '@/lib/recipes/image'
import { computeRecipeNutrition, ingredientNutritionFromFood } from '@/lib/recipes/nutrition'
import {
  canReadRecipe,
  canMutateRecipe,
  isFreelyEditable,
  requiresReviseOnEdit,
  canHardDelete,
} from '@/lib/recipes/access'
import type { RecipeStatus } from '@prisma/client'

// ── helpers ──────────────────────────────────────────────────────────────────

// A snapshot value is valid when it is null (unresolved) OR a finite non-negative number.
// Rejects negative values, NaN, Infinity, and non-numeric types supplied by clients.
function isValidSnapshotValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

const DETAIL_SELECT = {
  id: true,
  userId: true,
  name: true,
  description: true,
  servings: true,
  prepMinutes: true,
  cookMinutes: true,
  status: true,
  storageKey: true,
  cachedCalPerServing: true,
  cachedProteinGPerServing: true,
  cachedCarbGPerServing: true,
  cachedFatGPerServing: true,
  nutritionComplete: true,
  sharingConsent: true,
  creatorName: true,
  rejectionReason: true,
  isAiGenerated: true,
  createdAt: true,
  updatedAt: true,
  ingredients: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      foodItemId: true,
      name: true,
      quantity: true,
      unit: true,
      sortOrder: true,
      notes: true,
      snapshotCalories: true,
      snapshotProteinG: true,
      snapshotCarbG: true,
      snapshotFatG: true,
    },
  },
  steps: {
    orderBy: { sortOrder: 'asc' as const },
    select: { id: true, sortOrder: true, body: true },
  },
  saves: true,
  _count: { select: { saves: true } },
}

function serializeRecipe(r: Awaited<ReturnType<typeof fetchRecipe>>, signedUrl: string | null, userId: string) {
  if (!r) return null
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    description: r.description,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    status: r.status,
    imageUrl: signedUrl,
    cachedCalPerServing: r.cachedCalPerServing ? Number(r.cachedCalPerServing) : null,
    cachedProteinGPerServing: r.cachedProteinGPerServing ? Number(r.cachedProteinGPerServing) : null,
    cachedCarbGPerServing: r.cachedCarbGPerServing ? Number(r.cachedCarbGPerServing) : null,
    cachedFatGPerServing: r.cachedFatGPerServing ? Number(r.cachedFatGPerServing) : null,
    nutritionComplete: r.nutritionComplete,
    sharingConsent: r.sharingConsent,
    creatorName: r.creatorName,
    rejectionReason: r.status === 'rejected' ? r.rejectionReason : null,
    isAiGenerated: r.isAiGenerated,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    savedByMe: r.saves.some((s) => s.userId === userId),
    saveCount: r._count.saves,
    ingredients: r.ingredients.map((i) => ({
      ...i,
      quantity: Number(i.quantity),
      snapshotCalories: i.snapshotCalories ? Number(i.snapshotCalories) : null,
      snapshotProteinG: i.snapshotProteinG ? Number(i.snapshotProteinG) : null,
      snapshotCarbG: i.snapshotCarbG ? Number(i.snapshotCarbG) : null,
      snapshotFatG: i.snapshotFatG ? Number(i.snapshotFatG) : null,
    })),
    steps: r.steps,
  }
}

async function fetchRecipe(id: string) {
  return prisma.recipe.findUnique({ where: { id }, select: DETAIL_SELECT })
}

// ── GET /api/recipes/[id] ─────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const recipe = await fetchRecipe(id)
  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!canReadRecipe(recipe.userId, recipe.status as RecipeStatus, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const signedUrl = recipe.storageKey ? await generateSignedUrl(recipe.storageKey) : null
  return NextResponse.json({ recipe: serializeRecipe(recipe, signedUrl, user.id) })
}

// ── PATCH /api/recipes/[id] ───────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: { ingredients: true },
  })
  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canMutateRecipe(recipe.userId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    name?: string
    description?: string
    servings?: number
    prepMinutes?: number
    cookMinutes?: number
    // Ingredients replace all existing ingredients when provided
    ingredients?: Array<{
      id?: string
      foodItemId?: string | null
      name: string
      quantity: number
      unit: string
      sortOrder?: number
      notes?: string | null
      snapshotCalories?: number | null
      snapshotProteinG?: number | null
      snapshotCarbG?: number | null
      snapshotFatG?: number | null
    }>
    steps?: Array<{
      id?: string
      sortOrder?: number
      body: string
    }>
    // Required to edit a published recipe — moves it back to pending
    revise?: boolean
  }

  const status = recipe.status as RecipeStatus
  if (requiresReviseOnEdit(status) && !body.revise) {
    return NextResponse.json(
      {
        error: 'published_recipe',
        message:
          status === 'published'
            ? 'This recipe is published. Editing it will submit it for re-review and temporarily remove it from Discover.'
            : 'This recipe is pending review. Editing it will move it back to draft.',
      },
      { status: 409 },
    )
  }

  if (recipe.status === 'archived') {
    return NextResponse.json({ error: 'Archived recipes cannot be edited' }, { status: 403 })
  }

  if (body.ingredients !== undefined) {
    const badSnapshot = body.ingredients.some(
      (ing) =>
        !isValidSnapshotValue(ing.snapshotCalories) ||
        !isValidSnapshotValue(ing.snapshotProteinG) ||
        !isValidSnapshotValue(ing.snapshotCarbG) ||
        !isValidSnapshotValue(ing.snapshotFatG),
    )
    if (badSnapshot) {
      return NextResponse.json({ error: 'Invalid ingredient nutrition values' }, { status: 400 })
    }
  }

  // Pre-fetch library FoodItems so the server can recompute authoritative snapshots.
  // For library ingredients (foodItemId set), client-supplied snapshot values are ignored
  // and replaced with values derived from the actual DB food data + quantity/unit.
  // For external ingredients (foodItemId null), client-supplied snapshots are used as-is.
  type ComputedIngredient = {
    recipeId: string
    foodItemId: string | null
    name: string
    quantity: number
    unit: string
    sortOrder: number
    notes: string | null
    snapshotCalories: number | null
    snapshotProteinG: number | null
    snapshotCarbG: number | null
    snapshotFatG: number | null
  }

  let ingredientData: ComputedIngredient[] | null = null
  if (body.ingredients !== undefined) {
    const libraryIds = [
      ...new Set(
        body.ingredients
          .filter((i) => i.foodItemId != null)
          .map((i) => i.foodItemId as string),
      ),
    ]

    const foodMap = new Map<string, {
      calories: import('@prisma/client/runtime/library').Decimal
      proteinG: import('@prisma/client/runtime/library').Decimal
      carbohydrateG: import('@prisma/client/runtime/library').Decimal
      fatG: import('@prisma/client/runtime/library').Decimal
      servingSize: import('@prisma/client/runtime/library').Decimal
      servingUnit: string
    }>()

    if (libraryIds.length > 0) {
      const foods = await prisma.foodItem.findMany({
        where: { id: { in: libraryIds } },
        select: { id: true, calories: true, proteinG: true, carbohydrateG: true, fatG: true, servingSize: true, servingUnit: true },
      })
      for (const f of foods) foodMap.set(f.id, f)
    }

    ingredientData = body.ingredients.map((ing, idx) => {
      let foodItemId = ing.foodItemId ?? null
      let snapshotCalories: number | null = null
      let snapshotProteinG: number | null = null
      let snapshotCarbG: number | null = null
      let snapshotFatG: number | null = null

      if (foodItemId && foodMap.has(foodItemId)) {
        // Library item: recompute from DB, ignoring what the client sent.
        const food = foodMap.get(foodItemId)!
        const computed = ingredientNutritionFromFood(food, ing.quantity, ing.unit)
        if (computed) {
          snapshotCalories = computed.calories
          snapshotProteinG = computed.proteinG
          snapshotCarbG    = computed.carbG
          snapshotFatG     = computed.fatG
        }
        // Unit incompatible with food's serving unit → snapshots stay null (unresolved).
      } else if (foodItemId) {
        // foodItemId was provided but the food is no longer in the DB — clear the stale link.
        foodItemId = null
      } else {
        // External provider item: use validated client-supplied snapshot values.
        snapshotCalories = ing.snapshotCalories ?? null
        snapshotProteinG = ing.snapshotProteinG ?? null
        snapshotCarbG    = ing.snapshotCarbG    ?? null
        snapshotFatG     = ing.snapshotFatG     ?? null
      }

      return {
        recipeId: id,
        foodItemId,
        name: ing.name.trim(),
        quantity: ing.quantity,
        unit: ing.unit.trim(),
        sortOrder: ing.sortOrder ?? idx,
        notes: ing.notes ?? null,
        snapshotCalories,
        snapshotProteinG,
        snapshotCarbG,
        snapshotFatG,
      }
    })
  }

  const newStatus: RecipeStatus = requiresReviseOnEdit(status)
    ? status === 'published' ? 'pending' : 'draft'
    : status

  await prisma.$transaction(async (tx) => {
    await tx.recipe.update({
      where: { id },
      data: {
        name: body.name?.trim() ?? undefined,
        description: body.description !== undefined ? (body.description?.trim() ?? null) : undefined,
        servings: body.servings ?? undefined,
        prepMinutes: body.prepMinutes !== undefined ? body.prepMinutes : undefined,
        cookMinutes: body.cookMinutes !== undefined ? body.cookMinutes : undefined,
        status: newStatus,
        // Clear review metadata when moving back to draft/pending
        ...(requiresReviseOnEdit(status) && status === 'pending' ? { submittedAt: null } : {}),
      },
    })

    if (ingredientData !== null) {
      await tx.recipeIngredient.deleteMany({ where: { recipeId: id } })
      if (ingredientData.length > 0) {
        await tx.recipeIngredient.createMany({ data: ingredientData })
      }

      // Recompute cached nutrition using server-authoritative snapshot values.
      const nutrition = computeRecipeNutrition(
        ingredientData.map((d) => ({
          foodItemId: d.foodItemId,
          quantity: d.quantity as unknown as import('@prisma/client/runtime/library').Decimal,
          unit: d.unit,
          snapshotCalories: d.snapshotCalories != null ? (d.snapshotCalories as unknown as import('@prisma/client/runtime/library').Decimal) : null,
          snapshotProteinG: d.snapshotProteinG != null ? (d.snapshotProteinG as unknown as import('@prisma/client/runtime/library').Decimal) : null,
          snapshotCarbG:    d.snapshotCarbG    != null ? (d.snapshotCarbG    as unknown as import('@prisma/client/runtime/library').Decimal) : null,
          snapshotFatG:     d.snapshotFatG     != null ? (d.snapshotFatG     as unknown as import('@prisma/client/runtime/library').Decimal) : null,
        })),
        body.servings ?? recipe.servings,
      )
      await tx.recipe.update({
        where: { id },
        data: {
          nutritionComplete: nutrition.complete,
          cachedCalPerServing: nutrition.calPerServing,
          cachedProteinGPerServing: nutrition.proteinGPerServing,
          cachedCarbGPerServing: nutrition.carbGPerServing,
          cachedFatGPerServing: nutrition.fatGPerServing,
        },
      })
    }

    if (body.steps !== undefined) {
      await tx.recipeStep.deleteMany({ where: { recipeId: id } })
      if (body.steps.length > 0) {
        await tx.recipeStep.createMany({
          data: body.steps.map((step, idx) => ({
            recipeId: id,
            sortOrder: step.sortOrder ?? idx,
            body: step.body.trim(),
          })),
        })
      }
    }
  })

  const updated = await fetchRecipe(id)
  const signedUrl = updated?.storageKey ? await generateSignedUrl(updated.storageKey) : null
  return NextResponse.json({ recipe: serializeRecipe(updated!, signedUrl, user.id) })
}

// ── DELETE /api/recipes/[id] ──────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const recipe = await prisma.recipe.findUnique({ where: { id } })
  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canMutateRecipe(recipe.userId, user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!canHardDelete(recipe.status as RecipeStatus)) {
    return NextResponse.json(
      { error: 'Published recipes cannot be deleted. Contact support to remove a published recipe.' },
      { status: 403 },
    )
  }

  await prisma.recipe.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
