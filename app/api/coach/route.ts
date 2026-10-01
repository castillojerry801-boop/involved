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
import { SYSTEM_PROMPT, CORRECTION_SYSTEM_PROMPT, EMPTY_SEARCH_RESULT, QUALITY_EXHAUSTED_MESSAGE, GENERATION_FAILED_MESSAGE, GENERATION_FAILED_ALT_MESSAGE, PROGRAM_INTENT_PATTERN } from './constants'
import type OpenAI from 'openai'

// One Luna draft + one targeted Luna correction, then escalate to Sol (which also
// gets a draft + one correction). Kept at 1 so a correction round is cheap and the
// token budget survives draft → correction → Sol escalation.
const QUALITY_RETRY_LIMIT = 1

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

    // Reassignable: on a quality-correction round it is REPLACED with a compact,
    // delta-only context (see buildCorrectionMessages) instead of resending the full
    // transcript + prior draft + pool, which is what blew the token budget.
    let chatMessages: ChatMessage[] = [
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
    // keeps all tools on auto.
    const roundToolShape = (): {
      tools: typeof tools
      tool_choice: OpenAI.Chat.ChatCompletionToolChoiceOption
    } => {
      if (!programGenerationMode) return { tools, tool_choice: 'auto' }
      return {
        tools: [PROPOSE_PROGRAM_TOOL],
        tool_choice: { type: 'function', function: { name: 'propose_program' } },
      }
    }

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
        ...(useTools ? { tools: shape.tools, tool_choice: shape.tool_choice } : {}),
        ...buildModelParamShape(selectedModel, useTools, maxTokens),
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await openai.chat.completions.create(params)
          if (res.usage) {
            promptTokens += res.usage.prompt_tokens ?? 0
            completionTokens += res.usage.completion_tokens ?? 0
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
          let result: string

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

          } else {
            result = JSON.stringify({ error: 'Unknown tool' })
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
