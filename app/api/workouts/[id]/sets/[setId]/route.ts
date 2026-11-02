import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { estimated1RM, isValid1RMEstimate } from '@/lib/training/one-rm'

type Params = { params: Promise<{ id: string; setId: string }> }

// ─── PATCH: update a logged set ───────────────────────────────────────────────

interface UpdateSetBody {
  actualReps?: number | null
  actualWeightKg?: number | null
  actualDurationSeconds?: number | null
  actualDistanceM?: number | null
  rpe?: number | null
  rir?: number | null
  restSeconds?: number | null
  setType?: 'warmup' | 'working' | 'amrap' | 'drop' | 'failure'
  completed?: boolean
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workoutId, setId } = await params
  const body = await req.json() as UpdateSetBody

  try {
    // Verify ownership via workout chain; include workoutExercise for PR detection
    const set = await prisma.workoutSet.findFirst({
      where: {
        id: setId,
        workoutExercise: { workoutId, workout: { userId: user.id } },
      },
      include: { workoutExercise: { select: { exerciseId: true } } },
    })
    if (!set) return Response.json({ error: 'Not found' }, { status: 404 })

    const now = new Date()
    const wasCompleted = set.completed
    const isCompleted = body.completed !== false && (
      body.actualReps != null || body.actualDurationSeconds != null
    )

    const updated = await prisma.workoutSet.update({
      where: { id: setId },
      data: {
        ...(body.setType !== undefined && { setType: body.setType }),
        actualReps:            body.actualReps ?? undefined,
        actualWeightKg:        body.actualWeightKg ?? undefined,
        actualDurationSeconds: body.actualDurationSeconds ?? undefined,
        actualDistanceM:       body.actualDistanceM ?? undefined,
        rpe:                   body.rpe ?? undefined,
        rir:                   body.rir ?? undefined,
        restSeconds:           body.restSeconds ?? undefined,
        completed:             isCompleted,
        completedAt:           isCompleted ? (set.completedAt ?? now) : null,
      },
    })

    const prs: Record<string, boolean> = {}

    // Run PR detection only on the first-time completion of a set, not re-edits.
    // Warmup sets never earn PRs (matches POST behaviour).
    const setType = body.setType ?? set.setType
    if (!wasCompleted && isCompleted && setType !== 'warmup') {
      const exerciseId = set.workoutExercise.exerciseId
      const weight = body.actualWeightKg && body.actualWeightKg > 0 ? body.actualWeightKg : null
      const reps = body.actualReps && body.actualReps > 0 ? body.actualReps : null

      // ── Weight PR ──────────────────────────────────────────────────────────
      if (weight) {
        const existing = await prisma.personalRecord.findFirst({
          where: { userId: user.id, exerciseId, metric: 'weight' },
          orderBy: { value: 'desc' },
        })
        if (!existing || Number(existing.value) < weight) {
          await prisma.personalRecord.create({
            data: {
              userId: user.id, exerciseId, metric: 'weight',
              value: weight, unit: 'kg', achievedAt: now,
              workoutId, workoutSetId: updated.id,
            },
          })
          prs.weight = true
        }
      }

      // ── Estimated 1RM PR ───────────────────────────────────────────────────
      if (weight && reps && isValid1RMEstimate(reps)) {
        const e1rm = estimated1RM(weight, reps)
        const existing = await prisma.personalRecord.findFirst({
          where: { userId: user.id, exerciseId, metric: 'estimated_1rm' },
          orderBy: { value: 'desc' },
        })
        if (!existing || Number(existing.value) < e1rm) {
          await prisma.personalRecord.create({
            data: {
              userId: user.id, exerciseId, metric: 'estimated_1rm',
              value: e1rm, unit: 'kg', achievedAt: now, workoutId,
            },
          })
          prs.estimated1rm = true
        }
      }

      // ── Bodyweight rep PR (no weight) ──────────────────────────────────────
      if (reps && !weight) {
        const existing = await prisma.personalRecord.findFirst({
          where: { userId: user.id, exerciseId, metric: 'reps' },
          orderBy: { value: 'desc' },
        })
        if (!existing || Number(existing.value) < reps) {
          await prisma.personalRecord.create({
            data: {
              userId: user.id, exerciseId, metric: 'reps',
              value: reps, unit: 'reps', achievedAt: now, workoutId,
            },
          })
          prs.reps = true
        }
      }

      // ── Session volume PR ──────────────────────────────────────────────────
      if (weight && reps) {
        const siblingExerciseIds = await prisma.workoutExercise.findMany({
          where: { workoutId, exerciseId },
          select: { id: true },
        })
        const sessionSets = await prisma.workoutSet.findMany({
          where: {
            workoutExerciseId: { in: siblingExerciseIds.map(r => r.id) },
            completed: true,
            setType: { not: 'warmup' },
          },
          select: { actualWeightKg: true, actualReps: true },
        })
        const sessionVolume = sessionSets.reduce(
          (sum, s) => sum + (Number(s.actualWeightKg ?? 0) * (s.actualReps ?? 0)), 0
        )
        if (sessionVolume > 0) {
          const existing = await prisma.personalRecord.findFirst({
            where: { userId: user.id, exerciseId, metric: 'volume_kg' },
            orderBy: { value: 'desc' },
          })
          if (!existing || Number(existing.value) < sessionVolume) {
            await prisma.personalRecord.create({
              data: {
                userId: user.id, exerciseId, metric: 'volume_kg',
                value: sessionVolume, unit: 'kg', achievedAt: now, workoutId,
              },
            })
            prs.volume = true
          }
        }
      }
    }

    return Response.json({ set: updated, prs, newPR: Object.keys(prs).length > 0 })
  } catch {
    return Response.json({ error: 'Failed to update set' }, { status: 500 })
  }
}

// ─── DELETE: remove a set ─────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workoutId, setId } = await params

  try {
    const set = await prisma.workoutSet.findFirst({
      where: {
        id: setId,
        workoutExercise: { workoutId, workout: { userId: user.id } },
      },
    })
    if (!set) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.workoutSet.delete({ where: { id: setId } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete set' }, { status: 500 })
  }
}
