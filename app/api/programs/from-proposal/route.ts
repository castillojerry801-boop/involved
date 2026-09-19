import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft } from '@/lib/ai/tools/program'

type TrackingType = 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals'

function inferTrackingType(equipment: string): TrackingType {
  const eq = equipment.toLowerCase()
  if (eq.includes('body weight')) return 'bodyweight'
  if (eq.includes('cardio') || eq.includes('cycle') || eq.includes('treadmill')) return 'cardio'
  return 'strength'
}

// Saves a program proposed by V in the coach chat.
// Re-validates all exercise IDs against the local library before writing.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as ProgramDraft

  const validation = validateProgramDraft(body)
  if (!validation.valid || !validation.program) {
    return Response.json({ error: 'Invalid program data', details: validation.errors }, { status: 400 })
  }

  const validated = validation.program

  try {
    const program = await prisma.program.create({
      data: {
        userId: user.id,
        name: validated.program_name,
        description: validated.description ?? null,
        days: {
          create: validated.days.map((day, di) => ({
            name: day.name,
            focus: day.focus ?? null,
            estimatedDurationMinutes: day.estimated_duration_minutes ?? null,
            sortOrder: di,
            exercises: {
              create: day.exercises.map((ex, ei) => ({
                exerciseId: ex.exercise_id,
                sortOrder: ei,
                trackingType: inferTrackingType(ex.exercise.equipment),
                restSeconds: ex.rest_seconds,
                notes: ex.notes ?? null,
                sets: {
                  create: Array.from({ length: ex.sets }, (_, j) => ({
                    setNumber: j + 1,
                    setType: 'working' as const,
                    targetRepsMin: ex.reps_min ?? null,
                    targetRepsMax: ex.reps_max ?? null,
                    targetDurationSeconds: ex.duration_seconds ?? null,
                    restSeconds: ex.rest_seconds,
                  })),
                },
              })),
            },
          })),
        },
      },
      select: { id: true, name: true },
    })

    return Response.json({ programId: program.id, name: program.name }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to save program' }, { status: 500 })
  }
}
