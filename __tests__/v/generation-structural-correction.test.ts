/**
 * V Generation — Structural Correction Context Tests
 *
 * Reproduces the production `budget_exhausted` failure from commit b4e3692:
 * structural validation failures were not triggering correction context
 * compaction, causing chatMessages to grow ~3,600 tokens per round and
 * exhausting the 70,000-token budget after just 3 rounds on an 8-week program
 * whose initial prompt was already ~22,000 tokens.
 *
 * These are deterministic: no paid AI calls, controlled mock OpenAI + stub
 * validateDraft. The kernel's injectable interfaces (openai, validateDraft)
 * make this possible without module mocking.
 *
 * NOTE on quality errors: the minimal MINIMAL_DRAFT (1 day, 1 exercise) always
 * fails quality validation (NO_PROGRESSION, MISSING_REQUIRED_ROLE, etc.).
 * Quality validation is real code (not injectable) and fires AFTER structural
 * validation passes. Tests that care about outcome after structural compaction
 * assert `not budget_exhausted` or `quality_exhausted`, not `program_delivered`,
 * since structural compaction correctness is verified by message-shape assertions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type OpenAI from 'openai'
import { runProgramGeneration, QUALITY_RETRY_LIMIT, PROGRAM_DRAFT_MAX_TOKENS } from '../../lib/v/generation'
import { MAX_ORCHESTRATION_TOKENS } from '../../lib/v/search-orchestration'
import { PROPOSE_PROGRAM_TOOL } from '../../lib/ai/tools/program'
import type { ProgramValidationResult } from '../../lib/ai/tools/program'
import { GENERATION_FAILED_MESSAGE, BUDGET_EXHAUSTED_MESSAGE } from '../../app/api/coach/constants'

vi.mock('server-only', () => ({}))

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const MOCK_POOL = 'vertical_pull: ymv:aaa=Lat Pulldown (Cable)\nhorizontal_pull: ymv:bbb=Seated Cable Row (Cable)'
const MOCK_REQUEST = '8-week program, 5 days/week. Goal: strength. Training background: consistent_intermediate. Equipment: barbell, cable, dumbbell.'

const MINIMAL_DRAFT = JSON.stringify({
  program_name: 'Test 8-Week Strength',
  description: 'Test program',
  primary_goal: 'Strength',
  weeks: 8,
  phases: [{ name: 'Base', weeks: '1-4', focus: 'Volume' }, { name: 'Strength', weeks: '5-8', focus: 'Intensity' }],
  days: [{
    name: 'Push Day',
    weekday: 0,
    estimated_duration_minutes: 60,
    exercises: [{ exercise_id: 'ymv:aaa', intended_pattern: 'vertical_pull', sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90 }],
  }],
})

const VALID_PROGRAM: ProgramValidationResult = {
  valid: true,
  errors: [],
  warnings: [],
  program: {
    program_name: 'Test 8-Week Strength',
    days: [{
      name: 'Push Day',
      estimated_duration_minutes: 60,
      weekday: 0,
      exercises: [],
    }],
  },
}

function makeCompletion(draftJson: string, promptTokens = 22000, completionTokens = 3600): OpenAI.Chat.ChatCompletion {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-6-luna',
    choices: [{
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_test_' + Math.random().toString(36).slice(2),
          type: 'function',
          function: { name: 'propose_program', arguments: draftJson },
        }],
        refusal: null,
      },
      logprobs: null,
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }
}

function makeBaseOptions(overrides: {
  openai: { chat: { completions: { create: ReturnType<typeof vi.fn> } } }
  validateDraft: (draft: unknown, userId: string, prisma: unknown, opts: unknown) => Promise<ProgramValidationResult>
}) {
  return {
    userId: 'user-test',
    messages: [
      { role: 'system' as const, content: 'You are V.' },
      { role: 'user' as const, content: 'Build me an 8-week strength program, 5 days per week.' },
    ],
    candidateSummaryText: MOCK_POOL,
    requestSummary: MOCK_REQUEST,
    intake: {
      readinessState: 'consistent_intermediate',
      dailyWalkRequested: false,
      explicitSchedule: null,
      fitnessLevel: 'intermediate',
    },
    models: { program: 'gpt-6-luna', escalation: 'gpt-6-sol', chat: 'gpt-4o-mini' },
    openai: overrides.openai as unknown as OpenAI,
    prisma: {} as never,
    allowedEquipment: ['barbell', 'cable', 'dumbbell'],
    proposeProgramTool: PROPOSE_PROGRAM_TOOL,
    validateDraft: overrides.validateDraft,
    notify: undefined,
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('runProgramGeneration — structural correction context compaction', () => {

  it('structural failure triggers correctionPending → chatMessages compacted to 3 for round 1', async () => {
    const capturedMessages: OpenAI.Chat.ChatCompletionMessageParam[][] = []
    let callIndex = 0

    const create = vi.fn().mockImplementation((params: { messages: OpenAI.Chat.ChatCompletionMessageParam[] }) => {
      capturedMessages.push([...params.messages])
      const pt = callIndex++ === 0 ? 22000 : 3200
      return Promise.resolve(makeCompletion(MINIMAL_DRAFT, pt, 3600))
    })

    // After the structural fail on round 0, all subsequent validateDraft calls return valid
    // so the kernel can proceed to quality validation.
    const validateDraft = vi.fn()
      .mockResolvedValueOnce({ valid: false, errors: ['Day "Push Day", Lat Pulldown: intended_pattern "horizontal_pull" does not match the Involved classification (derived: "vertical_pull"). Either assign this exercise to its verified movement role ("vertical_pull") or select a correctly classified replacement.'] })
      .mockResolvedValue(VALID_PROGRAM)

    await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    // Round 0: initial messages (2 messages from base options)
    expect(capturedMessages[0].length).toBe(2)

    // Round 1: compact correction context — exactly 3 messages (structural compaction fired)
    expect(capturedMessages[1].length).toBe(3)
    expect(capturedMessages[1][0].role).toBe('system')
    expect(capturedMessages[1][1].role).toBe('user')
    expect(capturedMessages[1][2].role).toBe('user')
  })

  it('compact context round 1 preserves candidate pool and request summary', async () => {
    const capturedMessages: OpenAI.Chat.ChatCompletionMessageParam[][] = []

    const create = vi.fn().mockImplementation((params: { messages: OpenAI.Chat.ChatCompletionMessageParam[] }) => {
      capturedMessages.push([...params.messages])
      return Promise.resolve(makeCompletion(MINIMAL_DRAFT))
    })

    const validateDraft = vi.fn()
      .mockResolvedValueOnce({ valid: false, errors: ['Day "Push Day": intended_pattern mismatch'] })
      .mockResolvedValue(VALID_PROGRAM)

    await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    const round1SystemMsg = capturedMessages[1]?.[0]
    expect(typeof round1SystemMsg?.content).toBe('string')
    const content = round1SystemMsg!.content as string

    // Pool is preserved in compact context
    expect(content).toContain(MOCK_POOL)
    // Request summary is preserved in compact context
    expect(content).toContain(MOCK_REQUEST)
  })

  it('compact context includes the structural errors in the third user message', async () => {
    const capturedMessages: OpenAI.Chat.ChatCompletionMessageParam[][] = []
    const STRUCTURAL_ERROR = 'Day "Push Day", Lat Pulldown: intended_pattern "horizontal_pull" does not match classification (derived: "vertical_pull").'

    const create = vi.fn().mockImplementation((params: { messages: OpenAI.Chat.ChatCompletionMessageParam[] }) => {
      capturedMessages.push([...params.messages])
      return Promise.resolve(makeCompletion(MINIMAL_DRAFT))
    })

    const validateDraft = vi.fn()
      .mockResolvedValueOnce({ valid: false, errors: [STRUCTURAL_ERROR] })
      .mockResolvedValue(VALID_PROGRAM)

    await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    const round1ErrorMsg = capturedMessages[1]?.[2]
    expect(typeof round1ErrorMsg?.content).toBe('string')
    expect(round1ErrorMsg!.content as string).toContain(STRUCTURAL_ERROR)
    expect(round1ErrorMsg!.content as string).toContain('[STRUCTURAL]')
  })

  it('repeated structural failures stay compact — history does not grow across rounds', async () => {
    const capturedMessages: OpenAI.Chat.ChatCompletionMessageParam[][] = []

    const create = vi.fn().mockImplementation((params: { messages: OpenAI.Chat.ChatCompletionMessageParam[] }) => {
      capturedMessages.push([...params.messages])
      return Promise.resolve(makeCompletion(MINIMAL_DRAFT, 2000, 500))
    })

    // Fail structurally twice, then succeed
    const validateDraft = vi.fn()
      .mockResolvedValueOnce({ valid: false, errors: ['structural error round 0'] })
      .mockResolvedValueOnce({ valid: false, errors: ['structural error round 1'] })
      .mockResolvedValue(VALID_PROGRAM)

    await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    // Round 0: initial messages (2)
    expect(capturedMessages[0].length).toBe(2)
    // Round 1: compact (3)
    expect(capturedMessages[1].length).toBe(3)
    // Round 2: also compact (3) — compaction re-fires after each structural failure
    expect(capturedMessages[2].length).toBe(3)
  })

  it('structural failure then valid draft proceeds to quality validation', async () => {
    const logs: string[] = []
    const originalLog = console.log.bind(console)
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      if (typeof args[0] === 'string') logs.push(args[0])
      originalLog(...args)
    })

    const create = vi.fn().mockResolvedValue(makeCompletion(MINIMAL_DRAFT, 3000, 1000))
    const validateDraft = vi.fn()
      .mockResolvedValueOnce({ valid: false, errors: ['Phase "Base": weeks range is required'] })
      .mockResolvedValue(VALID_PROGRAM)

    await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    vi.restoreAllMocks()

    // Quality log fires when quality validation runs — proving structural→quality flow works
    expect(logs.some(l => l.includes('[V-generation-quality]'))).toBe(true)
  })

  it('structural failure emits [V-generation-structural-fail] log with diagnostics', async () => {
    const warnLogs: { args: unknown[] }[] = []
    vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warnLogs.push({ args })
    })

    const create = vi.fn().mockResolvedValue(makeCompletion(MINIMAL_DRAFT, 10000, 2000))
    const validateDraft = vi.fn()
      .mockResolvedValueOnce({ valid: false, errors: ['structural error'] })
      .mockResolvedValue(VALID_PROGRAM)

    await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    vi.restoreAllMocks()

    const structuralLog = warnLogs.find(l => l.args[0] === '[V-generation-structural-fail]')
    expect(structuralLog).toBeDefined()
    const payload = structuralLog!.args[1] as Record<string, unknown>
    expect(payload.round).toBe(0)
    expect(payload.errorCount).toBe(1)
    expect(Array.isArray(payload.errors)).toBe(true)
    expect(typeof payload.remainingTokenBudget).toBe('number')
    expect(payload.contextCompacted).toBe(true)
  })

  it('token budget is NOT exhausted by repeated structural failures (original bug regression)', async () => {
    // Simulate the production failure: 8-week program, initial prompt ~22,663 tokens,
    // each round adds ~3,618 completion + ~100 tool result tokens.
    // Before the fix: 3 rounds × growing context = 79,143 total → budget_exhausted on round 3.
    // After the fix: compact context (3,200 tokens) replaces growing history → budget survives.
    let roundIndex = 0
    const create = vi.fn().mockImplementation(() => {
      const pt = roundIndex++ === 0 ? 22000 : 3200
      return Promise.resolve(makeCompletion(MINIMAL_DRAFT, pt, 3600))
    })

    // Fail structurally 3 times (the production failure scenario), then succeed structurally
    const validateDraft = vi.fn()
      .mockResolvedValueOnce({ valid: false, errors: ['structural error 0'] })
      .mockResolvedValueOnce({ valid: false, errors: ['structural error 1'] })
      .mockResolvedValueOnce({ valid: false, errors: ['structural error 2'] })
      .mockResolvedValue(VALID_PROGRAM)

    const result = await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    // With compaction: total tokens stay well under 70,000.
    // Without compaction (pre-fix): growing context would exhaust the budget.
    expect(result.outcome).not.toBe('budget_exhausted')
    expect(result.promptTokens + result.completionTokens).toBeLessThan(MAX_ORCHESTRATION_TOKENS)
  })

  it('token budget still fires when genuinely exceeded even with compaction', async () => {
    // Each round uses tokens close to the budget limit — eventually exhausts it
    // regardless of compaction. This verifies the budget guard still works.
    const LARGE_PT = 25000
    const LARGE_CT = 5000

    const create = vi.fn().mockResolvedValue(makeCompletion(MINIMAL_DRAFT, LARGE_PT, LARGE_CT))

    // Always fail structurally — budget will exhaust eventually
    const validateDraft = vi.fn().mockResolvedValue({ valid: false, errors: ['persistent structural error'] })

    const result = await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    expect(result.outcome).toBe('budget_exhausted')
  })

})

describe('runProgramGeneration — quality corrections and Sol escalation still work', () => {

  it('quality validation fires and increments qualityRetries when structural passes', async () => {
    // Structural passes immediately → quality validation runs with the minimal draft
    // → quality errors fire → qualityRetries incremented → qualityExhausted.
    // This confirms the structural compaction fix did not break the quality path.
    const validateDraft = vi.fn().mockResolvedValue(VALID_PROGRAM)
    const create = vi.fn().mockResolvedValue(makeCompletion(MINIMAL_DRAFT, 3000, 1000))

    const result = await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    // Quality retries must have incremented — proves quality validation ran
    expect(result.qualityRetries).toBeGreaterThan(0)
    // Outcome is quality_exhausted (not budget_exhausted — the structural fix didn't break this path)
    expect(result.outcome).toBe('quality_exhausted')
  })

  it('Sol escalation fires when quality retries exhausted', async () => {
    // After QUALITY_RETRY_LIMIT quality failures on Luna, the kernel switches to Sol.
    const capturedModels: string[] = []

    const create = vi.fn().mockImplementation((params: { messages: unknown[]; model: string }) => {
      capturedModels.push(params.model)
      return Promise.resolve(makeCompletion(MINIMAL_DRAFT, 3000, 1000))
    })

    const validateDraft = vi.fn().mockResolvedValue(VALID_PROGRAM)

    const result = await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    // Sol model must appear in captured calls — proves escalation fired
    expect(capturedModels).toContain('gpt-6-sol')
    // Escalation flag is set on result
    expect(result.escalated).toBe(true)
    // Outcome after Sol exhausts quality is quality_exhausted, not budget_exhausted
    expect(result.outcome).toBe('quality_exhausted')
  })

})

describe('runProgramGeneration — validation rules remain enforced', () => {

  it('valid exercise classification is still enforced — structural errors still fire', async () => {
    // The fix must NOT weaken structural validation. Verify validateDraft is
    // called on every round and that its result gates advancement to quality.
    const validateDraft = vi.fn()
      .mockResolvedValueOnce({ valid: false, errors: ['Day "Push": intended_pattern mismatch'] })
      .mockResolvedValueOnce({ valid: false, errors: ['Day "Push": intended_pattern mismatch'] })
      .mockResolvedValue(VALID_PROGRAM)

    const create = vi.fn().mockResolvedValue(makeCompletion(MINIMAL_DRAFT, 2000, 500))

    await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    // validateDraft was called once per structural-pass attempt — 2 fails + at least 1 pass
    expect(validateDraft.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('structural validation is not bypassed — program_delivered requires valid: true', async () => {
    // Structural validation always fails → outcome is never program_delivered
    const validateDraft = vi.fn().mockResolvedValue({ valid: false, errors: ['persistent error'] })
    const create = vi.fn().mockResolvedValue(makeCompletion(MINIMAL_DRAFT, 3000, 2000))

    const result = await runProgramGeneration(makeBaseOptions({ openai: { chat: { completions: { create } } }, validateDraft }))

    expect(result.outcome).not.toBe('program_delivered')
    // program is null/undefined when structural validation never passed
    expect(result.program?.valid).toBeFalsy()
  })

})

describe('BUDGET_EXHAUSTED_MESSAGE and GENERATION_FAILED_MESSAGE content', () => {

  it('BUDGET_EXHAUSTED_MESSAGE does not suggest reducing program duration', () => {
    const lower = BUDGET_EXHAUSTED_MESSAGE.toLowerCase()
    expect(lower).not.toContain('4 week')
    expect(lower).not.toContain('four week')
    expect(lower).not.toContain('shorter')
    expect(lower).not.toContain('simpler')
    expect(lower).not.toContain('reduce')
    expect(lower).not.toContain('starter block')
  })

  it('BUDGET_EXHAUSTED_MESSAGE is a non-empty string with no internal token details', () => {
    expect(BUDGET_EXHAUSTED_MESSAGE.length).toBeGreaterThan(20)
    expect(BUDGET_EXHAUSTED_MESSAGE.toLowerCase()).not.toContain('token')
    expect(BUDGET_EXHAUSTED_MESSAGE.toLowerCase()).not.toContain('budget')
    expect(BUDGET_EXHAUSTED_MESSAGE.toLowerCase()).not.toContain('70,000')
  })

  it('BUDGET_EXHAUSTED_MESSAGE is distinct from GENERATION_FAILED_MESSAGE', () => {
    expect(BUDGET_EXHAUSTED_MESSAGE).not.toBe(GENERATION_FAILED_MESSAGE)
  })

  it('GENERATION_FAILED_MESSAGE is unchanged (not affected by the budget_exhausted fix)', () => {
    // The original message is correct for genuine generation failures — only
    // budget_exhausted (a transient technical issue) uses a different message.
    expect(GENERATION_FAILED_MESSAGE).toContain('4 weeks')
    expect(GENERATION_FAILED_MESSAGE).toContain('starter block')
  })

})

describe('runProgramGeneration — exported constants', () => {
  it('PROGRAM_DRAFT_MAX_TOKENS is 6000', () => {
    expect(PROGRAM_DRAFT_MAX_TOKENS).toBe(6_000)
  })
  it('QUALITY_RETRY_LIMIT is 1', () => {
    expect(QUALITY_RETRY_LIMIT).toBe(1)
  })
  it('MAX_ORCHESTRATION_TOKENS is 70,000', () => {
    expect(MAX_ORCHESTRATION_TOKENS).toBe(70_000)
  })
})
