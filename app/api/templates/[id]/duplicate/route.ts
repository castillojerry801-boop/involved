import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const source = await prisma.workoutTemplate.findFirst({
      where: { id, userId: user.id },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })
    if (!source) return Response.json({ error: 'Not found' }, { status: 404 })

    const copy = await prisma.workoutTemplate.create({
      data: {
        userId: user.id,
        name: `${source.name} (copy)`,
        description: source.description,
        equipmentProfileId: source.equipmentProfileId,
        exercises: {
          create: source.exercises.map(ex => ({
            exerciseId: ex.exerciseId,
            sortOrder: ex.sortOrder,
            trackingType: ex.trackingType,
            notes: ex.notes,
            restSeconds: ex.restSeconds,
            sets: {
              create: ex.sets.map(s => ({
                setNumber: s.setNumber,
                setType: s.setType,
                targetRepsMin: s.targetRepsMin,
                targetRepsMax: s.targetRepsMax,
                targetWeightKg: s.targetWeightKg,
                targetDurationSeconds: s.targetDurationSeconds,
                targetDistanceM: s.targetDistanceM,
                restSeconds: s.restSeconds,
                notes: s.notes,
              })),
            },
          })),
        },
      },
    })

    return Response.json({ template: copy }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to duplicate template' }, { status: 500 })
  }
}
