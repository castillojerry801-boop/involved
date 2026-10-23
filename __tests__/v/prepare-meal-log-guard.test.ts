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
 *
 *   Corrected token-invalid hint (Part A diagnostics)
 *    14. malformed token → hint names both get_meal_log and calculate_nutrition
 *    15. invalid_signature token → hint names both get_meal_log and calculate_nutrition
 *    16. [V-meal-log-verify-fail] logged with reason on invalid_signature
 *    17. [V-meal-log-verify-fail] does not log raw token or macro data
 *
 *   get_meal_log diagnostic logging (Part A diagnostics)
 *    18. [V-get-meal-log] logged with status/itemCount/tokenPresent/tokenLength on found
 *    19. [V-get-meal-log] logged with tokenPresent: false on empty result
 *    20. [V-get-meal-log] never logs the raw token value
 *
 *   Opaque calculationRefId path (Option 2 architecture)
 *    21. get_meal_log dispatch stores a ref and returns calculationRefId (not token) to V
 *    22. calculate_nutrition dispatch stores a ref and returns calculationRefId to V
 *    23. prepare_meal_log with valid calculationRefId → meal_log_pending emitted
 *    24. prepare_meal_log with missing calculationRefId → error, no meal_log_pending
 *    25. prepare_meal_log with not_found ref → error, no meal_log_pending
 *    26. prepare_meal_log with expired ref → error, no meal_log_pending
 *    27. prepare_meal_log with db_error → error, no meal_log_pending
 *    28. Legacy calculationToken still accepted (transition path), meal_log_pending emitted
 *    29. Multiple pending refs — only the supplied refId is used, not substituted
 *    30. No FoodLogEntry created when ref resolution fails
 *    31. meal_log_pending uses server-resolved token, not V's argument
 *    32. Ref creation never creates a FoodLogEntry (diary write requires confirmation)
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
    mealCalculationRef: {
      create:     vi.fn().mockResolvedValue({ id: 'test-ref-id-001' }),
      findUnique: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
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

const MOCK_REF_ID = 'test-ref-id-001'

beforeEach(() => {
  vi.stubEnv('MEAL_LOG_SIGNING_KEY', TEST_KEY)
  vi.clearAllMocks()
  // Restore persistent mocks cleared by clearAllMocks
  mockPrisma.aiUsageLog.upsert.mockResolvedValue({ interactionCount: 1 })
  mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: MOCK_REF_ID })
  mockPrisma.mealCalculationRef.deleteMany.mockResolvedValue({ count: 0 })
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

    it('emits meal_log_pending after sequential get_meal_log then prepare_meal_log (using calculationRefId)', async () => {
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
      // Simulate DB storing the ref and returning a UUID
      mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: MOCK_REF_ID })
      // Simulate DB resolving the ref to the full token
      mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
        userId: mockUser.id, token, expiresAt: new Date(Date.now() + 7200 * 1000),
      })

      mockCreate
        .mockResolvedValueOnce(makeTool('get_meal_log', { sourceDate: '2026-10-21', sourceMealType: 'lunch', destinationDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationRefId: MOCK_REF_ID, mealType: 'lunch', logDate: '2026-10-22' }))
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
      mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: MOCK_REF_ID })
      mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
        userId: mockUser.id, token, expiresAt: new Date(Date.now() + 7200 * 1000),
      })

      mockCreate
        .mockResolvedValueOnce(makeTool('get_meal_log', { sourceDate: '2026-10-19', sourceMealType: 'dinner' }))
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationRefId: MOCK_REF_ID, mealType: 'lunch', logDate: '2026-10-22' }))
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

  describe('corrected token-invalid hint', () => {
    it('malformed token — error message names get_meal_log AND calculate_nutrition as recovery paths', async () => {
      // Token without signature: base64url body only, no "." separator → malformed
      const bodyOnly = buildToken().split('.')[0]

      let messagesOnRound1: Array<Record<string, unknown>> = []
      mockCreate
        .mockImplementationOnce(async () =>
          makeTool('prepare_meal_log', { calculationToken: bodyOnly, mealType: 'lunch', logDate: '2026-10-22' })
        )
        .mockImplementationOnce(async (params: Record<string, unknown>) => {
          messagesOnRound1 = params.messages as Array<Record<string, unknown>>
          return makeText('Cannot log.')
        })

      await callRoute(USER_MSG)

      const toolMsg = messagesOnRound1.find(m => m.role === 'tool')
      expect(toolMsg).toBeDefined()
      const parsed = JSON.parse(toolMsg!.content as string) as Record<string, unknown>
      expect(parsed.status).toBe('error')
      expect(parsed.reason).toBe('malformed')
      expect(parsed.message as string).toContain('get_meal_log')
      expect(parsed.message as string).toContain('calculate_nutrition')
    })

    it('invalid_signature token — error message names get_meal_log AND calculate_nutrition as recovery paths', async () => {
      const token = buildToken()
      const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')

      let messagesOnRound1: Array<Record<string, unknown>> = []
      mockCreate
        .mockImplementationOnce(async () =>
          makeTool('prepare_meal_log', { calculationToken: tampered, mealType: 'lunch', logDate: '2026-10-22' })
        )
        .mockImplementationOnce(async (params: Record<string, unknown>) => {
          messagesOnRound1 = params.messages as Array<Record<string, unknown>>
          return makeText('Cannot log.')
        })

      await callRoute(USER_MSG)

      const toolMsg = messagesOnRound1.find(m => m.role === 'tool')
      expect(toolMsg).toBeDefined()
      const parsed = JSON.parse(toolMsg!.content as string) as Record<string, unknown>
      expect(parsed.status).toBe('error')
      expect(parsed.reason).toBe('invalid_signature')
      expect(parsed.message as string).toContain('get_meal_log')
      expect(parsed.message as string).toContain('calculate_nutrition')
    })

    it('[V-meal-log-verify-fail] is logged with the reason code on verification failure', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        const token = buildToken()
        const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')

        mockCreate
          .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: tampered, mealType: 'lunch', logDate: '2026-10-22' }))
          .mockResolvedValueOnce(makeText('Cannot log.'))

        await callRoute(USER_MSG)

        const verifyCall = consoleSpy.mock.calls.find(([tag]) => tag === '[V-meal-log-verify-fail]')
        expect(verifyCall).toBeDefined()
        expect(verifyCall![1]).toMatchObject({ userId: mockUser.id, reason: 'invalid_signature' })
      } finally {
        consoleSpy.mockRestore()
      }
    })

    it('[V-meal-log-verify-fail] does not log raw token, macro values, or food details', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        const wrongUserToken = buildToken('other-user-id')

        mockCreate
          .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: wrongUserToken, mealType: 'lunch', logDate: '2026-10-22' }))
          .mockResolvedValueOnce(makeText('Cannot log.'))

        await callRoute(USER_MSG)

        const verifyCall = consoleSpy.mock.calls.find(([tag]) => tag === '[V-meal-log-verify-fail]')
        expect(verifyCall).toBeDefined()
        const logged = verifyCall![1] as Record<string, unknown>
        expect(Object.keys(logged).sort()).toEqual(['reason', 'userId'].sort())
        expect(logged).not.toHaveProperty('token')
        expect(logged).not.toHaveProperty('calories')
        expect(logged).not.toHaveProperty('ingredients')
      } finally {
        consoleSpy.mockRestore()
      }
    })
  })

  describe('opaque calculationRefId path (Option 2)', () => {
    it('get_meal_log dispatch stores a ref and returns calculationRefId — not token — to V', async () => {
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
      mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: MOCK_REF_ID })

      let messagesAfterGetMealLog: Array<Record<string, unknown>> = []
      mockCreate
        .mockImplementationOnce(async () =>
          makeTool('get_meal_log', { sourceDate: '2026-10-21', sourceMealType: 'lunch' })
        )
        .mockImplementationOnce(async (params: Record<string, unknown>) => {
          messagesAfterGetMealLog = params.messages as Array<Record<string, unknown>>
          return makeText('Found your lunch.')
        })

      await callRoute(USER_MSG)

      const toolMsg = messagesAfterGetMealLog.find(m => m.role === 'tool')
      expect(toolMsg).toBeDefined()
      const parsed = JSON.parse(toolMsg!.content as string) as Record<string, unknown>
      // V's result must include calculationRefId
      expect(parsed.calculationRefId).toBe(MOCK_REF_ID)
      // V's result must NOT include the raw signed token
      expect(JSON.stringify(parsed)).not.toContain(token)
    })

    it('prepare_meal_log with valid calculationRefId resolves the token and emits meal_log_pending', async () => {
      const token = buildToken()
      mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
        userId: mockUser.id, token, expiresAt: new Date(Date.now() + 7200 * 1000),
      })

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationRefId: MOCK_REF_ID, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Here is your confirmation card.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeDefined()
    })

    it('prepare_meal_log with missing calculationRefId → error, no meal_log_pending', async () => {
      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('No ref available.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    })

    it('prepare_meal_log with not_found ref → error, no meal_log_pending', async () => {
      mockPrisma.mealCalculationRef.findUnique.mockResolvedValue(null)

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationRefId: 'nonexistent-ref', mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Ref not found.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    })

    it('prepare_meal_log with expired ref → error, no meal_log_pending', async () => {
      const token = buildToken()
      mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
        userId: mockUser.id, token, expiresAt: new Date(Date.now() - 1000),
      })

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationRefId: MOCK_REF_ID, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Ref expired.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    })

    it('prepare_meal_log with db_error → error, no meal_log_pending', async () => {
      mockPrisma.mealCalculationRef.findUnique.mockRejectedValue(new Error('DB timeout'))

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationRefId: MOCK_REF_ID, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('DB error.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeUndefined()
    })

    it('legacy calculationToken still accepted — meal_log_pending emitted (transition path)', async () => {
      const token = buildToken()
      // No ref lookup needed — legacy token is verified directly
      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationToken: token, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Legacy path.'))

      const events = await callRoute(USER_MSG)

      expect(events.find(e => e.type === 'meal_log_pending')).toBeDefined()
    })

    it('multiple pending refs — only the supplied refId is resolved, not substituted', async () => {
      // Two tokens, two refs. The route must look up ONLY the one V explicitly supplied.
      const tokenA = buildToken()
      const tokenB = buildToken()

      mockPrisma.mealCalculationRef.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === 'ref-id-A') return { userId: mockUser.id, token: tokenA, expiresAt: new Date(Date.now() + 7200 * 1000) }
        if (where.id === 'ref-id-B') return { userId: mockUser.id, token: tokenB, expiresAt: new Date(Date.now() + 7200 * 1000) }
        return null
      })

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationRefId: 'ref-id-B', mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Confirmed.'))

      const events = await callRoute(USER_MSG)

      const pending = events.find(e => e.type === 'meal_log_pending') as Record<string, unknown> | undefined
      expect(pending).toBeDefined()
      // The token in meal_log_pending must be tokenB (the one V supplied), not tokenA
      expect((pending!.data as Record<string, unknown>).calculationToken).toBe(tokenB)
    })

    it('no FoodLogEntry created when ref resolution fails', async () => {
      mockPrisma.mealCalculationRef.findUnique.mockResolvedValue(null)

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationRefId: 'nonexistent', mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Ref not found.'))

      await callRoute(USER_MSG)

      expect(mockPrisma.foodLogEntry.create).not.toHaveBeenCalled()
    })

    it('meal_log_pending uses the server-resolved token, not a raw string from V', async () => {
      const token = buildToken()
      mockPrisma.mealCalculationRef.findUnique.mockResolvedValue({
        userId: mockUser.id, token, expiresAt: new Date(Date.now() + 7200 * 1000),
      })

      mockCreate
        .mockResolvedValueOnce(makeTool('prepare_meal_log', { calculationRefId: MOCK_REF_ID, mealType: 'lunch', logDate: '2026-10-22' }))
        .mockResolvedValueOnce(makeText('Here is the confirmation card.'))

      const events = await callRoute(USER_MSG)

      const pending = events.find(e => e.type === 'meal_log_pending') as Record<string, unknown> | undefined
      expect(pending).toBeDefined()
      // The full signed token in the SSE event must be the one stored in the DB, not invented by V
      expect((pending!.data as Record<string, unknown>).calculationToken).toBe(token)
    })

    it('storing a ref never creates a FoodLogEntry', async () => {
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
      mockPrisma.mealCalculationRef.create.mockResolvedValue({ id: MOCK_REF_ID })

      mockCreate
        .mockResolvedValueOnce(makeTool('get_meal_log', { sourceDate: '2026-10-21', sourceMealType: 'lunch' }))
        .mockResolvedValueOnce(makeText('Found your lunch.'))

      await callRoute(USER_MSG)

      // Ref was stored, but the diary was not touched
      expect(mockPrisma.mealCalculationRef.create).toHaveBeenCalled()
      expect(mockPrisma.foodLogEntry.create).not.toHaveBeenCalled()
    })
  })

  describe('get_meal_log diagnostic logging', () => {
    it('[V-get-meal-log] logged with status/itemCount/tokenPresent/tokenLength on found result', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        const token = buildToken()
        mockGetMealLog.mockResolvedValue({
          status: 'found',
          calculationToken: token,
          sourceDate: '2026-10-21',
          sourceMealType: 'lunch',
          itemCount: 3,
          totals: { calories: 748, proteinG: 58, carbG: 40, fatG: 22 },
          message: 'Found 3 items from 2026-10-21 lunch.',
        })

        mockCreate
          .mockResolvedValueOnce(makeTool('get_meal_log', { sourceDate: '2026-10-21', sourceMealType: 'lunch' }))
          .mockResolvedValueOnce(makeText('Found your lunch.'))

        await callRoute(USER_MSG)

        const getLogCall = consoleSpy.mock.calls.find(([tag]) => tag === '[V-get-meal-log]')
        expect(getLogCall).toBeDefined()
        const logged = getLogCall![1] as Record<string, unknown>
        expect(logged.status).toBe('found')
        expect(logged.itemCount).toBe(3)
        expect(logged.tokenPresent).toBe(true)
        expect(typeof logged.tokenLength).toBe('number')
        expect(logged.tokenLength as number).toBeGreaterThan(0)
      } finally {
        consoleSpy.mockRestore()
      }
    })

    it('[V-get-meal-log] logged with tokenPresent: false and tokenLength: 0 on empty result', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        mockGetMealLog.mockResolvedValue({
          status: 'empty',
          sourceDate: '2026-10-21',
          sourceMealType: 'lunch',
          message: 'No lunch entries found for 2026-10-21.',
        })

        mockCreate
          .mockResolvedValueOnce(makeTool('get_meal_log', { sourceDate: '2026-10-21', sourceMealType: 'lunch' }))
          .mockResolvedValueOnce(makeText('No lunch found for that date.'))

        await callRoute(USER_MSG)

        const getLogCall = consoleSpy.mock.calls.find(([tag]) => tag === '[V-get-meal-log]')
        expect(getLogCall).toBeDefined()
        const logged = getLogCall![1] as Record<string, unknown>
        expect(logged.status).toBe('empty')
        expect(logged.tokenPresent).toBe(false)
        expect(logged.tokenLength).toBe(0)
      } finally {
        consoleSpy.mockRestore()
      }
    })

    it('[V-get-meal-log] never logs the raw token value', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
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
          .mockResolvedValueOnce(makeTool('get_meal_log', { sourceDate: '2026-10-21', sourceMealType: 'lunch' }))
          .mockResolvedValueOnce(makeText('Found your lunch.'))

        await callRoute(USER_MSG)

        const getLogCall = consoleSpy.mock.calls.find(([tag]) => tag === '[V-get-meal-log]')
        expect(getLogCall).toBeDefined()
        // Serialize the logged object and confirm the token body is not present
        const loggedJson = JSON.stringify(getLogCall![1])
        expect(loggedJson).not.toContain(token)
      } finally {
        consoleSpy.mockRestore()
      }
    })
  })
})
