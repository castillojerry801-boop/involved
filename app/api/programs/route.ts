import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'
import { isYmvId } from '@/lib/exercises/identity'
import { verifyYmvIds } from '@/lib/ymove/resolver'

// ─── GET: list user's programs ────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const programs = await prisma.program.findMany({
      where: { userId: user.id },
      include: {
        days: {
          orderBy: { sortOrder: 'asc' },
          include: {
            exercises: {
              orderBy: { sortOrder: 'asc' },
              select: { exerciseId: true, trackingType: true },
            },
          },
        },
      },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    })
    return Response.json({ programs })
  } catch {
    return Response.json({ error: 'Failed to load programs' }, { status: 500 })
  }
}

// ─── POST: create a program ───────────────────────────────────────────────────

interface CreateProgramBody {
  name: string
  description?: string
  days?: Array<{
    name: string
    weekday?: number
    focus?: string
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
        targetDistanceM?: number
        targetRir?: number
        restSeconds?: number
        notes?: string
      }>
    }>
  }>
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as CreateProgramBody
  if (!body.name?.trim()) return Response.json({ error: 'Name is required' }, { status: 400 })

  // Validate all exercise IDs up front — syntax + ExerciseDB catalog
  for (const day of body.days ?? []) {
    for (const ex of day.exercises ?? []) {
      if (!isYmvId(ex.exerciseId) && !getExerciseById(ex.exerciseId)) {
        return Response.json({ error: `Exercise "${ex.exerciseId}" not found` }, { status: 400 })
      }
    }
  }
  // DB-validate ymv: IDs against catalog
  const allExIds = (body.days ?? []).flatMap(d => (d.exercises ?? []).map(e => e.exerciseId))
  const ymvIds = allExIds.filter(isYmvId)
  if (ymvIds.length > 0 && !(await verifyYmvIds(ymvIds, prisma))) {
    return Response.json({ error: 'One or more YMove exercise IDs not found in catalog' }, { status: 400 })
  }

  try {
    const program = await prisma.program.create({
      data: {
        userId: user.id,
        name: body.name.trim(),
        description: body.description?.trim() ?? null,
        days: {
          create: (body.days ?? []).map((day, di) => ({
            name: day.name,
            weekday: day.weekday ?? null,
            focus: day.focus?.trim() ?? null,
            sortOrder: day.sortOrder ?? di,
            exercises: {
              create: (day.exercises ?? []).map((ex, ei) => ({
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
                    targetRir: s.targetRir ?? null,
                    restSeconds: s.restSeconds ?? null,
                    notes: s.notes ?? null,
                  })),
                },
              })),
            },
          })),
        },
      },
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

    return Response.json({ program }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to create program' }, { status: 500 })
  }
}
