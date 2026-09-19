import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { assertTrainerClientAccess } from '@/lib/subscription/entitlements'

type Params = { params: Promise<{ clientId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  try {
    await assertTrainerClientAccess(user.id, clientId)
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json() as {
    trainerProgramId: string
    dayId: string
    scheduledDate?: string
    title?: string
  }

  if (!body.trainerProgramId || !body.dayId) {
    return Response.json({ error: 'trainerProgramId and dayId are required' }, { status: 400 })
  }

  // Verify trainer owns the program and day exists
  const day = await prisma.trainerProgramDay.findFirst({
    where: {
      id: body.dayId,
      programId: body.trainerProgramId,
      program: { trainerId: user.id },
    },
    include: {
      exercises: {
        orderBy: { sortOrder: 'asc' },
        include: { sets: { orderBy: { setNumber: 'asc' } } },
      },
    },
  })

  if (!day) return Response.json({ error: 'Program day not found' }, { status: 404 })

  const workout = await prisma.workout.create({
    data: {
      userId: clientId,
      assignedById: user.id,
      source: 'trainer_assigned',
      status: 'planned',
      title: body.title?.trim() || day.name,
      scheduledDate: body.scheduledDate ? new Date(body.scheduledDate) : null,
      exercises: {
        create: day.exercises.map((ex, i) => ({
          exerciseId: ex.exerciseId,
          order: i,
          trackingType: ex.trackingType,
          targetSets: ex.sets.length || undefined,
          restSeconds: ex.restSeconds,
          notes: ex.notes,
          sets: {
            create: ex.sets.map(s => ({
              setNumber: s.setNumber,
              setType: s.setType,
              targetRepsMin: s.targetRepsMin,
              targetRepsMax: s.targetRepsMax,
              targetWeightKg: s.targetWeightKg,
              targetDurationSeconds: s.targetDurationSeconds,
              restSeconds: s.restSeconds,
            })),
          },
        })),
      },
    },
    select: { id: true, title: true, scheduledDate: true },
  })

  return Response.json({ workout }, { status: 201 })
}
