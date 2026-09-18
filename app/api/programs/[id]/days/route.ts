import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

type Params = { params: Promise<{ id: string }> }

// ─── POST: add a day to a program ────────────────────────────────────────────

interface CreateDayBody {
  name: string
  sortOrder?: number
  exercises?: Array<{
    exerciseId: string
    sortOrder?: number
    trackingType?: string
    notes?: string
    restSeconds?: number
    sets?: Array<{
      setNumber: number
      setType?: string
      targetRepsMin?: number
      targetRepsMax?: number
      targetWeightKg?: number
      targetDurationSeconds?: number
      targetRir?: number
      restSeconds?: number
    }>
  }>
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: programId } = await params
  const body = await req.json() as CreateDayBody

  if (!body.name?.trim()) return Response.json({ error: 'Day name is required' }, { status: 400 })

  try {
    const program = await prisma.program.findFirst({ where: { id: programId, userId: user.id } })
    if (!program) return Response.json({ error: 'Program not found' }, { status: 404 })

    for (const ex of body.exercises ?? []) {
      if (!getExerciseById(ex.exerciseId)) {
        return Response.json({ error: `Exercise "${ex.exerciseId}" not found` }, { status: 400 })
      }
    }

    // If sortOrder not specified, append at end
    const maxOrder = await prisma.programDay.aggregate({
      where: { programId },
      _max: { sortOrder: true },
    })
    const nextOrder = body.sortOrder ?? (maxOrder._max.sortOrder ?? -1) + 1

    const day = await prisma.programDay.create({
      data: {
        programId,
        name: body.name.trim(),
        sortOrder: nextOrder,
        exercises: {
          create: (body.exercises ?? []).map((ex, ei) => ({
            exerciseId: ex.exerciseId,
            sortOrder: ex.sortOrder ?? ei,
            trackingType: (ex.trackingType as 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals') ?? 'strength',
            notes: ex.notes ?? null,
            restSeconds: ex.restSeconds ?? null,
            sets: {
              create: (ex.sets ?? []).map(s => ({
                setNumber: s.setNumber,
                setType: (s.setType as 'warmup' | 'working' | 'amrap' | 'drop' | 'failure') ?? 'working',
                targetRepsMin: s.targetRepsMin ?? null,
                targetRepsMax: s.targetRepsMax ?? null,
                targetWeightKg: s.targetWeightKg ?? null,
                targetDurationSeconds: s.targetDurationSeconds ?? null,
                targetRir: s.targetRir ?? null,
                restSeconds: s.restSeconds ?? null,
              })),
            },
          })),
        },
      },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    })

    return Response.json({ day }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to add day' }, { status: 500 })
  }
}
