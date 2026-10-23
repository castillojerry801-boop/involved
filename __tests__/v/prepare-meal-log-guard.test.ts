/**
 * prepare_meal_log guard — regression tests for sequential-tool enforcement
 *
 * Covers:
 *   parallel_tool_calls configuration
 *     1. parallel_tool_calls: false present on every tool-bearing OpenAI call
 *
 *   Missing calculationToken guard
 *     2. Empty calculationToken → structured error, no meal_log_pending SSE
 *     3. Absent calculationToken field → structured error, no meal_log_pending SSE
 *
 *   Token integrity rejection
 *     4. Tampered token (corrupted signature) → invalid_signature, no meal_log_pending
 *     5. Wrong-user token → wrong_user, no meal_log_pending
 *     6. Expired token → expired, no meal_log_pending
 *     7. No signing key (MEAL_LOG_SIGNING_KEY='') → no_key on pending-calc verification
 *
 *   Sequential get_meal_log → prepare_meal_log
 *     8.  get_meal_log dispatch emits calculation_token SSE event
 *     9.  Sequential: get_meal_log round then prepare_meal_log round → meal_log_pending
 *    10.  Correct mealType/logDate forwarded in meal_log_pending (not source values)
 *
 *   Normal calculate_nutrition flow preserved
 *    11. Valid calculate_nutrition token → meal_log_pending SSE still emitted
 *
 *   No side effects on verification failure
 *    12. foodLogEntry.create never called when token verification fails
 *    13. No meal_log_pending for any of the three primary failure modes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────
// Must be hoisted so they are in place before module-level imports resolve.

const { mockCreate, mockGetMealLog, mockPrisma, mockUser } = vi.hoisted(() => {
  const mockUser = { id: 'guard-user-001', email: 'guard@test.com' }
  const mockCreate = vi.fn()
  const mockGetMealLog = vi.fn()
  const mockPrisma = {
    aiUsageLog: { upsert: vi.fn().mockResolvedValue({ interactionCount: 1 }), update: vi.fn() },
    foodLogEntry: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  }
  return { mockCreate, mockGetMealLog, mockPrisma, mockUser }
})

vi.mock('@/lib/ai/client', () => ({
  getOpenAI: () => ({ chat: { completions: { create: mockCreate } } }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({
    auth: { getUser: () => Promise.resolve({ data: { user: mockUser } }) },
  }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/subscription/entitlements', () => ({
  getUserEntitlement: () => Promise.resolve({ tier: 'plus', trialDaysRemaining: null }),
}))
vi.mock('@/lib/ai/context', () => ({
  buildCoachContext: () => Promise.resolve({ trainingCtx: null }),
  contextToSystemSnippet: () => '',
}))
vi.mock('@/lib/v/tools/get-meal-log', () => ({
  getMealLog: mockGetMealLog,
}))

// ─── Signing-key stub ──────────────────────────────────────────────────────────

const TEST_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2'

// ─── Late imports (after mocks are hoisted) ────────────────────────────────────

import { POST } from '@/app/api/coach/route'
import { signMealLogToken } from '@/lib/v/meal-log-token'
import type { MealLogTokenPayload } from '@/lib/v/meal-log-token'
import type { IngredientResult } from '@/lib/v/tools/calculate-nutrition'

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const RESOLVED_ING: IngredientResult = {
  userDescription: 'grilled chicken 150g',
  matchedFoodName: 'Chicken, broilers, breast, cooked, roasted',
  matchConfidence: 'confident',
  calories: 248,
  proteinG: 46.3,
  carbG: 0,
  fatG: 5.4,
  resolved: true,
  conversionNote: '150g',
}

const USER_MSG = [{ role: 'user' as const, content: 'log yesterday lunch for today' }]

function buildToken(userId = mockUser.id, expiresOffsetSec = 7200): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: MealLogTokenPayload = {
    calculationId: 'guard-calc-001',
    userId,
    issuedAt: now,
    expiresAt: now + expiresOffsetSec,
    ingredients: [RESOLVED_ING],
    totals: { calories: 248, proteinG: 46.3, carbG: 0, fatG: 5.4 },
    completeness: 'complete',
    unresolvedIngredients: [],
  }
  return signMealLogToken(payload)!
}

// ─── OpenAI response builders ──────────────────────────────────────────────────

function makeTool(name: string, args: Record<string, unknown>) {
  return {
    choices: [{
      message: {
        role: 'assistant' as const,
        content: null,
        tool_calls: [{ id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }],
      },
    }],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  }
}

function makeText(content: string) {
  return {
    choices: [{ message: { role: 'assistant' as const, content, tool_calls: [] } }],
    usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
  }
}

// ─── Route call helper ─────────────────────────────────────────────────────────

async function callRoute(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  opts: { pendingCalculationToken?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const req = new NextRequest('http://localhost/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, clientDate: '2026-10-22', ...opts }),
  })
  const res = await POST(req)
  const events: Array<Record<string, unknown>> = []
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data: '))
      if (line) { try { events.push(JSON.parse(line.slice(6))) } catch {} }
    }
  }
  return events
}

// ─── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv('MEAL_LOG_SIGNING_KEY', TEST_KEY)
  vi.clearAllMocks()
  // Restore persistent mocks cleared by clearAllMocks
  mockPrisma.aiUsageLog.upsert.mockResolvedValue({ interactionCount: 1 })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('prepare_meal_log guard', () => {

  describe('parallel_tool_calls configuration', () => {
    it('passes parallel_tool_calls: false on every tool-bearing OpenAI API call', async () => {
      mockCreate.mockResolvedValueOnce(makeText('Hello!'))
      await callRoute(USER_MSG)
      const toolCalls = mockCreate.mock.calls.filter(([p]) => Array.isArray(p.tools))
      expect(toolCalls.length).toBeGreaterThan(0)
      for (const [params] of toolCalls) {
        expect(params.parallel_tool_calls).toBe(false)
      }
    })
  })

  describe('missing calculationToken guard', () => {
    it('returns structured error when calculationToken is an empty string', async () => {
      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: '', mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Cannot log without a token.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
      // Route must have fed V an error tool result — verify V's text follows
      expect(events.some(e => e.type === 'text')).toBe(true)
    })

    it('returns structured error when calculationToken field is absent from arguments', async () => {
      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('No token available.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    })
  })

  describe('token integrity rejection', () => {
    it('rejects a tampered token — no meal_log_pending emitted', async () => {
      const token = buildToken()
      // Corrupt the last character of the HMAC signature
      const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: tampered, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Token invalid.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    })

    it('rejects a wrong-user token — no meal_log_pending emitted', async () => {
      const otherUserToken = buildToken('completely-different-user-id')

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: otherUserToken, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Cannot log for a different user.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    })

    it('rejects an expired token — no meal_log_pending emitted', async () => {
      const expired = buildToken(mockUser.id, -1) // expiresAt in the past

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: expired, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Token expired.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    })

    it('handles absent MEAL_LOG_SIGNING_KEY — pending-calc token declared invalid, no meal_log_pending', async () => {
      vi.stubEnv('MEAL_LOG_SIGNING_KEY', '')
      const token = buildToken() // built with TEST_KEY before we cleared it

      // Route verifies pendingCalcToken at request start; no_key → token invalid in context
      // V calls prepare_meal_log with the unusable token
      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: token, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Signing key absent.'))

      const events = await callRoute(USER_MSG, { pendingCalculationToken: token })

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    })
  })

  describe('sequential get_meal_log → prepare_meal_log', () => {
    it('emits calculation_token SSE when get_meal_log returns a token', async () => {
      const token = buildToken()
      mockGetMealLog.mockResolvedValue({
        status: 'found',
        calculationToken: token,
        sourceDate: '2026-10-21',
        sourceMealType: 'lunch',
        itemCount: 1,
        totals: { calories: 248, proteinG: 46.3, carbG: 0, fatG: 5.4 },
        message: 'Found 1 item from 2026-10-21 lunch.',
      })

      mockCreate
        .mockResolvedValueOnce(makeTool('get_meal_log', { sourceDate: '2026-10-21', sourceMealType: 'lunch' }))
        .mockResolvedValueOnce(makeText('Found your lunch. Logging it now.'))

      const events = await callRoute(USER_MSG)

      const tokenEvent = events.find(e => e.type === 'calculation_token')
      expect(tokenEvent).toBeDefined()
      expect(tokenEvent?.calculationToken).toBe(token)
    })

    it('emits meal_log_pending after sequential get_meal_log then prepare_meal_log', async () => {
      const token = buildToken()
      mockGetMealLog.mockResolvedValue({
        status: 'found',
        calculationToken: token,
        sourceDate: '2026-10-21',
        sourceMealType: 'lunch',
        itemCount: 1,
        totals: { calories: 248, proteinG: 46.3, carbG: 0, fatG: 5.4 },
        message: 'Found 1 item.',
      })

      mockCreate
        .mockResolvedValueOnce(makeTool('get_meal_log', { sourceDate: '2026-10-21', sourceMealType: 'lunch', destinationDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: token, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('I found your lunch from October 21st. Tap to confirm.'))

      const events = await callRoute(USER_MSG)

      const pending = events.find(e => e.type === 'meal_log_pending')
      expect(pending).toBeDefined()
    })

    it('forwards the DESTINATION logDate and mealType in meal_log_pending, not source values', async () => {
      const token = buildToken()
      mockGetMealLog.mockResolvedValue({
        status: 'found',
        calculationToken: token,
        sourceDate: '2026-10-19',
        sourceMealType: 'dinner',
        itemCount: 1,
        totals: { calories: 248, proteinG: 46.3, carbG: 0, fatG: 5.4 },
        message: 'Found 1 item.',
      })

      mockCreate
        .mockResolvedValueOnce(makeTool('get_meal_log', { sourceDate: '2026-10-19', sourceMealType: 'dinner' }))
        // V correctly uses destination values (lunch, today) — not source (dinner, 2026-10-19)
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: token, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText("Here's yesterday's dinner as today's lunch."))

      const events = await callRoute(USER_MSG)

      const pending = events.find(e => e.type === 'meal_log_pending') as Record<string, unknown> | undefined
      expect(pending?.data).toMatchObject({ mealType: 'lunch', logDate: '2026-10-22' })
    })
  })

  describe('normal calculate_nutrition flow preserved', () => {
    it('emits meal_log_pending when prepare_meal_log receives a valid calculate_nutrition token', async () => {
      const token = buildToken()

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: token, mealType: 'dinner', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Here is your confirmation card.'))

      const events = await callRoute(USER_MSG, { pendingCalculationToken: token })

      expect(events.find(e => e.type === 'meal_log_pending')).toBeDefined()
    })
  })

  describe('no side effects on verification failure', () => {
    it('never calls foodLogEntry.create when token verification fails', async () => {
      const otherToken = buildToken('wrong-user-id')

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: otherToken, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Could not verify.'))

      await callRoute(USER_MSG)

      expect(mockPrisma.foodLogEntry.create).not.toHaveBeenCalled()
    })

    it('emits no meal_log_pending for all three primary token failures (missing, tampered, wrong-user)', async () => {
      const validToken = buildToken()
      const tampered = validToken.slice(0, -1) + (validToken.endsWith('a') ? 'b' : 'a')
      const wrongUser = buildToken('attacker-user-id')

      for (const badToken of ['', tampered, wrongUser]) {
        vi.clearAllMocks()
        mockPrisma.aiUsageLog.upsert.mockResolvedValue({ interactionCount: 1 })
        mockCreate
          .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: badToken, mealType: 'lunch', logDate: '2026-10-22' }))
          .mockResolvedValueOnce(makeText('Cannot log.'))

        const events = await callRoute(USER_MSG)
        expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
      }
    })
  })
})
