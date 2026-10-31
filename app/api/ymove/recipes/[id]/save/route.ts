import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { getRecipe } from '@/lib/ymove/recipes'

type Ctx = { params: Promise<{ id: string }> }

// POST — explicitly save a recipe. Idempotent: saving an already-saved recipe
// is a no-op (upsert with update:{}).
// Snapshot data is fetched server-side from YMove, not trusted from the client body,
// so this also verifies the recipe ID refers to a real YMove recipe.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: ymoveRecipeId } = await params
  if (!ymoveRecipeId || ymoveRecipeId.length > 100) {
    return NextResponse.json({ error: 'Invalid recipe ID' }, { status: 400 })
  }

  const recipe = await getRecipe(ymoveRecipeId)
  if (!recipe) {
    return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
  }

  await prisma.yMoveRecipeSave.upsert({
    where: { userId_ymoveRecipeId: { userId: user.id, ymoveRecipeId } },
    create: {
      userId:          user.id,
      ymoveRecipeId,
      snapshotTitle:    recipe.title,
      snapshotCalories: recipe.calories,
      snapshotProtein:  recipe.protein,
      snapshotCarbs:    recipe.carbs,
      snapshotFat:      recipe.fat,
      snapshotImageUrl: recipe.imageUrl ?? null,
      snapshotMealType: recipe.mealType || null,
      snapshotDietTags: recipe.dietTags,
      snapshotServings: recipe.servings,
      snapshotPrepMin:  recipe.prepTimeMin ?? null,
      snapshotCookMin:  recipe.cookTimeMin ?? null,
    },
    update: {},
  })

  return NextResponse.json({ saved: true })
}

// DELETE — explicitly unsave a recipe. Idempotent: unsaving an already-unsaved
// recipe is a no-op (deleteMany matches zero rows without error).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: ymoveRecipeId } = await params
  if (!ymoveRecipeId || ymoveRecipeId.length > 100) {
    return NextResponse.json({ error: 'Invalid recipe ID' }, { status: 400 })
  }

  await prisma.yMoveRecipeSave.deleteMany({
    where: { userId: user.id, ymoveRecipeId },
  })

  return NextResponse.json({ saved: false })
}
