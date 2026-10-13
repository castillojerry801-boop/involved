import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { generateSignedUrls } from '@/lib/recipes/image'
import type { Prisma, RecipeStatus } from '@prisma/client'

const PAGE_SIZE = 20

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const view = searchParams.get('view') ?? 'discover'
  const cursor = searchParams.get('cursor') ?? undefined

  let where: Prisma.RecipeWhereInput

  if (view === 'discover') {
    where = { status: 'published' }
  } else if (view === 'saved') {
    where = { status: 'published', saves: { some: { userId: user.id } } }
  } else {
    // mine — all statuses except archived
    where = { userId: user.id, status: { not: 'archived' as RecipeStatus } }
  }

  const recipes = await prisma.recipe.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
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
      creatorName: true,
      userId: true,
      createdAt: true,
      saves: {
        where: { userId: user.id },
        select: { id: true },
      },
      _count: { select: { ingredients: true, saves: true } },
    },
  })

  const hasMore = recipes.length > PAGE_SIZE
  const page = recipes.slice(0, PAGE_SIZE)

  // Generate signed URLs for all recipes with images in one batched call
  const keysWithImages = page
    .filter((r) => r.storageKey)
    .map((r) => r.storageKey!)
  const signedUrls = await generateSignedUrls(keysWithImages)

  const items = page.map((r) => ({
    ...r,
    imageUrl: r.storageKey ? (signedUrls[r.storageKey] ?? null) : null,
    storageKey: undefined, // never expose raw storage key to clients
    savedByMe: r.saves.length > 0,
    saves: undefined,
    cachedCalPerServing: r.cachedCalPerServing ? Number(r.cachedCalPerServing) : null,
    cachedProteinGPerServing: r.cachedProteinGPerServing ? Number(r.cachedProteinGPerServing) : null,
    cachedCarbGPerServing: r.cachedCarbGPerServing ? Number(r.cachedCarbGPerServing) : null,
    cachedFatGPerServing: r.cachedFatGPerServing ? Number(r.cachedFatGPerServing) : null,
  }))

  return NextResponse.json({
    items,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    name: string
    description?: string
    servings?: number
    prepMinutes?: number
    cookMinutes?: number
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const recipe = await prisma.recipe.create({
    data: {
      userId: user.id,
      name: body.name.trim(),
      description: body.description?.trim() ?? null,
      servings: body.servings ?? 1,
      prepMinutes: body.prepMinutes ?? null,
      cookMinutes: body.cookMinutes ?? null,
      status: 'draft',
    },
  })

  return NextResponse.json({ recipe }, { status: 201 })
}
