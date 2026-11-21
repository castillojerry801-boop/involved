/**
 * V Generation Loop — nudge behavior regression tests
 *
 * Tests the state machine that handles text-only OpenAI responses (no tool_calls)
 * before a valid program has been proposed. The loop injects a follow-up message
 * ("nudge") rather than breaking immediately, up to MAX_NUDGES_TOTAL=2 total and
 * MAX_NUDGES_PER_EPISODE=1 per episode (between tool calls).
 *
 * All tests run synchronously with mocked responses — no live API calls.
 *
 * Scenarios:
 *   A — single nudge recovery: text → nudge → propose_program → success
 *   B — two-nudge recovery: text → nudge → search → text → nudge → propose → success
 *   C — per-episode cap: text → nudge → text (same episode) → break → loop_exhausted
 *   D — total cap: two episodes both nudged, third text-only → break → loop_exhausted
 *   E — budget exhaustion: token budget exceeded before nudge matters
 *   F — normal path: no text-only responses → nudgesUsed=0
 *   G — text after valid program: nudge NOT injected → clean exit
 */

import { describe, it, expect, vi } from 'vitest'

// ─── Mocked dependencies ──────────────────────────────────────────────────────

vi.mock('../../lib/ai/tools/exercises', () => ({
  SEARCH_EXERCISES_TOOL: { type: 'function', function: { name: 'search_exercises', parameters: {} } },
  executeExerciseSearchAsync: vi.fn().mockResolvedValue([
    { id: 'ex_bench', name: 'Bench Press', bodyPart: 'chest', equipment: 'barbell', target: 'pectorals' },
  ]),
}))

vi.mock('../../lib/ai/tools/program', () => ({
  PROPOSE_PROGRAM_TOOL: { type: 'function', function: { name: 'propose_program', parameters: {} } },
  validateProgramDraft: vi.fn().mockResolvedValue({
    valid: true,
    program: {
      program_name: 'Test Program',
      days: [{
        name: 'Day 1',
        weekday: 0,
        session_type: 'full_body',
        estimated_duration_minutes: 45,
        exercises: [{
          exercise_id: 'ex_bench',
          sets: 3,
          reps_min: 8,
          reps_max: 12,
          rest_seconds: 90,
          intended_pattern: 'horizontal_push',
          exercise: { id: 'ex_bench', name: 'Bench Press', bodyPart: 'chest', equipment: 'barbell', target: 'pectorals' },
        }],
      }],
    },
    warnings: [],
  }),
}))

vi.mock('../../lib/v/program-quality', () => ({
  validateProgramQuality: vi.fn().mockReturnValue([]),
}))

import { executeExerciseSearchAsync } from '../../lib/ai/tools/exercises'
import { validateProgramDraft } from '../../lib/ai/tools/program'
import type { ProgramValidationResult } from '../../lib/ai/tools/program'
import { validateProgramQuality } from '../../lib/v/program-quality'

// ─── Mock response builders ───────────────────────────────────────────────────

