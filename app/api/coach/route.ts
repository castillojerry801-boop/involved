import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getOpenAI } from '@/lib/ai/client'
import { coachModel, V_CHAT_MODEL, V_PROGRAM_MODEL, V_ESCALATION_MODEL, validateModelConfig, describeOpenAIError, isModelNotFoundError, isUnsupportedParamError, buildModelParamShape } from '@/lib/ai/models'
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
import {
  createCandidatePool, addCandidates, coveredCorePatterns, missingCorePatterns,
  canHandoffToDraft, hasFullCoreCoverage, buildCandidatePoolSummary, compactCandidatePool,
  buildDeterministicSearchPlan, filterCandidatesByEquipment, MAX_ORCHESTRATION_TOKENS,
  type SearchPhase, type CandidatePool,
} from '@/lib/v/search-orchestration'
import type { QualityIssue } from '@/lib/v/program-quality'
import { SYSTEM_PROMPT, CORRECTION_SYSTEM_PROMPT, EMPTY_SEARCH_RESULT, QUALITY_EXHAUSTED_MESSAGE, GENERATION_FAILED_MESSAGE, GENERATION_FAILED_ALT_MESSAGE, PROGRAM_INTENT_PATTERN, LOOKUP_INTENT_PATTERN, CREATION_INTENT_PATTERN, selectRoundTools, CALCULATE_NUTRITION_TOOL, PREPARE_MEAL_LOG_TOOL, GET_MEAL_LOG_TOOL } from './constants'
import { calculateNutrition } from '@/lib/v/tools/calculate-nutrition'
import type { CalculateNutritionArgs } from '@/lib/v/tools/calculate-nutrition'
import { getMealLog } from '@/lib/v/tools/get-meal-log'
import type { GetMealLogArgs } from '@/lib/v/tools/get-meal-log'
import { buildMealLogToken, verifyMealLogToken, selectTokenIngredients, TOKEN_TTL_SECONDS } from '@/lib/v/meal-log-token'
import { storeMealCalculationRef, resolveMealCalculationRef } from '@/lib/v/meal-calculation-ref'
import type OpenAI from 'openai'
import { after } from 'next/server'
import { buildTokenLog, flushRequestLogs } from '@/lib/ai/request-logger'
import type { PendingRequestLog, OperationType } from '@/lib/ai/request-logger'

// One Luna draft + one targeted Luna correction, then escalate to Sol (which also
// gets a draft + one correction). Kept at 1 so a correction round is cheap and the
// token budget survives draft → correction → Sol escalation.
const QUALITY_RETRY_LIMIT = 1

// Keep the most recent messages to prevent context blowout on long conversations.
// 30 turns ≈ 15 exchanges — enough for full program generation + one follow-up round.
const MAX_HISTORY_MESSAGES = 30

