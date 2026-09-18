import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { validateWorkoutDraft } from '@/lib/ai/tools/workout'
import type { WorkoutDraft } from '@/lib/ai/tools/workout'

type TrackingType = 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals'

function inferTrackingType(equipment: string): TrackingType {
  const eq = equipment.toLowerCase()
  if (eq.includes('body weight')) return 'bodyweight'
  if (eq.includes('cardio') || eq.includes('cycle') || eq.includes('treadmill')) return 'cardio'
  return 'strength'
}

// Saves a workout that was already proposed by V in the coach chat.
// Re-validates all exercise IDs against the local library before writing.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as WorkoutDraft

  const validation = validateWorkoutDraft(body)
  if (!validation.valid || !validation.workout) {
    return Response.json({ error: 'Invalid workout data', details: validation.errors }, { status: 400 })
  }

  const validated = validation.workout

  try {
    const workout = await prisma.workout.create({
      data: {
        userId: user.id,
        title: validated.workout_name,
        notes: validated.description ?? null,
        source: 'coach_generated',
        status: 'planned',
        exercises: {
          create: validated.exercises.map((ex, i) => ({
            exerciseId: ex.exercise_id,
            order: i,
            trackingType: inferTrackingType(ex.exercise.equipment),
            targetSets: ex.sets,
            restSeconds: ex.rest_seconds,
            notes: ex.notes ?? null,
            sets: {
              create: Array.from({ length: ex.sets }, (_, j) => ({
                setNumber: j + 1,
                setType: 'working' as const,
                targetReps: ex.reps ?? null,
                targetDurationSeconds: ex.duration_seconds ?? null,
              })),
            },
          })),
        },
      },
      select: { id: true, title: true },
    })

    return Response.json({ workoutId: workout.id, title: workout.title }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to save workout' }, { status: 500 })
  }
}
