import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import type { VoiceIntent } from '../intent/route'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const entitlement = await getUserEntitlement(user.id)
  if (!hasFeatureAccess(entitlement.tier, 'voice_logging')) {
    return Response.json({ error: 'Involved+ required for voice logging' }, { status: 403 })
  }

  const body = await req.json() as {
    intent: VoiceIntent
    workoutId: string
    workoutExerciseId: string
    setId: string
  }

  if (!body.intent || !body.workoutId || !body.workoutExerciseId || !body.setId) {
    return Response.json({ error: 'intent, workoutId, workoutExerciseId, and setId are required' }, { status: 400 })
  }

  const set = await prisma.workoutSet.findUnique({
    where: { id: body.setId },
    include: {
      workoutExercise: {
        include: { workout: { select: { userId: true } } },
      },
    },
  })

  if (!set || set.workoutExercise.workout.userId !== user.id) {
    return Response.json({ error: 'Set not found' }, { status: 404 })
  }

  const { intent } = body

  if (intent.action === 'log_set') {
    const updateData: Record<string, unknown> = {
      completed: true,
      completedAt: new Date(),
    }
    if (intent.weightKg !== undefined) updateData.actualWeightKg = intent.weightKg
    if (intent.reps !== undefined) updateData.actualReps = intent.reps
    if (intent.durationSeconds !== undefined) updateData.actualDurationSeconds = intent.durationSeconds
    if (intent.distanceM !== undefined) updateData.actualDistanceM = intent.distanceM
    if (intent.rpe !== undefined) updateData.rpe = Math.min(10, Math.max(1, Math.round(intent.rpe)))
    if (intent.rir !== undefined) updateData.rir = Math.min(5, Math.max(0, Math.round(intent.rir)))

    const updated = await prisma.workoutSet.update({
      where: { id: body.setId },
      data: updateData,
    })

    return Response.json({ action: 'logged', set: updated })
  }

  if (intent.action === 'complete_set') {
    const updated = await prisma.workoutSet.update({
      where: { id: body.setId },
      data: { completed: true, completedAt: new Date() },
    })
    return Response.json({ action: 'completed', set: updated })
  }

  if (intent.action === 'skip_exercise') {
    return Response.json({ action: 'skip_exercise', workoutExerciseId: body.workoutExerciseId })
  }

  if (intent.action === 'complete_workout') {
    const workout = await prisma.workout.findUnique({
      where: { id: body.workoutId },
      select: { userId: true, status: true },
    })
    if (!workout || workout.userId !== user.id) {
      return Response.json({ error: 'Workout not found' }, { status: 404 })
    }
    if (workout.status !== 'in_progress') {
      return Response.json({ error: 'Workout is not in progress' }, { status: 400 })
    }
    await prisma.workout.update({
      where: { id: body.workoutId },
      data: { status: 'completed', completedAt: new Date() },
    })
    return Response.json({ action: 'completed_workout' })
  }

  return Response.json({ action: 'unknown', rawTranscript: (intent as { rawTranscript?: string }).rawTranscript ?? '' })
}
