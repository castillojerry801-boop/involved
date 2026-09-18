import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

type Params = { params: Promise<{ id: string; dayId: string }> }

// ─── GET: day detail with exercises ──────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: programId, dayId } = await params
  try {
    const day = await prisma.programDay.findFirst({
      where: { id: dayId, program: { id: programId, userId: user.id } },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })
    if (!day) return Response.json({ error: 'Not found' }, { status: 404 })

    const hydrated = {
      ...day,
      exercises: day.exercises.map(ex => ({
        ...ex,
        exercise: getExerciseById(ex.exerciseId) ?? null,
      })),
    }
    return Response.json({ day: hydrated })
  } catch {
    return Response.json({ error: 'Failed to load day' }, { status: 500 })
  }
}

// ─── PATCH: update day name / reorder / update exercises ─────────────────────

interface PatchDayBody {
  name?: string
  sortOrder?: number
  exercises?: Array<{
    id?: string // existing exercise — if provided, updates it
    exerciseId?: string // for new exercises
    sortOrder?: number
    trackingType?: string
    notes?: string
    restSeconds?: number
    sets?: Array<{
      id?: string
      setNumber: number
      setType?: string
      targetRepsMin?: number
      targetRepsMax?: number
      targetWeightKg?: number
      targetDurationSeconds?: number
      targetRir?: number
      restSeconds?: number
      notes?: string
    }>
  }>
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: programId, dayId } = await params
  const body = await req.json() as PatchDayBody

  try {
    const day = await prisma.programDay.findFirst({
      where: { id: dayId, program: { id: programId, userId: user.id } },
    })
    if (!day) return Response.json({ error: 'Not found' }, { status: 404 })

    // If exercises array provided, replace all exercises for this day
    if (body.exercises !== undefined) {
      // Validate all new exercise IDs
      for (const ex of body.exercises) {
        if (!ex.id && ex.exerciseId && !getExerciseById(ex.exerciseId)) {
          return Response.json({ error: `Exercise "${ex.exerciseId}" not found` }, { status: 400 })
        }
      }

      // Delete existing exercises and recreate (simplest correct approach for re-ordering)
      await prisma.programExercise.deleteMany({ where: { programDayId: dayId } })
      await prisma.programExercise.createMany({
        data: body.exercises.map((ex, i) => ({
          programDayId: dayId,
          exerciseId: ex.exerciseId ?? '',
          sortOrder: ex.sortOrder ?? i,
          trackingType: (ex.trackingType as 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals') ?? 'strength',
          notes: ex.notes ?? null,
          restSeconds: ex.restSeconds ?? null,
        })),
      })
    }

    const updated = await prisma.programDay.update({
      where: { id: dayId },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })

    return Response.json({
      day: {
        ...updated,
        exercises: updated.exercises.map(ex => ({
          ...ex,
          exercise: getExerciseById(ex.exerciseId) ?? null,
        })),
      },
    })
  } catch {
    return Response.json({ error: 'Failed to update day' }, { status: 500 })
  }
}

// ─── DELETE: remove day ───────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: programId, dayId } = await params
  try {
    const day = await prisma.programDay.findFirst({
      where: { id: dayId, program: { id: programId, userId: user.id } },
    })
    if (!day) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.programDay.delete({ where: { id: dayId } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete day' }, { status: 500 })
  }
}