interface MockToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface MockCompletion {
  choices: Array<{
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: MockToolCall[]
    }
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

function textResponse(content = 'Here is my plan...', tokens = { in: 5_000, out: 200 }): MockCompletion {
  return {
    choices: [{ message: { role: 'assistant', content, tool_calls: undefined } }],
    usage: { prompt_tokens: tokens.in, completion_tokens: tokens.out, total_tokens: tokens.in + tokens.out },
  }
}

function toolResponse(calls: Array<{ name: string; args?: object }>, tokens = { in: 5_000, out: 300 }): MockCompletion {
  return {
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: calls.map((c, i) => ({
          id: `call_${i}`,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      },
    }],
    usage: { prompt_tokens: tokens.in, completion_tokens: tokens.out, total_tokens: tokens.in + tokens.out },
  }
}

const SEARCH_CALL = { name: 'search_exercises', args: { query: 'chest press', limit: 5 } }
const PROPOSE_CALL = { name: 'propose_program', args: {
  program_name: 'Test Program',
  primary_goal: 'general_fitness',
  days: [{
    name: 'Day 1',
    weekday: 0,
    session_type: 'full_body',
    exercises: [{
      exercise_id: 'ex_bench',
      sets: 3,
      reps_min: 8,
      reps_max: 12,
      rest_seconds: 90,
      intended_pattern: 'horizontal_push',
    }],
    estimated_duration_minutes: 45,
  }],
} }

// ─── Loop helper (mirrors route.ts generate loop exactly) ────────────────────
//
// This helper contains the SAME nudge state machine as route.ts. Any change to
// the production logic must also be reflected here to keep the tests valid.

interface LoopResult {
  success: boolean
  nudgesUsed: number
  rounds: number
  errorCode?: 'loop_exhausted' | 'budget_exceeded' | 'quality_failure'
  nudgeMessages: string[]   // content of injected nudge user messages, in order
}

async function runLoopWithNudge(
  responseQueue: MockCompletion[],
  opts: {
    programDays?: number
    tokenBudgetInput?: number
    tokenBudgetOutput?: number
  } = {}
): Promise<LoopResult> {
  const programDays = opts.programDays ?? 3
  const MAX_ROUNDS = Math.min(Math.max(16, programDays * 4 + 6), 36)
  const QUALITY_RETRY_LIMIT = programDays >= 5 ? 3 : 2
  const TOKEN_BUDGET_INPUT  = opts.tokenBudgetInput  ?? (programDays >= 5 ? 240_000 : 120_000)
  const TOKEN_BUDGET_OUTPUT = opts.tokenBudgetOutput ?? 30_000

  // ── Nudge state (mirrors route.ts) ──────────────────────────────────────────
  let nudgesThisEpisode = 0
  let totalNudges = 0
  const MAX_NUDGES_PER_EPISODE = 1
  const MAX_NUDGES_TOTAL = 2
  // ────────────────────────────────────────────────────────────────────────────

  let qualityRetries = 0
  let qualityFailed = false
  let totalInputTokens  = 0
  let totalOutputTokens = 0
  let pendingProgram: ProgramValidationResult | null = null
  let pendingDraft: unknown = null
  let budgetExceeded = false
  const nudgeMessages: string[] = []

  type Msg = { role: string; content: string | null | object; tool_call_id?: string }
  const messages: Msg[] = [
    { role: 'system', content: 'test' },
    { role: 'user', content: 'Create a program.' },
  ]

  let idx = 0
  let round = 0

  for (; round < MAX_ROUNDS; round++) {
    if (idx >= responseQueue.length) break   // exhausted mock queue — treat as loop end

    const response = responseQueue[idx++]
    const choice = response.choices[0]

    if (response.usage) {
      totalInputTokens  += response.usage.prompt_tokens
      totalOutputTokens += response.usage.completion_tokens
      if (totalInputTokens > TOKEN_BUDGET_INPUT || totalOutputTokens > TOKEN_BUDGET_OUTPUT) {
        budgetExceeded = true
        break
      }
    }
    messages.push(choice.message as Msg)

    // ── Nudge logic (mirrors route.ts) ────────────────────────────────────────
    if (!choice.message.tool_calls?.length) {
      // pendingProgram is only set when validation.valid is true (non-null implies valid)
      if (pendingProgram !== null || qualityFailed) break
      if (nudgesThisEpisode < MAX_NUDGES_PER_EPISODE && totalNudges < MAX_NUDGES_TOTAL) {
        nudgesThisEpisode++
        totalNudges++
        const nudgeContent = 'Please call propose_program now with the exercises you have already found.'
        nudgeMessages.push(nudgeContent)
        messages.push({ role: 'user', content: nudgeContent })
        continue
      }
      break
    }
    // ─────────────────────────────────────────────────────────────────────────

    nudgesThisEpisode = 0   // model called a tool — reset per-episode counter

    for (const call of choice.message.tool_calls) {
      const fn = call.function
      let result: string

      if (fn.name === 'search_exercises') {
        const exercises = await executeExerciseSearchAsync({})
        result = JSON.stringify(exercises)
      } else if (fn.name === 'propose_program') {
        const draft = JSON.parse(fn.arguments)
        const validation = await validateProgramDraft(draft, undefined, undefined)
        if (validation.valid) {
          const qualityIssues = validateProgramQuality(draft, {})
          const hardErrors = qualityIssues.filter((i: { severity: string }) => i.severity === 'error')
          if (hardErrors.length > 0 && qualityRetries < QUALITY_RETRY_LIMIT) {
            qualityRetries++
            result = JSON.stringify({ status: 'quality_issues', errors: hardErrors.map((e: { code: string; message: string }) => `[${e.code}] ${e.message}`) })
          } else if (hardErrors.length > 0) {
            qualityFailed = true
            result = JSON.stringify({ status: 'quality_exhausted' })
          } else {
            pendingProgram = validation
            pendingDraft = draft
            result = JSON.stringify({ status: 'valid', message: 'Program validated. You are done.' })
          }
        } else {
          result = JSON.stringify({ status: 'invalid', errors: validation.errors })
        }
      } else {
        result = JSON.stringify({ error: 'Unknown tool' })
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }

    if (pendingProgram?.valid || qualityFailed) break
  }

  void pendingDraft  // used only by the loop — silence unused-var lint

  return {
    success: !!(pendingProgram?.valid),
    nudgesUsed: totalNudges,
    rounds: round + 1,
    errorCode: budgetExceeded
      ? 'budget_exceeded'
      : qualityFailed
        ? 'quality_failure'
        : !pendingProgram
          ? 'loop_exhausted'
          : undefined,
    nudgeMessages,
  }
}

// ─── Scenario A — single nudge recovery ──────────────────────────────────────

describe('A — single nudge recovery', () => {
  it('A1 — succeeds after one text-only response followed by propose_program', async () => {
    const result = await runLoopWithNudge([
      textResponse(),            // round 0: text → nudge injected
      toolResponse([PROPOSE_CALL]), // round 1: propose_program → valid
    ])
    expect(result.success).toBe(true)
    expect(result.errorCode).toBeUndefined()
  })

  it('A2 — exactly one nudge was used', async () => {
    const result = await runLoopWithNudge([
      textResponse(),
      toolResponse([PROPOSE_CALL]),
    ])
    expect(result.nudgesUsed).toBe(1)
  })

  it('A3 — nudge message directs the model to call propose_program', async () => {
    const result = await runLoopWithNudge([
      textResponse(),
      toolResponse([PROPOSE_CALL]),
    ])
    expect(result.nudgeMessages).toHaveLength(1)
    expect(result.nudgeMessages[0]).toContain('propose_program')
  })

  it('A4 — search before nudge scenario: search → text → nudge → propose → success', async () => {
    const result = await runLoopWithNudge([
      toolResponse([SEARCH_CALL]),    // round 0: search (counter resets to 0)
      textResponse(),                  // round 1: text → nudge (episode 1)
      toolResponse([PROPOSE_CALL]),   // round 2: propose → valid
    ])
    expect(result.success).toBe(true)
    expect(result.nudgesUsed).toBe(1)
  })
})

// ─── Scenario B — two-nudge recovery ─────────────────────────────────────────

describe('B — two-nudge recovery (tool call resets episode counter between nudges)', () => {
  it('B1 — succeeds after two text-only episodes, each with a tool call in between', async () => {
    const result = await runLoopWithNudge([
      textResponse(),                  // round 0: text → nudge 1 (episode 1)
      toolResponse([SEARCH_CALL]),    // round 1: search → resets episode counter
      textResponse(),                  // round 2: text → nudge 2 (episode 2)
      toolResponse([PROPOSE_CALL]),   // round 3: propose → valid
    ])
    expect(result.success).toBe(true)
    expect(result.nudgesUsed).toBe(2)
  })

  it('B2 — both nudge messages are recorded', async () => {
    const result = await runLoopWithNudge([
      textResponse(),
      toolResponse([SEARCH_CALL]),
      textResponse(),
      toolResponse([PROPOSE_CALL]),
    ])
    expect(result.nudgeMessages).toHaveLength(2)
  })

  it('B3 — second nudge fires because per-episode counter reset after tool call', async () => {
    // If the counter did NOT reset, nudgesThisEpisode would be 1 on the second
    // text response and the second nudge would be blocked. This test proves the
    // reset is working.
    const result = await runLoopWithNudge([
      textResponse(),
      toolResponse([SEARCH_CALL]),
      textResponse(),
      toolResponse([PROPOSE_CALL]),
    ])
    // Success proves the second nudge fired — without it, the loop would break
    // on the third response and return loop_exhausted.
    expect(result.success).toBe(true)
  })
})

// ─── Scenario C — per-episode cap ────────────────────────────────────────────

describe('C — per-episode cap prevents double-nudging within a single episode', () => {
  it('C1 — loop_exhausted when model writes text twice in the same episode', async () => {
    const result = await runLoopWithNudge([
      textResponse(),   // round 0: text → nudge 1 (nudgesThisEpisode=1)
      textResponse(),   // round 1: text → nudgesThisEpisode >= 1 → break
    ])
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('loop_exhausted')
  })

  it('C2 — only one nudge used before the per-episode cap terminates the loop', async () => {
    const result = await runLoopWithNudge([
      textResponse(),
      textResponse(),
    ])
    expect(result.nudgesUsed).toBe(1)
  })

  it('C3 — per-episode cap does NOT fire after a tool call resets the counter', async () => {
    // text → nudge → search (reset) → text → nudge (allowed) — this is scenario B
    // This test specifically confirms the cap is per-episode, not global.
    const result = await runLoopWithNudge([
      textResponse(),
      toolResponse([SEARCH_CALL]),
      textResponse(),
      toolResponse([PROPOSE_CALL]),
    ])
    // If the cap were global (not per-episode), the second text would be blocked
    // and the loop would fail. Success here proves the cap resets.
    expect(result.success).toBe(true)
  })
})

// ─── Scenario D — total nudge cap ────────────────────────────────────────────

describe('D — total nudge cap (MAX_NUDGES_TOTAL=2) terminates the loop after 2 nudges', () => {
  it('D1 — loop_exhausted after MAX_NUDGES_TOTAL=2 nudges with no proposal', async () => {
    // Three text-only episodes with tool calls in between to reset per-episode counter.
    // After nudge 2 (total cap), the third text-only response has no nudge left → break.
    const result = await runLoopWithNudge([
      textResponse(),                  // round 0: text → nudge 1
      toolResponse([SEARCH_CALL]),    // round 1: search → reset episode counter
      textResponse(),                  // round 2: text → nudge 2 (total cap reached)
      toolResponse([SEARCH_CALL]),    // round 3: search → reset
      textResponse(),                  // round 4: text → totalNudges=2 ≥ MAX → break
    ])
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('loop_exhausted')
  })

  it('D2 — exactly 2 nudges recorded before the loop terminates', async () => {
    const result = await runLoopWithNudge([
      textResponse(),
      toolResponse([SEARCH_CALL]),
      textResponse(),
      toolResponse([SEARCH_CALL]),
      textResponse(),
    ])
    expect(result.nudgesUsed).toBe(2)
  })

  it('D3 — recovery before total cap: 2 nudges both resolve → success', async () => {
    // Uses both nudges productively — still succeeds.
    const result = await runLoopWithNudge([
      textResponse(),
      toolResponse([SEARCH_CALL]),
      textResponse(),
      toolResponse([PROPOSE_CALL]),
    ])
    expect(result.success).toBe(true)
    expect(result.nudgesUsed).toBe(2)
  })
})

// ─── Scenario E — budget exhaustion ──────────────────────────────────────────

describe('E — token budget exhaustion breaks the loop before nudges matter', () => {
  it('E1 — budget_exceeded when input token limit is hit', async () => {
    // Set a tiny budget (10K) so the first search response already exceeds it.
    const result = await runLoopWithNudge([
      toolResponse([SEARCH_CALL], { in: 15_000, out: 300 }),  // 15K > 10K budget
      textResponse(),
      toolResponse([PROPOSE_CALL]),
    ], { tokenBudgetInput: 10_000 })
    expect(result.errorCode).toBe('budget_exceeded')
    expect(result.success).toBe(false)
  })

  it('E2 — budget_exceeded when output token limit is hit', async () => {
    const result = await runLoopWithNudge([
      toolResponse([SEARCH_CALL], { in: 1_000, out: 50_000 }),  // 50K > 30K output
    ], { tokenBudgetOutput: 30_000 })
    expect(result.errorCode).toBe('budget_exceeded')
    expect(result.success).toBe(false)
  })

  it('E3 — budget guard fires BEFORE nudge injection (budget takes precedence)', async () => {
    // The response that would trigger a nudge carries enough tokens to exceed the budget.
    // The budget guard runs before the nudge check → no nudge, errorCode=budget_exceeded.
    const result = await runLoopWithNudge([
      textResponse('plan...', { in: 200_000, out: 200 }),  // first response: budget exceeded
    ], { tokenBudgetInput: 100_000 })
    expect(result.errorCode).toBe('budget_exceeded')
    expect(result.nudgesUsed).toBe(0)
  })
})

// ─── Scenario F — normal path (no text-only responses) ───────────────────────

describe('F — normal path: no text-only responses, nudge never fires', () => {
  it('F1 — search then propose succeeds with 0 nudges', async () => {
    const result = await runLoopWithNudge([
      toolResponse([SEARCH_CALL]),
      toolResponse([PROPOSE_CALL]),
    ])
    expect(result.success).toBe(true)
    expect(result.nudgesUsed).toBe(0)
    expect(result.nudgeMessages).toHaveLength(0)
  })

  it('F2 — multiple searches then propose succeeds with 0 nudges', async () => {
    const result = await runLoopWithNudge([
      toolResponse([SEARCH_CALL]),
      toolResponse([SEARCH_CALL]),
      toolResponse([SEARCH_CALL]),
      toolResponse([PROPOSE_CALL]),
    ])
    expect(result.success).toBe(true)
    expect(result.nudgesUsed).toBe(0)
  })
})

// ─── Scenario G — text after valid program ────────────────────────────────────

describe('G — text after a valid program does NOT inject a nudge', () => {
  it('G1 — loop exits cleanly when model writes text after successful propose_program', async () => {
    // The loop should break immediately when pendingProgram.valid is true,
    // without injecting a nudge. In practice the loop breaks at the
    // `if (pendingProgram?.valid) break` check BEFORE the next round's text
    // response — but we verify that even if a text response somehow arrives
    // after a valid result, the nudge branch is bypassed.
    //
    // In the current implementation the loop exits before the next round starts,
    // so this test validates that pendingProgram.valid causes an immediate exit.
    const result = await runLoopWithNudge([
      toolResponse([PROPOSE_CALL]),   // round 0: propose → valid → loop breaks
      textResponse(),                  // round 1: never reached
    ])
    expect(result.success).toBe(true)
    expect(result.nudgesUsed).toBe(0)
    expect(result.rounds).toBe(1)   // loop exited after round 0
  })

  it('G2 — quality_failure does NOT trigger a nudge, exits cleanly', async () => {
    vi.mocked(validateProgramQuality).mockReturnValueOnce([
      { severity: 'error', code: 'TEST_ERR', message: 'test error' },
    ])
    vi.mocked(validateProgramQuality).mockReturnValueOnce([
      { severity: 'error', code: 'TEST_ERR', message: 'test error' },
    ])
    vi.mocked(validateProgramQuality).mockReturnValueOnce([
      { severity: 'error', code: 'TEST_ERR', message: 'test error' },
    ])

    // Propose fails quality 3 times (QUALITY_RETRY_LIMIT=2 for 3-day), exits with quality_failure
    const result = await runLoopWithNudge([
      toolResponse([PROPOSE_CALL]),   // quality error → retry 1
      toolResponse([PROPOSE_CALL]),   // quality error → retry 2
      toolResponse([PROPOSE_CALL]),   // quality error → exhausted
      textResponse(),                  // never reached (loop already broke)
    ], { programDays: 3 })

    expect(result.errorCode).toBe('quality_failure')
    expect(result.nudgesUsed).toBe(0)
  })
})
