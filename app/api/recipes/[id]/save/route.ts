import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// Toggle save/unsave a published recipe.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const recipe = await prisma.recipe.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (recipe.status !== 'published') {
    return NextResponse.json({ error: 'Only published recipes can be saved' }, { status: 409 })
  }

  const existing = await prisma.recipeSave.findUnique({
    where: { userId_recipeId: { userId: user.id, recipeId: id } },
  })

  if (existing) {
    await prisma.recipeSave.delete({ where: { id: existing.id } })
    return NextResponse.json({ saved: false })
  } else {
    await prisma.recipeSave.create({ data: { userId: user.id, recipeId: id } })
    return NextResponse.json({ saved: true })
  }
}
