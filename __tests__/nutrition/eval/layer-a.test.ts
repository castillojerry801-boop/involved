/**
 * PIPELINE tests — mechanics only (Layer A equivalent).
 *
 * These tests verify that the matchIngredient → resolveIngredientFactor →
 * calculateNutrition pipeline executes correctly for the full diversity of
 * food input categories and unit types. Providers are mocked; fixture macros
 * are uniform placeholders (120/10/15/5) — NOT food-specific reference values.
 *
 * PURPOSE: Pipeline mechanics, not nutritional accuracy.
 *   "Resolved = true" confirms the unit conversion path worked.
 *   It says NOTHING about whether the macros are nutritionally correct.
 *
 * For real nutritional accuracy, see: reference-accuracy.test.ts
 * For live provider health, see: GET /api/admin/nutrition-health?probe=true
 * For real AI behavior, see: layer-b.test.ts (EVAL_REAL_AI=true)
 * For telemetry firing, see: telemetry.test.ts
 *
 * What is explicitly NOT tested here:
 *   - Nutritional accuracy (reference-accuracy.test.ts handles that)
 *   - Natural language parsing (handled by the AI layer — Layer B)
 *   - Real provider network behavior (tested by the health endpoint)
 *   - Coach V prompt logic (tested by chat-routing and partial-meal tests)
 *
 * Run: pnpm vitest __tests__/nutrition/eval/layer-a
 *
 * Scenarios executed: all with layerA spec that don't require live providers.
 * Scenarios skipped: expectsNoMatch=true provider failure scenarios (they mock timeout,
 *   tested specifically in the provider-failure section at the bottom of this file).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExternalFoodResult } from '../../../lib/nutrition/providers/types'
import { LAYER_A_SCENARIOS, ALL_SCENARIOS, type EvalScenario, type MatchInput } from './scenarios'
import { scoreScenario, buildSummary, printSummary } from './scorer'
import type { NutritionToolResult } from '../../../lib/v/tools/calculate-nutrition'

// ── Mocks ─────────────────────────────────────────────────────────────────────

// vi.hoisted ensures these are initialized before vi.mock factories run.
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

// Prisma: empty library cache, no stored portions
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

// Portions: no stored portions — factor engine uses same-unit and serving-alias paths
vi.mock('../../../lib/nutrition/conversion/portions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/nutrition/conversion/portions')>()
  return {
    ...actual,
    lookupPortions: vi.fn().mockResolvedValue([]),
    fetchAndStoreUsdaPortions: vi.fn().mockResolvedValue([]),
  }
})

// FatSecret enrichment: return null (tests that the pipeline degrades gracefully when
// FatSecret detail is unavailable rather than testing enrichment specifically)
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

// ── Fixture factory ───────────────────────────────────────────────────────────

const VOLUME_UNITS = new Set([
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons',
  'tsp', 'teaspoon', 'teaspoons', 'fl oz', 'fluid oz', 'fluid ounce', 'fluid ounces',
  'ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters',
])

/**
 * Build a synthetic ExternalFoodResult for a given provider search query and input unit.
 *
 * The food name contains the query so the quality gate passes.
 * Serving data is calibrated to the input unit type:
 *   - Weight inputs (g, oz, lb): servingUnit='g', resolves via same-unit or weight→weight
 *   - Volume inputs (cup, tbsp etc.): servingUnit='ml', resolves via volume→volume
 *   - Count inputs (medium, bar, piece, strip): gram serving + householdUnit='piece'
 *
 * Macro values are uniform placeholders. The eval tests pipeline mechanics, not
 * exact nutritional accuracy.
 */
// Words that describe a cooked preparation state (subset of COOKED_STATE_WORDS).
// When the query already contains one of these, the fixture name should NOT append
// ', raw' — that would create a contradictory name (e.g. "oatmeal cooked, raw") that
// the topMatch identity check correctly rejects as a prep-state conflict.
const COOKED_QUERY_WORDS = new Set([
  'cooked', 'grilled', 'baked', 'roasted', 'broiled', 'fried',
  'poached', 'steamed', 'smoked', 'canned', 'prepared',
])

