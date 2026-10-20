/**
 * Deterministic regression tests for the tool-call execution guarantee.
 *
 * Every tool_call_id emitted in an assistant message must receive exactly one
 * corresponding tool response before the next model request. Handler errors —
 * including JSON.parse failures, provider timeouts, and authorization errors —
 * must not leave any call_id without a response.
 *
 * These tests verify the executeToolCalls helper directly. The production route
 * (app/api/coach/route.ts) implements the same guarantee via an identical
 * try/catch pattern: see the inline comment above the tool-call for loop.
 *
 * Authorization and integrity invariants:
 *   - Authorization errors produce structured error responses, NOT successful ops.
 *   - No data is written or mutated when a handler throws.
 *   - Error responses never expose internal error details to the model.
 */

import { describe, it, expect, vi } from 'vitest'
import { executeToolCalls } from '../../lib/v/tool-call-executor'
import type { ToolHandler } from '../../lib/v/tool-call-executor'

// ── Helpers ───────────────────────────────────────────────────────────────────

function call(id: string, name: string, args: Record<string, unknown> = {}) {
  return { id, name, arguments: JSON.stringify(args) }
}

function callRaw(id: string, name: string, rawArgs: string) {
  return { id, name, arguments: rawArgs }
}

function successHandler(response: string): ToolHandler {
  return async (_name, _args) => response
}

function throwingHandler(message: string): ToolHandler {
  return async (_name, _args) => { throw new Error(message) }
}

function selectiveHandler(
  succeedFor: Set<string>,
  successResponse: string,
  errorMessage: string,
): ToolHandler {
  return async (name, _args) => {
    if (succeedFor.has(name)) return successResponse
    throw new Error(errorMessage)
  }
}

function responseContent(result: { tool_call_id: string; content: string }) {
  return JSON.parse(result.content) as unknown
}

// ── Core guarantee ────────────────────────────────────────────────────────────

describe('executeToolCalls — core guarantee', () => {
  it('returns exactly one response per call for a single successful call', async () => {
    const calls = [call('id-1', 'calculate_nutrition', { ingredients: [] })]
    const handler = successHandler(JSON.stringify({ totals: { calories: 200 } }))

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(1)
    expect(responses[0].tool_call_id).toBe('id-1')
    expect(responseContent(responses[0])).toEqual({ totals: { calories: 200 } })
  })

  it('returns exactly one response per call for two successful calls', async () => {
    const calls = [
      call('id-1', 'calculate_nutrition', { ingredients: [{ name: 'apple' }] }),
      call('id-2', 'calculate_nutrition', { ingredients: [{ name: 'banana' }] }),
    ]
    let callCount = 0
    const handler: ToolHandler = async (_name, _args) => {
      callCount++
      return JSON.stringify({ callN: callCount })
    }

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(2)
    expect(responses[0].tool_call_id).toBe('id-1')
    expect(responses[1].tool_call_id).toBe('id-2')
    expect(callCount).toBe(2)
  })

  it('preserves call_id→response pairing when multiple calls processed', async () => {
    const ids = ['call-a', 'call-b', 'call-c']
    const calls = ids.map(id => call(id, 'search_exercises'))
    const handler: ToolHandler = async (_name, _args) => JSON.stringify({ found: _name })

    const responses = await executeToolCalls(calls, handler)

    expect(responses.map(r => r.tool_call_id)).toEqual(ids)
  })
})

// ── Error scenarios ───────────────────────────────────────────────────────────

