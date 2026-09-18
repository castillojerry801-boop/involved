import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

type Params = { params: Promise<{ exerciseId: string }> }

type PreferenceState = 'favorite' | 'more_often' | 'normal' | 'less_often' | 'dont_recommend'
const VALID_STATES: PreferenceState[] = ['favorite', 'more_often', 'normal', 'less_often', 'dont_recommend']

// GET: current preference state for one exercise
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { exerciseId } = await params

  try {
    const pref = await prisma.exercisePreference.findUnique({
      where: { userId_exerciseId: { userId: user.id, exerciseId } },
      select: { state: true },
    })
    return Response.json({ state: pref?.state ?? 'normal' })
  } catch {
    return Response.json({ error: 'Failed to load preference' }, { status: 500 })
  }
}

// POST: set preference state for one exercise
// Body: { state: PreferenceState }
// Deletes the row when state is 'normal' (saves space, normal is the default).
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { exerciseId } = await params
  if (!getExerciseById(exerciseId)) {
    return Response.json({ error: 'Exercise not found' }, { status: 404 })
  }

  const { state } = await req.json() as { state: PreferenceState }
  if (!VALID_STATES.includes(state)) {
    return Response.json({ error: 'Invalid state' }, { status: 400 })
  }

  try {
    if (state === 'normal') {
      await prisma.exercisePreference.deleteMany({
        where: { userId: user.id, exerciseId },
      })
      return Response.json({ state: 'normal' })
    }

    const pref = await prisma.exercisePreference.upsert({
      where: { userId_exerciseId: { userId: user.id, exerciseId } },
      create: { userId: user.id, exerciseId, state },
      update: { state },
    })
    return Response.json({ state: pref.state })
  } catch {
    return Response.json({ error: 'Failed to update preference' }, { status: 500 })
  }
}
