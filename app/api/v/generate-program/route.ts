import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getOpenAI } from '@/lib/ai/client'
import { workoutModel } from '@/lib/ai/models'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearch } from '@/lib/ai/tools/exercises'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft } from '@/lib/ai/tools/program'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage } from '@/lib/v/usage'
import { buildVTrainingContext, trainingContextToPrompt } from '@/lib/v/training-context'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `You are Involved V, an AI training program designer.

RULES:
• Only use exercise IDs returned by search_exercises. Never invent IDs.
• Search for exercises for each day separately.
• Distribute muscle groups across days for proper recovery.
• Build the program appropriate for the user's fitness level and goals.
• Respect equipment constraints and exercise preferences.
• After searching, call propose_program with the complete program.

USER CONTEXT:
`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    name?: string
    days?: number
    focus?: string
    durationPerDayMinutes?: number
  }

  const entitlement = await getUserEntitlement(user.id)
  const tier = entitlement.tier

  if (!hasFeatureAccess(tier, 'workout_generation_ai')) {
    return Response.json({ error: 'Involved+ required for AI program generation' }, { status: 403 })
  }

  const usage = await checkAndConsumeVUsage(user.id, tier, 'workout_generation')
  if (!usage.allowed) {
    return Response.json({ error: 'limit_reached', limit: usage.limit }, { status: 429 })
  }

  const ctx = await buildVTrainingContext(user.id)
  const contextSnippet = trainingContextToPrompt(ctx)
  const model = workoutModel(tier === 'free' ? 'free' : 'plus')
  const openai = getOpenAI()

  const daysLine = body.days ? `\nNUMBER OF DAYS: ${body.days}` : ''
  const focusLine = body.focus ? `\nPROGRAM FOCUS: ${body.focus}` : ''
  const durLine = body.durationPerDayMinutes ? `\nTARGET DURATION PER SESSION: ${body.durationPerDayMinutes} minutes` : ''

  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT + contextSnippet + daysLine + focusLine + durLine },
    { role: 'user', content: `Create a ${body.days ?? 3}-day training program${body.focus ? ` focused on ${body.focus}` : ''}. Search for exercises for each day, then propose the program.` },
  ]

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_PROGRAM_TOOL]
  let pendingProgram: ReturnType<typeof validateProgramDraft> | null = null
  const MAX_ROUNDS = 10

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 4000,
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
      } else if (fn.name === 'propose_program') {
        const draft = JSON.parse(fn.arguments) as ProgramDraft
        const validation = validateProgramDraft(draft)
        if (validation.valid) {
          pendingProgram = validation
          result = JSON.stringify({ status: 'valid', message: 'Program validated. You are done.' })
        } else {
          result = JSON.stringify({ status: 'invalid', errors: validation.errors })
        }
      } else {
        result = JSON.stringify({ error: 'Unknown tool' })
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }

    if (pendingProgram?.valid) break
  }

  if (!pendingProgram?.valid || !pendingProgram.program) {
    return Response.json({ error: 'V could not generate a valid program. Please try again.' }, { status: 422 })
  }

  const validated = pendingProgram.program

  const program = await prisma.program.create({
    data: {
      userId: user.id,
      name: body.name ?? validated.program_name,
      description: validated.description ?? null,
      days: {
        create: validated.days.map((day, di) => ({
          name: day.name,
          sortOrder: di,
          exercises: {
            create: day.exercises.map((ex, ei) => ({
              exerciseId: ex.exercise_id,
              sortOrder: ei,
              restSeconds: ex.rest_seconds,
              notes: ex.notes ?? null,
              sets: {
                create: Array.from({ length: ex.sets }, (_, j) => ({
                  setNumber: j + 1,
                  setType: 'working' as const,
                  targetRepsMin: ex.reps ?? null,
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
}
