import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchRecipes } from '@/lib/ymove/recipes'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const q          = sp.get('q')?.trim() || undefined
  const diet       = sp.get('diet')?.trim() || undefined
  const mealType   = sp.get('mealType')?.trim() || undefined
  const minProtein = sp.get('minProtein') ? Number(sp.get('minProtein')) : undefined
  const maxCalories = sp.get('maxCalories') ? Number(sp.get('maxCalories')) : undefined
  const page       = sp.get('page') ? Number(sp.get('page')) : 1

  const { recipes, pagination } = await searchRecipes({
    q, diet, mealType, minProtein, maxCalories, page, limit: 20,
  })

  return NextResponse.json({ recipes, pagination })
}
