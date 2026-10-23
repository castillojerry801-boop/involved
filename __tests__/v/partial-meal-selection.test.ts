/**
 * Partial-meal ingredient selection — integration regression tests
 *
 * Two layers:
 *
 *  A) REAL multi-turn Coach API orchestration (POST /api/coach) driven by a scripted
 *     OpenAI client. The route's tool-dispatch loop, token signing, context injection,
 *     and server-authoritative ingredient selection all run for real — only the LLM and
 *     the external nutrition calculation are scripted/mocked. This is what the previous
 *     helper-only tests did not cover.
 *
 *  B) Confirm endpoint (POST /api/coach/meal-log) selection + original-index idempotency.
 *
 * Scenarios (per requirements):
 *   - "log that" → all resolved; unresolved disclosed
 *   - "log just the eggs" → only the selected verified egg
 *   - "log the eggs and toast" → exactly those resolved items
 *   - zero resolved → no confirmation card, no log
 *   - selection naming only unresolved/out-of-range indexes → rejected safely
 *   - category change ("as dinner") → reuses token, no recalculation
 *   - quantity correction ("make it 3 eggs") → recalculates (new token)
 *   - duplicate logging → alreadyLogged, no new rows
 *   - original-index idempotency keys
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Env (token signing) ─────────────────────────────────────────────────────────
vi.stubEnv('MEAL_LOG_SIGNING_KEY', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2')

// ── Hoisted mocks ────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const mockUser = { id: 'user-sel-001', email: 'sel@example.com' }
  // Scripted OpenAI responses — each test sets `openaiScript` to an array of
  // ChatCompletion-shaped objects returned in order per create() call.
  const state: {
    openaiScript: unknown[]
    scriptIdx: number
    calcResult: unknown
    calcCalls: number
  } = { openaiScript: [], scriptIdx: 0, calcResult: null, calcCalls: 0 }

  const mockPrisma = {
    aiUsageLog: {
      upsert: vi.fn().mockResolvedValue({ interactionCount: 1 }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    foodLogEntry: { create: vi.fn() },
    mealCalculationRef: {
      create:     vi.fn().mockResolvedValue({ id: 'test-ref-id-001' }),
      findUnique: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(),
  }

  return { mockUser, state, mockPrisma }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: h.mockUser } }) },
  }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.mockPrisma }))
vi.mock('@/lib/ai/client', () => ({
  // The route calls getOpenAI() exactly once per request — reset the script index here so
  // each request (turn) replays its scripted responses from the start.
  getOpenAI: () => {
    h.state.scriptIdx = 0
    return {
      chat: {
        completions: {
          create: async () => {
            const script = h.state.openaiScript
            const idx = Math.min(h.state.scriptIdx, script.length - 1)
            h.state.scriptIdx++
            return script[idx]
          },
        },
      },
    }
  },
}))

vi.mock('@/lib/subscription/config', () => ({ getAiLimit: () => null }))
vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: vi.fn().mockResolvedValue({ tier: 'plus', trialDaysRemaining: null }),
}))
vi.mock('@/lib/ai/context', () => ({
  buildCoachContext: vi.fn().mockResolvedValue({ trainingCtx: null }),
  contextToSystemSnippet: () => '',
}))
vi.mock('@/lib/v/tools/calculate-nutrition', () => ({
  calculateNutrition: vi.fn(async () => {
    h.state.calcCalls++
    return h.state.calcResult
  }),
}))

import { NextRequest } from 'next/server'
import { POST as COACH_POST } from '../../app/api/coach/route'
import { POST as MEALLOG_POST } from '../../app/api/coach/meal-log/route'
import { buildMealLogToken } from '../../lib/v/meal-log-token'
import type { IngredientResult } from '../../lib/v/tools/calculate-nutrition'
import { Prisma } from '@prisma/client'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EGGS: IngredientResult = {
  userDescription: '2 large eggs', matchedFoodName: 'Egg, whole, raw, fresh',
  matchConfidence: 'confident', calories: 140, proteinG: 12, carbG: 0, fatG: 10,
  resolved: true, conversionNote: '2 large eggs',
}
const BACON_UNRESOLVED: IngredientResult = {
  userDescription: '3 strips bacon', matchedFoodName: 'bacon',
  matchConfidence: 'no_match', calories: 0, proteinG: 0, carbG: 0, fatG: 0,
  resolved: false, errorReason: 'No portion data found',
}
const TOAST: IngredientResult = {
  userDescription: '1 slice toast', matchedFoodName: 'Bread, white, toasted',
  matchConfidence: 'confident', calories: 80, proteinG: 3, carbG: 14, fatG: 1,
  resolved: true, conversionNote: '1 slice',
}

// Partial calc result: eggs(0) resolved, bacon(1) unresolved
const PARTIAL_RESULT = {
  ingredients: [EGGS, BACON_UNRESOLVED],
  totals: { calories: 140, proteinG: 12, carbG: 0, fatG: 10 },
  completeness: 'estimated' as const,
  unresolvedIngredients: [{ name: 'bacon', reason: 'conversion_error' }],
  assumptions: [],
}

// ── SSE helpers ─────────────────────────────────────────────────────────────────

function assistantToolCall(name: string, args: object) {
  return {
    choices: [{ message: { role: 'assistant', content: null, tool_calls: [
      { id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }
}
function assistantText(text: string) {
  return {
    choices: [{ message: { role: 'assistant', content: text } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }
}

async function parseSSE(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text()
  const events: Array<Record<string, unknown>> = []
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find(l => l.startsWith('data: '))
    if (!line) continue
    try { events.push(JSON.parse(line.slice(6))) } catch { /* ignore */ }
  }
  return events
}

