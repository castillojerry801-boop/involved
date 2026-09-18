import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/ai/client'
import { workoutModel } from '@/lib/ai/models'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearch, validateExerciseId } from '@/lib/ai/tools/exercises'
import { getExerciseById } from '@/lib/exercises'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage } from '@/lib/v/usage'
import { buildVTrainingContext, trainingContextToPrompt } from '@/lib/v/training-context'
import type OpenAI from 'openai'

const PROPOSE_SUBSTITUTION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'propose_substitution',
    description: 'Propose 1–3 substitute exercises from the IDs already found via search_exercises. Only use IDs returned by search. Return exact IDs only.',
    parameters: {
      type: 'object',
      properties: {
        substitutes: {
          type: 'array',
          description: 'Array of substitution recommendations, in order of preference',
          items: {
            type: 'object',
            properties: {
              exercise_id: { type: 'string', description: 'ExerciseDB ID from search results' },
              reason:      { type: 'string', description: 'Why this is a good substitute (1 sentence)' },
            },
            required: ['exercise_id', 'reason'],
          },
          minItems: 1,
          maxItems: 3,
        },
      },
      required: ['substitutes'],
    },
  },
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    exerciseId: string
    reason?: string
  }

  if (!body.exerciseId) {
    return Response.json({ error: 'exerciseId is required' }, { status: 400 })
  }

  const original = getExerciseById(body.exerciseId)
  if (!original) {
    return Response.json({ error: 'Exercise not found in library' }, { status: 404 })
  }

  const entitlement = await getUserEntitlement(user.id)
  const tier = entitlement.tier

  if (!hasFeatureAccess(tier, 'workout_generation_ai')) {
    return Response.json({ error: 'Involved+ required for AI substitutions' }, { status: 403 })
  }

  const usage = await checkAndConsumeVUsage(user.id, tier, 'substitution')
  if (!usage.allowed) {
    return Response.json({ error: 'limit_reached', limit: usage.limit }, { status: 429 })
  }

  const ctx = await buildVTrainingContext(user.id)
  const contextSnippet = trainingContextToPrompt(ctx)
  const model = workoutModel(tier === 'free' ? 'free' : 'plus')
  const openai = getOpenAI()

  const reasonLine = body.reason ? `\nREASON FOR SUBSTITUTION: ${body.reason}` : ''

  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are Involved V, a training AI. Find exercise substitutions.

RULES:
• Only use exercise IDs returned by search_exercises. Never invent IDs.
• Search for exercises similar to the one being substituted (same muscle group, similar movement pattern).
• After searching, call propose_substitution with 1–3 options in order of preference.
• Respect the user's equipment and avoid exercises they have excluded.
• The server will validate every ID you propose.

USER CONTEXT:\n${contextSnippet}`,
    },
    {
      role: 'user',
      content: `Find substitutes for: "${original.name}" (target: ${original.target}, equipment: ${original.equipment})${reasonLine}. Search first, then propose.`,
    },
  ]

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_SUBSTITUTION_TOOL]
  let substitutes: Array<{ exercise_id: string; reason: string }> | null = null
  const MAX_ROUNDS = 5

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 1500,
      temperature: 0.5,
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
      } else if (fn.name === 'propose_substitution') {
        const proposal = JSON.parse(fn.arguments) as { substitutes: Array<{ exercise_id: string; reason: string }> }
        const validated = proposal.substitutes.filter(s => validateExerciseId(s.exercise_id))
        if (validated.length > 0) {
          substitutes = validated
          result = JSON.stringify({ status: 'valid', count: validated.length })
        } else {
          result = JSON.stringify({ status: 'invalid', error: 'All proposed IDs are invalid. Search for more exercises first.' })
        }
      } else {
        result = JSON.stringify({ error: 'Unknown tool' })
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }

    if (substitutes) break
  }

  if (!substitutes || substitutes.length === 0) {
    return Response.json({ error: 'V could not find valid substitutes. Please try again.' }, { status: 422 })
  }

  const enriched = substitutes.map(s => {
    const ex = getExerciseById(s.exercise_id)!
    return {
      exerciseId: s.exercise_id,
      name: ex.name,
      target: ex.target,
      equipment: ex.equipment,
      bodyPart: ex.bodyPart,
      gifId: s.exercise_id,
      reason: s.reason,
    }
  })

  return Response.json({ substitutes: enriched })
}
