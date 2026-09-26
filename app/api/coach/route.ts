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
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft } from '@/lib/ai/tools/program'
import { validateProgramQuality } from '@/lib/v/program-quality'
import { SYSTEM_PROMPT, EMPTY_SEARCH_RESULT, QUALITY_EXHAUSTED_MESSAGE } from './constants'
import type OpenAI from 'openai'

const QUALITY_RETRY_LIMIT = 2

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
  const trainingCtx = ctx.trainingCtx
  const contextSnippet = contextToSystemSnippet(ctx)
  // gpt-4o-mini for tool-calling rounds: 10x faster, 200k TPM, no rate-limit stalls.
  // Switch to the configured model only for the final prose response (no tool calls).
  const proseModel = coachModel(tier === 'free' ? 'free' : 'plus')
  const toolModel = 'gpt-4o-mini'
  const openai = getOpenAI()

  // Open the stream immediately — the client gets HTTP headers right away and
  // shows the thinking indicator while the tool loop runs in the background.
  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()

  const emitRaw = (event: object) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => {})
  }

  void (async () => {
    const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_WORKOUT_TOOL, PROPOSE_PROGRAM_TOOL]
    type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam

    const chatMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + contextSnippet },
      ...body.messages.map(m => ({ role: m.role, content: m.content } as ChatMessage)),
    ]

    let pendingWorkout: ReturnType<typeof validateWorkoutDraft> | null = null
    let pendingProgram: ReturnType<typeof validateProgramDraft> | null = null
    const MAX_ROUNDS = 12
    let qualityRetries = 0

    // If the user stated gym/commercial access in the conversation, lift the
    // equipment restriction entirely — their words override the DB profile.
    const conversationText = body.messages.map(m => m.content).join(' ').toLowerCase()
    const userStatedGymAccess = /full[\s-]?gym|commercial\s?gym|gym\s?access|well[\s-]?equipped|barbell|squat\s?rack|power\s?rack/.test(conversationText)
    const allowedEquipment = userStatedGymAccess ? undefined : trainingCtx?.equipment?.items

    // useTools: tool-calling rounds use gpt-4o-mini (fast, 200k TPM).
    // Final prose round (no tools) uses the configured proseModel (gpt-4o for plus).
    const callModel = async (
      messages: OpenAI.Chat.ChatCompletionMessageParam[],
      useTools: boolean,
    ) => {
      const selectedModel = useTools ? toolModel : proseModel
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await openai.chat.completions.create({
            model: selectedModel,
            messages,
            ...(useTools ? { tools, tool_choice: 'auto' } : {}),
            max_tokens: useTools ? 4000 : 1500,
            temperature: 0.7,
          })
        } catch (err: unknown) {
          const apiErr = err as { status?: number; headers?: Record<string, string> }
          if (apiErr.status === 429 && attempt < 2) {
            const waitMs =
              parseInt(apiErr.headers?.['retry-after-ms'] ?? '') ||
              (parseInt(apiErr.headers?.['retry-after'] ?? '') * 1000) ||
              30000
            emitRaw({ type: 'status', message: 'V is thinking...' })
            await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 60000)))
            continue
          }
          throw err
        }
      }
      throw new Error('OpenAI 429 retries exhausted')
    }

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let response: Awaited<ReturnType<typeof openai.chat.completions.create>>
        try {
          response = await callModel(chatMessages, true)
        } catch (err: unknown) {
          const status = (err as { status?: number }).status
          if (status === 429) {
            emitRaw({ type: 'text', content: "I'm over capacity right now — please try again in a minute." })
            emitRaw({ type: 'done' })
            return
          }
          throw err
        }

        const choice = response.choices[0]
        chatMessages.push(choice.message)

        if (!choice.message.tool_calls?.length) break

        for (const call of choice.message.tool_calls) {
          const fn = (call as unknown as { function: { name: string; arguments: string } }).function
          let result: string

          if (fn.name === 'search_exercises') {
            emitRaw({ type: 'status', message: 'Searching exercises...' })
            const params = JSON.parse(fn.arguments) as Parameters<typeof executeExerciseSearch>[0]
            const exercises = executeExerciseSearch({ ...params, limit: Math.min(params.limit ?? 15, 20) })
            result = exercises.length > 0
              ? JSON.stringify(exercises)
              : JSON.stringify({ message: EMPTY_SEARCH_RESULT })

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
            emitRaw({ type: 'status', message: qualityRetries > 0 ? 'Refining your program...' : 'Building your program...' })
            const draft = JSON.parse(fn.arguments) as ProgramDraft

            console.log('[V-routing]', {
              userId: user.id,
              intent: 'program_generation',
              toolCalled: 'propose_program',
              draftWeeks: draft.weeks,
              draftDays: draft.days?.length,
            })

            const validation = validateProgramDraft(draft, { allowedEquipment })

            if (!validation.valid) {
              result = JSON.stringify({ status: 'invalid', errors: validation.errors })
            } else {
              const isLongProgram = (draft.weeks ?? 0) >= 8
              if (isLongProgram && trainingCtx && trainingCtx.readinessState === null) {
                result = JSON.stringify({
                  status: 'intake_incomplete',
                  message: "Before building an 8+ week program, you need to understand the user's training background. Ask them first:",
                  questions: ['How long have you been training consistently, if at all?'],
                })
              } else {
                const qualityIssues = validateProgramQuality(draft, {
                  fitnessLevel: trainingCtx?.profile.fitnessLevel,
                  weeks: draft.weeks,
                  readinessState: trainingCtx?.readinessState ?? undefined,
                })
                const hardErrors = qualityIssues.filter(i => i.severity === 'error')

                console.log('[V-quality]', {
                  userId: user.id,
                  weeks: draft.weeks,
                  dayCount: draft.days.length,
                  exerciseCounts: draft.days.map(d => d.exercises.length),
                  qualityErrors: hardErrors.map(i => i.code),
                  qualityRetry: qualityRetries,
                })

                if (hardErrors.length > 0 && qualityRetries < QUALITY_RETRY_LIMIT) {
                  qualityRetries++
                  result = JSON.stringify({
                    status: 'quality_issues',
                    message: `Program passed structural validation but has ${hardErrors.length} quality error(s). Fix ALL listed errors and call propose_program again with a corrected draft. Do not respond to the user yet.`,
                    errors: hardErrors.map(e => `[${e.code}] ${e.message}`),
                  })
                } else if (hardErrors.length > 0) {
                  console.error('[V-quality-retry-exhausted]', { userId: user.id, codes: hardErrors.map(e => e.code) })
                  result = JSON.stringify({
                    status: 'quality_exhausted',
                    message: QUALITY_EXHAUSTED_MESSAGE,
                  })
                } else {
                  pendingProgram = validation
                  result = JSON.stringify({
                    status: 'valid',
                    message: 'Program validated and accepted. Now present it to the user with a brief summary of the program structure and how progression works.',
                  })
                }
              }
            }

          } else {
            result = JSON.stringify({ error: 'Unknown tool' })
          }

          chatMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
        }

        if (pendingProgram?.valid) break
      }

      const lastMsg = [...chatMessages].reverse().find(m => m.role === 'assistant')
      const finalText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

      // Stream text word-by-word for the typing effect
      const words = finalText.split(' ')
      for (let i = 0; i < words.length; i++) {
        emitRaw({ type: 'text', content: (i > 0 ? ' ' : '') + words[i] })
        await new Promise(resolve => setTimeout(resolve, 8))
      }

      if (pendingWorkout?.valid && pendingWorkout.workout) {
        emitRaw({ type: 'workout', data: pendingWorkout.workout })
      }
      if (pendingProgram?.valid && pendingProgram.program) {
        emitRaw({ type: 'program', data: pendingProgram.program })
      }
      emitRaw({ type: 'done' })

    } catch (err: unknown) {
      console.error('[V-coach-error]', err)
      emitRaw({ type: 'text', content: 'Something went wrong on my end. Please try again.' })
      emitRaw({ type: 'done' })
    } finally {
      await writer.close().catch(() => {})
    }
  })()

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Usage-Count': String(usage.count),
      'X-Usage-Limit': usage.limit !== null ? String(usage.limit) : 'unlimited',
    },
  })
}
