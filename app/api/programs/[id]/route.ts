import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById, isCustomExerciseId } from '@/lib/exercises'
import { customToMeta, verifyCustomExerciseIds } from '@/lib/training/custom-exercises'

type Params = { params: Promise<{ id: string }> }

async function getProgramForUser(id: string, userId: string) {
  return prisma.program.findFirst({
    where: { id, userId },
    include: {
      days: {
        orderBy: { sortOrder: 'asc' },
        include: {
          exercises: {
            orderBy: { sortOrder: 'asc' },
            include: { sets: { orderBy: { setNumber: 'asc' } } },
          },
        },
      },
    },
  })
}

// ─── GET: program detail ──────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const program = await getProgramForUser(id, user.id)
    if (!program) return Response.json({ error: 'Not found' }, { status: 404 })

    const hydrated = {
      ...program,
      days: await Promise.all(program.days.map(async day => ({
        ...day,
        exercises: await Promise.all(day.exercises.map(async ex => {
          let exercise = null
          if (isCustomExerciseId(ex.exerciseId)) {
            const row = await prisma.customExercise.findFirst({ where: { id: ex.exerciseId, userId: user.id } })
            exercise = row ? customToMeta(row) : null
          } else {
            exercise = getExerciseById(ex.exerciseId) ?? null
          }
          return { ...ex, exercise }
        })),
      }))),
    }
    return Response.json({ program: hydrated })
  } catch {
    return Response.json({ error: 'Failed to load program' }, { status: 500 })
  }
}

// ─── PATCH: update program metadata or activate ───────────────────────────────

interface PatchProgramBody {
  name?: string
  description?: string
  isActive?: boolean
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as PatchProgramBody

  try {
    const existing = await prisma.program.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    if (body.isActive === true) {
      await prisma.program.updateMany({
        where: { userId: user.id, id: { not: id } },
        data: { isActive: false },
      })
    }

    const updated = await prisma.program.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.description !== undefined && { description: body.description.trim() || null }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    })
    return Response.json({ program: updated })
  } catch {
    return Response.json({ error: 'Failed to update program' }, { status: 500 })
  }
}

// ─── PUT: full program replace (name + description + all days/exercises) ──────

interface PutSetInput {
  setNumber: number
  setType?: string
  targetRepsMin?: number
  targetRepsMax?: number
  targetWeightKg?: number
  targetDurationSeconds?: number
  targetDistanceM?: number
  restSeconds?: number
  notes?: string
}

interface PutExerciseInput {
  exerciseId: string
  sortOrder?: number
  trackingType?: string
  notes?: string
  restSeconds?: number
  sets?: PutSetInput[]
}

interface PutDayInput {
  name: string
  sortOrder?: number
  exercises?: PutExerciseInput[]
}

interface PutProgramBody {
  name?: string
  description?: string
  days: PutDayInput[]
}

export async function PUT(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as PutProgramBody

  const allExerciseIds = body.days.flatMap(d => (d.exercises ?? []).map(e => e.exerciseId))
  for (const eid of allExerciseIds) {
    if (!isCustomExerciseId(eid) && !getExerciseById(eid)) {
      return Response.json({ error: `Exercise "${eid}" not found` }, { status: 400 })
    }
  }
  if (!(await verifyCustomExerciseIds(allExerciseIds, user.id))) {
    return Response.json({ error: 'One or more custom exercises not found' }, { status: 400 })
  }

  try {
    const existing = await prisma.program.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.$transaction(async tx => {
      if (body.name !== undefined || body.description !== undefined) {
        await tx.program.update({
          where: { id },
          data: {
            ...(body.name !== undefined && { name: body.name.trim() }),
            ...(body.description !== undefined && { description: body.description.trim() || null }),
          },
        })
      }
      await tx.programDay.deleteMany({ where: { programId: id } })
      for (let di = 0; di < body.days.length; di++) {
        const day = body.days[di]
        const createdDay = await tx.programDay.create({
          data: {
            programId: id,
            name: day.name || `Day ${di + 1}`,
            sortOrder: day.sortOrder ?? di,
          },
        })
        for (let ei = 0; ei < (day.exercises ?? []).length; ei++) {
          const ex = day.exercises![ei]
          await tx.programExercise.create({
            data: {
              programDayId: createdDay.id,
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
                  targetDistanceM: s.targetDistanceM ?? null,
                  restSeconds: s.restSeconds ?? null,
                  notes: s.notes ?? null,
                })),
              },
            },
          })
        }
      }
    })

    const updated = await getProgramForUser(id, user.id)
    return Response.json({ program: updated })
  } catch {
    return Response.json({ error: 'Failed to update program' }, { status: 500 })
  }
}

// ─── DELETE: remove program ───────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const existing = await prisma.program.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.program.delete({ where: { id } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete program' }, { status: 500 })
  }
}
