import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

type Params = { params: Promise<{ id: string }> }

// ─── GET: template detail ─────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const template = await prisma.workoutTemplate.findFirst({
      where: { id, userId: user.id },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })
    if (!template) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({
      template: {
        ...template,
        exercises: template.exercises.map(ex => ({
          ...ex,
          exercise: getExerciseById(ex.exerciseId) ?? null,
        })),
      },
    })
  } catch {
    return Response.json({ error: 'Failed to load template' }, { status: 500 })
  }
}

// ─── PATCH: update template ───────────────────────────────────────────────────

interface PatchTemplateBody {
  name?: string
  description?: string
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as PatchTemplateBody

  try {
    const existing = await prisma.workoutTemplate.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    const updated = await prisma.workoutTemplate.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.description !== undefined && { description: body.description.trim() || null }),
      },
    })
    return Response.json({ template: updated })
  } catch {
    return Response.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const existing = await prisma.workoutTemplate.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.workoutTemplate.delete({ where: { id } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
