import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

interface SaveAsTemplateBody {
  name?: string
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as SaveAsTemplateBody

  try {
    const workout = await prisma.workout.findFirst({
      where: { id, userId: user.id },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })
    if (!workout) return Response.json({ error: 'Workout not found' }, { status: 404 })

    const name = body.name?.trim() || workout.title

    const template = await prisma.workoutTemplate.create({
      data: {
        userId: user.id,
        name,
        description: workout.notes?.slice(0, 500) ?? null,
        exercises: {
          create: workout.exercises.map((ex, ei) => ({
            exerciseId: ex.exerciseId,
            sortOrder: ex.order ?? ei,
            trackingType: ex.trackingType,
            notes: ex.notes,
            restSeconds: ex.restSeconds,
            sets: {
              create: ex.sets
                .filter(s => s.completedAt !== null)
                .map(s => ({
                  setNumber: s.setNumber,
                  setType: s.setType,
                  targetRepsMin: s.actualReps,
                  targetRepsMax: s.actualReps,
                  targetWeightKg: s.actualWeightKg,
                  targetDurationSeconds: s.actualDurationSeconds,
                  targetDistanceM: s.actualDistanceM,
                  restSeconds: ex.restSeconds,
                  notes: null,
                })),
            },
          })),
        },
      },
    })

    return Response.json({ template }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to save as template' }, { status: 500 })
  }
}
