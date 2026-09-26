import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getOpenAI } from '@/lib/ai/client'
import { coachModel, V_CHAT_MODEL, V_PROGRAM_MODEL, V_ESCALATION_MODEL, validateModelConfig, describeOpenAIError, isModelNotFoundError, isUnsupportedParamError } from '@/lib/ai/models'
import { getAiLimit } from '@/lib/subscription/config'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { buildCoachContext, contextToSystemSnippet } from '@/lib/ai/context'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearch } from '@/lib/ai/tools/exercises'
import { PROPOSE_WORKOUT_TOOL, validateWorkoutDraft } from '@/lib/ai/tools/workout'
import type { WorkoutDraft } from '@/lib/ai/tools/workout'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft } from '@/lib/ai/tools/program'
import { validateProgramQuality } from '@/lib/v/program-quality'
import { extractEquipmentFromConversation, buildEquipmentCapabilitySummary } from '@/lib/v/equipment-normalize'
import { parseProgramIntake, missingProgramContext, buildMissingContextPrompt } from '@/lib/v/program-intake'
import { SYSTEM_PROMPT, EMPTY_SEARCH_RESULT, QUALITY_EXHAUSTED_MESSAGE, GENERATION_FAILED_MESSAGE, GENERATION_FAILED_ALT_MESSAGE, PROGRAM_INTENT_PATTERN } from './constants'
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
  const t0 = Date.now()
  const supabase = await createClient()
  const [{ data: { user } }, body] = await Promise.all([
    supabase.auth.getUser(),
    req.json() as Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: string }> }>,
  ])
  if (!user) return new Response('Unauthorized', { status: 401 })
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

  const tCtx = Date.now()
  const ctx = await buildCoachContext(user.id, user.email)
  console.log(`[V-perf] context=${Date.now() - tCtx}ms auth_to_ctx=${tCtx - t0}ms`)
  const trainingCtx = ctx.trainingCtx
  const contextSnippet = contextToSystemSnippet(ctx)
  // ── Cost-conscious model routing ─────────────────────────────────────────────
  //   chatModel      — cheap/fast: chat, intake, clarification, exercise-search
  //                    orchestration, simple factual responses.
  //   programModel   — stronger-but-low-cost: full structured ProgramDraft drafting.
  //   escalationModel— strongest: ONLY the final recovery attempt when a drafted
  //                    program still has hard validation errors after normal retries.
  const proseModel = coachModel(tier === 'free' ? 'free' : 'plus')
  const chatModel = V_CHAT_MODEL
  const programModel = V_PROGRAM_MODEL
  const escalationModel = V_ESCALATION_MODEL
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

    // Extract equipment from conversation first. Explicit user-stated equipment
    // (normalized to canonical ExerciseDB values) always overrides the DB profile.
    // null means "no restriction" (full gym stated or no equipment detected).
    const conversationText = body.messages.map(m => m.content).join('\n')
    const conversationEquipment = extractEquipmentFromConversation(conversationText)
    const allowedEquipment = conversationEquipment ?? trainingCtx?.equipment?.items

    // ── Structured program-intake state ──────────────────────────────────────
    // Single source of truth for the request, re-derived from the whole
    // conversation each turn (the client resends full history) merged with the
    // DB profile. Conversation-stated values win over the DB.
    const intake = parseProgramIntake(body.messages, trainingCtx)
    const missingContext = missingProgramContext(intake, trainingCtx)
    // Program intent is a property of the whole conversation, not just the last
    // message — the user's answer to "what equipment?" doesn't itself look like a
    // program request, but the intake is still in flight.
    const conversationHasProgramIntent = body.messages.some(
      m => m.role === 'user' && PROGRAM_INTENT_PATTERN.test(m.content)
    )
    // We are in program-generation mode only once all required context is present.
    // This is what routes the tool loop to the stronger programModel — intake and
    // plain chat stay on the cheap chatModel.
    const programGenerationMode = conversationHasProgramIntent && missingContext.length === 0
    // Shallow config check surfaced BEFORE the call — a bad env value logs a clear
    // config error rather than only failing deep inside the model call.
    if (programGenerationMode) {
      const cfg = validateModelConfig({ program: programModel, escalation: escalationModel })
      if (!cfg.ok) console.error('[V-config-error]', { userId: user.id, issues: cfg.issues, programModel, escalationModel })
      console.log('[V-config]', { userId: user.id, chatModel, programModel, escalationModel })
    }
    console.log('[V-intake]', {
      userId: user.id,
      readinessState: intake.readinessState,
      readinessSource: intake.readinessSource,
      trainingDaysPerWeek: intake.trainingDaysPerWeek,
      trainingDaysSource: intake.trainingDaysSource,
      trainingLocation: intake.trainingLocation,
      primaryGoal: intake.primaryGoal,
      secondaryGoals: intake.secondaryGoals,
      weeks: intake.weeks,
      conversationHasProgramIntent,
      missing: missingContext.map(m => m.field),
    })

    // ── Loop protection ──────────────────────────────────────────────────────
    // The client resends the full history, so the prior assistant turn is right
    // here. If we're about to emit a message identical to the last one with no
    // state change, that's a no-progress loop — block it.
    const priorAssistant = body.messages.filter(m => m.role === 'assistant').map(m => m.content)
    const lastAssistantText = priorAssistant[priorAssistant.length - 1] ?? ''
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
    const wouldRepeatLast = (msg: string) => lastAssistantText !== '' && norm(msg) === norm(lastAssistantText)

    const streamText = async (msg: string) => {
      const words = msg.split(' ')
      for (let i = 0; i < words.length; i++) {
        emitRaw({ type: 'text', content: (i > 0 ? ' ' : '') + words[i] })
        await new Promise(resolve => setTimeout(resolve, 8))
      }
    }

    console.log('[V-equipment]', {
      userId: user.id,
      conversationEquipment,
      dbEquipment: trainingCtx?.equipment?.items ?? null,
      resolved: allowedEquipment ?? 'unrestricted',
    })

    // Build a capability summary so V knows exact canonical names + movement patterns.
    // Injected into the system prompt — prevents "can't find exercises" errors.
    const equipmentCapabilitySummary = allowedEquipment?.length
      ? '\n\n' + buildEquipmentCapabilitySummary(allowedEquipment)
      : '\n\nEQUIPMENT: Full gym access assumed — all movement patterns and equipment available.'

    const chatMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + contextSnippet + equipmentCapabilitySummary },
      ...body.messages.map(m => ({ role: m.role, content: m.content } as ChatMessage)),
    ]

    let pendingWorkout: ReturnType<typeof validateWorkoutDraft> | null = null
    let pendingProgram: ReturnType<typeof validateProgramDraft> | null = null
    const MAX_ROUNDS = 12
    let qualityRetries = 0
    // Freeform guard state — tracks whether the model attempted program generation
    // without producing a validated result. If true at loop exit, the server asks
    // for the missing intake field (or a controlled failure) instead of streaming
    // the model's untrusted text.
    let proposeProgramAttempted = false
    let hadSearchCalls = false
    let qualityExhausted = false
    let modelEscalated = false
    // Deduplicates repeated searches with identical params within one generation turn.
    const searchCache = new Map<string, string>()

    // ── AUTHORITATIVE PRE-GENERATION GATE ────────────────────────────────────
    // The single deterministic checkpoint. It runs BEFORE any exercise search and
    // BEFORE any propose_program call. If required program context is missing, we
    // do NOT let the model search or generate — we ask only for the missing
    // field(s). This is what prevents generation starting on incomplete context
    // (e.g. trainingDaysPerWeek never supplied) and the resulting failure loop.
    if (conversationHasProgramIntent && missingContext.length > 0) {
      let prompt = buildMissingContextPrompt(missingContext)!
      console.log('[V-model]', { userId: user.id, stage: 'intake', model: 'deterministic' })

      // Loop protection — if we're about to re-ask the EXACT question we asked last
      // turn, the user presumably just answered it. Re-run extraction is already
      // done (parseProgramIntake ran on the full history); if the field is STILL
      // missing, that's an intake-state error, not a reason to parrot the question.
      if (wouldRepeatLast(prompt)) {
        const askedField = missingContext[0].field
        const lastUser = [...body.messages].reverse().find(m => m.role === 'user')?.content ?? ''
        console.error('[V-intake-error]', {
          userId: user.id,
          field: askedField,
          lastUser,
          reason: 'about_to_repeat_intake_question_after_user_reply',
          note: 'extraction did not resolve the field from the latest answer',
        })
        // Prefer moving to the next missing field so we never emit an identical
        // repeat. If this is the only missing field, ask a disambiguated variant
        // once (different text → cannot form an identical-message loop).
        const next = missingContext.find(m => m.field !== askedField)
        prompt = next
          ? next.question
          : `Just to confirm — ${prompt.charAt(0).toLowerCase()}${prompt.slice(1)} (a number from 1 to 7)`
      }

      console.log('[V-pregate]', {
        userId: user.id,
        missing: missingContext.map(m => m.field),
        asked: missingContext[0].field,
        action: 'ask_before_search_and_generation',
      })
      await streamText(prompt)
      emitRaw({ type: 'done' })
      await writer.close().catch(() => {})
      return
    }

    // Token + timing telemetry, accumulated across all rounds.
    let promptTokens = 0
    let completionTokens = 0
    const logModelSummary = (outcome: string) => {
      console.log('[V-model-summary]', {
        userId: user.id,
        stage: programGenerationMode ? 'program_generation' : 'chat_intake',
        programModel: programGenerationMode ? programModel : chatModel,
        escalated: modelEscalated,
        escalationModel: modelEscalated ? escalationModel : null,
        qualityRetries,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        totalMs: Date.now() - t0,
        outcome,
      })
    }

    // Resolve the model for a tool round from the current state:
    //   escalation (Sol) > program-generation (Luna) > chat/intake/search (mini).
    const toolRoundModel = () =>
      modelEscalated ? escalationModel : (programGenerationMode ? programModel : chatModel)

    const callModel = async (
      messages: OpenAI.Chat.ChatCompletionMessageParam[],
      useTools: boolean,
    ) => {
      const selectedModel = useTools ? toolRoundModel() : proseModel
      // Intake turns (no prior tool calls) only need ~500 tokens — V asks one short question.
      // Once tool calls begin, use the full 4000 for exercise lists and program drafts.
      const hasToolHistory = messages.some(m => m.role === 'tool')
      const maxTokens = useTools ? (hasToolHistory ? 4000 : 500) : 1500
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await openai.chat.completions.create({
            model: selectedModel,
            messages,
            ...(useTools ? { tools, tool_choice: 'auto' } : {}),
            max_tokens: maxTokens,
            temperature: 0.7,
          })
          if (res.usage) {
            promptTokens += res.usage.prompt_tokens ?? 0
            completionTokens += res.usage.completion_tokens ?? 0
          }
          return res
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
        const roundStage = modelEscalated
          ? 'quality_escalation'
          : (programGenerationMode ? 'program_generation' : 'chat_intake')
        try {
          const tRound = Date.now()
          console.log('[V-model]', { userId: user.id, stage: roundStage, model: toolRoundModel(), round })
          response = await callModel(chatMessages, true)
          console.log(`[V-perf] round=${round} llm=${Date.now() - tRound}ms`)
        } catch (err: unknown) {
          const info = describeOpenAIError(err)
          if (info.status === 429) {
            emitRaw({ type: 'text', content: "I'm over capacity right now — please try again in a minute." })
            emitRaw({ type: 'done' })
            logModelSummary('rate_limited')
            return
          }

          // Surface the EXACT model/API error instead of swallowing it into the
          // generic handler. Do NOT silently fall back to another model.
          const failedModel = toolRoundModel()
          if (isModelNotFoundError(info)) {
            console.error('[V-config-error]', {
              userId: user.id,
              stage: roundStage,
              model: failedModel,
              status: info.status, code: info.code, message: info.message,
              hint: `The configured model "${failedModel}" is not available to this OpenAI project. Set the matching AI_MODEL_V_* env var to a valid model ID.`,
            })
          } else if (isUnsupportedParamError(info)) {
            console.error('[V-model-error]', {
              userId: user.id,
              stage: roundStage,
              model: failedModel,
              status: info.status, code: info.code, param: info.param, message: info.message,
              hint: `Model "${failedModel}" rejected a request parameter (likely max_tokens/temperature). It may require different parameters than the chat model.`,
            })
          } else {
            console.error('[V-model-error]', {
              userId: user.id,
              stage: roundStage,
              model: failedModel,
              status: info.status, code: info.code, type: info.type, message: info.message,
            })
          }
          logModelSummary('model_error')
          emitRaw({ type: 'text', content: "I couldn't reach the program builder just now. Please try again in a moment." })
          emitRaw({ type: 'done' })
          return
        }

        const choice = response.choices[0]
        chatMessages.push(choice.message)

        if (!choice.message.tool_calls?.length) break

        for (const call of choice.message.tool_calls) {
          const fn = (call as unknown as { function: { name: string; arguments: string } }).function
          let result: string

          if (fn.name === 'search_exercises') {
            hadSearchCalls = true
            const params = JSON.parse(fn.arguments) as Parameters<typeof executeExerciseSearch>[0]
            const normalizedParams = { ...params, limit: Math.min(params.limit ?? 15, 20) }
            const cacheKey = JSON.stringify(normalizedParams)
            if (searchCache.has(cacheKey)) {
              result = searchCache.get(cacheKey)!
            } else {
              emitRaw({ type: 'status', message: 'Searching exercises...' })
              const found = executeExerciseSearch(normalizedParams)
              result = found.length > 0
                ? JSON.stringify(found)
                : JSON.stringify({ message: EMPTY_SEARCH_RESULT })
              searchCache.set(cacheKey, result)
            }

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
            proposeProgramAttempted = true
            emitRaw({ type: 'status', message: qualityRetries > 0 ? 'Refining your program...' : 'Building your program...' })
            let draft: ProgramDraft
            try {
              draft = JSON.parse(fn.arguments) as ProgramDraft
            } catch {
              result = JSON.stringify({ status: 'invalid', errors: ['Malformed program draft — could not parse JSON arguments.'] })
              chatMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
              continue
            }

            console.log('[V-routing]', {
              userId: user.id,
              intent: 'program_generation',
              toolCalled: 'propose_program',
              draftWeeks: draft.weeks,
              draftDays: draft.days?.length,
            })

            let validation: ReturnType<typeof validateProgramDraft>
            try {
              validation = validateProgramDraft(draft, { allowedEquipment })
            } catch (valErr) {
              console.error('[V-propose-program-validate-error]', valErr)
              result = JSON.stringify({ status: 'invalid', errors: ['Internal validation error — please revise the draft and try again.'] })
              chatMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
              continue
            }

            if (!validation.valid) {
              result = JSON.stringify({ status: 'invalid', errors: validation.errors })
            } else {
              // Readiness from the structured intake state (conversation wins over DB).
              const effectiveReadinessState = intake.readinessState
              const isLongProgram = (draft.weeks ?? 0) >= 8
              if (isLongProgram && effectiveReadinessState === null) {
                result = JSON.stringify({
                  status: 'intake_incomplete',
                  message: "Before building an 8+ week program, you need to understand the user's training background. Ask them first:",
                  questions: ['How long have you been training consistently, if at all?'],
                })
              } else {
                const qualityIssues = validateProgramQuality(draft, {
                  fitnessLevel: trainingCtx?.profile.fitnessLevel,
                  weeks: draft.weeks,
                  readinessState: effectiveReadinessState ?? undefined,
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
                } else if (hardErrors.length > 0 && !modelEscalated) {
                  // Luna exhausted its quality-retry budget. Escalate the FINAL
                  // recovery attempt to the strongest model (Sol) with a fresh
                  // budget — a genuinely different strategy, not a re-ask. Sol is
                  // reached only here: context complete, program drafted, hard
                  // errors persist after normal retries.
                  console.warn('[V-model]', { userId: user.id, stage: 'quality_escalation', model: escalationModel, from: programModel, codes: hardErrors.map(e => e.code) })
                  modelEscalated = true
                  qualityRetries = 0
                  emitRaw({ type: 'status', message: 'Refining your program...' })
                  result = JSON.stringify({
                    status: 'quality_issues',
                    message: `Program has ${hardErrors.length} quality error(s). Fix ALL listed errors and call propose_program again with a corrected draft. Do not respond to the user yet.`,
                    errors: hardErrors.map(e => `[${e.code}] ${e.message}`),
                  })
                } else if (hardErrors.length > 0) {
                  console.error('[V-quality-retry-exhausted]', { userId: user.id, codes: hardErrors.map(e => e.code), escalated: modelEscalated })
                  qualityExhausted = true
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

        if (pendingProgram?.valid || qualityExhausted) break
      }

      // ── Freeform guard ───────────────────────────────────────────────────────
      // If program generation was attempted but no valid program emerged, the
      // model's final text is untrusted — it may be an improvised outline or
      // "I'll use common movements" fallback. Instead of streaming it, decide what
      // to say from the STRUCTURED INTAKE STATE, not a hardcoded question.
      const generationFailed =
        qualityExhausted ||
        (proposeProgramAttempted && !pendingProgram?.valid) ||
        (conversationHasProgramIntent && hadSearchCalls && !pendingProgram?.valid && !pendingWorkout?.valid)

      if (generationFailed) {
        // Prefer asking for a genuinely-missing field. Only if nothing is missing
        // is this a true generation failure (context complete, model still failed).
        const missingPrompt = buildMissingContextPrompt(missingContext)
        let guardMessage = missingPrompt ?? GENERATION_FAILED_MESSAGE

        // Loop protection: if this exact message was already the last thing we said
        // and no state changed, do not repeat it. Fall back to the missing-context
        // question, or a controlled scope-reducing alternative for a hard failure.
        if (wouldRepeatLast(guardMessage)) {
          guardMessage = missingPrompt ?? GENERATION_FAILED_ALT_MESSAGE
        }

        console.log('[V-freeform-guard]', {
          userId: user.id,
          qualityExhausted,
          proposeProgramAttempted,
          conversationHasProgramIntent,
          hadSearchCalls,
          modelEscalated,
          missing: missingContext.map(m => m.field),
          loopBlocked: wouldRepeatLast(missingPrompt ?? GENERATION_FAILED_MESSAGE),
          action: missingPrompt ? 'ask_missing_field' : 'generation_failed',
        })

        await streamText(guardMessage)
        logModelSummary(missingPrompt ? 'ask_missing_field' : 'generation_failed')
        emitRaw({ type: 'done' })
        return
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
      console.log(`[V-perf] total=${Date.now() - t0}ms`)
      logModelSummary(pendingProgram?.valid ? 'program_delivered' : (pendingWorkout?.valid ? 'workout_delivered' : 'chat_reply'))
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
