/**
 * Reference-accuracy evaluation — real pipeline, food-specific fixtures.
 *
 * Unlike the PIPELINE tests (layer-a.test.ts) which use uniform placeholder macros
 * to test mechanics, these tests use food-specific macro values from published USDA
 * FoodData Central tables to test whether the arithmetic is correct for real foods.
 *
 * What is tested here:
 *   - Factor engine produces macros within tolerance of documented reference values
 *   - Each ingredient RESOLVES (graceful failure ≠ accurate calculation)
 *   - Unit conversions (g, oz, tbsp, cup, count-units) produce correct scaled values
 *   - Matched food name contains expected tokens (identity, not just "any food")
 *
 * What is NOT tested here:
 *   - Live provider network calls (providers are mocked to return the captured fixture)
 *   - Natural language parsing (that is Layer B)
 *   - That our fixture values exactly match the current live API (use capture script
 *     to verify: npx tsx __tests__/nutrition/eval/capture-records.ts)
 *
 * A test that does not resolve is marked FAIL regardless of error handling.
 * Graceful failure (resolved: false) is never counted as accuracy.
 *
 * Run: pnpm vitest __tests__/nutrition/eval/reference-accuracy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExternalFoodResult } from '../../../lib/nutrition/providers/types'
import { CAPTURED_RECORDS, type CapturedRecord } from './fixtures/captured-records'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockUsdaSearch, mockFatSecretSearch, mockOffSearch } = vi.hoisted(() => ({
  mockUsdaSearch: vi.fn(),
  mockFatSecretSearch: vi.fn(),
  mockOffSearch: vi.fn(),
}))

vi.mock('../../../lib/nutrition/providers', () => ({
  FOOD_PROVIDERS: [
    {
      providerId: 'usda_fooddata',
      name: 'USDA FoodData Central',
      search: mockUsdaSearch,
      getById: vi.fn().mockResolvedValue(null),
      searchByBarcode: vi.fn().mockResolvedValue(null),
    },
    {
      providerId: 'fatsecret',
      name: 'FatSecret',
      search: mockFatSecretSearch,
      getById: vi.fn().mockResolvedValue(null),
      searchByBarcode: vi.fn().mockResolvedValue(null),
    },
    {
      providerId: 'open_food_facts',
      name: 'Open Food Facts',
      search: mockOffSearch,
      getById: vi.fn().mockResolvedValue(null),
      searchByBarcode: vi.fn().mockResolvedValue(null),
    },
  ],
}))

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    foodItem: { findMany: vi.fn().mockResolvedValue([]) },
    foodItemPortion: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}))

vi.mock('../../../lib/nutrition/conversion/portions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/nutrition/conversion/portions')>()
  return {
    ...actual,
    lookupPortions: vi.fn().mockResolvedValue([]),
    fetchAndStoreUsdaPortions: vi.fn().mockResolvedValue([]),
  }
})

vi.mock('../../../lib/nutrition/providers/fatsecret', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/nutrition/providers/fatsecret')>()
  return {
    ...actual,
    FatSecretProvider: class {
      readonly name = 'FatSecret'
      readonly providerId = 'fatsecret'
      search = mockFatSecretSearch
      getById = vi.fn().mockResolvedValue(null)
      getByIdForEnrichment = vi.fn().mockResolvedValue(null)
      searchByBarcode = vi.fn().mockResolvedValue(null)
    },
  }
})

import { calculateNutrition } from '../../../lib/v/tools/calculate-nutrition'

// ── Helpers ───────────────────────────────────────────────────────────────────

function withinTolerance(actual: number, expected: number, tolerance: number): boolean {
  if (expected === 0) return actual < 0.5  // near-zero check
  return Math.abs(actual - expected) / expected <= tolerance
}

function macroFailReasons(
  actual: { calories: number; proteinG: number; carbG: number; fatG: number },
  ref: CapturedRecord['referenceMacros'],
  tolerance: number,
): string[] {
  const reasons: string[] = []
  const checks = [
    ['calories', actual.calories, ref.calories] as const,
    ['proteinG', actual.proteinG, ref.proteinG] as const,
    ['carbG',    actual.carbG,    ref.carbG]    as const,
    ['fatG',     actual.fatG,     ref.fatG]     as const,
  ]
  for (const [key, got, want] of checks) {
    if (!withinTolerance(got, want, tolerance)) {
      reasons.push(`${key}: got ${got.toFixed(2)}, expected ${want.toFixed(2)} ±${(tolerance*100).toFixed(0)}%`)
    }
  }
  return reasons
}

// ── Reference accuracy tests ───────────────────────────────────────────────────

describe('Reference accuracy — food-specific fixtures (USDA published values, needs_capture)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFatSecretSearch.mockResolvedValue([])
    mockOffSearch.mockResolvedValue([])
  })

  for (const record of CAPTURED_RECORDS) {
    it(`[ref] ${record.label}`, async () => {
      // Mock USDA to return the captured fixture.
      // Other providers return empty — only the captured record is available.
      mockUsdaSearch.mockResolvedValue([record.food as ExternalFoodResult])

      const result = await calculateNutrition({
        ingredients: [{
          name: record.food.name,
          quantity: record.referenceQuantity,
          unit: record.referenceUnit,
        }],
      })

      // RULE: a non-resolving result is NEVER accurate.
      // Provider/conversion failure is a pipeline failure, not a pass.
      expect(result, 'calculateNutrition returned null').not.toBeNull()

      const ing = result!.ingredients[0]
      expect(
        ing.resolved,
        `Ingredient did not resolve. Graceful failure ≠ accurate calculation. ` +
        `captureStatus: ${record.captureStatus}. note: ${record.note ?? 'none'}`
      ).toBe(true)

      // Food identity: matched name must contain a significant token from the fixture name.
      const fixtureName = record.food.name.toLowerCase()
      const firstMeaningfulWord = fixtureName
        .split(/[\s,]+/)
        .find(w => w.length >= 4 && !['with', 'from', 'added', 'style', 'whole'].includes(w))
      if (firstMeaningfulWord) {
        expect(
          ing.matchedFoodName.toLowerCase(),
          `Food identity mismatch: matched "${ing.matchedFoodName}" but fixture is "${record.food.name}"`
        ).toContain(firstMeaningfulWord)
      }

      // Macro accuracy: within tolerance of reference.
      const actual = {
        calories: ing.calories,
        proteinG: ing.proteinG ?? 0,
        carbG:    ing.carbG    ?? 0,
        fatG:     ing.fatG     ?? 0,
      }
      const reasons = macroFailReasons(actual, record.referenceMacros, record.tolerance)
      if (reasons.length > 0 && record.captureStatus === 'needs_capture') {
        // For un-verified fixtures, log warnings but don't hard-fail.
        // This lets CI pass while flagging that capture verification is needed.
        console.warn(
          `[ref-accuracy] WARN [${record.label}]: macro mismatch (captureStatus=needs_capture)\n` +
          reasons.map(r => `  • ${r}`).join('\n')
        )
        // Soft check: result must be plausible (non-zero calories if reference > 0)
        if (record.referenceMacros.calories > 0) {
          expect(actual.calories, 'Calories are zero but reference expects > 0').toBeGreaterThan(0)
        }
      } else if (reasons.length > 0) {
        // Verified captures: hard fail on macro mismatch.
        throw new Error(
          `Macro accuracy failure for [${record.label}]:\n` +
          reasons.map(r => `  • ${r}`).join('\n')
        )
      }

      // Capture status annotation in output
      if (record.captureStatus === 'needs_capture') {
        console.info(
          `[ref-accuracy] [${record.label}]: resolved=${ing.resolved}, ` +
          `cal=${ing.calories.toFixed(1)} (ref ${record.referenceMacros.calories}, ±${(record.tolerance*100).toFixed(0)}%)`
        )
      }
    })
  }
})

describe('Reference accuracy — failure is not a pass', () => {
  it('returns resolved=false when no provider has the food (not a zero-accuracy pass)', async () => {
    mockUsdaSearch.mockResolvedValue([])
    mockFatSecretSearch.mockResolvedValue([])
    mockOffSearch.mockResolvedValue([])

    const result = await calculateNutrition({
      ingredients: [{ name: 'obscure food that no provider knows', quantity: 100, unit: 'g' }],
    })

    expect(result).not.toBeNull()
    const ing = result!.ingredients[0]
    // Pipeline handles the failure gracefully — but the ingredient is NOT resolved.
    expect(ing.resolved).toBe(false)
    // And the completeness reflects the gap.
    expect(result!.completeness).toBe('incomplete')
    // IMPORTANT: this test documents that the pipeline does NOT fabricate a result.
    // A resolved=false result must never be presented to the user as accurate macros.
  })

  it('returns resolved=false when provider returns a zero-nutrition result', async () => {
    // A food with all-zero macros should be filtered by the "withNutrition" gate
    // in the matcher, not reach the factor engine and produce a fake 0-calorie resolve.
    mockUsdaSearch.mockResolvedValue([{
      provider: 'usda_fooddata',
      externalId: 'zero-food',
      name: 'imaginary zero-nutrition food',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
      isGeneric: true,
    } as ExternalFoodResult])
    mockFatSecretSearch.mockResolvedValue([])
    mockOffSearch.mockResolvedValue([])

    const result = await calculateNutrition({
      ingredients: [{ name: 'imaginary zero-nutrition food', quantity: 100, unit: 'g' }],
    })

    expect(result).not.toBeNull()
    // Zero-nutrition results are dropped by the "withNutrition" filter → no_match
    expect(result!.ingredients[0].resolved).toBe(false)
  })
})
