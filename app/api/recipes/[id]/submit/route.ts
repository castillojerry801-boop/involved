import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import type { RecipeStatus } from '@prisma/client'

const SUBMITTABLE: RecipeStatus[] = ['draft', 'private', 'rejected']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as { sharingConsent?: boolean }

  if (!body.sharingConsent) {
    return NextResponse.json(
      { error: 'sharingConsent must be true to submit a recipe for community review' },
      { status: 400 },
    )
  }

  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: { profile: { select: { displayName: true, username: true } } },
  })
  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (recipe.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!SUBMITTABLE.includes(recipe.status as RecipeStatus)) {
    return NextResponse.json(
      { error: `Cannot submit a recipe with status "${recipe.status}"` },
      { status: 409 },
    )
  }
  if (!recipe.name?.trim()) {
    return NextResponse.json({ error: 'Recipe must have a name before submitting' }, { status: 400 })
  }

  const creatorName =
    recipe.profile.displayName ?? recipe.profile.username ?? 'Involved User'

  const updated = await prisma.recipe.update({
    where: { id },
    data: {
      status: 'pending',
      sharingConsent: true,
      sharingConsentAt: new Date(),
      submittedAt: new Date(),
      creatorName,
    },
  })

  return NextResponse.json({ recipe: updated })
}