describe('executeToolCalls — error isolation', () => {
  it('first call succeeds, second throws: both receive exactly one response', async () => {
    const calls = [
      call('id-success', 'calculate_nutrition'),
      call('id-throw',   'calculate_nutrition'),
    ]
    let n = 0
    const handler: ToolHandler = async (_name, _args) => {
      n++
      if (n === 2) throw new Error('Provider timeout')
      return JSON.stringify({ status: 'ok', n })
    }

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(2)
    expect(responses[0].tool_call_id).toBe('id-success')
    expect(responses[1].tool_call_id).toBe('id-throw')

    const r0 = responseContent(responses[0]) as { status: string; n: number }
    expect(r0.status).toBe('ok')
    expect(r0.n).toBe(1)

    const r1 = responseContent(responses[1]) as { status: string }
    expect(r1.status).toBe('error')
  })

  it('first throws, second succeeds: both receive exactly one response', async () => {
    const calls = [
      call('id-throw',   'calculate_nutrition'),
      call('id-success', 'calculate_nutrition'),
    ]
    let n = 0
    const handler: ToolHandler = async (_name, _args) => {
      n++
      if (n === 1) throw new Error('USDA unavailable')
      return JSON.stringify({ status: 'resolved' })
    }

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(2)
    expect(responses[0].tool_call_id).toBe('id-throw')
    expect(responses[1].tool_call_id).toBe('id-success')

    expect((responseContent(responses[0]) as { status: string }).status).toBe('error')
    expect((responseContent(responses[1]) as { status: string }).status).toBe('resolved')
  })

  it('all calls throw: every call_id still receives a structured error response', async () => {
    const calls = [
      call('a', 'calculate_nutrition'),
      call('b', 'calculate_nutrition'),
      call('c', 'calculate_nutrition'),
    ]
    const handler = throwingHandler('Database connection lost')

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(3)
    expect(responses.map(r => r.tool_call_id)).toEqual(['a', 'b', 'c'])
    for (const r of responses) {
      const parsed = responseContent(r) as { status: string }
      expect(parsed.status).toBe('error')
    }
  })

  it('malformed JSON in arguments produces structured error, not a crash', async () => {
    const calls = [callRaw('bad-json', 'calculate_nutrition', '{ "ingredients": [INVALID')]
    const handler = successHandler(JSON.stringify({ status: 'ok' }))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(1)
    expect(responses[0].tool_call_id).toBe('bad-json')
    const parsed = responseContent(responses[0]) as { status: string; message: string }
    expect(parsed.status).toBe('error')
    // Handler was never called — JSON.parse failed before reaching it
    consoleSpy.mockRestore()
  })

  it('mixed batch: malformed JSON + success + throw = three responses, correct order', async () => {
    const calls = [
      callRaw('malformed',  'calculate_nutrition', 'NOT JSON'),
      call('success',       'calculate_nutrition', { ingredients: [] }),
      call('provider-fail', 'calculate_nutrition', { ingredients: [] }),
    ]
    let n = 0
    const handler: ToolHandler = async (_name, _args) => {
      n++
      if (n === 2) throw new Error('Provider failure')
      return JSON.stringify({ callN: n })
    }

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(3)
    expect(responses[0].tool_call_id).toBe('malformed')
    expect(responses[1].tool_call_id).toBe('success')
    expect(responses[2].tool_call_id).toBe('provider-fail')

    const m = responseContent(responses[0]) as { status: string }
    const s = responseContent(responses[1]) as { callN: number }
    const f = responseContent(responses[2]) as { status: string }

    expect(m.status).toBe('error')
    expect(s.callN).toBe(1)  // first handler invocation (malformed was caught before handler)
    expect(f.status).toBe('error')
  })

  it('provider timeout error is caught and produces structured error response', async () => {
    const calls = [call('timeout-call', 'calculate_nutrition', { ingredients: [{ name: 'salmon' }] })]
    const handler: ToolHandler = async (_name, _args) => {
      await new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('ETIMEDOUT: provider did not respond')), 1),
      )
      return '' // unreachable
    }

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(1)
    expect(responses[0].tool_call_id).toBe('timeout-call')
    const parsed = responseContent(responses[0]) as { status: string }
    expect(parsed.status).toBe('error')
  })
})

// ── Authorization / integrity invariants ─────────────────────────────────────

