import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft } from '@/lib/ai/tools/program'

type TrackingType = 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals'
type SetType = 'working' | 'warmup' | 'amrap'

function inferTrackingType(equipment: string): TrackingType {
  const eq = equipment.toLowerCase()
  if (eq.includes('body weight')) return 'bodyweight'
  if (eq.includes('cardio') || eq.includes('cycle') || eq.includes('treadmill')) return 'cardio'
  return 'strength'
}

function coerceSetType(raw?: string): SetType {
  if (raw === 'warmup' || raw === 'amrap') return raw
  return 'working'
}

// Saves a V-generated program draft to the database.
// Re-validates all exercise IDs before writing — prevents any client-side tampering.
// Does NOT consume an AI usage credit (credit was consumed at preview generation).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { draft: ProgramDraft; name?: string }
  if (!body.draft) return Response.json({ error: 'Missing draft' }, { status: 400 })

  // Allow caller to override the program name (e.g., user renamed it before saving)
  const draftToSave: ProgramDraft = body.name
    ? { ...body.draft, program_name: body.name }
    : body.draft

  const validation = validateProgramDraft(draftToSave)
  if (!validation.valid || !validation.program) {
    return Response.json({ error: 'Invalid program data', details: validation.errors }, { status: 400 })
  }

  const validated = validation.program

  // Build a description that captures weeks + progression strategy if present
  let description = validated.description ?? null
  const draft = body.draft
  const extras: string[] = []
  if (draft.primary_goal)       extras.push(`Goal: ${draft.primary_goal}`)
  if (draft.weeks)              extras.push(`Duration: ${draft.weeks} weeks`)
  if (draft.progression_strategy) extras.push(`Progression: ${draft.progression_strategy}`)
  if (extras.length && !description?.includes(extras[0])) {
    description = extras.join(' · ') + (description ? '\n\n' + description : '')
  }

  try {
    const program = await prisma.program.create({
      data: {
        userId: user.id,
        name: validated.program_name,
        description,
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
                  create: Array.from({ length: ex.sets }, (_, j) => {
                    const trackingType = inferTrackingType(ex.exercise.equipment)
                    const isTimedOnly = ex.duration_seconds != null && ex.reps_min == null && ex.reps_max == null
                    const targetRir = (ex.rpe != null && !isTimedOnly && trackingType !== 'cardio')
                      ? Math.max(0, Math.min(10, Math.round(10 - ex.rpe)))
                      : undefined
                    return {
                      setNumber: j + 1,
                      setType: coerceSetType(ex.set_type) as SetType,
                      targetRepsMin: ex.reps_min ?? null,
                      targetRepsMax: ex.reps_max ?? null,
                      targetDurationSeconds: ex.duration_seconds ?? null,
                      restSeconds: ex.rest_seconds,
                      ...(targetRir !== undefined ? { targetRir } : {}),
                    }
                  }),
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
