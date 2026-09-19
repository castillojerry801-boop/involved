import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getOpenAI } from '@/lib/ai/client'
import { coachModel } from '@/lib/ai/models'
import { getAiLimit } from '@/lib/subscription/config'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { buildCoachContext, contextToSystemSnippet } from '@/lib/ai/context'
import { PROGRAM_INTELLIGENCE_PROMPT } from '@/lib/v/program-intelligence'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearch } from '@/lib/ai/tools/exercises'
import { PROPOSE_WORKOUT_TOOL, validateWorkoutDraft } from '@/lib/ai/tools/workout'
import type { WorkoutDraft } from '@/lib/ai/tools/workout'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft } from '@/lib/ai/tools/program'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `You are V, an evidence-informed fitness and nutrition coach built into the Involved app.

ROLE:
You help users train smarter, eat better, and reach their goals. You receive structured summaries of the user's data — you never access the database directly.

════════════════════════════════════════
HONESTY RULES — NON-NEGOTIABLE
════════════════════════════════════════
• Only state things supported by the user's actual data or established fitness knowledge.
• Never invent workout history, injuries, habits, preferences, performance, PRs, heart-rate zones, or any medical fact the user hasn't shared.
• Never fabricate exercise IDs. Only use IDs returned by search_exercises.
• Unknown means unknown — say so, or ask.
• Math is done by the app — do not recalculate nutrition totals.

════════════════════════════════════════
TONE
════════════════════════════════════════
Direct, encouraging, practical. Like a coach who knows their athlete.
No filler phrases ("Great question!", "Absolutely!"). Get to the point.
One clear recommendation, not a menu of options.

════════════════════════════════════════
SAFETY
════════════════════════════════════════
Never diagnose injuries, prescribe medication, or make medical claims.
For reported pain: give general guidance and recommend professional evaluation.

════════════════════════════════════════
TOOLS
════════════════════════════════════════
• search_exercises — find valid exercise IDs. Always search before building any workout or program.
• propose_workout — single training session ("give me a workout", "I have 45 minutes").
• propose_program — structured multi-day plan ("build me a program", "3-day split", "6-week plan").

${PROGRAM_INTELLIGENCE_PROMPT}

════════════════════════════════════════
USER DATA (provided below):
════════════════════════════════════════
`

function billingPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function checkAndIncrementUsage(userId: string, tier: 'free' | 'trial' | 'plus' | 'trainer') {
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

  const usage = await checkAndIncrementUsage(user.id, tier)
  if (!usage.allowed) {
    return Response.json(
      { error: 'limit_reached', limit: usage.limit, count: usage.count },
      { status: 429 }
    )
  }

  const ctx = await buildCoachContext(user.id, user.email)
  const contextSnippet = contextToSystemSnippet(ctx)
  const model = coachModel(tier === 'free' ? 'free' : 'plus')
  const openai = getOpenAI()

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_WORKOUT_TOOL, PROPOSE_PROGRAM_TOOL]
  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT + contextSnippet },
    ...body.messages.map(m => ({ role: m.role, content: m.content } as ChatMessage)),
  ]

  // Agentic tool loop — 10 rounds supports complex program design + review pass
  let pendingWorkout: ReturnType<typeof validateWorkoutDraft> | null = null
  let pendingProgram: ReturnType<typeof validateProgramDraft> | null = null
  const MAX_ROUNDS = 10

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      tools,
      tool_choice: 'auto',
      max_tokens: 4000,
      temperature: 0.7,
    })

    const choice = response.choices[0]
    chatMessages.push(choice.message)

    if (!choice.message.tool_calls?.length) break

    for (const call of choice.message.tool_calls) {
      const fn = (call as unknown as { function: { name: string; arguments: string } }).function
      let result: string

      if (fn.name === 'search_exercises') {
        const params = JSON.parse(fn.arguments) as Parameters<typeof executeExerciseSearch>[0]
        const exercises = executeExerciseSearch({ ...params, limit: Math.min(params.limit ?? 15, 20) })
        result = exercises.length > 0
          ? JSON.stringify(exercises)
          : JSON.stringify({ message: 'No exercises found for those criteria. Try different filters — adjust bodyPart, equipment, or movementPattern.' })

      } else if (fn.name === 'propose_workout') {
        const draft = JSON.parse(fn.arguments) as WorkoutDraft
        const validation = validateWorkoutDraft(draft)
        if (validation.valid) {
          pendingWorkout = validation
          result = JSON.stringify({ status: 'valid', message: 'Workout validated. Present it to the user.' })
        } else {
          result = JSON.stringify({ status: 'invalid', errors: validation.errors })
        }

      } else if (fn.name === 'propose_program') {
        const draft = JSON.parse(fn.arguments) as ProgramDraft
        const validation = validateProgramDraft(draft)
        if (validation.valid) {
          pendingProgram = validation
          // Inject the quality-review instruction so V self-reviews before finalizing
          result = JSON.stringify({
            status: 'valid',
            message: [
              'Program structure validated — all exercise IDs verified.',
              'REQUIRED: Run your Program Review Pass now before writing your response.',
              'Check every day:',
              '(1) Any day with multiple exercises sharing the same movementPattern is a redundancy problem — revise unless specialization was explicitly requested.',
              '(2) Each session must represent its major required movement patterns for its stated purpose.',
              '(3) Exercise order: compounds before isolation, technique before fatigue.',
              '(4) Volume must match user experience level.',
              '(5) Adjacent training days must allow adequate recovery.',
              '(6) All exercises must be compatible with the user\'s available equipment.',
              '(7) Program complexity, exercise selection, and progression must be appropriate for this user\'s experience level.',
              'If any check fails, call propose_program again with corrections.',
              'If all checks pass, write your response describing the program.',
            ].join(' '),
          })
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

  const lastMsg = [...chatMessages].reverse().find(m => m.role === 'assistant')
  const finalText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const words = finalText.split(' ')
      let i = 0

      function push() {
        if (i < words.length) {
          const chunk = (i > 0 ? ' ' : '') + words[i++]
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`))
          setTimeout(push, 8)
        } else {
          if (pendingWorkout?.valid && pendingWorkout.workout) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'workout', data: pendingWorkout.workout })}\n\n`)
            )
          }
          if (pendingProgram?.valid && pendingProgram.program) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'program', data: pendingProgram.program })}\n\n`)
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