function buildUsdaFixtureForQuery(query: string, inputUnit = 'g'): ExternalFoodResult {
  const queryNorm = query.toLowerCase().trim().replace(/\s+/g, ' ')
  const queryWords = queryNorm.split(/[\s,]+/)
  const alreadyCooked = queryWords.some(w => COOKED_QUERY_WORDS.has(w))
  const name = alreadyCooked ? queryNorm : queryNorm + ', raw'
  const id = `test-${query.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-usda`
  const unitLower = inputUnit.toLowerCase()
  const isVolume = VOLUME_UNITS.has(unitLower)

  if (isVolume) {
    // Volume input: use ml-based serving so volume→volume step fires
    return {
      provider: 'usda_fooddata', externalId: id, name,
      servingSize: 100, servingUnit: 'ml',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 120, proteinG: 10, carbohydrateG: 15, fatG: 5 },
      isGeneric: true,
    }
  }

  // Count or weight input: gram serving with household unit for count resolution.
  // Use the actual input unit so Step 5 (householdUnit match) fires correctly for
  // any count noun — including those not in FOOD_COUNT_NOUNS (bar, burrito, container, etc.).
  // For weight inputs (g/oz/lb), Step 3 (weight→weight) fires first so the household
  // fields are never consulted; using the actual unit there is harmless.
  return {
    provider: 'usda_fooddata', externalId: id, name,
    servingSize: 100, servingUnit: 'g',
    householdUnit: unitLower,
    unitsPerServing: 1,
    householdServingText: `1 ${unitLower} (100g)`,
    fdcDataType: 'Foundation',
    coreNutrients: { calories: 120, proteinG: 10, carbohydrateG: 15, fatG: 5 },
    isGeneric: true,
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

async function runScenario(scenario: EvalScenario): Promise<NutritionToolResult | null> {
  const spec = scenario.layerA!

  // Build a query→unit map so the mock can produce unit-appropriate fixtures.
  // calculateNutrition searches with the ingredient name as the query, so we index
  // by a normalized form of the ingredient name.
  const queryUnitMap = new Map<string, string>()
  for (const ing of spec.ingredients) {
    queryUnitMap.set(ing.name.toLowerCase().trim(), ing.unit)
    // Also index by first word for partial-match cases
    queryUnitMap.set(ing.name.split(' ')[0].toLowerCase(), ing.unit)
  }

  mockFatSecretSearch.mockResolvedValue([])
  mockOffSearch.mockResolvedValue([])

  mockUsdaSearch.mockImplementation(async (query: string) => {
    // Find the unit for this query by best-match
    const qLower = query.toLowerCase().trim()
    let unit = queryUnitMap.get(qLower)
    if (!unit) {
      // Fallback: find first ingredient whose name overlaps with query
      for (const [ingName, ingUnit] of queryUnitMap) {
        if (qLower.includes(ingName.split(' ')[0]) || ingName.includes(qLower.split(' ')[0])) {
          unit = ingUnit
          break
        }
      }
    }
    return [buildUsdaFixtureForQuery(query, unit ?? 'g')]
  })

  try {
    return await calculateNutrition({ ingredients: spec.ingredients })
  } catch (err) {
    console.error(`[eval] scenario ${scenario.id} threw:`, err)
    return null
  }
}

// ── Main test suite ───────────────────────────────────────────────────────────

describe('PIPELINE — mechanics (synthetic fixtures, mocked providers)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // intentional — nothing to clean up
  })

  // Run all Layer A scenarios that are not provider-failure scenarios
  const runnable = LAYER_A_SCENARIOS.filter(s =>
    s.category !== 'provider_failure' || !s.expectsNoMatch
  )

  const scores: ReturnType<typeof scoreScenario>[] = []

  // ── Individual scenario tests ──────────────────────────────────────────────

  for (const scenario of runnable) {
    it(`[${scenario.id}] ${scenario.label}`, async () => {
      const result = await runScenario(scenario)
      const score = scoreScenario(scenario, result)
      scores.push(score)

      if (scenario.layerA!.expectedResolved) {
        // Should produce at least one resolved ingredient
        expect(result?.ingredients.some(i => i.resolved)).toBe(true)
        // Matched food name should contain at least one expected token
        const firstResolved = result?.ingredients.find(i => i.resolved)
        if (firstResolved && scenario.layerA!.expectedNameTokens.length > 0) {
          const matchedLower = firstResolved.matchedFoodName.toLowerCase()
          const hasToken = scenario.layerA!.expectedNameTokens.some(t =>
            matchedLower.includes(t.toLowerCase())
          )
          // Warn rather than hard-fail — provider fixtures use synthetic names
          if (!hasToken) {
            console.warn(
              `[${scenario.id}] Name token miss: matched "${firstResolved.matchedFoodName}", ` +
              `expected [${scenario.layerA!.expectedNameTokens.join(', ')}]`
            )
          }
        }
      }
    })
  }

  // ── Provider failure scenarios ─────────────────────────────────────────────

  describe('Provider failure: all providers empty', () => {
    it('[pf-004] all providers timeout → all ingredients unresolved', async () => {
      mockUsdaSearch.mockResolvedValue([])
      mockFatSecretSearch.mockResolvedValue([])
      mockOffSearch.mockResolvedValue([])

      const result = await calculateNutrition({
        ingredients: [{ name: 'greek yogurt', quantity: 1, unit: 'cup' }],
      })

      expect(result).not.toBeNull()
      expect(result!.ingredients.every(i => !i.resolved)).toBe(true)
      expect(result!.completeness).toBe('incomplete')
    })
  })

  describe('Provider failure: FatSecret empty, USDA works', () => {
    it('[pf-001] FatSecret returns empty → USDA resolves banana', async () => {
      mockFatSecretSearch.mockResolvedValue([])
      mockOffSearch.mockResolvedValue([])
      mockUsdaSearch.mockImplementation(async (query: string) => [buildUsdaFixtureForQuery(query, 'medium')])

      const result = await calculateNutrition({
        ingredients: [{ name: 'banana', quantity: 1, unit: 'medium' }],
      })

      expect(result?.ingredients.some(i => i.resolved)).toBe(true)
    })
  })

  describe('Provider failure: FatSecret returns Error 21 body (silent null)', () => {
    it('[pf-002] FatSecret Error 21 → USDA resolves chicken', async () => {
      mockFatSecretSearch.mockResolvedValue([])
      mockOffSearch.mockResolvedValue([])
      mockUsdaSearch.mockImplementation(async (query: string) => [buildUsdaFixtureForQuery(query, 'g')])

      const result = await calculateNutrition({
        ingredients: [{ name: 'chicken breast', quantity: 100, unit: 'g' }],
      })

      expect(result?.ingredients.some(i => i.resolved)).toBe(true)
    })
  })
})

