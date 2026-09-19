import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getOpenAI } from '@/lib/ai/client'
import { workoutModel } from '@/lib/ai/models'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearch } from '@/lib/ai/tools/exercises'
import { PROPOSE_WORKOUT_TOOL, validateWorkoutDraft } from '@/lib/ai/tools/workout'
import type { WorkoutDraft } from '@/lib/ai/tools/workout'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage } from '@/lib/v/usage'
import { buildVTrainingContext, trainingContextToPrompt } from '@/lib/v/training-context'
import type OpenAI from 'openai'

type TrackingType = 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals'

function inferTrackingType(equipment: string): TrackingType {
  const eq = equipment.toLowerCase()
  if (eq.includes('body weight')) return 'bodyweight'
  if (eq.includes('cardio') || eq.includes('cycle') || eq.includes('treadmill')) return 'cardio'
  return 'strength'
}

const SYSTEM_PROMPT = `You are Involved V, an AI workout designer.

RULES:
• Only use exercise IDs returned by search_exercises. Never invent IDs.
• Search multiple times with different filters to build a balanced workout.
• Respect the user's equipment constraints — only include exercises that match their available equipment.
• Respect the user's exercise preferences (favorites, avoid lists).
• Build a workout appropriate for the user's fitness level and goals.
• Prefer conventional compound movements (e.g., squat, deadlift, bench press, overhead press, pull-up, row) unless equipment or preferences require alternatives.
• The server will validate every exercise ID. Invalid IDs will be rejected.
• After searching, call propose_workout with the final workout.

USER CONTEXT:
`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    title?: string
    focus?: string
    durationMinutes?: number
  }

  const entitlement = await getUserEntitlement(user.id)
  const tier = entitlement.tier

  if (!hasFeatureAccess(tier, 'workout_generation_ai')) {
    return Response.json({ error: 'Involved+ required for AI workout generation' }, { status: 403 })
  }

  const usage = await checkAndConsumeVUsage(user.id, tier, 'workout_generation')
  if (!usage.allowed) {
    return Response.json({ error: 'limit_reached', limit: usage.limit }, { status: 429 })
  }

  const ctx = await buildVTrainingContext(user.id)
  const contextSnippet = trainingContextToPrompt(ctx)
  const model = workoutModel(tier === 'free' ? 'free' : 'plus')
  const openai = getOpenAI()

  const focusLine = body.focus ? `\nWORKOUT FOCUS: ${body.focus}` : ''
  const durationLine = body.durationMinutes ? `\nTARGET DURATION: ${body.durationMinutes} minutes` : ''

  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT + contextSnippet + focusLine + durationLine },
    { role: 'user', content: `Create a${body.focus ? ` ${body.focus}` : ''} workout${body.durationMinutes ? ` in about ${body.durationMinutes} minutes` : ''}. Search for exercises first, then propose the workout.` },
  ]

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_WORKOUT_TOOL]
  let pendingWorkout: ReturnType<typeof validateWorkoutDraft> | null = null
  const MAX_ROUNDS = 6

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 2000,
      temperature: 0.7,
    })

    const choice = response.choices[0]
    messages.push(choice.message)

    if (!choice.message.tool_calls?.length) break

    for (const call of choice.message.tool_calls) {
      const fn = (call as unknown as { function: { name: string; arguments: string } }).function
      let result: string

      if (fn.name === 'search_exercises') {
        const params = JSON.parse(fn.arguments) as Parameters<typeof executeExerciseSearch>[0]
        const exercises = executeExerciseSearch({ ...params, limit: Math.min(params.limit ?? 15, 20) })
        result = exercises.length > 0
          ? JSON.stringify(exercises)
          : JSON.stringify({ message: 'No exercises found. Try different filters.' })
      } else if (fn.name === 'propose_workout') {
        const draft = JSON.parse(fn.arguments) as WorkoutDraft
        const validation = validateWorkoutDraft(draft)
        if (validation.valid) {
          pendingWorkout = validation
          result = JSON.stringify({ status: 'valid', message: 'Workout validated. You are done.' })
        } else {
          result = JSON.stringify({ status: 'invalid', errors: validation.errors })
        }
      } else {
        result = JSON.stringify({ error: 'Unknown tool' })
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }

    if (pendingWorkout?.valid) break
  }

  if (!pendingWorkout?.valid || !pendingWorkout.workout) {
    return Response.json({ error: 'V could not generate a valid workout. Please try again.' }, { status: 422 })
  }

  const validated = pendingWorkout.workout

  const workout = await prisma.workout.create({
    data: {
      userId: user.id,
      title: body.title ?? validated.workout_name,
      notes: validated.description ?? null,
      source: 'coach_generated',
      status: 'planned',
      exercises: {
        create: validated.exercises.map((ex, i) => ({
          exerciseId: ex.exercise_id,
          order: i,
          trackingType: inferTrackingType(ex.exercise.equipment),
          targetSets: ex.sets,
          restSeconds: ex.rest_seconds,
          notes: ex.notes ?? null,
          sets: {
            create: Array.from({ length: ex.sets }, (_, j) => ({
              setNumber: j + 1,
              setType: 'working' as const,
              targetReps: ex.reps ?? null,
              targetDurationSeconds: ex.duration_seconds ?? null,
            })),
          },
        })),
      },
    },
    select: { id: true, title: true },
  })

  return Response.json({ workoutId: workout.id, title: workout.title }, { status: 201 })
}
