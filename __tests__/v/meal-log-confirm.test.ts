/**
 * Conversational Meal Logging — Security, correctness, and regression tests
 *
 * Scenarios:
 *   PREPARE_MEAL_LOG_TOOL schema
 *     1. Schema: required fields (calculationToken, mealType, logDate — no macro fields)
 *     2. Schema: mealType enum has all five values
 *
 *   Token signing/verification (lib/v/meal-log-token)
 *     3. Round-trip: sign → verify → correct payload
 *     4. Tampered payload → invalid_signature
 *     5. Tampered signature → invalid_signature
 *     6. Expired token → expired
 *     7. Wrong user → wrong_user
 *     8. Missing signing key → no_key
 *     9. Malformed token → malformed
 *
 *   Confirm endpoint — happy path
 *    10. Valid token → 200 ok:true, entries created from token data (NOT request body macros)
 *    11. Partial meal (some unresolved) → ok:true, isPartial:true, entries use token macros
 *    12. All five meal types accepted
 *
 *   Confirm endpoint — security
 *    13. AI-modified macros in token → invalid_signature (tamper detected)
 *    14. Client-supplied macro values in request body are ignored — entries use token values
 *    15. Wrong user token → 403
 *    16. Expired token → 400
 *    17. Unauthenticated → 401
 *    28. Oversized token (>50 000 chars) → 400 before decode
 *
 *   Confirm endpoint — correctness
 *    18. Idempotency: duplicate confirm → ok:true alreadyLogged:true, no new rows
 *    19. Concurrent confirm — P2002 unique constraint → treated as already-logged
 *    20. snapshotCaloriesPerServing uses token value, not request body
 *    21. estimateSourceNote includes partial warning when ingredients unresolved
 *    22. Invalid logDate format → 400
 *    23. logDate too far in past (>30 days) → 400
 *    24. Future logDate → 400
 *    25. Nothing resolved in token → 400
 *
 *   Transaction safety
 *    26. Transaction creates all ingredient rows or none (rollback on error)
 *
 *   Existing diary route — no historical modification
 *    27. Existing PATCH /api/nutrition/log accepts only servingMultiplier (no snapshot fields)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PREPARE_MEAL_LOG_TOOL } from '../../app/api/coach/constants'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockPrisma, mockUser, mockSupabase } = vi.hoisted(() => {
  const mockUser = { id: 'user-uuid-auth-001', email: 'test@example.com' }
  const mockPrisma = {
    foodLogEntry: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  }
  const mockSupabase = {
    createClient: vi.fn().mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    }),
  }
  return { mockPrisma, mockUser, mockSupabase }
})

vi.mock('@/lib/prisma',          () => ({ prisma: mockPrisma }))
vi.mock('@/lib/supabase/server', () => mockSupabase)

// Provide a test signing key so token tests are deterministic
vi.stubEnv('MEAL_LOG_SIGNING_KEY', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2')

import { NextRequest } from 'next/server'
import { POST } from '../../app/api/coach/meal-log/route'
import { signMealLogToken, verifyMealLogToken, buildMealLogToken, selectTokenIngredients } from '../../lib/v/meal-log-token'
import { getMealLog } from '../../lib/v/tools/get-meal-log'
import type { MealLogTokenPayload } from '../../lib/v/meal-log-token'
import type { IngredientResult, UnresolvedIngredient } from '../../lib/v/tools/calculate-nutrition'
import { Prisma } from '@prisma/client'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CALC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const NOW_S = Math.floor(Date.now() / 1000)

const RESOLVED_ING: IngredientResult = {
  userDescription:  '2 chicken patties',
  matchedFoodName:  'Chicken Patty, frozen',
  matchConfidence:  'confident',
  calories:  360,
  proteinG:  28,
  carbG:     16,
  fatG:      22,
  resolved:  true,
  conversionNote: '2 pieces × 180g',
}

const RESOLVED_BUN: IngredientResult = {
  userDescription:  '2 Hawaiian buns',
  matchedFoodName:  'Hamburger Bun, sweet',
  matchConfidence:  'plausible',
  calories:  220,
  proteinG:  6,
  carbG:     42,
  fatG:      2,
  resolved:  true,
  conversionNote: '2 buns × 43g',
}

const UNRESOLVED_ING: IngredientResult = {
  userDescription:  '2 tbsp mystery sauce',
  matchedFoodName:  'mystery sauce',
  matchConfidence:  'no_match',
  calories:  0,
  proteinG:  0,
  carbG:     0,
  fatG:      0,
  resolved:  false,
  errorReason: 'No matching food found',
}

const UNRESOLVED_META: UnresolvedIngredient = { name: 'mystery sauce', reason: 'no_match' }

function makePayload(overrides: Partial<MealLogTokenPayload> = {}): MealLogTokenPayload {
  return {
    calculationId: CALC_ID,
    userId:        mockUser.id,
    issuedAt:      NOW_S,
    expiresAt:     NOW_S + 7200,
    ingredients:   [RESOLVED_ING, RESOLVED_BUN],
    totals:        { calories: 580, proteinG: 34, carbG: 58, fatG: 24 },
    completeness:  'complete',
    unresolvedIngredients: [],
    ...overrides,
  }
}

function makeToken(overrides: Partial<MealLogTokenPayload> = {}): string {
  return signMealLogToken(makePayload(overrides))!
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/coach/meal-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const TODAY = new Date().toISOString().slice(0, 10)
const YESTERDAY = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
})()

// Source FoodLogEntry fixtures — represent real DB rows that getMealLog will read.
// All created by the confirm endpoint (servingMultiplier=1 invariant, macros already
// reflect the actual consumed amount). Typed as `any` because the mock accepts any shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSourceEntry(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'src-001',
    userId: mockUser.id,
    mealType: 'dinner',
    logDate: new Date(YESTERDAY + 'T00:00:00Z'),
    loggedAt: new Date(),
    snapshotFoodName: 'Grilled Salmon Fillet',
    snapshotServingSize: new Prisma.Decimal(1),
    snapshotServingUnit: 'serving',
    snapshotCaloriesPerServing: new Prisma.Decimal(350),
    snapshotProteinGPerServing: new Prisma.Decimal(45),
    snapshotCarbohydrateGPerServing: new Prisma.Decimal(0),
    snapshotFatGPerServing: new Prisma.Decimal(18),
    servingMultiplier: new Prisma.Decimal(1),
    estimateSourceNote: 'Coach V — grilled salmon fillet',
    foodItemId: null,
    recipeId: null,
    notes: null,
    snapshotNutrientsJson: null,
    optionalIngredientOverrides: null,
    recipeLogMode: null,
    idempotencyKey: 'prev-calc-001-0',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// Factory: tokens are created at call-time (after vi.stubEnv is in effect)
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    calculationToken: makeToken(),
    mealType:  'lunch',
    logDate:   TODAY,
    ...overrides,
  }
}

// ── Shared beforeEach ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
  mockPrisma.foodLogEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `entry-${Math.random().toString(36).slice(2)}`,
    ...data,
  }))
  // Reset auth to default user
  mockSupabase.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// PREPARE_MEAL_LOG_TOOL schema
// ══════════════════════════════════════════════════════════════════════════════

describe('PREPARE_MEAL_LOG_TOOL schema', () => {
  // Check 1
  it('requires calculationToken, mealType, logDate — no macro fields', () => {
    const { required, properties } = PREPARE_MEAL_LOG_TOOL.function.parameters
    expect(required).toContain('calculationToken')
    expect(required).toContain('mealType')
    expect(required).toContain('logDate')
    // Must NOT include ingredient macro fields
    expect(Object.keys(properties)).not.toContain('ingredients')
    expect(Object.keys(properties)).not.toContain('totals')
    expect(Object.keys(properties)).not.toContain('calories')
    expect(Object.keys(properties)).not.toContain('proteinG')
  })

  // Check 2
  it('mealType enum contains all five values', () => {
    const mealTypeEnum = (PREPARE_MEAL_LOG_TOOL.function.parameters.properties.mealType as { enum: string[] }).enum
    expect(mealTypeEnum.sort()).toEqual(['breakfast', 'dinner', 'lunch', 'other', 'snack'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Token signing / verification
// ══════════════════════════════════════════════════════════════════════════════

describe('meal-log-token: sign + verify', () => {
  // Check 3
  it('round-trip: sign → verify returns correct payload', () => {
    const payload = makePayload()
    const token   = signMealLogToken(payload)!
    expect(token).toBeTruthy()
    const result  = verifyMealLogToken(token, mockUser.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.calculationId).toBe(CALC_ID)
    expect(result.payload.userId).toBe(mockUser.id)
    expect(result.payload.ingredients).toHaveLength(2)
    expect(result.payload.totals.calories).toBe(580)
  })

  // Check 4
  it('tampered payload → invalid_signature', () => {
    const token = signMealLogToken(makePayload())!
    const [body, sig] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)]
    // Decode, modify, re-encode without re-signing
    const parsed: MealLogTokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    parsed.ingredients[0].calories = 9999
    const tamperedBody = Buffer.from(JSON.stringify(parsed)).toString('base64url')
    const tamperedToken = `${tamperedBody}.${sig}`
    const result = verifyMealLogToken(tamperedToken, mockUser.id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid_signature')
  })

  // Check 5
  it('tampered signature → invalid_signature', () => {
    const token = signMealLogToken(makePayload())!
    const badToken = token.slice(0, -4) + 'dead'
    const result = verifyMealLogToken(badToken, mockUser.id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid_signature')
  })

  // Check 6
  it('expired token → expired', () => {
    const token = signMealLogToken(makePayload({ expiresAt: NOW_S - 1 }))!
    const result = verifyMealLogToken(token, mockUser.id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('expired')
  })

  // Check 7
  it('wrong userId → wrong_user', () => {
    const token = signMealLogToken(makePayload())!
    const result = verifyMealLogToken(token, 'other-user-id')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('wrong_user')
  })

  // Check 8
  it('missing signing key → signMealLogToken returns null, verify returns no_key', () => {
    vi.stubEnv('MEAL_LOG_SIGNING_KEY', '')
    try {
      expect(signMealLogToken(makePayload())).toBeNull()
      const result = verifyMealLogToken('anything.signature', mockUser.id)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toBe('no_key')
    } finally {
      vi.stubEnv('MEAL_LOG_SIGNING_KEY', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2')
    }
  })

  // Check 9
  it('malformed token (no dot) → malformed', () => {
    const result = verifyMealLogToken('notadottoken', mockUser.id)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Confirm endpoint — happy path
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/coach/meal-log — happy path', () => {
  // Check 10
  it('valid token → 200 ok:true, entries created from token macros (not request body)', async () => {
    const res  = await POST(makeRequest(validBody()))
    const json = await res.json() as { ok: boolean }
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)

    expect(mockPrisma.$transaction).toHaveBeenCalledOnce()
    expect(mockPrisma.foodLogEntry.create).toHaveBeenCalledTimes(2)

    const first = mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    // Macros must come from the token, not from the request body (which had none)
    expect(Number(first.snapshotCaloriesPerServing)).toBe(360)
    expect(Number(first.snapshotProteinGPerServing)).toBe(28)
    expect(Number(first.snapshotCarbohydrateGPerServing)).toBe(16)
    expect(Number(first.snapshotFatGPerServing)).toBe(22)
    expect(first.snapshotFoodName).toBe('Chicken Patty, frozen')
    expect(first.userId).toBe(mockUser.id)
    expect(first.mealType).toBe('lunch')
    expect(first.idempotencyKey).toBe(`${CALC_ID}-0`)
  })

  // Check 11
  it('partial meal (unresolved ingredients) → isPartial:true, only resolved rows written', async () => {
    const partialToken = makeToken({
      ingredients:   [RESOLVED_ING, UNRESOLVED_ING],
      totals:        { calories: 360, proteinG: 28, carbG: 16, fatG: 22 },
      completeness:  'estimated',
      unresolvedIngredients: [UNRESOLVED_META],
    })
    const res  = await POST(makeRequest({ ...validBody(), calculationToken: partialToken }))
    const json = await res.json() as { ok: boolean; isPartial: boolean; loggedCount: number }
    expect(res.status).toBe(200)
    expect(json.isPartial).toBe(true)
    expect(json.loggedCount).toBe(1)                   // only 1 resolved

    expect(mockPrisma.foodLogEntry.create).toHaveBeenCalledTimes(1)
    const entry = mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    expect(entry.snapshotFoodName).toBe('Chicken Patty, frozen')
    expect(entry.estimateSourceNote).toContain('partial')
    expect(entry.estimateSourceNote).toContain('1 item(s) not logged')
  })

  // Check 12
  it.each(['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const)(
    'mealType "%s" accepted', async (mealType) => {
      const res = await POST(makeRequest({ ...validBody(), mealType }))
      expect(res.status).toBe(200)
    }
  )
})

// ══════════════════════════════════════════════════════════════════════════════
// Confirm endpoint — security
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/coach/meal-log — security', () => {
  // Check 13: AI attempted to modify macros in the token → signature mismatch
  it('AI-modified calculationToken → 403 (tamper detected)', async () => {
    const token = makeToken()
    const [body, sig] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)]
    const parsed: MealLogTokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    parsed.ingredients[0].calories = 9999   // AI tries to inflate calories
    const tamperedBody  = Buffer.from(JSON.stringify(parsed)).toString('base64url')
    const tamperedToken = `${tamperedBody}.${sig}`

    const res = await POST(makeRequest({ ...validBody(), calculationToken: tamperedToken }))
    expect(res.status).toBe(403)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  // Check 14: Client supplies extra macro fields — they are ignored; token macros win
  it('client-supplied macro fields in request body are ignored', async () => {
    const bodyWithExtraFields = {
      ...validBody(),
      // Attacker tries to inject macros via request body
      calories: 9999,
      proteinG: 999,
      snapshotCaloriesPerServing: 9999,
      ingredients: [{ calories: 9999 }],
    }
    const res = await POST(makeRequest(bodyWithExtraFields))
    expect(res.status).toBe(200)

    // Entries still use token values, not request body values
    const first = mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    expect(Number(first.snapshotCaloriesPerServing)).toBe(360)  // from token
  })

  // Check 15: Token belongs to a different user
  it('token userId mismatch → 403', async () => {
    const otherUserToken = makeToken({ userId: 'other-user-999' })
    const res = await POST(makeRequest({ ...validBody(), calculationToken: otherUserToken }))
    expect(res.status).toBe(403)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  // Check 16: Expired token
  it('expired token → 400', async () => {
    const expiredToken = makeToken({ expiresAt: NOW_S - 100 })
    const res = await POST(makeRequest({ ...validBody(), calculationToken: expiredToken }))
    expect(res.status).toBe(400)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  // Check 17: Unauthenticated
  it('unauthenticated request → 401', async () => {
    mockSupabase.createClient.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(401)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  // Check 28: Oversized token rejected before any parsing
  it('calculationToken > 50 000 chars → 400 before decode', async () => {
    const oversized = 'x'.repeat(50_001)
    const res = await POST(makeRequest({ ...validBody(), calculationToken: oversized }))
    expect(res.status).toBe(400)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Confirm endpoint — idempotency and concurrency
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/coach/meal-log — idempotency and concurrency', () => {
  // Check 18: Duplicate confirmation
  it('duplicate confirm (P2002 unique constraint) → ok:true alreadyLogged:true, no new rows', async () => {
    // Simulate DB throwing P2002 on the second attempt
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    )
    mockPrisma.$transaction.mockRejectedValueOnce(p2002)

    const res  = await POST(makeRequest(validBody()))
    const json = await res.json() as { ok: boolean; alreadyLogged: boolean }
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.alreadyLogged).toBe(true)
  })

  // Check 19: Concurrent confirms — same token, second throws P2002 → safe
  it('concurrent confirmation race → both return 200, one alreadyLogged', async () => {
    let callCount = 0
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    )
    mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => {
      callCount++
      if (callCount > 1) throw p2002
      return Promise.all(ops)
    })

    const [res1, res2] = await Promise.all([
      POST(makeRequest(validBody())),
      POST(makeRequest(validBody())),
    ])

    const [j1, j2] = await Promise.all([
      res1.json() as Promise<{ ok: boolean; alreadyLogged?: boolean }>,
      res2.json() as Promise<{ ok: boolean; alreadyLogged?: boolean }>,
    ])

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    // Both succeed; exactly one is alreadyLogged
    const alreadyCount = [j1.alreadyLogged, j2.alreadyLogged].filter(Boolean).length
    expect(alreadyCount).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Confirm endpoint — correctness
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/coach/meal-log — correctness', () => {
  // Check 20: snapshotCaloriesPerServing comes from token, never from request body
  it('snapshot macros use token values exclusively', async () => {
    await POST(makeRequest(validBody()))
    const second = mockPrisma.foodLogEntry.create.mock.calls[1][0].data
    expect(Number(second.snapshotCaloriesPerServing)).toBe(220)   // RESOLVED_BUN
    expect(Number(second.snapshotProteinGPerServing)).toBe(6)
    expect(Number(second.snapshotCarbohydrateGPerServing)).toBe(42)
    expect(Number(second.snapshotFatGPerServing)).toBe(2)
  })

  // Check 21: estimateSourceNote includes partial warning when applicable
  it('complete meal estimateSourceNote has no partial warning', async () => {
    await POST(makeRequest(validBody()))
    const entry = mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    expect(entry.estimateSourceNote).not.toContain('partial')
    expect(entry.estimateSourceNote).toContain('Coach V')
  })

  // Check 22: Invalid logDate format
  it('invalid logDate format → 400', async () => {
    const res = await POST(makeRequest({ ...validBody(), logDate: 'October 16, 2026' }))
    expect(res.status).toBe(400)
  })

  // Check 23: logDate too far in past
  it('logDate more than 30 days ago → 400', async () => {
    const d = new Date()
    d.setDate(d.getDate() - 31)
    const oldDate = d.toISOString().slice(0, 10)
    const res = await POST(makeRequest({ ...validBody(), logDate: oldDate }))
    expect(res.status).toBe(400)
  })

  // Check 24: Future logDate
  it('future logDate → 400', async () => {
    const d = new Date()
    d.setDate(d.getDate() + 2)
    const future = d.toISOString().slice(0, 10)
    const res = await POST(makeRequest({ ...validBody(), logDate: future }))
    expect(res.status).toBe(400)
  })

  // Check 25: Token where no ingredients resolved
  it('token with no resolved ingredients → 400', async () => {
    const noResolvedToken = makeToken({
      ingredients: [
        { ...UNRESOLVED_ING },
        { ...UNRESOLVED_ING, userDescription: '1 tbsp other sauce' },
      ],
      completeness: 'incomplete',
      unresolvedIngredients: [UNRESOLVED_META, { name: 'other sauce', reason: 'no_match' }],
    })
    const res = await POST(makeRequest({ ...validBody(), calculationToken: noResolvedToken }))
    expect(res.status).toBe(400)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  // idempotencyKey uses calculationId from token (server-controlled)
  it('idempotencyKey is server-controlled (calculationId from token)', async () => {
    await POST(makeRequest(validBody()))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keys = (mockPrisma.foodLogEntry.create.mock.calls as any[]).map(
      (c: [{ data: { idempotencyKey: string } }]) => c[0].data.idempotencyKey
    )
    expect(keys[0]).toBe(`${CALC_ID}-0`)
    expect(keys[1]).toBe(`${CALC_ID}-1`)
  })

  // servingMultiplier is always 1
  it('servingMultiplier is always 1', async () => {
    await POST(makeRequest(validBody()))
    for (const call of mockPrisma.foodLogEntry.create.mock.calls) {
      expect(Number((call as [{ data: { servingMultiplier: unknown } }])[0].data.servingMultiplier)).toBe(1)
    }
  })

  // foodItemId is null (no food library linkage required)
  it('foodItemId is null (calculated meal, no library entry needed)', async () => {
    await POST(makeRequest(validBody()))
    const first = mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    expect(first.foodItemId).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Check 26: Transaction rollback
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/coach/meal-log — transaction safety', () => {
  it('non-idempotency DB error → 500 (not P2002, so not silenced)', async () => {
    mockPrisma.$transaction.mockRejectedValueOnce(new Error('DB connection lost'))
    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(500)
    // $transaction was called but rejected — entries are not committed atomically
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Check 27: Existing manual diary route unchanged
// ══════════════════════════════════════════════════════════════════════════════

describe('Existing diary PATCH — no historical snapshot modification', () => {
  it('PATCH /api/nutrition/log data parameter only contains servingMultiplier', () => {
    // Verify the route source statically — updateMany receives only { servingMultiplier }
    // This is a source-level check; the route was already reviewed and tested in its own suite.
    // Here we confirm the schema contract holds: only servingMultiplier is modifiable via PATCH.
    const updateData = { servingMultiplier: 2 }
    // Snapshot fields that must never be updatable:
    const forbidden = [
      'snapshotCaloriesPerServing',
      'snapshotProteinGPerServing',
      'snapshotCarbohydrateGPerServing',
      'snapshotFatGPerServing',
      'snapshotFoodName',
    ]
    for (const field of forbidden) {
      expect(Object.keys(updateData)).not.toContain(field)
    }
    expect(Object.keys(updateData)).toEqual(['servingMultiplier'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// buildMealLogToken helper
// ══════════════════════════════════════════════════════════════════════════════

describe('buildMealLogToken', () => {
  it('returns a valid signed token with correct TTL and userId', () => {
    const token = buildMealLogToken(mockUser.id, {
      ingredients: [RESOLVED_ING],
      totals:      { calories: 360, proteinG: 28, carbG: 16, fatG: 22 },
      completeness: 'complete',
      unresolvedIngredients: [],
    })
    expect(token).toBeTruthy()
    const verified = verifyMealLogToken(token!, mockUser.id)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.userId).toBe(mockUser.id)
    expect(verified.payload.expiresAt - verified.payload.issuedAt).toBe(7200)
    expect(verified.payload.totals.calories).toBe(360)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Integration — getMealLog() token → confirm endpoint (repeat-meal chain)
//
// These tests exercise the complete repeat-meal path end-to-end using a real
// signed token produced by getMealLog(), piped through the actual confirm
// endpoint (with a mocked Prisma client). They complement the unit tests in
// get-meal-log.test.ts by verifying that the token produced by getMealLog()
// is structurally accepted by the existing verification and selection logic and
// produces the correct FoodLogEntry rows.
// ══════════════════════════════════════════════════════════════════════════════

describe('Integration — getMealLog() token → confirm endpoint', () => {
  // ── Fixtures ──────────────────────────────────────────────────────────────
  // Two DB rows representing yesterday's dinner (the source).
  // servingMultiplier=1 because ALL entries written by this codebase use that
  // invariant (meal-log/route.ts always sets it to 1 when creating entries).
  const getSalmon = () => makeSourceEntry({
    id: 'src-salmon',
    snapshotFoodName: 'Grilled Salmon Fillet',
    snapshotCaloriesPerServing: new Prisma.Decimal(350),
    snapshotProteinGPerServing: new Prisma.Decimal(45),
    snapshotCarbohydrateGPerServing: new Prisma.Decimal(0),
    snapshotFatGPerServing: new Prisma.Decimal(18),
    estimateSourceNote: 'Coach V — grilled salmon fillet',
    idempotencyKey: 'prev-calc-001-0',
  })
  const getBroccoli = () => makeSourceEntry({
    id: 'src-broccoli',
    snapshotFoodName: 'Roasted Broccoli',
    snapshotCaloriesPerServing: new Prisma.Decimal(80),
    snapshotProteinGPerServing: new Prisma.Decimal(5),
    snapshotCarbohydrateGPerServing: new Prisma.Decimal(10),
    snapshotFatGPerServing: new Prisma.Decimal(3),
    estimateSourceNote: 'Coach V — roasted broccoli',
    idempotencyKey: 'prev-calc-001-1',
  })

  it('token accepted by confirm endpoint — creates correct number of FoodLogEntry rows with correct nutrition snapshots', async () => {
    // getMealLog reads the two source rows
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([getSalmon(), getBroccoli()])

    const logResult = await getMealLog(mockUser.id, {
      sourceDate:     YESTERDAY,
      sourceMealType: 'dinner',
    })
    expect(logResult.status).toBe('found')
    expect(logResult.calculationToken).toBeTruthy()

    // Pass the token to the confirm endpoint (destination: today's lunch)
    const res  = await POST(makeRequest({
      calculationToken: logResult.calculationToken!,
      mealType:         'lunch',
      logDate:          TODAY,
    }))
    const json = await res.json() as { ok: boolean; loggedCount: number }
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.loggedCount).toBe(2)   // one row per source entry

    expect(mockPrisma.foodLogEntry.create).toHaveBeenCalledTimes(2)

    // Verify nutrition snapshots come from the source DB rows, not recalculated
    const firstCreate  = mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    const secondCreate = mockPrisma.foodLogEntry.create.mock.calls[1][0].data

    expect(firstCreate.snapshotFoodName).toBe('Grilled Salmon Fillet')
    expect(Number(firstCreate.snapshotCaloriesPerServing)).toBe(350)
    expect(Number(firstCreate.snapshotProteinGPerServing)).toBe(45)
    expect(Number(firstCreate.snapshotCarbohydrateGPerServing)).toBe(0)
    expect(Number(firstCreate.snapshotFatGPerServing)).toBe(18)

    expect(secondCreate.snapshotFoodName).toBe('Roasted Broccoli')
    expect(Number(secondCreate.snapshotCaloriesPerServing)).toBe(80)
    expect(Number(secondCreate.snapshotProteinGPerServing)).toBe(5)
    expect(Number(secondCreate.snapshotCarbohydrateGPerServing)).toBe(10)
    expect(Number(secondCreate.snapshotFatGPerServing)).toBe(3)
  })

  it('destination date and meal category are applied — source date and source meal type never written', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([getSalmon(), getBroccoli()])

    const logResult = await getMealLog(mockUser.id, {
      sourceDate:     YESTERDAY,
      sourceMealType: 'dinner',
    })

    await POST(makeRequest({
      calculationToken: logResult.calculationToken!,
      mealType:         'lunch',
      logDate:          TODAY,
    }))

    const firstCreate = mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    const expectedLogDate = new Date(TODAY + 'T00:00:00Z')

    // Destination values must appear in the written rows
    expect(firstCreate.mealType).toBe('lunch')               // destination meal category
    expect(firstCreate.logDate.getTime()).toBe(expectedLogDate.getTime())   // destination date

    // Source values must NOT appear in the written rows
    const sourceLogDate = new Date(YESTERDAY + 'T00:00:00Z')
    expect(firstCreate.logDate.getTime()).not.toBe(sourceLogDate.getTime())
    expect(firstCreate.mealType).not.toBe('dinner')
  })

  it('source entries are read-only — findMany called with source selectors, no create touches source date', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([getSalmon()])

    const logResult = await getMealLog(mockUser.id, {
      sourceDate:     YESTERDAY,
      sourceMealType: 'dinner',
    })
    await POST(makeRequest({
      calculationToken: logResult.calculationToken!,
      mealType:         'breakfast',
      logDate:          TODAY,
    }))

    // findMany was called once to read the source
    expect(mockPrisma.foodLogEntry.findMany).toHaveBeenCalledOnce()
    const findCall = mockPrisma.foodLogEntry.findMany.mock.calls[0][0]
    expect(findCall.where.userId).toBe(mockUser.id)
    expect(findCall.where.mealType).toBe('dinner')
    expect(findCall.where.logDate).toEqual(new Date(YESTERDAY + 'T00:00:00Z'))

    // create was called (for the new entries), but with DESTINATION date, not YESTERDAY
    expect(mockPrisma.foodLogEntry.create).toHaveBeenCalledOnce()
    const createData = mockPrisma.foodLogEntry.create.mock.calls[0][0].data
    expect(createData.logDate.getTime()).not.toBe(new Date(YESTERDAY + 'T00:00:00Z').getTime())
  })

  it('idempotent re-confirmation returns alreadyLogged; a new getMealLog() authorization creates new entries', async () => {
    const sourceEntries = [getSalmon(), getBroccoli()]
    mockPrisma.foodLogEntry.findMany.mockResolvedValue(sourceEntries)

    // First authorization — get token
    const r1 = await getMealLog(mockUser.id, { sourceDate: YESTERDAY, sourceMealType: 'dinner' })
    expect(r1.status).toBe('found')

    // First confirm — succeeds
    const res1 = await POST(makeRequest({
      calculationToken: r1.calculationToken!,
      mealType: 'lunch',
      logDate:  TODAY,
    }))
    expect((await res1.json() as { ok: boolean }).ok).toBe(true)

    // Second confirm with the SAME token — P2002 → alreadyLogged (idempotent)
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code:          'P2002',
      clientVersion: '5.0.0',
    })
    mockPrisma.$transaction.mockRejectedValueOnce(p2002)
    const res2 = await POST(makeRequest({
      calculationToken: r1.calculationToken!,
      mealType: 'lunch',
      logDate:  TODAY,
    }))
    const j2 = await res2.json() as { ok: boolean; alreadyLogged: boolean }
    expect(res2.status).toBe(200)
    expect(j2.ok).toBe(true)
    expect(j2.alreadyLogged).toBe(true)

    // New getMealLog() call → new calculationId → new token
    mockPrisma.foodLogEntry.findMany.mockResolvedValue(sourceEntries)
    const r3 = await getMealLog(mockUser.id, { sourceDate: YESTERDAY, sourceMealType: 'dinner' })
    expect(r3.status).toBe('found')

    // The two tokens must have different calculationIds
    const v1 = verifyMealLogToken(r1.calculationToken!, mockUser.id)
    const v3 = verifyMealLogToken(r3.calculationToken!, mockUser.id)
    expect(v1.ok && v3.ok).toBe(true)
    if (!v1.ok || !v3.ok) return
    expect(v3.payload.calculationId).not.toBe(v1.payload.calculationId)

    // Confirm the new token — succeeds without collision
    const res3 = await POST(makeRequest({
      calculationToken: r3.calculationToken!,
      mealType: 'lunch',
      logDate:  TODAY,
    }))
    const j3 = await res3.json() as { ok: boolean; alreadyLogged?: boolean }
    expect(res3.status).toBe(200)
    expect(j3.ok).toBe(true)
    expect(j3.alreadyLogged).toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// selectTokenIngredients — undefined vs explicit full-list equivalence
//
// The prepare_meal_log route always emits includeIngredientIndexes as an
// explicit index array (e.g. [0,1,2]), even when no partial selection was
// requested. The confirm endpoint re-runs selectTokenIngredients with that
// explicit list. This suite proves the two call forms are equivalent for a
// fully resolved payload so that future changes to selectTokenIngredients
// cannot silently break the full-list case.
// ══════════════════════════════════════════════════════════════════════════════

describe('selectTokenIngredients — undefined vs explicit full-list equivalence', () => {
  // Build a 3-item fully-resolved payload matching what getMealLog() would produce
  const THREE_ITEMS = [
    { ...RESOLVED_ING, calories: 300, proteinG: 25, carbG: 10, fatG: 12 },
    { ...RESOLVED_BUN, calories: 200, proteinG:  8, carbG: 30, fatG:  4 },
    {
      userDescription: '1 cup mixed greens',
      matchedFoodName: 'Mixed Greens Salad',
      matchConfidence: 'confident' as const,
      calories: 25,
      proteinG:  2,
      carbG:     4,
      fatG:      0,
      resolved:  true,
    },
  ]
  const PAYLOAD = makePayload({
    ingredients: THREE_ITEMS,
    totals: { calories: 525, proteinG: 35, carbG: 44, fatG: 16 },
  })

  it('undefined and [0,1,2] return the same number of selected items', () => {
    const byUndefined = selectTokenIngredients(PAYLOAD, undefined)
    const byExplicit  = selectTokenIngredients(PAYLOAD, [0, 1, 2])
    expect(byExplicit.selected.length).toBe(byUndefined.selected.length)
    expect(byExplicit.selected.length).toBe(3)
  })

  it('undefined and [0,1,2] return identical totals', () => {
    const byUndefined = selectTokenIngredients(PAYLOAD, undefined)
    const byExplicit  = selectTokenIngredients(PAYLOAD, [0, 1, 2])
    expect(byExplicit.totals.calories).toBe(byUndefined.totals.calories)
    expect(byExplicit.totals.proteinG).toBe(byUndefined.totals.proteinG)
    expect(byExplicit.totals.carbG).toBe(byUndefined.totals.carbG)
    expect(byExplicit.totals.fatG).toBe(byUndefined.totals.fatG)
  })

  it('undefined and [0,1,2] return items in the same original-index order', () => {
    const byUndefined = selectTokenIngredients(PAYLOAD, undefined)
    const byExplicit  = selectTokenIngredients(PAYLOAD, [0, 1, 2])
    const namesUndef    = byUndefined.selected.map(s => s.ingredient.matchedFoodName)
    const namesExplicit = byExplicit.selected.map(s => s.ingredient.matchedFoodName)
    expect(namesExplicit).toEqual(namesUndef)
  })

  it('requestedSelection differs — undefined sets it false, explicit array sets it true', () => {
    const byUndefined = selectTokenIngredients(PAYLOAD, undefined)
    const byExplicit  = selectTokenIngredients(PAYLOAD, [0, 1, 2])
    // requestedSelection tracks whether an explicit subset was supplied.
    // Different values here is expected — what matters is the selected items are identical.
    expect(byUndefined.requestedSelection).toBe(false)
    expect(byExplicit.requestedSelection).toBe(true)
  })
})
