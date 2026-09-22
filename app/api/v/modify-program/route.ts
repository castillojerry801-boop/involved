import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/ai/client'
import { workoutModel } from '@/lib/ai/models'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearch } from '@/lib/ai/tools/exercises'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramPreview, GenerationConstraints } from '@/app/api/v/generate-program/route'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage, decrementVUsage } from '@/lib/v/usage'
import { buildVTrainingContext, trainingContextToPrompt } from '@/lib/v/training-context'
import { PROGRAM_INTELLIGENCE_PROMPT } from '@/lib/v/program-intelligence'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `You are Involved V, an AI training program designer making a targeted modification to an existing program.

MODIFICATION RULES — READ CAREFULLY:
• Make ONLY the change the user requested. Nothing else.
• For every day and exercise NOT mentioned in the modification request, reproduce the exact exercise IDs, sets, reps_min, reps_max, duration_seconds, rest_seconds, notes, RPE, and set_type from the existing program. Do not change them.
• Only search for new exercises when the modification explicitly requires replacing or adding an exercise.
• If the user asks to change duration, change only estimated_duration_minutes for the specified day. Leave all exercises in that day intact unless the user also asked to change exercises.
• If the user asks to replace an exercise, search for a replacement with the same movementPattern as the exercise being replaced.
• Complete the Program Review Pass before calling propose_program.
• Only use exercise IDs returned by search_exercises. Never invent IDs.
${PROGRAM_INTELLIGENCE_PROMPT}

USER CONTEXT:
`

function buildConstraintBlock(c: GenerationConstraints): string {
  const lines: string[] = []
  if (c.days)                  lines.push(`Number of days: ${c.days}`)
  if (c.focus)                 lines.push(`Program focus: ${c.focus}`)
  if (c.durationPerDayMinutes) lines.push(`Target duration per session: ${c.durationPerDayMinutes} minutes`)
  if (c.weeks)                 lines.push(`Program duration: ${c.weeks} weeks`)
  if (c.style)                 lines.push(`Training style: ${c.style}`)
  if (c.sport)                 lines.push(`Sport / activity: ${c.sport}`)
  if (c.injuries)              lines.push(`Injuries / limitations: ${c.injuries}`)
  if (c.constraints)           lines.push(`Other constraints: ${c.constraints}`)
  return lines.length > 0
    ? `ORIGINAL CONSTRAINTS (must be preserved even after modification):\n${lines.map(l => `• ${l}`).join('\n')}\n\n`
    : ''
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    draft: ProgramDraft
    modification: string
    constraints?: GenerationConstraints
  }

  if (!body.draft || !body.modification?.trim()) {
    return Response.json({ error: 'Missing draft or modification' }, { status: 400 })
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

  const constraintBlock = body.constraints ? buildConstraintBlock(body.constraints) : ''
  const allowedEquipment = ctx.equipment?.items

  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT + contextSnippet },
    {
      role: 'user',
      content:
        `${constraintBlock}` +
        `EXISTING PROGRAM (copy unchanged parts verbatim):\n\n${JSON.stringify(body.draft, null, 2)}\n\n` +
        `MODIFICATION REQUEST: ${body.modification.trim()}\n\n` +
        `Apply ONLY the requested modification. For every day and every exercise not explicitly changed, ` +
        `copy the exercise ID, sets, reps, rest, notes, and RPE from the existing program without alteration. ` +
        `Then propose the updated program.`,
    },
  ]

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_PROGRAM_TOOL]
  let pendingProgram: ReturnType<typeof validateProgramDraft> | null = null
  let pendingDraft: ProgramDraft | null = null
  const MAX_ROUNDS = 12

  try {
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
          const validation = validateProgramDraft(draft, { allowedEquipment })
          if (validation.valid) {
            pendingProgram = validation
            pendingDraft = draft
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
  } catch {
    await decrementVUsage(user.id, 'workout_generation')
    return Response.json({ error: 'V encountered an error. Please try again.' }, { status: 503 })
  }

  if (!pendingProgram?.valid || !pendingProgram.program || !pendingDraft) {
    await decrementVUsage(user.id, 'workout_generation')
    return Response.json({ error: 'V could not apply the modification. Please try again.' }, { status: 422 })
  }

  const validated = pendingProgram.program

  const preview: ProgramPreview = {
    program_name: validated.program_name,
    description: validated.description,
    primary_goal: pendingDraft.primary_goal,
    weeks: pendingDraft.weeks,
    progression_strategy: pendingDraft.progression_strategy,
    days: validated.days.map(day => ({
      name: day.name,
      focus: day.focus,
      estimated_duration_minutes: day.estimated_duration_minutes ?? 45,
      exercises: day.exercises.map(ex => ({
        exercise_id: ex.exercise_id,
        sets: ex.sets,
        reps_min: ex.reps_min,
        reps_max: ex.reps_max,
        duration_seconds: ex.duration_seconds,
        rest_seconds: ex.rest_seconds,
        notes: ex.notes,
        rpe: ex.rpe,
        set_type: ex.set_type,
        exercise: {
          id: ex.exercise.id,
          name: ex.exercise.name,
          bodyPart: ex.exercise.bodyPart,
          equipment: ex.exercise.equipment,
          target: ex.exercise.target,
        },
      })),
    })),
  }

  return Response.json({ draft: pendingDraft, preview }, { status: 200 })
}
