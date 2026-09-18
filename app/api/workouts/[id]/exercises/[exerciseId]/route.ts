import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById, isCustomExerciseId } from '@/lib/exercises'
import { verifyCustomExerciseIds } from '@/lib/training/custom-exercises'

type Params = { params: Promise<{ id: string; exerciseId: string }> }

// ─── PATCH: update exercise notes or substitute (change exerciseId) ───────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workoutId, exerciseId } = await params
  const body = await req.json() as { notes?: string; newExerciseId?: string }

  try {
    const exercise = await prisma.workoutExercise.findFirst({
      where: { id: exerciseId, workoutId, workout: { userId: user.id } },
    })
    if (!exercise) return Response.json({ error: 'Not found' }, { status: 404 })

    if (body.newExerciseId !== undefined) {
      if (!isCustomExerciseId(body.newExerciseId) && !getExerciseById(body.newExerciseId)) {
        return Response.json({ error: 'Exercise not found' }, { status: 400 })
      }
      if (!(await verifyCustomExerciseIds([body.newExerciseId], user.id))) {
        return Response.json({ error: 'Custom exercise not found' }, { status: 400 })
      }
    }

    const updated = await prisma.workoutExercise.update({
      where: { id: exerciseId },
      data: {
        ...(body.notes !== undefined && { notes: body.notes.trim() || null }),
        ...(body.newExerciseId !== undefined && { exerciseId: body.newExerciseId }),
      },
    })

    return Response.json({ exercise: updated })
  } catch {
    return Response.json({ error: 'Failed to update exercise' }, { status: 500 })
  }
}

// ─── DELETE: remove exercise from workout ────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workoutId, exerciseId } = await params

  try {
    const exercise = await prisma.workoutExercise.findFirst({
      where: { id: exerciseId, workoutId, workout: { userId: user.id } },
    })
    if (!exercise) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.workoutExercise.delete({ where: { id: exerciseId } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to remove exercise' }, { status: 500 })
  }
}