function trimMessageHistory<T extends { role: string; content: string }>(messages: T[]): T[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages
  return messages.slice(-MAX_HISTORY_MESSAGES)
}

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
    req.json() as Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: string }>; clientDate?: string; pendingCalculationToken?: string }>,
  ])
  if (!user) return new Response('Unauthorized', { status: 401 })
  if (!body.messages?.length) return new Response('No messages', { status: 400 })

  // Verify the pending calculation token immediately after auth — synchronous, so no extra round-trip.
  // We re-verify ownership + signature + expiry server-side every turn; the client value is never trusted.
  // The token value itself is never logged; only metadata (verified status, expiry window) is recorded.
  const pendingCalcRaw = body.pendingCalculationToken ?? null
  const pendingCalcVerified = pendingCalcRaw ? verifyMealLogToken(pendingCalcRaw, user.id) : null
  console.log('[V-pending-calc]', {
    userId: user.id,
    hasToken: !!pendingCalcRaw,
    verified: pendingCalcVerified?.ok ?? false,
    reason: pendingCalcVerified?.ok === false ? pendingCalcVerified.reason : null,
  })

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
  const ctx = await buildCoachContext(user.id, user.email, body.clientDate)
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
    const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_WORKOUT_TOOL, PROPOSE_PROGRAM_TOOL, CALCULATE_NUTRITION_TOOL, PREPARE_MEAL_LOG_TOOL, GET_MEAL_LOG_TOOL]
    // Per-turn loop guard for calculate_nutrition: if the model calls it more than
    // 3 times within a single conversation turn it gets a hard stop, forcing V to
    // respond with what it already has rather than looping indefinitely.
    let nutritionToolCallCount = 0
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
    // Current-turn lookup detection — the latest user message asks for information
    // (schedule, steps, history, etc.) rather than requesting generation. When true,
    // the intake gate and programGenerationMode are bypassed so V answers directly.
    // A creation verb in the same message overrides the lookup signal.
    const latestUserMessage = [...body.messages].reverse().find(m => m.role === 'user')?.content ?? ''
    const currentTurnIsLookup =
      LOOKUP_INTENT_PATTERN.test(latestUserMessage) &&
      !CREATION_INTENT_PATTERN.test(latestUserMessage)
    // We are in program-generation mode only once all required context is present
    // AND the current turn is not a simple lookup. This is what routes the tool loop
    // to the stronger programModel — intake and plain chat stay on the cheap chatModel.
    const programGenerationMode =
      conversationHasProgramIntent && missingContext.length === 0 && !currentTurnIsLookup
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
      currentTurnIsLookup,
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

    // Reassignable: on a quality-correction round it is REPLACED with a compact,
    // delta-only context (see buildCorrectionMessages) instead of resending the full
    // transcript + prior draft + pool, which is what blew the token budget.
    // Inject the verified pending calculation into the system context so V can reference the
    // token in the next turn without re-calling calculate_nutrition. The token value is included
    // verbatim — V must pass it back unmodified to prepare_meal_log.
    // If the token failed verification (expired, wrong user, tampered), show a brief note so V
    // knows to recalculate rather than attempting prepare_meal_log with a stale token.
    let pendingCalcContext = ''
    if (pendingCalcVerified?.ok) {
      const p = pendingCalcVerified.payload
      // Store the verified token server-side and give V only the opaque ref UUID.
      // The full signed token is never injected into V's system prompt context.
      const pendingRefId = await storeMealCalculationRef(
        user.id,
        pendingCalcRaw!,
        new Date(p.expiresAt * 1000),
      )
      // Enumerate ingredients with their STABLE original indexes + resolved status. On a
      // follow-up turn the tool result from the previous turn is NOT in the forwarded history
      // (the client sends only text messages), so this list is V's only source for which
      // ingredients exist and which indexes to pass to prepare_meal_log's includeIngredientIndexes.
      const ingredientLines = p.ingredients
        .map((ing, i) =>
          ing.resolved
            ? `  [${i}] ${ing.userDescription} → ${ing.matchedFoodName} — resolved (${ing.calories} kcal)`
            : `  [${i}] ${ing.userDescription} — UNRESOLVED (cannot be logged)`
        )
        .join('\n')
      pendingCalcContext =
        `\n\nOUTSTANDING NUTRITION CALCULATION (verified, active):\n` +
        `Ingredients (use these 0-based indexes for includeIngredientIndexes):\n${ingredientLines}\n` +
        `Resolved total: ${p.totals.calories} kcal, ${p.totals.proteinG}g protein, ${p.totals.carbG}g carbs, ${p.totals.fatG}g fat.\n` +
        `To log, call prepare_meal_log with calculationRefId: ${pendingRefId}\n` +
        `• "log that" / "log the meal" / "log the resolved items" → omit includeIngredientIndexes (the server logs every resolved ingredient; unresolved ones are disclosed but never logged).\n` +
        `• The user names specific items ("just the eggs", "the eggs and toast") → pass includeIngredientIndexes with ONLY those resolved items' indexes.\n` +
        `• A partially resolved meal CAN still be logged — at least one resolved ingredient is enough. Tell the user which items were not resolved and will be left out.\n` +
        `Do NOT call calculate_nutrition again unless the user requests a different food, a different quantity, or a correction.`
    } else if (pendingCalcRaw && pendingCalcVerified?.ok === false) {
      // Token present but invalid — tell V so it recalculates instead of using a bad token
      pendingCalcContext =
        `\n\nNOTE: A previous nutrition calculation is no longer valid ` +
        `(${pendingCalcVerified.reason === 'expired' ? 'it expired' : 'it could not be verified'}). ` +
        `If the user asks to log a meal, call calculate_nutrition first to get a fresh result.`
    }

    let chatMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + contextSnippet + equipmentCapabilitySummary + pendingCalcContext },
      ...trimMessageHistory(body.messages).map(m => ({ role: m.role, content: m.content } as ChatMessage)),
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
    //
    // Bypassed when the current turn is a lookup (schedule, steps, history, etc.) —
    // V must answer those directly regardless of prior program-building history.
    if (conversationHasProgramIntent && missingContext.length > 0 && !currentTurnIsLookup) {
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

    // Per-request log entries — flushed to DB in finally.
    const requestLogs: PendingRequestLog[] = []

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

    // ── Program-generation phase state ────────────────────────────────────────
    // The SEARCH phase is deterministic and runs BEFORE the model loop (see below):
    // the server calls search_exercises directly for each needed movement pattern,
    // spending zero model turns. By the time the model loop runs for a program, the
    // phase is already 'draft' (Luna) or escalates to 'escalation' (Sol) on quality
    // failure. Plain chat / workout requests never set genPhase to anything but the
    // initial 'draft' sentinel (unused — those run on the cheap chat model).
    let genPhase: SearchPhase = 'draft'
    const candidatePool = createCandidatePool()
    // Set once the deterministic search + compaction complete; reused to build cheap
    // correction contexts without re-deriving anything.
    let compactedPool: CandidatePool = candidatePool
    let candidateSummaryText = ''
    let requestSummary = ''
    // Raw JSON of the most recent draft + its hard errors — the only draft-specific
    // payload a correction round needs (no transcript, no prior drafts, no tool log).
    let lastDraftJson = ''
    let correctionErrors: QualityIssue[] = []
    let correctionPending = false

    // Build a compact, delta-only message array for a quality-correction round. This
    // REPLACES the full chatMessages so a correction never resends the system prompt,
    // the conversation, prior drafts, or the tool-call history — only the current
    // draft, the exact errors, the immutable request, and the candidate pool.
    const buildCorrectionMessages = (draftJson: string, errors: QualityIssue[]): ChatMessage[] => [
      {
        role: 'system',
        content:
          CORRECTION_SYSTEM_PROMPT +
          `\n\nREQUEST (immutable): ${requestSummary}` +
          `\n\nCANDIDATE POOL (use ONLY these exercise IDs):\n${candidateSummaryText}`,
      },
      { role: 'user', content: `CURRENT DRAFT (JSON):\n${draftJson}` },
      {
        role: 'user',
        content:
          `This draft has these quality errors. Fix ONLY these, keep everything else, and call propose_program with the corrected draft:\n` +
          errors.map(e => `[${e.code}] ${e.message}`).join('\n'),
      },
    ]

    // Resolve the model for a tool round from the current phase/state:
    //   escalation (Sol) > draft (Luna) > chat/intake (mini).
    const toolRoundModel = () => {
      if (!programGenerationMode) return chatModel
      if (genPhase === 'escalation') return escalationModel
      return programModel // 'draft' — the only loop phase for program generation
    }

    // Tools + tool_choice for the current round. For program generation the loop only
    // ever runs the DRAFT/ESCALATION phase (search already happened deterministically),
    // so we expose ONLY propose_program and FORCE it — the drafting model must produce
    // a draft from the candidate pool and can never stall in a search loop. Plain chat
    // keeps all tools on auto. Lookup turns (schedule, steps, history) never receive
    // propose_program — it is removed from the offered list entirely so the model
    // cannot call it even if it decides to.
    const roundToolShape = () => selectRoundTools(tools, programGenerationMode, currentTurnIsLookup)

    const callModel = async (
      messages: OpenAI.Chat.ChatCompletionMessageParam[],
      useTools: boolean,
    ) => {
      const selectedModel = useTools ? toolRoundModel() : proseModel
      // Intake turns (no prior tool calls) only need ~500 tokens — V asks one short question.
      // Once tool calls begin, use the full 4000 for exercise lists and program drafts.
      const hasToolHistory = messages.some(m => m.role === 'tool')
      const maxTokens = useTools ? (hasToolHistory ? 4000 : 500) : 1500
      const shape = roundToolShape()
      // Deterministic per-model request shape (next-gen gets max_completion_tokens
      // and reasoning_effort:'none' for tools; legacy gets max_tokens + temperature).
      const params = {
        model: selectedModel,
        messages,
        ...(useTools ? { tools: shape.tools, tool_choice: shape.tool_choice, parallel_tool_calls: false } : {}),
        ...buildModelParamShape(selectedModel, useTools, maxTokens),
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await openai.chat.completions.create(params)
          if (res.usage) {
            promptTokens += res.usage.prompt_tokens ?? 0
            completionTokens += res.usage.completion_tokens ?? 0
            // Derive the operation type from current phase so each round is
            // attributed accurately (chat vs program draft vs Sol escalation).
            const opType: OperationType = !useTools
              ? 'chat_prose'
              : !programGenerationMode
                ? 'chat_intake'
                : genPhase === 'escalation'
                  ? (qualityRetries > 0 ? 'quality_escalation_correction' : 'quality_escalation')
                  : (qualityRetries > 0 ? 'program_correction' : 'program_draft')
            requestLogs.push(
              buildTokenLog(user.id, 'coach_message', opType, selectedModel, res.usage)
            )
          }
          return res
        } catch (err: unknown) {
          const info = describeOpenAIError(err)
          if (info.status === 429 && attempt < 2) {
            const headers = (err as { headers?: Record<string, string> }).headers
            const waitMs =
              parseInt(headers?.['retry-after-ms'] ?? '') ||
              (parseInt(headers?.['retry-after'] ?? '') * 1000) ||
              30000
            emitRaw({ type: 'status', message: 'V is thinking...' })
            await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 60000)))
            continue
          }
          throw err
        }
      }
      throw new Error('OpenAI retries exhausted')
    }

    // ── DETERMINISTIC SEARCH PHASE (program generation only) ──────────────────
    // Runs BEFORE the model loop and spends ZERO model turns. For each movement
    // pattern the program needs, we call search_exercises directly, filter the
    // results to the user's equipment profile (same exact-match the draft validator
    // uses), and accumulate a deduped candidate pool. This replaces the model-driven
    // search loop that could spin for 12 rounds and never search a required pattern
    // (production: horizontal_pull was never searched). It cannot wander, cannot skip
    // a pattern, and is bounded by a fixed plan.
    if (programGenerationMode) {
      const plan = buildDeterministicSearchPlan()
      const RAW_LIMIT = 25
      let searchTurn = 0
      for (const step of plan) {
        searchTurn++
        const raw = executeExerciseSearch({ movementPattern: step.pattern, limit: RAW_LIMIT })
        const filtered = filterCandidatesByEquipment(raw, allowedEquipment).slice(0, step.core ? 8 : 5)
        const added = addCandidates(candidatePool, filtered)
        console.log('[V-search-turn]', {
          userId: user.id,
          outerRound: 0,
          searchTurn,
          pattern: step.pattern,
          core: step.core,
          toolCallsThisTurn: 1,
          resultCount: filtered.length,
          newCandidateCount: added,
          candidateCount: candidatePool.byId.size,
          coveredPatterns: coveredCorePatterns(candidatePool),
          missingPatterns: missingCorePatterns(candidatePool),
          decision: hasFullCoreCoverage(candidatePool) ? 'core_complete' : 'continue',
        })
      }
      hadSearchCalls = true

      // ── Deterministic candidate compaction ──────────────────────────────────
      // 14 searches can return ~80+ candidates; Luna does not need them all, and
      // resending the full pool on every correction round is the main prompt-bloat
      // source. Compact to a bounded, high-quality set (per-pattern caps, canonical
      // ranking, equipment diversity) BEFORE anything is sent to the model. Coverage
      // is preserved — every pattern that had a candidate keeps at least one.
      const rawCandidateCount = candidatePool.byId.size
      compactedPool = compactCandidatePool(candidatePool)
      candidateSummaryText = buildCandidatePoolSummary(compactedPool)
      console.log('[V-candidate-compaction]', {
        userId: user.id,
        before: rawCandidateCount,
        after: compactedPool.byId.size,
        coveredPatternsBefore: coveredCorePatterns(candidatePool),
        coveredPatternsAfter: coveredCorePatterns(compactedPool),
        equipmentTypes: [...new Set([...compactedPool.byId.values()].map(e => e.equipment))],
      })

      const transitioned = canHandoffToDraft(compactedPool)
      console.log('[V-search-final]', {
        userId: user.id,
        searchModelTurns: 0, // deterministic — no model turns spent on search
        searchToolCalls: plan.length,
        uniqueSearches: plan.length,
        totalCandidates: compactedPool.byId.size,
        rawCandidates: rawCandidateCount,
        coveredPatterns: coveredCorePatterns(compactedPool),
        missingPatterns: missingCorePatterns(compactedPool),
        terminationReason: hasFullCoreCoverage(compactedPool)
          ? 'coverage_met'
          : (transitioned ? 'viable_partial' : 'insufficient'),
        transitionedToProposal: transitioned,
      })

      if (!transitioned) {
        // Genuinely too thin a pool (empty or below the viable floor) — a targeted
        // failure, not a wasted Luna call. Ask for the missing intake field if any,
        // else stream the controlled generation-failed message.
        console.error('[V-search-insufficient]', {
          userId: user.id,
          totalCandidates: compactedPool.byId.size,
          coveredPatterns: coveredCorePatterns(compactedPool),
          missingRequiredPatterns: missingCorePatterns(compactedPool),
        })
        const missingPrompt = buildMissingContextPrompt(missingContext)
        let failMsg = missingPrompt ?? GENERATION_FAILED_MESSAGE
        if (wouldRepeatLast(failMsg)) failMsg = missingPrompt ?? GENERATION_FAILED_ALT_MESSAGE
        await streamText(failMsg)
        logModelSummary(missingPrompt ? 'ask_missing_field' : 'generation_failed')
        emitRaw({ type: 'done' })
        await writer.close().catch(() => {})
        return
      }

      // Immutable request constraints, reused verbatim in correction rounds so a
      // cheap correction prompt still carries everything Luna must honour.
      requestSummary =
        `${intake.weeks ?? '?'}-week program, ${intake.trainingDaysPerWeek ?? '?'} days/week. ` +
        `Goal: ${intake.primaryGoal ?? 'general fitness'}${intake.secondaryGoals.length ? ' + ' + intake.secondaryGoals.join(', ') : ''}. ` +
        `Training background: ${intake.readinessState ?? 'unspecified'}. ` +
        `Equipment: ${allowedEquipment?.length ? allowedEquipment.join(', ') : 'full gym'}.`

      // Hand the compacted candidate pool to Luna and FORCE propose_program below.
      genPhase = 'draft'
      chatMessages.push({
        role: 'system',
        content:
          `EXERCISE CANDIDATE POOL — ${compactedPool.byId.size} validated exercises for the user's equipment. ` +
          `Build the full ${intake.weeks ?? 'requested'}-week program NOW by calling propose_program, using ONLY these exercise IDs:\n` +
          candidateSummaryText +
          `\n\nYou have sufficient candidates. Do NOT request more searches. If a minor accessory role lacks an ideal match, pick the closest appropriate candidate above.`,
      })

      // Context-size telemetry — reveals where the draft prompt budget goes.
      const systemChars = typeof chatMessages[0]?.content === 'string' ? chatMessages[0].content.length : 0
      const conversationChars = body.messages.reduce((n, m) => n + m.content.length, 0)
      const candidateTextChars = candidateSummaryText.length
      const totalChars = systemChars + conversationChars + candidateTextChars
      console.log('[V-context-size]', {
        userId: user.id,
        candidateCount: compactedPool.byId.size,
        candidateTextChars,
        systemChars,
        conversationChars,
        estimatedPromptTokens: Math.round(totalChars / 4),
      })
    }

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        // Emergency cost guard — the deterministic search phase spends zero model
        // tokens, so reaching this means the Luna draft / quality loop itself ran
        // away. A valid program already breaks at the loop bottom, so none exists yet.
        if (programGenerationMode && (promptTokens + completionTokens) >= MAX_ORCHESTRATION_TOKENS) {
          console.error('[V-orchestration-budget-exhausted]', {
            userId: user.id,
            phase: genPhase,
            totalTokens: promptTokens + completionTokens,
            budget: MAX_ORCHESTRATION_TOKENS,
            missingRequiredPatterns: missingCorePatterns(candidatePool),
          })
          break
        }

        let response: Awaited<ReturnType<typeof openai.chat.completions.create>>
        const roundStage = genPhase === 'escalation'
          ? 'quality_escalation'
          : programGenerationMode ? 'program_generation' : 'chat_intake'
        try {
          const tRound = Date.now()
          console.log('[V-model]', { userId: user.id, stage: roundStage, model: toolRoundModel(), round, phase: programGenerationMode ? genPhase : 'chat' })
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
          // Initialized to a safe fallback so every tool_call_id receives exactly one
          // response even if an unexpected error bypasses all handler branches.
          let result: string = JSON.stringify({ status: 'error', message: 'Tool execution failed unexpectedly.' })
          try {

          if (fn.name === 'search_exercises') {
            // Only reachable in plain-chat / workout mode — program generation does
            // its searching deterministically before the loop. tool_choice forces
            // propose_program in the program draft phase, so this never fires there.
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
            // Execution-boundary guard: propose_program is not offered to the model
            // for lookup turns (it is filtered out of the tool list in roundToolShape).
            // This rejection handles the case where the model calls it anyway.
            if (currentTurnIsLookup) {
              console.error('[V-routing-violation]', {
                userId: user.id,
                toolCalled: 'propose_program',
                currentTurnIsLookup,
                latestUserMessage: latestUserMessage.slice(0, 120),
                note: 'propose_program called on a lookup turn — rejected at execution boundary',
              })
              result = JSON.stringify({
                status: 'rejected',
                message: 'propose_program is not available for informational queries. Answer the user\'s question directly from the context data provided.',
              })
              chatMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
              continue
            }
            proposeProgramAttempted = true
            lastDraftJson = fn.arguments // the only draft payload a correction round needs
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
                console.log('[V-quality-summary]', {
                  durationWeeks: draft.weeks ?? null,
                  model: modelEscalated ? escalationModel : programModel,
                  attempt: qualityRetries + (modelEscalated ? QUALITY_RETRY_LIMIT + 1 : 0),
                  errors: hardErrors.map(e => e.code),
                  warnings: qualityIssues.filter(i => i.severity === 'warning').map(i => i.code),
                })
                // Per-error structured detail — so a MISSING_REQUIRED_ROLE or
                // NO_STRUCTURED_DELOAD is traceable to the exact day/role/draft state
                // instead of a bare repeated code.
                for (const e of hardErrors) {
                  if (e.meta) console.log('[V-quality-detail]', { userId: user.id, code: e.code, ...e.meta })
                }

                if (hardErrors.length > 0 && qualityRetries < QUALITY_RETRY_LIMIT) {
                  qualityRetries++
                  correctionErrors = hardErrors
                  correctionPending = true
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
                  genPhase = 'escalation'
                  qualityRetries = 0
                  correctionErrors = hardErrors
                  correctionPending = true
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

          } else if (fn.name === 'calculate_nutrition') {
            // Per-turn loop guard — cap at 3 calls per turn
            nutritionToolCallCount++
            if (nutritionToolCallCount > 3) {
              result = JSON.stringify({
                status: 'loop_limit_reached',
                message: 'calculate_nutrition was called too many times in one turn. Respond to the user with the nutrition information you have already calculated. Do not call this tool again.',
              })
            } else {
              try {
                const nutritionArgs = JSON.parse(fn.arguments) as CalculateNutritionArgs
                const nutritionResult = await calculateNutrition(nutritionArgs)
                // Sign the result so prepare_meal_log can reference it by token — V never
                // touches the actual macro values; the confirm endpoint reads from the token.
                const calculationToken = buildMealLogToken(user.id, nutritionResult)
                // Emit the full token to the client (trusted path — used by MealLogConfirmCard
                // and the confirm endpoint). The token is never returned to V.
                if (calculationToken) {
                  emitRaw({ type: 'calculation_token', calculationToken })
                  // Store server-side and give V only the opaque ref UUID.
                  const calculationRefId = await storeMealCalculationRef(
                    user.id,
                    calculationToken,
                    new Date(Date.now() + TOKEN_TTL_SECONDS * 1000),
                  )
                  result = JSON.stringify({ ...nutritionResult, calculationRefId })
                } else {
                  result = JSON.stringify({ ...nutritionResult })
                }
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Nutrition calculation failed'
                console.error('[V-nutrition-tool-error]', { userId: user.id, error: msg })
                result = JSON.stringify({
                  status: 'error',
                  message: `Nutrition calculation failed: ${msg}. Tell the user you were unable to calculate macros right now.`,
                })
              }
            }

          } else if (fn.name === 'prepare_meal_log') {
            try {
              const logArgs = JSON.parse(fn.arguments) as {
                calculationRefId?: string    // primary path — opaque UUID from server
                calculationToken?: string    // legacy fallback — accepted during transition
                mealType: string
                logDate: string
                includeIngredientIndexes?: number[]
              }

              // Resolve the full signed token from the server-managed reference store.
              // LEGACY PATH — safe to remove once all active sessions have expired (≥2 h after
              // the Option 2 code ships to production). Sessions started before that deploy may
              // still carry a raw calculationToken in their React state. The legacy path still
              // runs verifyMealLogToken, so forged or model-corrupted tokens are rejected.
              // Removal: delete the `else if (logArgs.calculationToken)` branch and the
              // `calculationToken?: string` field in the logArgs type assertion above.
              let resolvedToken: string | null = null
              let resolutionError: string | null = null

              if (logArgs.calculationRefId) {
                const refResult = await resolveMealCalculationRef(logArgs.calculationRefId, user.id)
                if (!refResult.ok) {
                  const hint =
                    refResult.reason === 'expired'  ? 'The calculation reference has expired (older than 2 hours). Call get_meal_log again (repeat meal) or calculate_nutrition again (new food) to get a fresh reference.' :
                    refResult.reason === 'db_error' ? 'Meal logging is temporarily unavailable. Tell the user to try again later.' :
                    /* not_found */                   'The calculation reference was not found. Call get_meal_log again (repeat meal) or calculate_nutrition again (new food) to get a new reference.'
                  result = JSON.stringify({ status: 'error', reason: refResult.reason, message: hint })
                  resolutionError = refResult.reason
                  console.log('[V-meal-log-resolve-fail]', { userId: user.id, reason: refResult.reason })
                } else {
                  resolvedToken = refResult.token
                }
              } else if (logArgs.calculationToken) {
                // Legacy path: accept a raw signed token from sessions that pre-date the ref system.
                resolvedToken = logArgs.calculationToken
              } else {
                result = JSON.stringify({ status: 'error', message: 'Missing calculationRefId. Call get_meal_log (repeat meal) or calculate_nutrition (new food) first, then pass the returned calculationRefId here in a subsequent response.' })
                resolutionError = 'missing'
              }

              if (!resolutionError && resolvedToken) {
                const verified = verifyMealLogToken(resolvedToken, user.id)
                if (!verified.ok) {
                  const hint =
                    verified.reason === 'no_key'            ? 'Meal logging is temporarily unavailable. Tell the user to try again later.' :
                    verified.reason === 'expired'           ? 'The calculation has expired (older than 2 hours). Call calculate_nutrition again to get a fresh result.' :
                    verified.reason === 'wrong_user'        ? 'Ownership mismatch — cannot log a calculation belonging to another session.' :
                    /* malformed / invalid_signature */       'The calculationToken is invalid or was corrupted in transit. Call get_meal_log again (for a repeat meal) or calculate_nutrition again (for a new food) to obtain a fresh token, then pass it here in the next response. Do not modify the token string.'
                  result = JSON.stringify({ status: 'error', reason: verified.reason, message: hint })
                  console.log('[V-meal-log-verify-fail]', { userId: user.id, reason: verified.reason })
                } else {
                  const { payload } = verified
                  const includeIndexes = Array.isArray(logArgs.includeIngredientIndexes)
                    ? logArgs.includeIngredientIndexes
                    : undefined
                  // Server-authoritative selection — the AI only supplied indexes; all macros
                  // come from the signed token via selectTokenIngredients.
                  const { selected, totals: selectedTotals, requestedSelection, resolvedCount } =
                    selectTokenIngredients(payload, includeIndexes)

                  if (selected.length === 0) {
                    // Covers: nothing resolved at all, OR an explicit selection that named only
                    // unresolved / out-of-range indexes. Never fall back to logging other items.
                    result = JSON.stringify({
                      status: 'error',
                      message: requestedSelection && resolvedCount > 0
                        ? 'None of the selected items are resolved and loggable. The resolved items (with their indexes) are in the OUTSTANDING NUTRITION CALCULATION context — ask the user to choose from those, or omit includeIngredientIndexes to log all resolved items.'
                        : 'No ingredients were resolved — nothing to log. Tell the user which ingredients failed and ask them to rephrase or provide quantities.',
                    })
                  } else {
                    const selectedIndexes = selected.map(s => s.originalIndex)
                    emitRaw({
                      type: 'meal_log_pending',
                      data: {
                        calculationToken: resolvedToken,
                        // Forwarded to the confirm endpoint so the server logs exactly this set.
                        includeIngredientIndexes: selectedIndexes,
                        resolvedIngredients: selected.map(({ ingredient }) => ({
                          name:              ingredient.matchedFoodName,
                          userDescription:   ingredient.userDescription,
                          calories:          ingredient.calories,
                          proteinG:          ingredient.proteinG,
                          carbG:             ingredient.carbG,
                          fatG:              ingredient.fatG,
                          conversionNote:    ingredient.conversionNote,
                        })),
                        // Always disclose every unresolved ingredient — a partial meal is never
                        // silently presented as complete.
                        unresolvedIngredients: payload.unresolvedIngredients,
                        totals:               selectedTotals,
                        completeness:         payload.completeness,
                        mealType:             logArgs.mealType,
                        logDate:              logArgs.logDate,
                      },
                    })
                    const unresolvedCount = payload.unresolvedIngredients.length
                    result = JSON.stringify({
                      status: 'pending',
                      message: `A confirmation card is now shown with ${selected.length} selected item(s)${unresolvedCount ? ` and ${unresolvedCount} unresolved item(s) that will NOT be logged` : ''}. Tell the user the totals, name any unresolved items being left out, and that they can tap to save to their diary.`,
                    })
                  }
                }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Failed to prepare meal log'
              console.error('[V-meal-log-error]', { userId: user.id, error: msg })
              result = JSON.stringify({ status: 'error', message: msg })
            }

          } else if (fn.name === 'get_meal_log') {
            try {
              const logArgs = JSON.parse(fn.arguments) as GetMealLogArgs
              const logResult = await getMealLog(user.id, logArgs)
              if (logResult.status === 'found' && logResult.calculationToken) {
                // Emit the full token to the client (trusted path — MealLogConfirmCard + confirm endpoint).
                emitRaw({ type: 'calculation_token', calculationToken: logResult.calculationToken })
                // Store server-side and give V only the opaque ref UUID.
                const calculationRefId = await storeMealCalculationRef(
                  user.id,
                  logResult.calculationToken,
                  new Date(Date.now() + TOKEN_TTL_SECONDS * 1000),
                )
                // Strip the token from V's result; expose only the ref ID and metadata.
                const { calculationToken: _omit, ...resultWithoutToken } = logResult
                result = JSON.stringify({ ...resultWithoutToken, calculationRefId })
              } else {
                result = JSON.stringify(logResult)
              }
              console.log('[V-get-meal-log]', {
                userId:       user.id,
                status:       logResult.status,
                itemCount:    logResult.itemCount ?? 0,
                tokenPresent: !!logResult.calculationToken,
                tokenLength:  logResult.calculationToken?.length ?? 0,
              })
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Failed to retrieve meal log'
              console.error('[V-get-meal-log-error]', { userId: user.id, error: msg })
              result = JSON.stringify({ status: 'error', message: msg })
            }

          } else {
            result = JSON.stringify({ error: 'Unknown tool' })
          }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unexpected error'
            console.error('[V-tool-uncaught]', { toolName: fn.name, error: msg })
            result = JSON.stringify({ status: 'error', message: 'Tool execution failed. Please try again.' })
          }

          chatMessages.push({ role: 'tool', tool_call_id: call.id, content: result })
        }

        if (pendingProgram?.valid || qualityExhausted) break

        // On a quality correction (Luna retry or Sol escalation), REPLACE the growing
        // transcript with a compact delta-only context. This is the fix for the token
        // blowup: a correction no longer resends the system prompt, conversation, prior
        // drafts, or tool history — only the current draft, the errors, and the pool.
        if (correctionPending && lastDraftJson) {
          chatMessages = buildCorrectionMessages(lastDraftJson, correctionErrors)
          correctionPending = false
          console.log('[V-correction-context]', {
            userId: user.id,
            phase: genPhase,
            draftChars: lastDraftJson.length,
            errorCount: correctionErrors.length,
            estimatedPromptTokens: Math.round(
              (chatMessages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0)) / 4,
            ),
          })
        }
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
      // after() registers with Vercel's waitUntil so the function stays alive until
      // the DB write completes after the stream closes. Falls back to a direct await
      // in environments without a request context (e.g. tests).
      try {
        after(() => flushRequestLogs(requestLogs))
      } catch {
        await flushRequestLogs(requestLogs)
      }
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