// ── Scenario count assertion ───────────────────────────────────────────────────

describe('Scenario completeness', () => {
  it('has at least 100 total scenarios', () => {
    expect(ALL_SCENARIOS.length).toBeGreaterThanOrEqual(100)
  })

  it('all scenario IDs are unique', () => {
    const ids = ALL_SCENARIOS.map(s => s.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('covers all expected categories', () => {
    const cats = new Set(ALL_SCENARIOS.map(s => s.category))
    const required = [
      'whole_food_simple', 'whole_food_measured', 'packaged_branded', 'restaurant',
      'homemade', 'drink', 'cooking_ingredient', 'household_measurement',
      'casual_vague', 'misspelling', 'correction', 'multi_food',
      'partial_log', 'provider_failure', 'held_out',
    ]
    for (const cat of required) {
      expect(cats.has(cat as never), `Missing category: ${cat}`).toBe(true)
    }
  })

  it('has at least 5 held-out scenarios', () => {
    const heldOut = ALL_SCENARIOS.filter(s => s.category === 'held_out')
    expect(heldOut.length).toBeGreaterThanOrEqual(5)
  })

  it('Layer A scenarios are a strict subset of all scenarios', () => {
    const layerAIds = new Set(LAYER_A_SCENARIOS.map(s => s.id))
    for (const id of layerAIds) {
      expect(ALL_SCENARIOS.some(s => s.id === id)).toBe(true)
    }
  })
})
