import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { estimated1RM, isValid1RMEstimate } from '@/lib/training/one-rm'

type Params = { params: Promise<{ id: string }> }

interface LogSetBody {
  workoutExerciseId: string
  setNumber: number
  setType?: 'warmup' | 'working' | 'amrap' | 'drop' | 'failure'
  actualReps?: number
  actualWeightKg?: number
  actualDurationSeconds?: number
  actualDistanceM?: number
  rpe?: number
  rir?: number
  restSeconds?: number
  completed?: boolean
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workoutId } = await params
  const body = await req.json() as LogSetBody

  try {
    const workout = await prisma.workout.findFirst({
      where: { id: workoutId, userId: user.id },
      select: { id: true },
    })
    if (!workout) return Response.json({ error: 'Not found' }, { status: 404 })

    const workoutExercise = await prisma.workoutExercise.findFirst({
      where: { id: body.workoutExerciseId, workoutId },
      select: { id: true, exerciseId: true },
    })
    if (!workoutExercise) return Response.json({ error: 'Exercise not found in workout' }, { status: 404 })

    const now = new Date()
    const setType = body.setType ?? 'working'
    const isCompleted = body.completed !== false && (
      body.actualReps != null || body.actualDurationSeconds != null
    )

    const set = await prisma.workoutSet.create({
      data: {
        workoutExerciseId: body.workoutExerciseId,
        setNumber:             body.setNumber,
        setType,
        actualReps:            body.actualReps ?? null,
        actualWeightKg:        body.actualWeightKg ?? null,
        actualDurationSeconds: body.actualDurationSeconds ?? null,
        actualDistanceM:       body.actualDistanceM ?? null,
        rpe:                   body.rpe ?? null,
        rir:                   body.rir ?? null,
        restSeconds:           body.restSeconds ?? null,
        completed:             isCompleted,
        completedAt:           isCompleted ? now : null,
      },
    })

    const prs: Record<string, boolean> = {}

    if (!isCompleted || setType === 'warmup') {
      return Response.json({ set, prs, newPR: false }, { status: 201 })
    }

    const exerciseId = workoutExercise.exerciseId
    const weight = body.actualWeightKg && body.actualWeightKg > 0 ? body.actualWeightKg : null
    const reps = body.actualReps && body.actualReps > 0 ? body.actualReps : null

    // ── Weight PR ────────────────────────────────────────────────────────────
    if (weight) {
      const existing = await prisma.personalRecord.findFirst({
        where: { userId: user.id, exerciseId, metric: 'weight' },
        orderBy: { value: 'desc' },
      })
      if (!existing || Number(existing.value) < weight) {
        await prisma.personalRecord.create({
          data: {
            userId: user.id, exerciseId, metric: 'weight',
            value: weight, unit: 'kg', achievedAt: now,
            workoutId, workoutSetId: set.id,
          },
        })
        prs.weight = true
      }
    }

    // ── Estimated 1RM PR ─────────────────────────────────────────────────────
    if (weight && reps && isValid1RMEstimate(reps)) {
      const e1rm = estimated1RM(weight, reps)
      const existing = await prisma.personalRecord.findFirst({
        where: { userId: user.id, exerciseId, metric: 'estimated_1rm' },
        orderBy: { value: 'desc' },
      })
      if (!existing || Number(existing.value) < e1rm) {
        await prisma.personalRecord.create({
          data: {
            userId: user.id, exerciseId, metric: 'estimated_1rm',
            value: e1rm, unit: 'kg', achievedAt: now, workoutId,
          },
        })
        prs.estimated1rm = true
      }
    }

    // ── Bodyweight rep PR (no weight) ────────────────────────────────────────
    if (reps && !weight) {
      const existing = await prisma.personalRecord.findFirst({
        where: { userId: user.id, exerciseId, metric: 'reps' },
        orderBy: { value: 'desc' },
      })
      if (!existing || Number(existing.value) < reps) {
        await prisma.personalRecord.create({
          data: {
            userId: user.id, exerciseId, metric: 'reps',
            value: reps, unit: 'reps', achievedAt: now, workoutId,
          },
        })
        prs.reps = true
      }
    }

    // ── Session volume PR ────────────────────────────────────────────────────
    if (weight && reps) {
      const siblingExerciseIds = await prisma.workoutExercise.findMany({
        where: { workoutId, exerciseId },
        select: { id: true },
      })
      const sessionSets = await prisma.workoutSet.findMany({
        where: {
          workoutExerciseId: { in: siblingExerciseIds.map(r => r.id) },
          completed: true,
          setType: { not: 'warmup' },
        },
        select: { actualWeightKg: true, actualReps: true },
      })
      const sessionVolume = sessionSets.reduce(
        (sum, s) => sum + (Number(s.actualWeightKg ?? 0) * (s.actualReps ?? 0)), 0
      )
      if (sessionVolume > 0) {
        const existing = await prisma.personalRecord.findFirst({
          where: { userId: user.id, exerciseId, metric: 'volume_kg' },
          orderBy: { value: 'desc' },
        })
        if (!existing || Number(existing.value) < sessionVolume) {
          await prisma.personalRecord.create({
            data: {
              userId: user.id, exerciseId, metric: 'volume_kg',
              value: sessionVolume, unit: 'kg', achievedAt: now, workoutId,
            },
          })
          prs.volume = true
        }
      }
    }

    return Response.json({ set, prs, newPR: Object.keys(prs).length > 0 }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to log set' }, { status: 500 })
  }
}
