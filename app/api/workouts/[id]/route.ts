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

// ─── GET: workout detail + previous bests ─────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const workout = await getWorkoutForUser(id, user.id)
    if (!workout) return Response.json({ error: 'Not found' }, { status: 404 })

    // For each exercise in this workout, fetch the most recent prior session's sets
    const exerciseIds = workout.exercises.map(e => e.exerciseId)
    const previousBests: Record<string, { reps: number | null; weightKg: number | null; setCount: number }> = {}

    if (exerciseIds.length > 0) {
      const priorSessions = await prisma.workoutExercise.findMany({
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
        },
        orderBy: { workout: { completedAt: 'desc' } },
        distinct: ['exerciseId'],
      })

      for (const prior of priorSessions) {
        const completedSets = prior.sets.filter(s => s.completed)
        if (!completedSets.length) continue
        const maxWeight = Math.max(...completedSets.map(s => Number(s.actualWeightKg ?? 0)))
        const lastSet = completedSets[completedSets.length - 1]
        previousBests[prior.exerciseId] = {
          reps: lastSet?.actualReps ?? null,
          weightKg: maxWeight > 0 ? maxWeight : null,
          setCount: completedSets.length,
        }
      }
    }

    const hydrated = {
      ...workout,
      exercises: workout.exercises.map(ex => ({
        ...ex,
        exercise: getExerciseById(ex.exerciseId) ?? null,
        previousBest: previousBests[ex.exerciseId] ?? null,
      })),
    }

    return Response.json({ workout: hydrated })
  } catch {
    return Response.json({ error: 'Failed to load workout' }, { status: 500 })
  }
}

// ─── PATCH: update workout (start, complete, skip, edit) ──────────────────────

interface PatchWorkoutBody {
  status?: 'in_progress' | 'completed' | 'skipped' | 'planned'
  title?: string
  notes?: string
  scheduledDate?: string
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

// ─── DELETE: remove workout ───────────────────────────────────────────────────

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
