/**
 * Extracted program-generation loop for Coach V.
 *
 * Contains the full model loop: propose_program handling, structural validation,
 * quality validation, Luna correction, Sol escalation, and metrics collection.
 * Has no HTTP concerns — no SSE streaming, no auth, no usage tracking.
 *
 * The production route runs the deterministic search phase, then calls
 * runProgramGeneration with the resulting candidate pool already injected into
 * the message array. Tests call it directly with a mock OpenAI client and a
 * controlled validateProgramDraft stub.
 *
 * Server-side only by convention (requires injected openai + prisma), but carries
 * no server-only marker so test files can import it directly under Vitest/Node.js.
 */

import type OpenAI from 'openai'
import type { PrismaClient } from '@prisma/client'
import type { ProgramDraft, ProgramValidationResult } from '@/lib/ai/tools/program'
import type { WeeklySchedule } from '@/lib/v/program-intake'
import type { OperationType } from '@/lib/ai/request-logger'
import { validateProgramQuality } from '@/lib/v/program-quality'
import { buildModelParamShape, describeOpenAIError } from '@/lib/ai/models'
import { MAX_ORCHESTRATION_TOKENS } from '@/lib/v/search-orchestration'

// ─── Re-export so tests can reference the production constants ────────────────
export const QUALITY_RETRY_LIMIT = 1

// Output-token budget for every propose_program call (initial draft, correction,
// and Sol escalation). runProgramGeneration handles only structured program drafts —
// the 500-token conversational cap that guards chat/intake turns never applies here.
//
// Sizing: an 8-week 7-day program with week progressions uses ~2,900 output tokens
// (observed). A 12-week worst case (7 days × 5 exercises × 4 progressions) estimates
// ~4,700 tokens. 6,000 provides ~25% headroom above that, bounded well below any
// model context limit. Correction and escalation rounds need the same budget — they
// also output a full program JSON.
export const PROGRAM_DRAFT_MAX_TOKENS = 6_000
const MAX_ROUNDS = 12

// ─── Prompts used in the generation loop ─────────────────────────────────────
// Defined here rather than imported from app/api/coach/constants to avoid an
// app → lib layering dependency. app/api/coach/constants.ts also exports these
// for other callers.

const CORRECTION_SYSTEM_PROMPT = `You are V's program-correction pass. You are given a single program draft and a list of specific validation errors. Fix ONLY those errors and call propose_program again with the corrected draft.

RULES:
• Change the minimum necessary to clear every listed error. Keep everything else identical — same exercises, weeks, days, and prescriptions unless an error requires a change.
• Use ONLY exercise IDs from the candidate pool below. Never invent IDs or exercise names.
• For a missing movement-pattern role: add an exercise from the pool whose movementPattern matches the missing role to that specific day.
• For an intended_pattern mismatch (STRUCTURAL error): do NOT simply relabel the exercise — that removes a required movement role. Instead, either (a) assign the exercise to its verified movement role (use the classification code from the error message) or (b) select a correctly classified alternative from the pool's matching group for the rejected role. Never leave a required role uncovered.
• For a missing structural deload (≥8-week programs): add a deload — set deload:true on the recovery-week week_progressions entries (e.g. ~week 4 and ~week 8) AND reduce sets that week, or add a labeled deload phase.
• For a missing final taper (≥12-week programs): set taper:true on the final week's week_progressions and reduce volume.
• For a conditioning day with no aerobic modality: add a cardio/carry exercise from the pool, or convert the day to match its real content.
• Do NOT respond to the user in text. The only valid output is a propose_program tool call.`

const QUALITY_EXHAUSTED_MESSAGE = "Quality validation failed after all retries. Ask the user: \"I ran into a problem finding the right exercises for your setup — can you tell me exactly what equipment you have available?\" Do NOT output a program. Do NOT list exercises. Do NOT say \"I'll use standard exercises.\" Do NOT create a general outline. Ask the one clarifying question and stop."

