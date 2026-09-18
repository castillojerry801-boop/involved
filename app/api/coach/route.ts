import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getOpenAI } from '@/lib/ai/client'
import { coachModel } from '@/lib/ai/models'
import { getAiLimit } from '@/lib/subscription/config'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { buildCoachContext, contextToSystemSnippet } from '@/lib/ai/context'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearch } from '@/lib/ai/tools/exercises'
import { PROPOSE_WORKOUT_TOOL, validateWorkoutDraft } from '@/lib/ai/tools/workout'
import type { WorkoutDraft } from '@/lib/ai/tools/workout'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `You are Involved Coach, a knowledgeable and direct personal fitness and nutrition coach built into the Involved app.

ROLE:
You help users train smarter, eat better, and reach their goals. You receive structured summaries of the user's data — you do not access the database directly.

HONESTY RULES — CRITICAL:
• Only state things supported by the user's actual data or trusted fitness knowledge.
• Do not invent workout history, injuries, habits, or preferences the user hasn't shared.
• Do not fabricate exercise IDs. Only use IDs returned by the search_exercises tool.
• Clearly label estimates ("approximately", "typically", "estimated").
• If you don't know something, say so and ask the user.
• Math is done by the app — do not recalculate nutrition totals.

TOOLS:
• Use search_exercises to find valid exercises before building any workout.
• Use propose_workout only after searching — never invent exercise IDs.
• Search multiple times with different filters to build a complete, balanced workout.

TONE:
Direct, encouraging, and practical. Like a coach who knows their athlete. No filler phrases like "Great question!" or "Absolutely!". Get to the point.

SAFETY:
Never diagnose injuries, prescribe medication, or make medical claims. If a user reports pain or injury symptoms, give general guidance and recommend professional evaluation.

USER DATA (provided below):
`

function billingPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function checkAndIncrementUsage(userId: string, tier: 'free' | 'trial' | 'plus') {
  const limit = getAiLimit(tier, 'coach_message')
  const period = billingPeriod()

  try {
    const record = await prisma.aiUsageLog.upsert({
      where: { userId_billingPeriod_feature: { userId, billingPeriod: period, feature: 'coach_message' } },
      update: { interactionCount: { increment: 1 } },
      create: { userId, billingPeriod: period, feature: 'coach_message', interactionCount: 1 },
    })

    if (limit !== null && record.interactionCount > limit) {
      await prisma.aiUsageLog.update({
        where: { userId_billingPeriod_feature: { userId, billingPeriod: period, feature: 'coach_message' } },
        data: { interactionCount: { decrement: 1 } },
      })
      return { allowed: false, count: record.interactionCount - 1, limit }
    }

    return { allowed: true, count: record.interactionCount, limit }
  } catch {
    // DB schema not yet migrated (prisma db push pending) — allow without metering
    return { allowed: true, count: 0, limit }
  }
}

// ─── GET: usage status ────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const period = billingPeriod()
  const [usage, entitlement] = await Promise.all([
    prisma.aiUsageLog.findUnique({
      where: { userId_billingPeriod_feature: { userId: user.id, billingPeriod: period, feature: 'coach_message' } },
    }).catch(() => null),
    getUserEntitlement(user.id),
  ])

  const tier = entitlement.tier
  const limit = getAiLimit(tier, 'coach_message')
  const count = usage?.interactionCount ?? 0
  const nextReset = new Date()
  nextReset.setMonth(nextReset.getMonth() + 1, 1)

  return Response.json({
    tier,
    count,
    limit,
    remaining: limit !== null ? Math.max(0, limit - count) : null,
    resetsAt: nextReset.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
    trialDaysRemaining: entitlement.trialDaysRemaining,
  })
}

// ─── POST: coach message ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await req.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  }
  if (!body.messages?.length) return new Response('No messages', { status: 400 })

  const entitlement = await getUserEntitlement(user.id)
  const tier = entitlement.tier

  // Check usage
  const usage = await checkAndIncrementUsage(user.id, tier)
  if (!usage.allowed) {
    return Response.json(
      { error: 'limit_reached', limit: usage.limit, count: usage.count },
      { status: 429 }
    )
  }

  // Build context
  const ctx = await buildCoachContext(user.id, user.email)
  const contextSnippet = contextToSystemSnippet(ctx)
  // trial users get the plus model
  const model = coachModel(tier === 'free' ? 'free' : 'plus')
  const openai = getOpenAI()

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_WORKOUT_TOOL]
  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT + contextSnippet },
    ...body.messages.map(m => ({ role: m.role, content: m.content } as ChatMessage)),
  ]

  // Agentic tool loop — max 4 rounds to prevent runaway cost
  let pendingWorkout: ReturnType<typeof validateWorkoutDraft> | null = null
  const MAX_ROUNDS = 4

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      tools,
      tool_choice: 'auto',
      max_tokens: 1500,
      temperature: 0.7,
    })

    const choice = response.choices[0]
    chatMessages.push(choice.message)

    // No tool calls — final response
    if (!choice.message.tool_calls?.length) break

    // Execute each tool call
    for (const call of choice.message.tool_calls) {
      const fn = (call as unknown as { function: { name: string; arguments: string } }).function
      let result: string

      if (fn.name === 'search_exercises') {
        const params = JSON.parse(fn.arguments) as Parameters<typeof executeExerciseSearch>[0]
        const exercises = executeExerciseSearch({ ...params, limit: Math.min(params.limit ?? 15, 20) })
        result = exercises.length > 0
          ? JSON.stringify(exercises)
          : JSON.stringify({ message: 'No exercises found for those criteria. Try different filters.' })

      } else if (fn.name === 'propose_workout') {
        const draft = JSON.parse(fn.arguments) as WorkoutDraft
        const validation = validateWorkoutDraft(draft)
        if (validation.valid) {
          pendingWorkout = validation
          result = JSON.stringify({ status: 'valid', message: 'Workout validated. Present it to the user.' })
        } else {
          result = JSON.stringify({ status: 'invalid', errors: validation.errors })
        }
      } else {
        result = JSON.stringify({ error: 'Unknown tool' })
      }

      chatMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
      })
    }
  }

  // Get final text from last assistant message
  const lastMsg = [...chatMessages].reverse().find(m => m.role === 'assistant')
  const finalText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

  // Stream response back with optional workout data
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Send text in chunks for a streaming feel
      const words = finalText.split(' ')
      let i = 0

      function push() {
        if (i < words.length) {
          const chunk = (i > 0 ? ' ' : '') + words[i++]
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`))
          setTimeout(push, 8)
        } else {
          // Send workout if one was validated
          if (pendingWorkout?.valid && pendingWorkout.workout) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'workout', data: pendingWorkout.workout })}\n\n`)
            )
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
          controller.close()
        }
      }

      push()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Usage-Count': String(usage.count),
      'X-Usage-Limit': usage.limit !== null ? String(usage.limit) : 'unlimited',
    },
  })
}
