import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

type Params = { params: Promise<{ id: string }> }

async function getWorkoutForUser(workoutId: string, userId: string) {
  return prisma.workout.findFirst({
    where: { id: workoutId, userId },
    include: {
      exercises: {
        orderBy: { order: 'asc' },
        include: { sets: { orderBy: { setNumber: 'asc' } } },
      },
    },
  })
}

// ─── GET: workout detail + per-set previous session ───────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const workout = await getWorkoutForUser(id, user.id)
    if (!workout) return Response.json({ error: 'Not found' }, { status: 404 })

    const exerciseIds = workout.exercises.map(e => e.exerciseId)

    // Fetch the most recent completed session per exercise (excluding this workout)
    const priorSessions = exerciseIds.length > 0 ? await prisma.workoutExercise.findMany({
      where: {
        exerciseId: { in: exerciseIds },
        workout: {
          userId: user.id,
          status: 'completed',
          id: { not: id },
        },
      },
      include: {
        sets: { where: { completed: true }, orderBy: { setNumber: 'asc' } },
        workout: { select: { completedAt: true } },
      },
      orderBy: { workout: { completedAt: 'desc' } },
      distinct: ['exerciseId'],
    }) : []

    type PreviousSession = {
      completedAt: string
      notes: string | null
      sets: Array<{
        setNumber: number
        setType: string
        actualReps: number | null
        actualWeightKg: number | null
        actualDurationSeconds: number | null
        actualDistanceM: number | null
        rpe: number | null
        rir: number | null
      }>
    }

    const previousSessions: Record<string, PreviousSession> = {}

    for (const prior of priorSessions) {
      if (!prior.sets.length) continue
      previousSessions[prior.exerciseId] = {
        completedAt: prior.workout.completedAt?.toISOString() ?? '',
        notes: prior.notes,
        sets: prior.sets.map(s => ({
          setNumber: s.setNumber,
          setType: s.setType,
          actualReps: s.actualReps,
          actualWeightKg: s.actualWeightKg !== null ? Number(s.actualWeightKg) : null,
          actualDurationSeconds: s.actualDurationSeconds,
          actualDistanceM: s.actualDistanceM !== null ? Number(s.actualDistanceM) : null,
          rpe: s.rpe,
          rir: s.rir,
        })),
      }
    }

    const hydrated = {
      ...workout,
      exercises: workout.exercises.map(ex => ({
        ...ex,
        exercise: getExerciseById(ex.exerciseId) ?? null,
        previousSession: previousSessions[ex.exerciseId] ?? null,
      })),
    }

    return Response.json({ workout: hydrated })
  } catch {
    return Response.json({ error: 'Failed to load workout' }, { status: 500 })
  }
}

// ─── PATCH: update workout ────────────────────────────────────────────────────

interface PatchWorkoutBody {
  status?: 'in_progress' | 'completed' | 'skipped' | 'planned'
  title?: string
  notes?: string
  scheduledDate?: string
  durationTargetMinutes?: number | null
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as PatchWorkoutBody

  try {
    const existing = await getWorkoutForUser(id, user.id)
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    const now = new Date()
    const updates: Record<string, unknown> = {}

    if (body.title !== undefined) updates.title = body.title.trim()
    if (body.notes !== undefined) updates.notes = body.notes.trim() || null
    if (body.scheduledDate !== undefined) updates.scheduledDate = new Date(body.scheduledDate)
    if (body.durationTargetMinutes !== undefined) updates.durationTargetMinutes = body.durationTargetMinutes

    if (body.status === 'in_progress' && existing.status === 'planned') {
      updates.status = 'in_progress'
      updates.startedAt = now
    } else if (body.status === 'completed') {
      updates.status = 'completed'
      updates.completedAt = now
      if (existing.startedAt) {
        updates.durationSeconds = Math.round((now.getTime() - existing.startedAt.getTime()) / 1000)
      }
    } else if (body.status === 'skipped') {
      updates.status = 'skipped'
    } else if (body.status === 'planned') {
      updates.status = 'planned'
      updates.startedAt = null
      updates.completedAt = null
    }

    const updated = await prisma.workout.update({
      where: { id },
      data: updates,
    })

    return Response.json({ workout: updated })
  } catch {
    return Response.json({ error: 'Failed to update workout' }, { status: 500 })
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const existing = await prisma.workout.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.workout.delete({ where: { id } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete workout' }, { status: 500 })
  }
}
