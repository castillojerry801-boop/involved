import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

// ─── GET: list workouts ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')       // planned|in_progress|completed
  const date   = searchParams.get('date')         // YYYY-MM-DD
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50)

  try {
    const workouts = await prisma.workout.findMany({
      where: {
        userId: user.id,
        ...(status ? { status: status as 'planned' | 'in_progress' | 'completed' | 'skipped' } : {}),
        ...(date   ? { scheduledDate: new Date(date) } : {}),
      },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
      orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    })

    // Hydrate exercise metadata from static library
    const hydrated = workouts.map(w => ({
      ...w,
      exercises: w.exercises.map(ex => ({
        ...ex,
        exercise: getExerciseById(ex.exerciseId) ?? null,
      })),
    }))

    return Response.json({ workouts: hydrated })
  } catch {
    return Response.json({ error: 'Failed to load workouts' }, { status: 500 })
  }
}

// ─── POST: create workout ─────────────────────────────────────────────────────

interface CreateWorkoutBody {
  title: string
  notes?: string
  scheduledDate?: string       // YYYY-MM-DD; omit to start immediately
  source?: 'manual' | 'coach_generated' | 'trainer_assigned'
  startNow?: boolean
  exercises?: Array<{
    exerciseId: string
    order?: number
    notes?: string
    targetSets?: number
    sets?: Array<{
      setNumber: number
      targetReps?: number
      targetWeightKg?: number
      targetDurationSeconds?: number
    }>
  }>
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as CreateWorkoutBody

  if (!body.title?.trim()) {
    return Response.json({ error: 'Title is required' }, { status: 400 })
  }

  // Validate exercise IDs
  for (const ex of body.exercises ?? []) {
    if (!getExerciseById(ex.exerciseId)) {
      return Response.json(
        { error: `Exercise ID "${ex.exerciseId}" not found in library` },
        { status: 400 }
      )
    }
  }

  try {
    const now = new Date()
    const isStarting = body.startNow || (!body.scheduledDate)

    const workout = await prisma.workout.create({
      data: {
        userId: user.id,
        title: body.title.trim(),
        notes: body.notes?.trim() ?? null,
        scheduledDate: body.scheduledDate ? new Date(body.scheduledDate) : now,
        status: isStarting ? 'in_progress' : 'planned',
        source: body.source ?? 'manual',
        startedAt: isStarting ? now : null,
        exercises: {
          create: (body.exercises ?? []).map((ex, idx) => ({
            exerciseId: ex.exerciseId,
            order: ex.order ?? idx,
            notes: ex.notes ?? null,
            targetSets: ex.targetSets ?? ex.sets?.length ?? null,
            sets: ex.sets?.length ? {
              create: ex.sets.map(s => ({
                setNumber: s.setNumber,
                targetReps: s.targetReps ?? null,
                targetWeightKg: s.targetWeightKg ?? null,
                targetDurationSeconds: s.targetDurationSeconds ?? null,
              })),
            } : undefined,
          })),
        },
      },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })

    const hydrated = {
      ...workout,
      exercises: workout.exercises.map(ex => ({
        ...ex,
        exercise: getExerciseById(ex.exerciseId) ?? null,
      })),
    }

    return Response.json({ workout: hydrated }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to create workout' }, { status: 500 })
  }
}
