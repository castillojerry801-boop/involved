/**
 * Integration regression: actual route.ts tool-call loop guarantee.
 *
 * The executeToolCalls helper (lib/v/tool-call-executor.ts) is NOT wired into
 * route.ts. The route implements the same guarantee via an inline try/catch.
 * These tests exercise the ACTUAL POST handler to prove that every tool_call_id
 * in a multi-call assistant message receives exactly one tool response before
 * the next model request, even when a handler throws.
 *
 * What is verified:
 *   - Two tool_call_ids emitted by the model → two tool responses pushed to
 *     chatMessages → second OpenAI request carries both responses.
 *   - First call success + second call throw: both call_ids get responses.
 *   - First call success + second call malformed JSON (outer-catch path):
 *     both call_ids get responses, second is a generic error.
 *   - A throwing handler never produces a successful nutrition result
 *     (status: error, no totals/calories fields in the response).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks (must be initialized before vi.mock factories run) ──────────

const { mockCreate, mockCalculateNutrition } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCalculateNutrition: vi.fn(),
}))

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-route-test', email: 'test@involved.app' } },
      }),
    },
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiUsageLog: {
      upsert: vi.fn().mockResolvedValue({ interactionCount: 1 }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    // Program-quality chain (session-composition) — never called on non-program turns
    userTrainingPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    workoutLog:       { findMany: vi.fn().mockResolvedValue([]) },
    foodLogEntry:     { findMany: vi.fn().mockResolvedValue([]) },
    foodItem:         { findMany: vi.fn().mockResolvedValue([]) },
    foodItemPortion:  { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
  },
}))

vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn().mockResolvedValue({
    tier: 'plus',
    trialDaysRemaining: null,
  }),
}))

vi.mock('@/lib/subscription/config', () => ({
  getAiLimit: vi.fn().mockReturnValue(null), // unlimited
}))

vi.mock('@/lib/ai/context', () => ({
  buildCoachContext: vi.fn().mockResolvedValue({
    trainingCtx:  null,
    healthCtx:    null,
    nutritionCtx: null,
    scheduleCtx:  null,
  }),
  contextToSystemSnippet: vi.fn().mockReturnValue(''),
}))

vi.mock('@/lib/ai/client', () => ({
  getOpenAI: vi.fn().mockReturnValue({
    chat: { completions: { create: mockCreate } },
  }),
}))

vi.mock('@/lib/v/tools/calculate-nutrition', () => ({
  calculateNutrition: mockCalculateNutrition,
}))

// ── Route import (must come after vi.mock calls) ──────────────────────────────

import { POST } from '../../app/api/coach/route'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Consume the entire response stream and wait for the handler to finish. */
async function drainStream(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Build a NextRequest with a simple nutrition user message. */
function makeNutritionRequest() {
  return new NextRequest('http://localhost/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'how many calories in 100g chicken and 200g rice?' }],
    }),
  })
}

/** Assistant message with two calculate_nutrition tool calls. */
function assistantWithTwoCalls(call1Id: string, call2Id: string, call2Args?: string) {
  return {
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: call1Id,
            type: 'function',
            function: {
              name: 'calculate_nutrition',
              arguments: JSON.stringify({ ingredients: [{ name: 'chicken breast', quantity: 100, unit: 'g' }] }),
            },
          },
          {
            id: call2Id,
            type: 'function',
            function: {
              name: 'calculate_nutrition',
              arguments: call2Args ?? JSON.stringify({ ingredients: [{ name: 'brown rice', quantity: 200, unit: 'g' }] }),
            },
          },
        ],
      },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 50, completion_tokens: 30 },
  }
}

