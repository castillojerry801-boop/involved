import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

type Params = { params: Promise<{ id: string }> }

// ─── POST: add an exercise to an existing workout ─────────────────────────────

interface AddExerciseBody {
  exerciseId: string
  trackingType?: string
  targetSets?: number
  notes?: string
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workoutId } = await params
  const body = await req.json() as AddExerciseBody

  if (!body.exerciseId) return Response.json({ error: 'exerciseId required' }, { status: 400 })
  if (!getExerciseById(body.exerciseId)) return Response.json({ error: 'Unknown exercise' }, { status: 400 })

  try {
    const workout = await prisma.workout.findFirst({
      where: { id: workoutId, userId: user.id },
      select: { id: true, status: true },
    })
    if (!workout) return Response.json({ error: 'Not found' }, { status: 404 })

    const maxOrder = await prisma.workoutExercise.findFirst({
      where: { workoutId },
      orderBy: { order: 'desc' },
      select: { order: true },
    })

    const exercise = await prisma.workoutExercise.create({
      data: {
        workoutId,
        exerciseId: body.exerciseId,
        order: (maxOrder?.order ?? -1) + 1,
        trackingType: (body.trackingType as never) ?? 'strength',
        targetSets: body.targetSets ?? null,
        notes: body.notes ?? null,
      },
      include: { sets: { orderBy: { setNumber: 'asc' } } },
    })

    return Response.json({ exercise }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to add exercise' }, { status: 500 })
  }
}
