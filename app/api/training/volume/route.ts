import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Math.min(parseInt(req.nextUrl.searchParams.get('days') ?? '7'), 90)
  const from = new Date()
  from.setDate(from.getDate() - days)

  try {
    const workouts = await prisma.workout.findMany({
      where: {
        userId: user.id,
        status: 'completed',
        completedAt: { gte: from },
      },
      include: {
        exercises: {
          include: {
            sets: {
              where: { completed: true, setType: { not: 'warmup' } },
              orderBy: { setNumber: 'asc' },
            },
          },
        },
      },
      orderBy: { completedAt: 'asc' },
    })

    // Aggregate by target muscle
    const muscleMap = new Map<string, {
      muscle: string
      bodyPart: string
      workingSets: number
      totalReps: number
      totalVolumeKg: number
      lastTrainedAt: Date
      sessionDates: Set<string>
    }>()

    for (const workout of workouts) {
      const date = workout.completedAt!
      const dateStr = date.toISOString().slice(0, 10)

      for (const we of workout.exercises) {
        const ex = getExerciseById(we.exerciseId)
        if (!ex || we.sets.length === 0) continue

        const muscle = ex.target ?? ex.bodyPart ?? 'other'
        const bodyPart = ex.bodyPart ?? 'other'

        let entry = muscleMap.get(muscle)
        if (!entry) {
          entry = { muscle, bodyPart, workingSets: 0, totalReps: 0, totalVolumeKg: 0, lastTrainedAt: date, sessionDates: new Set() }
          muscleMap.set(muscle, entry)
        }

        for (const s of we.sets) {
          entry.workingSets += 1
          entry.totalReps += s.actualReps ?? 0
          entry.totalVolumeKg += (Number(s.actualWeightKg ?? 0)) * (s.actualReps ?? 0)
          entry.sessionDates.add(dateStr)
          if (date > entry.lastTrainedAt) entry.lastTrainedAt = date
        }
      }
    }

    const muscles = Array.from(muscleMap.values())
      .map(e => ({
        muscle: e.muscle,
        bodyPart: e.bodyPart,
        workingSets: e.workingSets,
        totalReps: e.totalReps,
        totalVolumeKg: Math.round(e.totalVolumeKg),
        lastTrainedAt: e.lastTrainedAt.toISOString(),
        sessionCount: e.sessionDates.size,
      }))
      .sort((a, b) => b.workingSets - a.workingSets)

    return Response.json({ muscles, period: { from: from.toISOString(), days } })
  } catch {
    return Response.json({ error: 'Failed to load volume data' }, { status: 500 })
  }
}
