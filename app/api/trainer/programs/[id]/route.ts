import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const program = await prisma.trainerProgram.findUnique({
    where: { id },
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
      _count: { select: { assignments: true } },
    },
  })

  if (!program || program.trainerId !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Resolve exercise names from the library
  const enriched = {
    ...program,
    days: program.days.map(day => ({
      ...day,
      exercises: day.exercises.map(ex => ({
        ...ex,
        exerciseName: getExerciseById(ex.exerciseId)?.name ?? null,
      })),
    })),
  }

  return Response.json({ program: enriched })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as { name?: string; description?: string; isArchived?: boolean }

  const program = await prisma.trainerProgram.findUnique({ where: { id } })
  if (!program || program.trainerId !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = await prisma.trainerProgram.update({
    where: { id },
    data: {
      ...(body.name        !== undefined ? { name:        body.name }        : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.isArchived  !== undefined ? { isArchived:  body.isArchived }  : {}),
    },
  })

  return Response.json({ program: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const program = await prisma.trainerProgram.findUnique({ where: { id } })
  if (!program || program.trainerId !== user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Soft-delete: archive rather than hard delete, since assignments reference the template
  await prisma.trainerProgram.update({
    where: { id },
    data:  { isArchived: true },
  })

  return Response.json({ ok: true })
}
