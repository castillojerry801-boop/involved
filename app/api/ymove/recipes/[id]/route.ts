import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRecipe } from '@/lib/ymove/recipes'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const recipe = await getRecipe(id)
  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ recipe })
}
