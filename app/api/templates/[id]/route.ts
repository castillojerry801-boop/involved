import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById, isCustomExerciseId } from '@/lib/exercises'
import { customToMeta, verifyCustomExerciseIds } from '@/lib/training/custom-exercises'

type Params = { params: Promise<{ id: string }> }

async function resolveExerciseMeta(exerciseId: string, userId: string) {
  if (isCustomExerciseId(exerciseId)) {
    const row = await prisma.customExercise.findFirst({ where: { id: exerciseId, userId } })
    return row ? customToMeta(row) : null
  }
  return getExerciseById(exerciseId) ?? null
}

// ─── GET: template detail ─────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const template = await prisma.workoutTemplate.findFirst({
      where: { id, userId: user.id },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
        equipmentProfile: { select: { id: true, name: true } },
      },
    })
    if (!template) return Response.json({ error: 'Not found' }, { status: 404 })

    const exercisesWithMeta = await Promise.all(
      template.exercises.map(async ex => ({
        ...ex,
        exercise: await resolveExerciseMeta(ex.exerciseId, user.id),
      }))
    )

    return Response.json({ template: { ...template, exercises: exercisesWithMeta } })
  } catch {
    return Response.json({ error: 'Failed to load template' }, { status: 500 })
  }
}

// ─── PATCH: update template (name/description/equipmentProfile + full exercise replace) ─

interface SetInput {
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

interface ExerciseInput {
  exerciseId: string
  sortOrder?: number
  trackingType?: string
  notes?: string
  restSeconds?: number
  sets?: SetInput[]
}

interface PatchTemplateBody {
  name?: string
  description?: string
  equipmentProfileId?: string | null
  exercises?: ExerciseInput[]
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as PatchTemplateBody

  try {
    const existing = await prisma.workoutTemplate.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    if (body.exercises !== undefined) {
      const exerciseIds = body.exercises.map(e => e.exerciseId)
      for (const eid of exerciseIds) {
        if (!isCustomExerciseId(eid) && !getExerciseById(eid)) {
          return Response.json({ error: `Exercise "${eid}" not found` }, { status: 400 })
        }
      }
      if (!(await verifyCustomExerciseIds(exerciseIds, user.id))) {
        return Response.json({ error: 'One or more custom exercises not found' }, { status: 400 })
      }

      // Replace all exercises atomically
      await prisma.$transaction(async tx => {
        await tx.workoutTemplate.update({
          where: { id },
          data: {
            ...(body.name !== undefined && { name: body.name.trim() }),
            ...(body.description !== undefined && { description: body.description.trim() || null }),
            ...(body.equipmentProfileId !== undefined && { equipmentProfileId: body.equipmentProfileId }),
          },
        })
        await tx.templateExercise.deleteMany({ where: { templateId: id } })
        for (let ei = 0; ei < body.exercises!.length; ei++) {
          const ex = body.exercises![ei]
          await tx.templateExercise.create({
            data: {
              templateId: id,
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
      })
    } else {
      await prisma.workoutTemplate.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.description !== undefined && { description: body.description.trim() || null }),
          ...(body.equipmentProfileId !== undefined && { equipmentProfileId: body.equipmentProfileId }),
        },
      })
    }

    const updated = await prisma.workoutTemplate.findFirst({
      where: { id },
      include: {
        exercises: {
          orderBy: { sortOrder: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
        equipmentProfile: { select: { id: true, name: true } },
      },
    })

    return Response.json({ template: updated })
  } catch {
    return Response.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const existing = await prisma.workoutTemplate.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.workoutTemplate.delete({ where: { id } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
