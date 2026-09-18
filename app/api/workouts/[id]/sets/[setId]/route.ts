import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string; setId: string }> }

// ─── PATCH: update a logged set ───────────────────────────────────────────────

interface UpdateSetBody {
  actualReps?: number | null
  actualWeightKg?: number | null
  actualDurationSeconds?: number | null
  actualDistanceM?: number | null
  rpe?: number | null
  completed?: boolean
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workoutId, setId } = await params
  const body = await req.json() as UpdateSetBody

  try {
    // Verify ownership via workout chain
    const set = await prisma.workoutSet.findFirst({
      where: {
        id: setId,
        workoutExercise: { workoutId, workout: { userId: user.id } },
      },
    })
    if (!set) return Response.json({ error: 'Not found' }, { status: 404 })

    const now = new Date()
    const isCompleted = body.completed !== false && (
      body.actualReps != null || body.actualDurationSeconds != null
    )

    const updated = await prisma.workoutSet.update({
      where: { id: setId },
      data: {
        actualReps:            body.actualReps ?? undefined,
        actualWeightKg:        body.actualWeightKg ?? undefined,
        actualDurationSeconds: body.actualDurationSeconds ?? undefined,
        actualDistanceM:       body.actualDistanceM ?? undefined,
        rpe:                   body.rpe ?? undefined,
        completed:             isCompleted,
        completedAt:           isCompleted ? (set.completedAt ?? now) : null,
      },
    })

    return Response.json({ set: updated })
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
