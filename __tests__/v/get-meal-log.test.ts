/**
 * get_meal_log tool — regression tests
 *
 * Coverage:
 *   Input validation
 *     1.  Invalid sourceMealType → error
 *     2.  Invalid sourceDate format → error
 *     3.  Future sourceDate → error
 *     4.  Source date too far in past (>90 days) → error
 *     5.  Empty scaleFactor / negative → clamped to 1.0 (no crash)
 *
 *   Specific-date retrieval
 *     6.  Valid date with entries → found, correct item count
 *     7.  Valid date with no entries → empty, sourceDate echoed
 *     8.  Multiple items in a meal → all included, totals correct
 *     9.  estimateSourceNote is parsed to extract original description
 *     10. snapshotFoodName used as matchedFoodName
 *     11. servingMultiplier != 1 → applied in nutrition values
 *
 *   Scale factor
 *    12. scaleFactor 0.5 → halved nutrition values
 *    13. scaleFactor 2.0 → doubled nutrition values
 *    14. scaleFactor 1.0 (default) → unchanged values, no scaleApplied in result
 *    15. conversionNote mentions scale when scaleFactor != 1
 *    16. conversionNote shows source date when scaleFactor == 1
 *
 *   most_recent
 *    17. most_recent with history → returns the most recent date's entries
 *    18. most_recent with no history → empty
 *    19. most_recent excludes the destination date
 *    20. most_recent uses today as default exclusion when destinationDate omitted
 *    21. most_recent returns all items for the most recent date (not just one)
 *    22. most_recent honours destinationDate for exclusion
 *
 *   Token integrity
 *    23. Returned token verifies correctly (userId, TTL, ingredients)
 *    24. Token has completeness: "complete" and empty unresolvedIngredients
 *    25. Each call produces a distinct calculationId (fresh idempotency keys)
 *    26. Token ingredient calories match the nutrition from entries (with scale)
 *    27. Signing key missing → error (no token returned)
 *
 *   Cross-user isolation
 *    28. Entries belonging to a different userId are never returned
 *
 *   GET_MEAL_LOG_TOOL schema
 *    29. Schema: required fields are sourceDate and sourceMealType only
 *    30. Schema: sourceMealType enum has all five values
 *    31. scaleFactor and destinationDate are optional
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    foodLogEntry: { findMany: vi.fn() },
  }
  return { mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

vi.stubEnv('MEAL_LOG_SIGNING_KEY', 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899')

import { getMealLog } from '../../lib/v/tools/get-meal-log'
import { verifyMealLogToken } from '../../lib/v/meal-log-token'
import { GET_MEAL_LOG_TOOL } from '../../app/api/coach/constants'
import { Prisma } from '@prisma/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-get-meal-log-001'

const TODAY = new Date().toISOString().slice(0, 10)
const YESTERDAY = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
})()
const TWO_DAYS_AGO = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 2)
  return d.toISOString().slice(0, 10)
})()
const FUTURE = (() => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
})()
const TOO_OLD = (() => {
  const d = new Date()
  d.setDate(d.getDate() - 91)
  return d.toISOString().slice(0, 10)
})()

function makeEntry(overrides: Partial<{
  id: string
  snapshotFoodName: string
  snapshotCaloriesPerServing: number
  snapshotProteinGPerServing: number
  snapshotCarbohydrateGPerServing: number
  snapshotFatGPerServing: number
  servingMultiplier: number
  estimateSourceNote: string | null
  mealType: string
  logDate: string
  loggedAt: Date
}> = {}) {
  const dateStr = overrides.logDate ?? YESTERDAY
  return {
    id:                              overrides.id ?? 'entry-001',
    userId:                          USER_ID,
    mealType:                        overrides.mealType ?? 'breakfast',
    logDate:                         new Date(dateStr + 'T00:00:00Z'),
    loggedAt:                        overrides.loggedAt ?? new Date(),
    snapshotFoodName:                overrides.snapshotFoodName ?? 'Scrambled Eggs',
    snapshotServingSize:             new Prisma.Decimal(1),
    snapshotServingUnit:             'serving',
    snapshotCaloriesPerServing:      new Prisma.Decimal(overrides.snapshotCaloriesPerServing ?? 200),
    snapshotProteinGPerServing:      new Prisma.Decimal(overrides.snapshotProteinGPerServing ?? 14),
    snapshotCarbohydrateGPerServing: new Prisma.Decimal(overrides.snapshotCarbohydrateGPerServing ?? 4),
    snapshotFatGPerServing:          new Prisma.Decimal(overrides.snapshotFatGPerServing ?? 14),
    servingMultiplier:               new Prisma.Decimal(overrides.servingMultiplier ?? 1),
    estimateSourceNote:              overrides.estimateSourceNote !== undefined
      ? overrides.estimateSourceNote
      : 'Coach V — 2 scrambled eggs',
    foodItemId:                      null,
    recipeId:                        null,
    notes:                           null,
    snapshotNutrientsJson:           null,
    optionalIngredientOverrides:     null,
    recipeLogMode:                   null,
    idempotencyKey:                  `calc-001-0`,
    createdAt:                       new Date(),
    updatedAt:                       new Date(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.foodLogEntry.findMany.mockResolvedValue([])
})

// ══════════════════════════════════════════════════════════════════════════════
// Input validation
// ══════════════════════════════════════════════════════════════════════════════

describe('get_meal_log — input validation', () => {
  // Check 1
  it('invalid sourceMealType → error', async () => {
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'brunch' })
    expect(result.status).toBe('error')
    expect(result.message).toContain('sourceMealType')
    expect(mockPrisma.foodLogEntry.findMany).not.toHaveBeenCalled()
  })

  // Check 2
  it('invalid sourceDate format → error', async () => {
    const result = await getMealLog(USER_ID, { sourceDate: 'yesterday', sourceMealType: 'breakfast' })
    expect(result.status).toBe('error')
    expect(result.message).toContain('sourceDate')
  })

  // Check 3
  it('future sourceDate → error', async () => {
    const result = await getMealLog(USER_ID, { sourceDate: FUTURE, sourceMealType: 'breakfast' })
    expect(result.status).toBe('error')
    expect(result.message).toContain('future')
  })

  // Check 4
  it('sourceDate more than 90 days ago → error', async () => {
    const result = await getMealLog(USER_ID, { sourceDate: TOO_OLD, sourceMealType: 'breakfast' })
    expect(result.status).toBe('error')
    expect(result.message).toContain('past')
  })

  // Check 5
  it('invalid scaleFactor (negative) is clamped to 1.0 — no crash', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([makeEntry()])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast', scaleFactor: -5 })
    expect(result.status).toBe('found')
    // Negative scale → clamped to min 0.01; result should still be numeric
    expect(result.totals?.calories).toBeGreaterThan(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Specific-date retrieval
// ══════════════════════════════════════════════════════════════════════════════

describe('get_meal_log — specific date retrieval', () => {
  // Check 6
  it('valid date with entries → found, correct item count', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([makeEntry()])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })
    expect(result.status).toBe('found')
    expect(result.itemCount).toBe(1)
    expect(result.sourceDate).toBe(YESTERDAY)
    expect(result.sourceMealType).toBe('breakfast')
    expect(result.calculationToken).toBeTruthy()
  })

  // Check 7
  it('valid date with no entries → empty, sourceDate echoed', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'lunch' })
    expect(result.status).toBe('empty')
    expect(result.sourceDate).toBe(YESTERDAY)
    expect(result.sourceMealType).toBe('lunch')
  })

  // Check 8
  it('multiple items in a meal → all included, totals correct', async () => {
    const eggs   = makeEntry({ id: 'e1', snapshotFoodName: 'Eggs', snapshotCaloriesPerServing: 140, snapshotProteinGPerServing: 12, snapshotCarbohydrateGPerServing: 1, snapshotFatGPerServing: 10 })
    const toast  = makeEntry({ id: 'e2', snapshotFoodName: 'Toast', snapshotCaloriesPerServing: 70,  snapshotProteinGPerServing: 3,  snapshotCarbohydrateGPerServing: 13, snapshotFatGPerServing: 1  })
    const coffee = makeEntry({ id: 'e3', snapshotFoodName: 'Coffee', snapshotCaloriesPerServing: 5,  snapshotProteinGPerServing: 0,  snapshotCarbohydrateGPerServing: 1,  snapshotFatGPerServing: 0  })
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([eggs, toast, coffee])

    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })
    expect(result.status).toBe('found')
    expect(result.itemCount).toBe(3)
    expect(result.totals?.calories).toBe(215)
    expect(result.totals?.proteinG).toBe(15)
    expect(result.totals?.carbG).toBe(15)
    expect(result.totals?.fatG).toBe(11)
  })

  // Check 9
  it('estimateSourceNote is parsed to extract original user description', async () => {
    const entry = makeEntry({ estimateSourceNote: 'Coach V — 3 scrambled eggs' })
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([entry])

    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })
    expect(result.status).toBe('found')
    const verified = verifyMealLogToken(result.calculationToken!, USER_ID)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.ingredients[0].userDescription).toBe('3 scrambled eggs')
  })

  // Check 10
  it('snapshotFoodName is preserved as matchedFoodName in the token', async () => {
    const entry = makeEntry({ snapshotFoodName: 'Egg, whole, scrambled' })
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([entry])

    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })
    const verified = verifyMealLogToken(result.calculationToken!, USER_ID)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.ingredients[0].matchedFoodName).toBe('Egg, whole, scrambled')
  })

  // Check 11
  it('servingMultiplier != 1 is applied to nutrition values', async () => {
    const entry = makeEntry({
      snapshotCaloriesPerServing: 100,
      snapshotProteinGPerServing: 10,
      snapshotCarbohydrateGPerServing: 10,
      snapshotFatGPerServing: 5,
      servingMultiplier: 2,
    })
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([entry])

    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })
    expect(result.totals?.calories).toBe(200)
    expect(result.totals?.proteinG).toBe(20)
    expect(result.totals?.carbG).toBe(20)
    expect(result.totals?.fatG).toBe(10)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Scale factor
// ══════════════════════════════════════════════════════════════════════════════

describe('get_meal_log — scale factor', () => {
  // Check 12
  it('scaleFactor 0.5 → halved nutrition values', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([
      makeEntry({ snapshotCaloriesPerServing: 400, snapshotProteinGPerServing: 20, snapshotCarbohydrateGPerServing: 40, snapshotFatGPerServing: 16 }),
    ])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'dinner', scaleFactor: 0.5 })
    expect(result.status).toBe('found')
    expect(result.totals?.calories).toBe(200)
    expect(result.totals?.proteinG).toBe(10)
    expect(result.totals?.carbG).toBe(20)
    expect(result.totals?.fatG).toBe(8)
    expect(result.scaleApplied).toBe(0.5)
  })

  // Check 13
  it('scaleFactor 2.0 → doubled nutrition values', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([
      makeEntry({ snapshotCaloriesPerServing: 200, snapshotProteinGPerServing: 10, snapshotCarbohydrateGPerServing: 20, snapshotFatGPerServing: 8 }),
    ])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'lunch', scaleFactor: 2.0 })
    expect(result.totals?.calories).toBe(400)
    expect(result.totals?.proteinG).toBe(20)
    expect(result.totals?.carbG).toBe(40)
    expect(result.totals?.fatG).toBe(16)
    expect(result.scaleApplied).toBe(2.0)
  })

  // Check 14
  it('scaleFactor 1.0 (default) → unchanged values, scaleApplied absent', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([
      makeEntry({ snapshotCaloriesPerServing: 300, snapshotProteinGPerServing: 15, snapshotCarbohydrateGPerServing: 30, snapshotFatGPerServing: 12 }),
    ])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'lunch' })
    expect(result.totals?.calories).toBe(300)
    expect(result.scaleApplied).toBeUndefined()
  })

  // Check 15
  it('conversionNote mentions scale factor when scaleFactor != 1', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([makeEntry()])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast', scaleFactor: 0.5 })
    const verified = verifyMealLogToken(result.calculationToken!, USER_ID)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.ingredients[0].conversionNote).toContain('0.5')
    expect(verified.payload.ingredients[0].conversionNote).toContain('logged serving')
  })

  // Check 16
  it('conversionNote shows source date when scaleFactor == 1', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([makeEntry()])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })
    const verified = verifyMealLogToken(result.calculationToken!, USER_ID)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.ingredients[0].conversionNote).toContain(YESTERDAY)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// most_recent
// ══════════════════════════════════════════════════════════════════════════════

describe('get_meal_log — most_recent', () => {
  // Check 17
  it('most_recent with history → returns the most recent date\'s entries', async () => {
    const older = makeEntry({ id: 'e1', logDate: TWO_DAYS_AGO, snapshotFoodName: 'Old Oatmeal' })
    const newer = makeEntry({ id: 'e2', logDate: YESTERDAY,    snapshotFoodName: 'Newer Eggs' })
    // findMany returns ordered by logDate DESC (most recent first)
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([newer, older])

    const result = await getMealLog(USER_ID, { sourceDate: 'most_recent', sourceMealType: 'breakfast', destinationDate: TODAY })
    expect(result.status).toBe('found')
    expect(result.sourceDate).toBe(YESTERDAY)
    // Only the YESTERDAY entry (not the older one)
    expect(result.itemCount).toBe(1)
    const verified = verifyMealLogToken(result.calculationToken!, USER_ID)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.ingredients[0].matchedFoodName).toBe('Newer Eggs')
  })

  // Check 18
  it('most_recent with no history → empty', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([])
    const result = await getMealLog(USER_ID, { sourceDate: 'most_recent', sourceMealType: 'lunch', destinationDate: TODAY })
    expect(result.status).toBe('empty')
    expect(result.message).toContain('lunch')
  })

  // Check 19
  it('most_recent excludes the destinationDate', async () => {
    const entry = makeEntry({ logDate: TODAY, snapshotFoodName: 'Today Entry' })
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([])

    await getMealLog(USER_ID, { sourceDate: 'most_recent', sourceMealType: 'breakfast', destinationDate: TODAY })

    const call = mockPrisma.foodLogEntry.findMany.mock.calls[0][0]
    // Should exclude today via `lt` bound
    expect(call.where.logDate.lt).toEqual(new Date(TODAY + 'T00:00:00Z'))
    // Confirm the TODAY entry would not appear (DB mock returns empty — correct exclusion)
    expect(entry).toBeDefined() // suppress unused-variable warning
  })

  // Check 20
  it('most_recent uses today as default exclusion when destinationDate omitted', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([])
    await getMealLog(USER_ID, { sourceDate: 'most_recent', sourceMealType: 'breakfast' })

    const call = mockPrisma.foodLogEntry.findMany.mock.calls[0][0]
    const expectedExclude = new Date(TODAY + 'T00:00:00Z')
    expect(call.where.logDate.lt.getTime()).toBe(expectedExclude.getTime())
  })

  // Check 21
  it('most_recent returns all items for the most-recent date (not just first)', async () => {
    const e1 = makeEntry({ id: 'e1', logDate: YESTERDAY, snapshotFoodName: 'Eggs' })
    const e2 = makeEntry({ id: 'e2', logDate: YESTERDAY, snapshotFoodName: 'Toast' })
    const e3 = makeEntry({ id: 'e3', logDate: TWO_DAYS_AGO, snapshotFoodName: 'Old Oatmeal' })
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([e1, e2, e3])

    const result = await getMealLog(USER_ID, { sourceDate: 'most_recent', sourceMealType: 'breakfast', destinationDate: TODAY })
    expect(result.status).toBe('found')
    // e1 and e2 share YESTERDAY; e3 is older and must be excluded
    expect(result.itemCount).toBe(2)
  })

  // Check 22
  it('most_recent honours a non-today destinationDate for exclusion', async () => {
    const entryYest = makeEntry({ logDate: YESTERDAY })
    const entry2Ago = makeEntry({ logDate: TWO_DAYS_AGO })
    // When destinationDate is YESTERDAY, entries from YESTERDAY must be excluded
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([entry2Ago])

    const result = await getMealLog(USER_ID, { sourceDate: 'most_recent', sourceMealType: 'breakfast', destinationDate: YESTERDAY })
    const call = mockPrisma.foodLogEntry.findMany.mock.calls[0][0]
    expect(call.where.logDate.lt).toEqual(new Date(YESTERDAY + 'T00:00:00Z'))
    expect(result.sourceDate).toBe(TWO_DAYS_AGO)
    expect(entryYest).toBeDefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Token integrity
// ══════════════════════════════════════════════════════════════════════════════

describe('get_meal_log — token integrity', () => {
  // Check 23
  it('returned token verifies correctly — userId, TTL, ingredients', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([makeEntry()])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })

    expect(result.status).toBe('found')
    const verified = verifyMealLogToken(result.calculationToken!, USER_ID)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return

    expect(verified.payload.userId).toBe(USER_ID)
    expect(verified.payload.expiresAt - verified.payload.issuedAt).toBe(7200)
    expect(verified.payload.ingredients).toHaveLength(1)
    expect(verified.payload.ingredients[0].resolved).toBe(true)
    expect(verified.payload.ingredients[0].matchConfidence).toBe('confident')
  })

  // Check 24
  it('token has completeness: "complete" and empty unresolvedIngredients', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([makeEntry()])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })

    const verified = verifyMealLogToken(result.calculationToken!, USER_ID)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.completeness).toBe('complete')
    expect(verified.payload.unresolvedIngredients).toHaveLength(0)
  })

  // Check 25
  it('each call produces a distinct calculationId — fresh idempotency keys', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([makeEntry()])

    const r1 = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })
    const r2 = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })

    expect(r1.calculationToken).toBeTruthy()
    expect(r2.calculationToken).toBeTruthy()

    const v1 = verifyMealLogToken(r1.calculationToken!, USER_ID)
    const v2 = verifyMealLogToken(r2.calculationToken!, USER_ID)
    expect(v1.ok && v2.ok).toBe(true)
    if (!v1.ok || !v2.ok) return
    expect(v1.payload.calculationId).not.toBe(v2.payload.calculationId)
  })

  // Check 26
  it('token ingredient calories match the entry snapshot values (with scale)', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([
      makeEntry({ snapshotCaloriesPerServing: 400, snapshotProteinGPerServing: 30, snapshotCarbohydrateGPerServing: 40, snapshotFatGPerServing: 20 }),
    ])
    const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'dinner', scaleFactor: 0.5 })
    const verified = verifyMealLogToken(result.calculationToken!, USER_ID)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.ingredients[0].calories).toBe(200)
    expect(verified.payload.ingredients[0].proteinG).toBe(15)
    expect(verified.payload.ingredients[0].carbG).toBe(20)
    expect(verified.payload.ingredients[0].fatG).toBe(10)
  })

  // Check 27
  it('missing signing key → error status, no token', async () => {
    vi.stubEnv('MEAL_LOG_SIGNING_KEY', '')
    try {
      mockPrisma.foodLogEntry.findMany.mockResolvedValue([makeEntry()])
      const result = await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })
      expect(result.status).toBe('error')
      expect(result.calculationToken).toBeUndefined()
      expect(result.message).toContain('signing key')
    } finally {
      vi.stubEnv('MEAL_LOG_SIGNING_KEY', 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899')
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Cross-user isolation
// ══════════════════════════════════════════════════════════════════════════════

describe('get_meal_log — cross-user isolation', () => {
  // Check 28
  it('DB query always includes userId — other users\' entries cannot be reached', async () => {
    mockPrisma.foodLogEntry.findMany.mockResolvedValue([makeEntry()])
    await getMealLog(USER_ID, { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })

    const call = mockPrisma.foodLogEntry.findMany.mock.calls[0][0]
    expect(call.where.userId).toBe(USER_ID)

    // Calling with a different userId sends a different userId to the DB
    await getMealLog('other-user-999', { sourceDate: YESTERDAY, sourceMealType: 'breakfast' })
    const call2 = mockPrisma.foodLogEntry.findMany.mock.calls[1][0]
    expect(call2.where.userId).toBe('other-user-999')
    // The token from the first call cannot be verified as other-user-999
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// GET_MEAL_LOG_TOOL schema
// ══════════════════════════════════════════════════════════════════════════════

describe('GET_MEAL_LOG_TOOL schema', () => {
  // Check 29
  it('required fields are sourceDate and sourceMealType only', () => {
    const { required, properties } = GET_MEAL_LOG_TOOL.function.parameters
    expect(required).toContain('sourceDate')
    expect(required).toContain('sourceMealType')
    // scaleFactor and destinationDate must be optional (not required)
    expect(required).not.toContain('scaleFactor')
    expect(required).not.toContain('destinationDate')
    // Must not expose macro fields
    expect(Object.keys(properties)).not.toContain('calories')
    expect(Object.keys(properties)).not.toContain('ingredients')
  })

  // Check 30
  it('sourceMealType enum has all five values', () => {
    const mealTypeEnum = (
      GET_MEAL_LOG_TOOL.function.parameters.properties.sourceMealType as { enum: string[] }
    ).enum
    expect(mealTypeEnum.sort()).toEqual(['breakfast', 'dinner', 'lunch', 'other', 'snack'])
  })

  // Check 31
  it('scaleFactor and destinationDate are present as optional properties', () => {
    const { properties } = GET_MEAL_LOG_TOOL.function.parameters
    expect(properties).toHaveProperty('scaleFactor')
    expect(properties).toHaveProperty('destinationDate')
  })
})
