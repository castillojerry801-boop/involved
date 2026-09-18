import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/ai/client'
import { MODELS } from '@/lib/ai/models'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage } from '@/lib/v/usage'

export type VoiceIntent =
  | { action: 'log_set'; weightKg?: number; reps?: number; durationSeconds?: number; distanceM?: number; rpe?: number; rir?: number }
  | { action: 'complete_set' }
  | { action: 'skip_exercise' }
  | { action: 'complete_workout' }
  | { action: 'unknown'; rawTranscript: string }

const INTENT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'extract_intent',
    description: 'Extract the user\'s training intent from their voice input',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['log_set', 'complete_set', 'skip_exercise', 'complete_workout', 'unknown'],
          description: 'The action the user is trying to perform',
        },
        weightKg: {
          type: 'number',
          description: 'Weight in kg. Convert lbs to kg by multiplying by 0.453592. If user says "225 pounds" → 102.06',
        },
        reps: {
          type: 'number',
          description: 'Number of reps performed',
        },
        durationSeconds: {
          type: 'number',
          description: 'Duration in seconds for timed exercises',
        },
        distanceM: {
          type: 'number',
          description: 'Distance in meters for cardio',
        },
        rpe: {
          type: 'number',
          description: 'Rate of Perceived Exertion (1–10) if mentioned',
        },
        rir: {
          type: 'number',
          description: 'Reps in Reserve (0–5) if mentioned',
        },
      },
      required: ['action'],
    },
  },
}

const SYSTEM_PROMPT = `You are extracting workout logging intent from voice input.

RULES:
• "185 for 8" → log_set: weight 185 (assume lbs unless clearly kg), reps 8
• "three plates for five" → 3 plates = 3×20kg plates per side + 20kg bar = 140kg, reps 5
• "two wheels" → 2 plates per side = 2×20kg + 20kg bar = 100kg
• "done" or "mark done" → complete_set
• "skip this" or "skip exercise" → skip_exercise
• "finish workout" or "done with workout" → complete_workout
• Always convert lb/pound to kg (multiply by 0.453592)
• If the intent is unclear, use "unknown"
• Weight units: if user says just a number with no unit in a strength context, assume lbs`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const entitlement = await getUserEntitlement(user.id)
  const tier = entitlement.tier

  if (!hasFeatureAccess(tier, 'voice_logging')) {
    return Response.json({ error: 'Involved+ required for voice logging' }, { status: 403 })
  }

  const usage = await checkAndConsumeVUsage(user.id, tier, 'voice_intent')
  if (!usage.allowed) {
    return Response.json({ error: 'limit_reached', limit: usage.limit }, { status: 429 })
  }

  const body = await req.json() as { transcript: string; exerciseName?: string }
  if (!body.transcript?.trim()) {
    return Response.json({ error: 'transcript is required' }, { status: 400 })
  }

  const openai = getOpenAI()
  const contextLine = body.exerciseName ? `\nCurrent exercise: ${body.exerciseName}` : ''

  const response = await openai.chat.completions.create({
    model: MODELS.voice.intent,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT + contextLine },
      { role: 'user', content: body.transcript },
    ],
    tools: [INTENT_TOOL],
    tool_choice: { type: 'function', function: { name: 'extract_intent' } },
    max_tokens: 300,
    temperature: 0,
  })

  const choice = response.choices[0]
  const toolCall = choice.message.tool_calls?.[0]

  if (!toolCall) {
    return Response.json({ intent: { action: 'unknown', rawTranscript: body.transcript } satisfies VoiceIntent })
  }

  const fn = (toolCall as unknown as { function: { arguments: string } }).function
  const extracted = JSON.parse(fn.arguments) as VoiceIntent

  return Response.json({ intent: extracted })
}
