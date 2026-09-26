import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  resolveExercisePrescriptionForWeek,
  buildResolvedSetSpecs,
  type PersistedWeekProgression,
} from '@/lib/training/prescription'

type Params = { params: Promise<{ id: string; dayId: string }> }

// POST: start a workout session from a program day.
// Creates a Workout + WorkoutExercises + WorkoutSets from the RESOLVED prescription
// for the requested week. Week comes from the client (?week= / body.week), defaulting
// to 1. Deload/taper weeks therefore produce the real reduced set/rep/RIR prescription,
// not the base template.

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: programId, dayId } = await params

  // Resolve the requested week (query param wins, then body, then 1).
  const urlWeek = parseInt(new URL(req.url).searchParams.get('week') ?? '', 10)
  let bodyWeek = NaN
  try {
    const body = await req.json() as { week?: number }
    if (typeof body?.week === 'number') bodyWeek = body.week
  } catch { /* no body */ }
  const requestedWeek = Number.isFinite(urlWeek) ? urlWeek : (Number.isFinite(bodyWeek) ? bodyWeek : 1)

  try {
    const day = await prisma.programDay.findFirst({
      where: { id: dayId, program: { id: programId, userId: user.id } },
      include: {
        program: { select: { name: true, durationWeeks: true } },
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })
    if (!day) return Response.json({ error: 'Program day not found' }, { status: 404 })

    // Clamp the week to [1, durationWeeks] (legacy programs → week 1).
    const maxWeek = day.program.durationWeeks ?? 1
    const week = Math.min(Math.max(1, requestedWeek), Math.max(1, maxWeek))

    const now = new Date()

    const workout = await prisma.workout.create({
      data: {
        userId: user.id,
        programDayId: dayId,
        title: maxWeek > 1 ? `${day.name} — Week ${week}` : day.name,
        status: 'in_progress',
        source: 'manual',
        scheduledDate: now,
        startedAt: now,
        exercises: {
          create: day.exercises.map((ex, idx) => {
            const resolved = resolveExercisePrescriptionForWeek(
              {
                restSeconds: ex.restSeconds,
                startingLoad: ex.startingLoad,
                weekProgressions: (ex.weekProgressions as PersistedWeekProgression[] | null) ?? null,
                sets: ex.sets.map(s => ({
                  targetRepsMin: s.targetRepsMin,
                  targetRepsMax: s.targetRepsMax,
                  targetRir: s.targetRir,
                  targetWeightKg: s.targetWeightKg != null ? Number(s.targetWeightKg) : null,
                  targetDurationSeconds: s.targetDurationSeconds,
                  targetDistanceM: s.targetDistanceM != null ? Number(s.targetDistanceM) : null,
                  restSeconds: s.restSeconds,
                })),
              },
              week,
            )
            const specs = buildResolvedSetSpecs(resolved)
            return {
              exerciseId: ex.exerciseId,
              order: idx,
              notes: ex.notes,
              targetSets: specs.length || null,
              trackingType: ex.trackingType,
              restSeconds: ex.restSeconds,
              sets: {
                create: specs.map(s => ({
                  setNumber: s.setNumber,
                  setType: s.setType,
                  targetReps: s.targetRepsMin ?? null,
                  targetRepsMin: s.targetRepsMin,
                  targetRepsMax: s.targetRepsMax,
                  targetWeightKg: s.targetWeightKg,
                  targetDurationSeconds: s.targetDurationSeconds,
                  targetDistanceM: s.targetDistanceM,
                  targetRir: s.targetRir,
                  restSeconds: s.restSeconds,
                })),
              },
            }
          }),
        },
      },
      select: { id: true, title: true },
    })

    return Response.json({ workoutId: workout.id, title: workout.title }, { status: 201 })
  } catch (err) {
    console.error('[program-day-start-error]', err)
    return Response.json({ error: 'Failed to start workout' }, { status: 500 })
  }
}
