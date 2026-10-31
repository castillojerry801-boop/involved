import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const saves = await prisma.yMoveRecipeSave.findMany({
    where: { userId: user.id },
    orderBy: { savedAt: 'desc' },
  })

  const savedRecipes = saves.map((s) => ({
    id:          s.ymoveRecipeId,
    title:       s.snapshotTitle,
    description: null,
    calories:    Number(s.snapshotCalories),
    protein:     Number(s.snapshotProtein),
    carbs:       Number(s.snapshotCarbs),
    fat:         Number(s.snapshotFat),
    imageUrl:    s.snapshotImageUrl ?? null,
    mealType:    s.snapshotMealType ?? 'other',
    dietTags:    (s.snapshotDietTags as string[]) ?? [],
    servings:    s.snapshotServings,
    prepTimeMin: s.snapshotPrepMin ?? null,
    cookTimeMin: s.snapshotCookMin ?? null,
    cuisineType: null,
    difficulty:  null,
    slug:        s.ymoveRecipeId,
  }))

  return NextResponse.json({
    savedRecipes,
    savedIds: savedRecipes.map((r) => r.id),
  })
}
