import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

type Params = { params: Promise<{ id: string }> }

async function getProgramForUser(id: string, userId: string) {
  return prisma.program.findFirst({
    where: { id, userId },
    include: {
      days: {
        orderBy: { sortOrder: 'asc' },
        include: {
          exercises: {
            orderBy: { sortOrder: 'asc' },
            include: { sets: { orderBy: { setNumber: 'asc' } } },
          },
        },
      },
    },
  })
}

// ─── GET: program detail ──────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const program = await getProgramForUser(id, user.id)
    if (!program) return Response.json({ error: 'Not found' }, { status: 404 })

    // Hydrate exercise metadata
    const hydrated = {
      ...program,
      days: program.days.map(day => ({
        ...day,
        exercises: day.exercises.map(ex => ({
          ...ex,
          exercise: getExerciseById(ex.exerciseId) ?? null,
        })),
      })),
    }
    return Response.json({ program: hydrated })
  } catch {
    return Response.json({ error: 'Failed to load program' }, { status: 500 })
  }
}

// ─── PATCH: update program metadata or activate ───────────────────────────────

interface PatchProgramBody {
  name?: string
  description?: string
  isActive?: boolean
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as PatchProgramBody

  try {
    const existing = await prisma.program.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    // Activating a program deactivates all others
    if (body.isActive === true) {
      await prisma.program.updateMany({
        where: { userId: user.id, id: { not: id } },
        data: { isActive: false },
      })
    }

    const updated = await prisma.program.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.description !== undefined && { description: body.description.trim() || null }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    })
    return Response.json({ program: updated })
  } catch {
    return Response.json({ error: 'Failed to update program' }, { status: 500 })
  }
}

// ─── DELETE: remove program ───────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const existing = await prisma.program.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.program.delete({ where: { id } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete program' }, { status: 500 })
  }
}
