import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

// POST: create a live workout session from a saved template.

export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: templateId } = await params

  try {
    const template = await prisma.workoutTemplate.findFirst({
      where: { id: templateId, userId: user.id },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })
    if (!template) return Response.json({ error: 'Template not found' }, { status: 404 })

    const now = new Date()

    const workout = await prisma.workout.create({
      data: {
        userId: user.id,
        templateId,
        title: template.name,
        status: 'in_progress',
        source: 'manual',
        scheduledDate: now,
        startedAt: now,
        exercises: {
          create: template.exercises.map((ex, idx) => ({
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