/** Final text response from the model — no tool calls, ends the loop. */
function assistantWithText(text = 'Chicken has 165 kcal, rice has 260 kcal.') {
  return {
    choices: [{
      message: {
        role: 'assistant',
        content: text,
        tool_calls: undefined,
      },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 80, completion_tokens: 20 },
  }
}

/** Minimal valid NutritionToolResult that satisfies buildMealLogToken. */
function nutritionSuccess(food: string) {
  return {
    ingredients: [{
      resolved: true,
      matchedFoodName: food,
      userDescription: food,
      calories: 165,
      proteinG: 31,
      carbG: 0,
      fatG: 3.6,
      conversionNote: '',
    }],
    totals:               { calories: 165, proteinG: 31, carbG: 0, fatG: 3.6 },
    completeness:         'complete' as const,
    unresolvedIngredients: [],
  }
}

/** Extract tool-role messages from the messages passed to an OpenAI create call. */
function toolMessagesFrom(createCallArgs: unknown): { tool_call_id: string; content: string }[] {
  const params = createCallArgs as { messages: { role: string; tool_call_id?: string; content: string }[] }
  return params.messages.filter(m => m.role === 'tool') as { tool_call_id: string; content: string }[]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('route.ts tool-call loop — integration guarantee', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('first call succeeds, second throws: both call_ids appear in the next OpenAI request', async () => {
    const CALL_1 = 'tc-success-001'
    const CALL_2 = 'tc-throw-002'

    // Round 0: model emits two tool calls
    // Round 1: model returns text → loop exits
    mockCreate
      .mockResolvedValueOnce(assistantWithTwoCalls(CALL_1, CALL_2))
      .mockResolvedValueOnce(assistantWithText())

    // call-1 succeeds; call-2 throws
    let callCount = 0
    mockCalculateNutrition.mockImplementation(async () => {
      callCount++
      if (callCount === 2) throw new Error('USDA provider timed out')
      return nutritionSuccess('Chicken breast, raw')
    })

    const response = await POST(makeNutritionRequest())
    await drainStream(response)

    // Two OpenAI requests were made
    expect(mockCreate).toHaveBeenCalledTimes(2)

    // The SECOND request (after tool processing) must carry both tool responses
    const secondCallMessages = toolMessagesFrom(mockCreate.mock.calls[1][0])
    expect(secondCallMessages).toHaveLength(2)

    // Both call_ids present, in order
    expect(secondCallMessages[0].tool_call_id).toBe(CALL_1)
    expect(secondCallMessages[1].tool_call_id).toBe(CALL_2)

    // First response is successful (has real nutrition data, no top-level status:error)
    const r0 = JSON.parse(secondCallMessages[0].content) as Record<string, unknown>
    expect(r0.status).not.toBe('error')
    expect(r0.totals).toBeDefined()

    // Second response is a structured error (inner catch in calculate_nutrition handler)
    const r1 = JSON.parse(secondCallMessages[1].content) as { status: string; message: string }
    expect(r1.status).toBe('error')
    // Error message comes from the inner catch — not a generic "Tool execution failed"
    expect(r1.message).toContain('Nutrition calculation failed')
  })

  it('second call has malformed JSON arguments: outer catch fires, both call_ids get responses', async () => {
    const CALL_1 = 'tc-valid-json-003'
    const CALL_2 = 'tc-bad-json-004'

    mockCreate
      .mockResolvedValueOnce(assistantWithTwoCalls(CALL_1, CALL_2, '{ "ingredients": INVALID JSON'))
      .mockResolvedValueOnce(assistantWithText())

    // Only called once — call-2 JSON.parse fails before reaching the handler
    mockCalculateNutrition.mockResolvedValue(nutritionSuccess('Chicken breast, raw'))

    const response = await POST(makeNutritionRequest())
    await drainStream(response)

    expect(mockCreate).toHaveBeenCalledTimes(2)

    const secondCallMessages = toolMessagesFrom(mockCreate.mock.calls[1][0])
    expect(secondCallMessages).toHaveLength(2)

    expect(secondCallMessages[0].tool_call_id).toBe(CALL_1)
    expect(secondCallMessages[1].tool_call_id).toBe(CALL_2)

    // First is successful
    const r0 = JSON.parse(secondCallMessages[0].content) as Record<string, unknown>
    expect(r0.status).not.toBe('error')

    // Second is error from the outer catch (generic message from route's outer try/catch)
    const r1 = JSON.parse(secondCallMessages[1].content) as { status: string; message: string }
    expect(r1.status).toBe('error')

    // calculateNutrition was invoked only once (malformed JSON never reached the handler)
    expect(mockCalculateNutrition).toHaveBeenCalledTimes(1)
  })

  it('both calls throw: every call_id still receives a structured error response', async () => {
    const CALL_A = 'tc-all-throw-a'
    const CALL_B = 'tc-all-throw-b'

    mockCreate
      .mockResolvedValueOnce(assistantWithTwoCalls(CALL_A, CALL_B))
      .mockResolvedValueOnce(assistantWithText())

    mockCalculateNutrition.mockRejectedValue(new Error('Database unavailable'))

    const response = await POST(makeNutritionRequest())
    await drainStream(response)

    expect(mockCreate).toHaveBeenCalledTimes(2)

    const secondCallMessages = toolMessagesFrom(mockCreate.mock.calls[1][0])
    expect(secondCallMessages).toHaveLength(2)
    expect(secondCallMessages.map(m => m.tool_call_id)).toEqual([CALL_A, CALL_B])

    for (const msg of secondCallMessages) {
      const parsed = JSON.parse(msg.content) as { status: string }
      expect(parsed.status).toBe('error')
    }

    // No successful nutrition result was produced
    for (const msg of secondCallMessages) {
      const parsed = JSON.parse(msg.content) as Record<string, unknown>
      expect(parsed.totals).toBeUndefined()
      expect(parsed.calories).toBeUndefined()
    }
  })

  it('throwing handler does not log a meal or emit plausible nutrition data', async () => {
    // Integrity invariant: a handler that throws must not produce a response
    // that could mislead V into presenting nutrition data to the user.
    const CALL_1 = 'tc-integrity-005'
    const CALL_2 = 'tc-integrity-006'

    mockCreate
      .mockResolvedValueOnce(assistantWithTwoCalls(CALL_1, CALL_2))
      .mockResolvedValueOnce(assistantWithText())

    let callN = 0
    mockCalculateNutrition.mockImplementation(async () => {
      callN++
      if (callN === 2) throw new Error('Connection reset by peer')
      return nutritionSuccess('Chicken breast, raw')
    })

    const response = await POST(makeNutritionRequest())
    await drainStream(response)

    const secondCallMessages = toolMessagesFrom(mockCreate.mock.calls[1][0])
    const failedMsg = secondCallMessages.find(m => m.tool_call_id === CALL_2)!
    const parsed = JSON.parse(failedMsg.content) as Record<string, unknown>

    expect(parsed.status).toBe('error')
    expect(parsed.totals).toBeUndefined()
    expect(parsed.calories).toBeUndefined()
    expect(parsed.proteinG).toBeUndefined()
  })
})
