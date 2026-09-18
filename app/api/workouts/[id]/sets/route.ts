import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

// ─── POST: log or add a set ───────────────────────────────────────────────────

interface LogSetBody {
  workoutExerciseId: string
  setNumber: number
  actualReps?: number
  actualWeightKg?: number
  actualDurationSeconds?: number
  actualDistanceM?: number
  rpe?: number
  completed?: boolean
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workoutId } = await params
  const body = await req.json() as LogSetBody

  try {
    // Verify the workout belongs to this user
    const workout = await prisma.workout.findFirst({
      where: { id: workoutId, userId: user.id },
      select: { id: true },
    })
    if (!workout) return Response.json({ error: 'Not found' }, { status: 404 })

    // Verify the exercise belongs to this workout
    const workoutExercise = await prisma.workoutExercise.findFirst({
      where: { id: body.workoutExerciseId, workoutId },
      select: { id: true, exerciseId: true },
    })
    if (!workoutExercise) return Response.json({ error: 'Exercise not found in workout' }, { status: 404 })

    const now = new Date()
    const isCompleted = body.completed !== false && (
      body.actualReps != null || body.actualDurationSeconds != null
    )

    const set = await prisma.workoutSet.create({
      data: {
        workoutExerciseId: body.workoutExerciseId,
        setNumber: body.setNumber,
        actualReps:            body.actualReps ?? null,
        actualWeightKg:        body.actualWeightKg ?? null,
        actualDurationSeconds: body.actualDurationSeconds ?? null,
        actualDistanceM:       body.actualDistanceM ?? null,
        rpe:                   body.rpe ?? null,
        completed:             isCompleted,
        completedAt:           isCompleted ? now : null,
      },
    })

    let newPR = false

    // Check for PR if the set has weight data
    if (isCompleted && body.actualWeightKg && body.actualWeightKg > 0) {
      const existingPR = await prisma.personalRecord.findFirst({
        where: { userId: user.id, exerciseId: workoutExercise.exerciseId, metric: 'weight' },
        orderBy: { value: 'desc' },
      })
      if (!existingPR || Number(existingPR.value) < body.actualWeightKg) {
        await prisma.personalRecord.create({
          data: {
            userId:      user.id,
            exerciseId:  workoutExercise.exerciseId,
            metric:      'weight',
            value:       body.actualWeightKg,
            unit:        'kg',
            achievedAt:  now,
            workoutId,
            workoutSetId: set.id,
          },
        })
        newPR = true
      }
    }

    return Response.json({ set, newPR }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to log set' }, { status: 500 })
  }
}