// ─── Types ────────────────────────────────────────────────────────────────────

export type GenerationModels = {
  program: string
  escalation: string
  chat: string
}

export type GenerationIntakeContext = {
  readinessState: string | null
  dailyWalkRequested: boolean
  explicitSchedule: WeeklySchedule | null | undefined
  fitnessLevel?: string | null
}

export type RoundLog = {
  model: string
  opType: OperationType
  usage: {
    promptTokens: number
    completionTokens: number
    cachedInputTokens: number
  }
}

export type GenerationResult = {
  outcome:
    | 'program_delivered'
    | 'generation_failed'
    | 'quality_exhausted'
    | 'model_error'
    | 'budget_exhausted'
  program?: ProgramValidationResult
  finalText: string
  rounds: number
  qualityRetries: number
  escalated: boolean
  proposeProgramAttempted: boolean
  promptTokens: number
  completionTokens: number
  cachedInputTokens: number
  roundLogs: RoundLog[]
  durationMs: number
}

export type GenerationOptions = {
  userId: string
  /**
   * Initial message array — must already include the system prompt, the
   * conversation history, and the candidate-pool injection message that tells the
   * model to call propose_program. The route builds this before handing off.
   */
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  candidateSummaryText: string
  requestSummary: string
  intake: GenerationIntakeContext
  models: GenerationModels
  openai: OpenAI
  prisma: PrismaClient
  allowedEquipment: string[] | null | undefined
  /**
   * The propose_program tool definition forwarded to OpenAI. Passed rather than
   * imported so callers can substitute a test double without module mocking.
   */
  proposeProgramTool: OpenAI.Chat.ChatCompletionTool
  /**
   * Structural draft validator. Defaults to the production validateProgramDraft
   * in the route; test harnesses pass a stub to skip DB calls.
   */
  validateDraft: (
    draft: ProgramDraft,
    userId: string,
    prisma: PrismaClient,
    opts: { allowedEquipment?: string[] }
  ) => Promise<ProgramValidationResult>
  /**
   * Optional status-message callback for SSE emission. The route passes
   * emitRaw; tests may pass undefined to discard status events.
   */
  notify?: (type: 'status', message: string) => void
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function runProgramGeneration(
  options: GenerationOptions,
): Promise<GenerationResult> {
  const {
    userId,
    openai,
    prisma,
    models,
    intake,
    allowedEquipment,
    notify,
    proposeProgramTool,
    validateDraft,
  } = options

  const t0 = Date.now()
  let genPhase: 'draft' | 'escalation' = 'draft'
  let qualityRetries = 0
  let modelEscalated = false
  let qualityExhausted = false
  let proposeProgramAttempted = false
  let correctionPending = false
  let lastDraftJson = ''
  let correctionErrors: { code: string; message: string; severity: 'error' | 'warning' }[] = []
  let pendingProgram: ProgramValidationResult | null = null
  let promptTokens = 0
  let completionTokens = 0
  let cachedInputTokens = 0
  const roundLogs: RoundLog[] = []
  let rounds = 0

  let chatMessages = [...options.messages]

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const buildCorrectionMessages = (
    draftJson: string,
    errors: typeof correctionErrors,
  ): OpenAI.Chat.ChatCompletionMessageParam[] => [
    {
      role: 'system',
      content:
        CORRECTION_SYSTEM_PROMPT +
        `\n\nREQUEST (immutable): ${options.requestSummary}` +
        `\n\nCANDIDATE POOL (use ONLY these exercise IDs):\n${options.candidateSummaryText}`,
    },
    { role: 'user', content: `CURRENT DRAFT (JSON):\n${draftJson}` },
    {
      role: 'user',
      content:
        `This draft has these validation errors. Fix ONLY these, keep everything else, ` +
        `and call propose_program with the corrected draft:\n` +
        errors.map(e => `[${e.code}] ${e.message}`).join('\n'),
    },
  ]

  const toolRoundModel = () =>
    genPhase === 'escalation' ? models.escalation : models.program

  const callModel = async (messages: OpenAI.Chat.ChatCompletionMessageParam[]) => {
    const selectedModel = toolRoundModel()
    const params = {
      model: selectedModel,
      messages,
      tools: [proposeProgramTool],
      tool_choice: { type: 'function' as const, function: { name: 'propose_program' } },
      parallel_tool_calls: false,
      ...buildModelParamShape(selectedModel, true, PROGRAM_DRAFT_MAX_TOKENS),
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await openai.chat.completions.create(params)
        if (res.usage) {
          const pt = res.usage.prompt_tokens ?? 0
          const ct = res.usage.completion_tokens ?? 0
          const cached =
            (res.usage as { prompt_tokens_details?: { cached_tokens?: number } })
              .prompt_tokens_details?.cached_tokens ?? 0
          promptTokens += pt
          completionTokens += ct
          cachedInputTokens += cached
          const opType: OperationType =
            genPhase === 'escalation'
              ? qualityRetries > 0
                ? 'quality_escalation_correction'
                : 'quality_escalation'
              : qualityRetries > 0
                ? 'program_correction'
                : 'program_draft'
          roundLogs.push({
            model: selectedModel,
            opType,
            usage: { promptTokens: pt, completionTokens: ct, cachedInputTokens: cached },
          })
        }
        return res
      } catch (err: unknown) {
        const info = describeOpenAIError(err)
        if (info.status === 429 && attempt < 2) {
          const headers = (err as { headers?: Record<string, string> }).headers
          const waitMs =
            parseInt(headers?.['retry-after-ms'] ?? '') ||
            parseInt(headers?.['retry-after'] ?? '') * 1000 ||
            30000
          notify?.('status', 'V is thinking...')
          await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 60000)))
          continue
        }
        throw err
      }
    }
    throw new Error('OpenAI retries exhausted')
  }

  // ─── Model loop ────────────────────────────────────────────────────────────

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      rounds = round + 1

      if (promptTokens + completionTokens >= MAX_ORCHESTRATION_TOKENS) {
        return makeResult('budget_exhausted', {
          pendingProgram, rounds, qualityRetries, modelEscalated,
          proposeProgramAttempted, promptTokens, completionTokens,
          cachedInputTokens, roundLogs, t0, finalText: '',
        })
      }

      let response: OpenAI.Chat.ChatCompletion
      try {
        const tRound = Date.now()
        console.log('[V-generation]', {
          userId,
          stage: genPhase === 'escalation' ? 'quality_escalation' : 'program_generation',
          model: toolRoundModel(),
          round,
          phase: genPhase,
        })
        response = await callModel(chatMessages)
        console.log(`[V-generation-perf] round=${round} llm=${Date.now() - tRound}ms`)
      } catch (err: unknown) {
        console.error('[V-generation-model-error]', { userId, round, genPhase, err })
        return makeResult('model_error', {
          pendingProgram, rounds, qualityRetries, modelEscalated,
          proposeProgramAttempted, promptTokens, completionTokens,
          cachedInputTokens, roundLogs, t0, finalText: '',
        })
      }

      const choice = response.choices[0]
      chatMessages.push(choice.message)

      if (!choice.message.tool_calls?.length) break

      for (const call of choice.message.tool_calls) {
        const fn = (call as unknown as { function: { name: string; arguments: string } }).function

        if (fn.name !== 'propose_program') {
          // Should not happen — tool_choice forces propose_program — but guard defensively
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ status: 'error', message: 'Unexpected tool call in program generation mode.' }),
          })
          continue
        }

        proposeProgramAttempted = true
        lastDraftJson = fn.arguments
        notify?.('status', qualityRetries > 0 ? 'Refining your program...' : 'Building your program...')

        // ── Parse ──────────────────────────────────────────────────────────
        let draft: ProgramDraft
        try {
          draft = JSON.parse(fn.arguments) as ProgramDraft
        } catch {
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              status: 'invalid',
              errors: ['Malformed program draft — could not parse JSON arguments.'],
            }),
          })
          continue
        }

        // ── Structural validation ──────────────────────────────────────────
        let validation: ProgramValidationResult
        try {
          validation = await validateDraft(draft, userId, prisma, { allowedEquipment: allowedEquipment ?? undefined })
        } catch (valErr) {
          console.error('[V-generation-validate-error]', { userId, valErr })
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              status: 'invalid',
              errors: ['Internal validation error — please revise the draft and try again.'],
            }),
          })
          continue
        }

        if (!validation.valid) {
          // Log structural failure for diagnostics — these are silent in production
          // without this log, making repeated failures undetectable until budget_exhausted.
          console.warn('[V-generation-structural-fail]', {
            userId,
            round,
            model: toolRoundModel(),
            errorCount: validation.errors.length,
            errors: validation.errors.map(e => e.substring(0, 150)),
            remainingTokenBudget: MAX_ORCHESTRATION_TOKENS - (promptTokens + completionTokens),
            contextCompacted: true,
          })
          // Trigger correction context compaction (same as quality-failure path).
          // Without this, chatMessages grows by ~3,600 tokens per structural-failure
          // round, exhausting the 70,000-token budget after just 3 rounds on a
          // typical 8-week program where the initial prompt is already ~22,000 tokens.
          correctionErrors = validation.errors.map(msg => ({
            code: 'STRUCTURAL',
            message: msg,
            severity: 'error' as const,
          }))
          correctionPending = true
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ status: 'invalid', errors: validation.errors }),
          })
          continue
        }

        // ── Readiness gate for 8+ week programs ───────────────────────────
        const isLongProgram = (draft.weeks ?? 0) >= 8
        if (isLongProgram && intake.readinessState === null) {
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              status: 'intake_incomplete',
              message:
                "Before building an 8+ week program, you need to understand the user's training background. Ask them first:",
              questions: ['How long have you been training consistently, if at all?'],
            }),
          })
          continue
        }

        // ── Quality validation ─────────────────────────────────────────────
        const qualityIssues = validateProgramQuality(draft, {
          fitnessLevel: intake.fitnessLevel,
          weeks: draft.weeks,
          readinessState: intake.readinessState ?? undefined,
          requiredDailyActivityIds: intake.dailyWalkRequested ? ['9001'] : undefined,
          explicitSchedule: intake.explicitSchedule,
        })
        const hardErrors = qualityIssues.filter(i => i.severity === 'error')

        console.log('[V-generation-quality]', {
          userId,
          weeks: draft.weeks,
          dayCount: draft.days.length,
          qualityErrors: hardErrors.map(i => i.code),
          qualityRetry: qualityRetries,
          phase: genPhase,
        })
        for (const e of hardErrors) {
          if (e.meta) console.log('[V-generation-quality-detail]', { userId, code: e.code, ...e.meta })
        }

        if (hardErrors.length > 0 && qualityRetries < QUALITY_RETRY_LIMIT) {
          // Luna correction
          qualityRetries++
          correctionErrors = hardErrors
          correctionPending = true
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              status: 'quality_issues',
              message: `Program passed structural validation but has ${hardErrors.length} quality error(s). Fix ALL listed errors and call propose_program again with a corrected draft. Do not respond to the user yet.`,
              errors: hardErrors.map(e => `[${e.code}] ${e.message}`),
            }),
          })
        } else if (hardErrors.length > 0 && !modelEscalated) {
          // Escalate to Sol
          console.warn('[V-generation-escalation]', {
            userId,
            from: models.program,
            to: models.escalation,
            codes: hardErrors.map(e => e.code),
          })
          modelEscalated = true
          genPhase = 'escalation'
          qualityRetries = 0
          correctionErrors = hardErrors
          correctionPending = true
          notify?.('status', 'Refining your program...')
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              status: 'quality_issues',
              message: `Program has ${hardErrors.length} quality error(s). Fix ALL listed errors and call propose_program again with a corrected draft. Do not respond to the user yet.`,
              errors: hardErrors.map(e => `[${e.code}] ${e.message}`),
            }),
          })
        } else if (hardErrors.length > 0) {
          // Quality retries exhausted on Sol
          console.error('[V-generation-quality-exhausted]', {
            userId,
            codes: hardErrors.map(e => e.code),
            escalated: modelEscalated,
          })
          qualityExhausted = true
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              status: 'quality_exhausted',
              message: QUALITY_EXHAUSTED_MESSAGE,
            }),
          })
        } else {
          // Accepted
          pendingProgram = validation
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              status: 'valid',
              message:
                'Program validated and accepted. Now present it to the user with a brief summary of the program structure and how progression works.',
            }),
          })
        }
      }

      if (pendingProgram?.valid || qualityExhausted) break

      // Swap to compact correction context — prevents token blowup on retries
      if (correctionPending && lastDraftJson) {
        chatMessages = buildCorrectionMessages(lastDraftJson, correctionErrors)
        correctionPending = false
        console.log('[V-generation-correction-context]', {
          userId,
          phase: genPhase,
          draftChars: lastDraftJson.length,
          errorCount: correctionErrors.length,
          estimatedPromptTokens: Math.round(
            chatMessages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0) / 4,
          ),
        })
      }
    }

    const lastMsg = [...chatMessages].reverse().find(m => m.role === 'assistant')
    const finalText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

    const outcome: GenerationResult['outcome'] = pendingProgram?.valid
      ? 'program_delivered'
      : qualityExhausted
        ? 'quality_exhausted'
        : 'generation_failed'

    console.log('[V-generation-summary]', {
      userId,
      outcome,
      rounds,
      qualityRetries,
      escalated: modelEscalated,
      promptTokens,
      completionTokens,
      cachedInputTokens,
      durationMs: Date.now() - t0,
    })

    return {
      outcome,
      program: pendingProgram ?? undefined,
      finalText,
      rounds,
      qualityRetries,
      escalated: modelEscalated,
      proposeProgramAttempted,
      promptTokens,
      completionTokens,
      cachedInputTokens,
      roundLogs,
      durationMs: Date.now() - t0,
    }
  } catch (err: unknown) {
    console.error('[V-generation-loop-error]', { userId, err })
    return makeResult('model_error', {
      pendingProgram: null, rounds, qualityRetries, modelEscalated,
      proposeProgramAttempted, promptTokens, completionTokens,
      cachedInputTokens, roundLogs, t0, finalText: '',
    })
  }
}

// ─── Internal result builder ──────────────────────────────────────────────────

function makeResult(
  outcome: GenerationResult['outcome'],
  state: {
    pendingProgram: ProgramValidationResult | null
    rounds: number
    qualityRetries: number
    modelEscalated: boolean
    proposeProgramAttempted: boolean
    promptTokens: number
    completionTokens: number
    cachedInputTokens: number
    roundLogs: RoundLog[]
    t0: number
    finalText: string
  },
): GenerationResult {
  return {
    outcome,
    program: state.pendingProgram ?? undefined,
    finalText: state.finalText,
    rounds: state.rounds,
    qualityRetries: state.qualityRetries,
    escalated: state.modelEscalated,
    proposeProgramAttempted: state.proposeProgramAttempted,
    promptTokens: state.promptTokens,
    completionTokens: state.completionTokens,
    cachedInputTokens: state.cachedInputTokens,
    roundLogs: state.roundLogs,
    durationMs: Date.now() - state.t0,
  }
}
