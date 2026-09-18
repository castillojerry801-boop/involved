import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string; dayId: string }> }

// POST: start a workout session from a program day.
// Creates a Workout + WorkoutExercises + WorkoutSets mirroring the program day's prescription.

export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: programId, dayId } = await params

  try {
    const day = await prisma.programDay.findFirst({
      where: { id: dayId, program: { id: programId, userId: user.id } },
      include: {
        program: { select: { name: true } },
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })
    if (!day) return Response.json({ error: 'Program day not found' }, { status: 404 })

    const now = new Date()

    const workout = await prisma.workout.create({
      data: {
        userId: user.id,
        programDayId: dayId,
        title: day.name,
        status: 'in_progress',
        source: 'manual',
        scheduledDate: now,
        startedAt: now,
        exercises: {
          create: day.exercises.map((ex, idx) => ({
            exerciseId: ex.exerciseId,
            order: idx,
            notes: ex.notes,
            targetSets: ex.sets.length || null,
            trackingType: ex.trackingType,
            restSeconds: ex.restSeconds,
            sets: {
              create: ex.sets.map(s => ({
                setNumber: s.setNumber,
                setType: s.setType,
                targetReps: s.targetRepsMin ?? null,
                targetRepsMin: s.targetRepsMin,
                targetRepsMax: s.targetRepsMax,
                targetWeightKg: s.targetWeightKg,
                targetDurationSeconds: s.targetDurationSeconds,
                targetDistanceM: s.targetDistanceM,
                restSeconds: s.restSeconds,
              })),
            },
          })),
        },
      },
      select: { id: true, title: true },
    })

    return Response.json({ workoutId: workout.id, title: workout.title }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to start workout' }, { status: 500 })
  }
}