describe('executeToolCalls — authorization and integrity', () => {
  it('authorization errors produce structured error responses, not successful operations', async () => {
    const mealLogAttempts: unknown[] = []

    const calls = [call('auth-fail', 'prepare_meal_log', { calculationToken: 'tampered' })]
    const handler: ToolHandler = async (name, args) => {
      if (name === 'prepare_meal_log') {
        // Simulate signature verification failure (as verifyMealLogToken would throw)
        throw new Error('HMAC signature invalid — token may have been tampered')
      }
      mealLogAttempts.push(args)
      return JSON.stringify({ status: 'logged' })
    }

    const responses = await executeToolCalls(calls, handler)

    // Response is a structured error, not a successful log
    const parsed = responseContent(responses[0]) as { status: string }
    expect(parsed.status).toBe('error')

    // The handler threw before any write could happen — no meal was logged
    expect(mealLogAttempts).toHaveLength(0)
  })

  it('integrity error on calculate_nutrition does not produce plausible-looking nutrition', async () => {
    const calls = [call('integrity-fail', 'calculate_nutrition', { ingredients: [{ name: 'chicken' }] })]
    const handler = throwingHandler('Database connection lost during nutrition lookup')

    const responses = await executeToolCalls(calls, handler)

    const parsed = responseContent(responses[0]) as Record<string, unknown>
    // Must not look like a successful nutrition result
    expect(parsed.status).toBe('error')
    expect(parsed.totals).toBeUndefined()
    expect(parsed.calories).toBeUndefined()
  })

  it('error content does not expose internal stack traces or sensitive details', async () => {
    const sensitiveMessage = 'Database password: secret123 at /internal/db/conn.ts:42'
    const calls = [call('sensitive-error', 'calculate_nutrition')]
    const handler = throwingHandler(sensitiveMessage)

    const responses = await executeToolCalls(calls, handler)

    const content = responses[0].content
    // The tool response sent to the model should not include the raw error message
    expect(content).not.toContain('password')
    expect(content).not.toContain('secret123')
    expect(content).not.toContain('/internal/db')
    // It should be a generic user-facing message
    const parsed = responseContent(responses[0]) as { status: string; message: string }
    expect(parsed.status).toBe('error')
    expect(parsed.message).toBe('Tool execution failed. Please try again.')
  })

  it('retry limit reached: handler returns limit response, not an exception', async () => {
    // The route's calculate_nutrition handler returns a structured limit_reached
    // response when nutritionToolCallCount >= 3. This is NOT an exception path —
    // the handler returns normally. Verify the guarantee layer passes it through.
    const limitResponse = JSON.stringify({
      status: 'loop_limit_reached',
      message: 'Nutrition calculation limit reached for this turn.',
    })

    const calls = [call('limit-call', 'calculate_nutrition')]
    const handler = successHandler(limitResponse)

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(1)
    const parsed = responseContent(responses[0]) as { status: string }
    expect(parsed.status).toBe('loop_limit_reached')
    expect(responses[0].tool_call_id).toBe('limit-call')
  })

  it('second call succeeds even when first authorization check throws', async () => {
    // Parallel calculate_nutrition calls where one ingredient fails auth, the other resolves.
    const calls = [
      call('bad-token', 'prepare_meal_log', { calculationToken: 'invalid' }),
      call('good-calc', 'calculate_nutrition', { ingredients: [{ name: 'apple' }] }),
    ]
    const handler: ToolHandler = async (name, _args) => {
      if (name === 'prepare_meal_log') throw new Error('Token verification failed')
      return JSON.stringify({ status: 'ok', food: 'apple' })
    }

    const responses = await executeToolCalls(calls, handler)

    expect(responses).toHaveLength(2)
    expect((responseContent(responses[0]) as { status: string }).status).toBe('error')
    expect((responseContent(responses[1]) as { status: string; food: string }).food).toBe('apple')
    // Both call_ids are accounted for
    expect(responses[0].tool_call_id).toBe('bad-token')
    expect(responses[1].tool_call_id).toBe('good-calc')
  })
})
