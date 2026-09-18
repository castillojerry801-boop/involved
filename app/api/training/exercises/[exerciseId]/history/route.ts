import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ exerciseId: string }> }

// GET: last N completed sessions for an exercise (used on workout screen for last-session reference)

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { exerciseId } = await params
  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '5'), 20)

  try {
    const sessions = await prisma.workoutExercise.findMany({
      where: {
        exerciseId,
        workout: { userId: user.id, status: 'completed' },
      },
      include: {
        sets: {
          where: { completed: true },
          orderBy: { setNumber: 'asc' },
          select: {
            setNumber: true,
            setType: true,
            actualReps: true,
            actualWeightKg: true,
            actualDurationSeconds: true,
            actualDistanceM: true,
            rpe: true,
            rir: true,
          },
        },
        workout: {
          select: { id: true, completedAt: true, title: true },
        },
      },
      orderBy: { workout: { completedAt: 'desc' } },
      take: limit,
    })

    return Response.json({ sessions })
  } catch {
    return Response.json({ error: 'Failed to load history' }, { status: 500 })
  }
}