function coachRequest(messages: Array<{ role: string; content: string }>, pendingCalculationToken?: string) {
  return new NextRequest('http://localhost/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, clientDate: '2026-10-17', ...(pendingCalculationToken ? { pendingCalculationToken } : {}) }),
  })
}

function mealLogRequest(body: unknown) {
  return new NextRequest('http://localhost/api/coach/meal-log', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

// Reset the scripted-create counter between requests. getOpenAI returns a fresh create
// closure each call, but the closure reads its index off the `create` symbol; reset it.
beforeEach(() => {
  vi.clearAllMocks()
  h.state.openaiScript = []
  h.state.scriptIdx = 0
  h.state.calcResult = null
  h.state.calcCalls = 0
  h.mockPrisma.aiUsageLog.upsert.mockResolvedValue({ interactionCount: 1 })
  h.mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
  h.mockPrisma.foodLogEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `e-${Math.random()}`, ...data }))
  h.mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: 'test-ref-id-001' })
  h.mockPrisma.mealCalculationRef.deleteMany.mockResolvedValue({ count: 0 })
})

// ══════════════════════════════════════════════════════════════════════════════
// A) REAL coach-route multi-turn orchestration
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/coach — multi-turn partial-meal selection (scripted AI)', () => {
  // Helper: run turn 1 (calculate) and return the emitted calculation_token
  async function runCalcTurn(): Promise<string> {
    h.state.calcResult = PARTIAL_RESULT
    h.state.openaiScript = [
      assistantToolCall('calculate_nutrition', { ingredients: [
        { name: 'eggs', quantity: 2, unit: 'large' },
        { name: 'bacon', quantity: 3, unit: 'strip' },
      ] }),
      assistantText('2 large eggs: 140 cal. The bacon did not resolve.'),
    ]
    const res = await COACH_POST(coachRequest([{ role: 'user', content: "what's the macros of 2 large eggs and 3 strips of bacon?" }]))
    const events = await parseSSE(res)
    const tokenEvent = events.find(e => e.type === 'calculation_token')
    expect(tokenEvent, 'turn 1 should emit a calculation_token').toBeTruthy()
    return tokenEvent!.calculationToken as string
  }

  it('turn 1 partial calc emits a calculation_token covering both ingredients', async () => {
    const token = await runCalcTurn()
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(10)
    expect(h.state.calcCalls).toBe(1)
  })

  it('"log the eggs as breakfast" → logs only the resolved egg, bacon disclosed, no recalculation', async () => {
    const token = await runCalcTurn()
    // Turn 2: scripted AI selects index 0 (eggs) only
    h.state.calcCalls = 0
    h.state.openaiScript = [
      assistantToolCall('prepare_meal_log', { calculationToken: token, mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: [0] }),
      assistantText('Logged your eggs to breakfast. The bacon could not be resolved, so I left it out.'),
    ]
    const res = await COACH_POST(coachRequest([
      { role: 'user', content: "what's the macros of 2 large eggs and 3 strips of bacon?" },
      { role: 'assistant', content: '2 large eggs: 140 cal. The bacon did not resolve.' },
      { role: 'user', content: 'can you log the eggs as breakfast?' },
    ], token))
    const events = await parseSSE(res)
    const pending = events.find(e => e.type === 'meal_log_pending')
    expect(pending, 'should emit a meal_log_pending card').toBeTruthy()
    const data = pending!.data as Record<string, unknown>
    expect(data.includeIngredientIndexes).toEqual([0])
    expect((data.resolvedIngredients as unknown[]).length).toBe(1)
    expect((data.resolvedIngredients as Array<{ name: string }>)[0].name).toBe('Egg, whole, raw, fresh')
    // Bacon disclosed, never silently dropped
    expect((data.unresolvedIngredients as unknown[]).length).toBe(1)
    expect((data.totals as { calories: number }).calories).toBe(140)
    expect(data.mealType).toBe('breakfast')
    // No recalculation on turn 2
    expect(h.state.calcCalls).toBe(0)
  })

  it('"log that" (no indexes) → logs all resolved, discloses unresolved', async () => {
    const token = await runCalcTurn()
    h.state.openaiScript = [
      assistantToolCall('prepare_meal_log', { calculationToken: token, mealType: 'breakfast', logDate: '2026-10-17' }),
      assistantText('Logged.'),
    ]
    const res = await COACH_POST(coachRequest([
      { role: 'user', content: 'macros?' },
      { role: 'assistant', content: 'eggs 140, bacon unresolved' },
      { role: 'user', content: 'log that as breakfast' },
    ], token))
    const data = (await parseSSE(res)).find(e => e.type === 'meal_log_pending')!.data as Record<string, unknown>
    // All resolved (just eggs here); unresolved disclosed
    expect(data.includeIngredientIndexes).toEqual([0])
    expect((data.unresolvedIngredients as unknown[]).length).toBe(1)
  })

  it('several resolved: "log the eggs and toast" → exactly indexes [0,2]', async () => {
    // Build a 3-ingredient token: eggs(0) resolved, bacon(1) unresolved, toast(2) resolved
    const token = buildMealLogToken(h.mockUser.id, {
      ingredients: [EGGS, BACON_UNRESOLVED, TOAST],
      totals: { calories: 220, proteinG: 15, carbG: 14, fatG: 11 },
      completeness: 'estimated',
      unresolvedIngredients: [{ name: 'bacon', reason: 'conversion_error' }],
    })!
    h.state.openaiScript = [
      assistantToolCall('prepare_meal_log', { calculationToken: token, mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: [0, 2] }),
      assistantText('Logged eggs and toast.'),
    ]
    const res = await COACH_POST(coachRequest([{ role: 'user', content: 'log the eggs and toast' }], token))
    const data = (await parseSSE(res)).find(e => e.type === 'meal_log_pending')!.data as Record<string, unknown>
    expect(data.includeIngredientIndexes).toEqual([0, 2])
    const names = (data.resolvedIngredients as Array<{ name: string }>).map(r => r.name)
    expect(names).toEqual(['Egg, whole, raw, fresh', 'Bread, white, toasted'])
    expect((data.totals as { calories: number }).calories).toBe(220)
  })

  it('selection naming only the unresolved item → error status, no card', async () => {
    const token = await runCalcTurn()
    h.state.openaiScript = [
      assistantToolCall('prepare_meal_log', { calculationToken: token, mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: [1] }),
      assistantText('I could not log the bacon because it was not resolved.'),
    ]
    const res = await COACH_POST(coachRequest([{ role: 'user', content: 'log just the bacon' }], token))
    const events = await parseSSE(res)
    expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    // V still streams a text answer (final turn)
    expect(events.some(e => e.type === 'text')).toBe(true)
  })

  it('zero resolved: token with no resolved ingredients → no card', async () => {
    const token = buildMealLogToken(h.mockUser.id, {
      ingredients: [BACON_UNRESOLVED, { ...BACON_UNRESOLVED, userDescription: '1 mystery' }],
      totals: { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
      completeness: 'incomplete',
      unresolvedIngredients: [{ name: 'bacon', reason: 'conversion_error' }],
    })!
    h.state.openaiScript = [
      assistantToolCall('prepare_meal_log', { calculationToken: token, mealType: 'breakfast', logDate: '2026-10-17' }),
      assistantText('Nothing resolved to log.'),
    ]
    const res = await COACH_POST(coachRequest([{ role: 'user', content: 'log that' }], token))
    expect((await parseSSE(res)).find(e => e.type === 'meal_log_pending')).toBeUndefined()
  })

  it('category change "log as dinner instead" reuses token, no recalculation', async () => {
    const token = await runCalcTurn()
    h.state.calcCalls = 0
    h.state.openaiScript = [
      assistantToolCall('prepare_meal_log', { calculationToken: token, mealType: 'dinner', logDate: '2026-10-17', includeIngredientIndexes: [0] }),
      assistantText('Logged to dinner instead.'),
    ]
    const res = await COACH_POST(coachRequest([{ role: 'user', content: 'actually log the eggs as dinner instead' }], token))
    const data = (await parseSSE(res)).find(e => e.type === 'meal_log_pending')!.data as Record<string, unknown>
    expect(data.mealType).toBe('dinner')
    expect(h.state.calcCalls).toBe(0)
  })

  it('quantity correction "make it 3 eggs" → recalculates (new token emitted)', async () => {
    const token = await runCalcTurn()
    h.state.calcCalls = 0
    // Correction triggers a fresh calculate_nutrition
    h.state.calcResult = {
      ingredients: [{ ...EGGS, userDescription: '3 large eggs', calories: 210, proteinG: 18 }],
      totals: { calories: 210, proteinG: 18, carbG: 0, fatG: 15 },
      completeness: 'complete',
      unresolvedIngredients: [],
      assumptions: [],
    }
    h.state.openaiScript = [
      assistantToolCall('calculate_nutrition', { ingredients: [{ name: 'eggs', quantity: 3, unit: 'large' }] }),
      assistantText('Updated: 3 eggs = 210 cal.'),
    ]
    const res = await COACH_POST(coachRequest([{ role: 'user', content: 'actually make that 3 eggs' }], token))
    const events = await parseSSE(res)
    expect(h.state.calcCalls).toBe(1)
    const newToken = events.find(e => e.type === 'calculation_token')
    expect(newToken).toBeTruthy()
    expect(newToken!.calculationToken).not.toBe(token)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// B) Confirm endpoint — selection + original-index idempotency
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/coach/meal-log — ingredient selection', () => {
  const THREE_ING = () => buildMealLogToken(h.mockUser.id, {
    ingredients: [EGGS, BACON_UNRESOLVED, TOAST],
    totals: { calories: 220, proteinG: 15, carbG: 14, fatG: 11 },
    completeness: 'estimated',
    unresolvedIngredients: [{ name: 'bacon', reason: 'conversion_error' }],
  })!

  it('includeIngredientIndexes:[0] logs only eggs with original-index key', async () => {
    const res = await MEALLOG_POST(mealLogRequest({
      calculationToken: THREE_ING(), mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: [0],
    }))
    const json = await res.json() as { ok: boolean; loggedCount: number }
    expect(res.status).toBe(200)
    expect(json.loggedCount).toBe(1)
    expect(h.mockPrisma.foodLogEntry.create).toHaveBeenCalledTimes(1)
    const data = h.mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    expect(data.snapshotFoodName).toBe('Egg, whole, raw, fresh')
    expect(Number(data.snapshotCaloriesPerServing)).toBe(140)
    expect(data.idempotencyKey).toMatch(/-0$/)   // original index 0
  })

  it('includeIngredientIndexes:[0,2] logs eggs+toast with original-index keys 0 and 2', async () => {
    const res = await MEALLOG_POST(mealLogRequest({
      calculationToken: THREE_ING(), mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: [0, 2],
    }))
    expect((await res.json() as { loggedCount: number }).loggedCount).toBe(2)
    const keys = h.mockPrisma.foodLogEntry.create.mock.calls.map(c => c[0].data.idempotencyKey as string)
    expect(keys[0].endsWith('-0')).toBe(true)
    expect(keys[1].endsWith('-2')).toBe(true)   // toast keeps its ORIGINAL index 2, not 1
  })

  it('omitted indexes → logs all resolved (eggs+toast), skips unresolved bacon', async () => {
    const res = await MEALLOG_POST(mealLogRequest({
      calculationToken: THREE_ING(), mealType: 'breakfast', logDate: '2026-10-17',
    }))
    expect((await res.json() as { loggedCount: number }).loggedCount).toBe(2)
    const names = h.mockPrisma.foodLogEntry.create.mock.calls.map(c => c[0].data.snapshotFoodName)
    expect(names).toEqual(['Egg, whole, raw, fresh', 'Bread, white, toasted'])
  })

  it('selection naming only the unresolved index → 400, nothing written', async () => {
    const res = await MEALLOG_POST(mealLogRequest({
      calculationToken: THREE_ING(), mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: [1],
    }))
    expect(res.status).toBe(400)
    expect(h.mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('out-of-range selection → 400, never falls back to other items', async () => {
    const res = await MEALLOG_POST(mealLogRequest({
      calculationToken: THREE_ING(), mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: [99],
    }))
    expect(res.status).toBe(400)
    expect(h.mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('empty selection array → 400 (explicit empty is not "log all")', async () => {
    const res = await MEALLOG_POST(mealLogRequest({
      calculationToken: THREE_ING(), mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: [],
    }))
    expect(res.status).toBe(400)
  })

  it('non-array includeIngredientIndexes → 400', async () => {
    const res = await MEALLOG_POST(mealLogRequest({
      calculationToken: THREE_ING(), mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: 'eggs',
    }))
    expect(res.status).toBe(400)
  })

  it('duplicate confirm of the same selection → alreadyLogged, no duplicate rows', async () => {
    const token = THREE_ING()
    h.mockPrisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.0.0' }),
    )
    const res = await MEALLOG_POST(mealLogRequest({
      calculationToken: token, mealType: 'breakfast', logDate: '2026-10-17', includeIngredientIndexes: [0],
    }))
    const json = await res.json() as { ok: boolean; alreadyLogged: boolean }
    expect(res.status).toBe(200)
    expect(json.alreadyLogged).toBe(true)
  })

  it('macros always come from the token, never request body', async () => {
    const res = await MEALLOG_POST(mealLogRequest({
      calculationToken: THREE_ING(), mealType: 'breakfast', logDate: '2026-10-17',
      includeIngredientIndexes: [0],
      // attacker-style injected fields
      calories: 9999, snapshotCaloriesPerServing: 9999, ingredients: [{ calories: 9999 }],
    }))
    expect(res.status).toBe(200)
    const data = h.mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    expect(Number(data.snapshotCaloriesPerServing)).toBe(140)   // token value, not 9999
  })
})
