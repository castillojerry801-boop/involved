import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { ExerciseBehaviorEventType } from '@prisma/client'

type Params = { params: Promise<{ exerciseId: string }> }

const VALID_EVENTS = Object.values(ExerciseBehaviorEventType)

interface EventBody {
  event: ExerciseBehaviorEventType
  workoutId?: string
  programId?: string
  replacedBy?: string
}

// POST: record a behavioral signal for an exercise.
// These are raw signals — they do NOT automatically modify exercise preferences.
// Callers: active workout session (added/removed/completed), program builder (added/removed).
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { exerciseId } = await params
  const body = await req.json() as EventBody

  if (!VALID_EVENTS.includes(body.event)) {
    return Response.json({ error: 'Invalid event type' }, { status: 400 })
  }

  try {
    await prisma.exerciseBehaviorEvent.create({
      data: {
        userId:     user.id,
        exerciseId,
        event:      body.event,
        workoutId:  body.workoutId ?? null,
        programId:  body.programId ?? null,
        replacedBy: body.replacedBy ?? null,
      },
    })
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to record event' }, { status: 500 })
  }
}
