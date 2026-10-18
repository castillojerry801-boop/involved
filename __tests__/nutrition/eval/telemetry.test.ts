/**
 * Logging integration tests — verifies that the telemetry layer actually fires.
 *
 * Two test groups:
 *
 * GROUP 1 — emit() unit tests
 *   Tests the emit() function directly: JSON format, required prefix,
 *   no credential fields, error resilience. Does not depend on providers.
 *
 * GROUP 2 — Matcher-level pipeline integration
 *   Runs the full matchIngredient → calculateNutrition pipeline with mocked providers.
 *   Tests matcher-emitted events: match_selected, match_no_result.
 *   These events are emitted by matcher.ts, not provider code, so they fire even
 *   with mocked providers.
 *
 * NOTE on provider_search events:
 *   provider_search events are emitted by the individual provider implementations
 *   (e.g. usda-fooddata.ts line 223+). Mocked providers in vi.fn() form bypass that
 *   code. Testing provider_search emission requires either:
 *   (a) real network calls with a live API key, or
 *   (b) unit tests in the individual provider test files.
 *   This file does NOT test provider_search emission — that gap is documented in
 *   the Phase 0 open issues list.
 *
 * Run: pnpm vitest __tests__/nutrition/eval/telemetry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExternalFoodResult } from '../../../lib/nutrition/providers/types'

// ── Provider mocks ─────────────────────────────────────────────────────────────

const { mockUsdaSearch } = vi.hoisted(() => ({
  mockUsdaSearch: vi.fn(),
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
      search = vi.fn().mockResolvedValue([])
      getById = vi.fn().mockResolvedValue(null)
      getByIdForEnrichment = vi.fn().mockResolvedValue(null)
      searchByBarcode = vi.fn().mockResolvedValue(null)
    },
  }
})

import { calculateNutrition } from '../../../lib/v/tools/calculate-nutrition'
import { emit } from '../../../lib/nutrition/telemetry'

// ── Helpers ────────────────────────────────────────────────────────────────────

const DIAG_PREFIX = '[nutrition-diag] '

function diagLogs(spy: ReturnType<typeof vi.spyOn>): Array<{raw: string; parsed: Record<string, unknown>}> {
  const result: Array<{raw: string; parsed: Record<string, unknown>}> = []
  for (const call of spy.mock.calls as unknown[][]) {
    const msg = String(call[0] ?? '')
    if (!msg.startsWith(DIAG_PREFIX)) continue
    try {
      const json = msg.slice(DIAG_PREFIX.length)
      result.push({ raw: msg, parsed: JSON.parse(json) as Record<string, unknown> })
    } catch {
      result.push({ raw: msg, parsed: {} })
    }
  }
  return result
}

function goodFood(): ExternalFoodResult {
  return {
    provider: 'usda_fooddata',
    externalId: 'test-apple',
    name: 'Apple, raw',
    servingSize: 100,
    servingUnit: 'g',
    fdcDataType: 'Foundation',
    coreNutrients: { calories: 52, proteinG: 0.26, carbohydrateG: 13.8, fatG: 0.17 },
    isGeneric: true,
  }
}

// ── GROUP 1: emit() unit tests ─────────────────────────────────────────────────

describe('Logging integration — emit() unit tests', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('emit() writes a [nutrition-diag] prefixed JSON line to console.log', () => {
    emit({ kind: 'match_selected', query: 'apple', provider: 'usda_fooddata', foodName: 'Apple, raw', confidence: 'confident', score: 90, qualityGateRejects: 0, totalCandidates: 1 })

    const prefixedLogs = consoleSpy.mock.calls
      .map((call: unknown[]) => String(call[0] ?? ''))
      .filter((msg: string) => msg.startsWith(DIAG_PREFIX))

    expect(prefixedLogs.length).toBeGreaterThanOrEqual(1)
    const first = prefixedLogs[0]
    expect(first.startsWith(DIAG_PREFIX)).toBe(true)
    expect(() => JSON.parse(first.slice(DIAG_PREFIX.length))).not.toThrow()
  })

  it('emitted event contains the kind field', () => {
    emit({ kind: 'match_no_result', query: 'xyz', reason: 'all_empty', qualityGateRejects: 0, totalBeforeGate: 0 })

    const logs = diagLogs(consoleSpy)
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0].parsed.kind).toBe('match_no_result')
  })

  it('emitted provider_search event contains required fields', () => {
    emit({
      kind: 'provider_search',
      provider: 'usda_fooddata',
      query: 'test',
      status: 'ok',
      resultCount: 3,
      latencyMs: 42,
    })

    const logs = diagLogs(consoleSpy)
    const e = logs.find(l => l.parsed.kind === 'provider_search')
    expect(e).toBeDefined()
    expect(e!.parsed).toHaveProperty('provider')
    expect(e!.parsed).toHaveProperty('query')
    expect(e!.parsed).toHaveProperty('status')
    expect(e!.parsed).toHaveProperty('resultCount')
    expect(e!.parsed).toHaveProperty('latencyMs')
  })

  it('emitted events do not contain credential-looking fields', () => {
    emit({ kind: 'provider_search', provider: 'fatsecret', query: 'test', status: 'ok', resultCount: 1, latencyMs: 50 })

    const logs = diagLogs(consoleSpy)
    for (const l of logs) {
      expect(JSON.stringify(l.parsed)).not.toMatch(/apiKey|api_key|clientSecret|client_secret|access_token|password/i)
    }
  })

  it('emit() does not throw when called with a valid event', () => {
    expect(() =>
      emit({ kind: 'match_selected', query: 'banana', provider: 'usda_fooddata', foodName: 'Banana, raw', confidence: 'confident', score: 95, qualityGateRejects: 0, totalCandidates: 1 })
    ).not.toThrow()
  })

  it('emit() is resilient — does not throw even if console.log throws', () => {
    consoleSpy.mockImplementation(() => { throw new Error('console broken') })
    // emit() should silently swallow console errors
    expect(() =>
      emit({ kind: 'match_no_result', query: 'test', reason: 'all_empty', qualityGateRejects: 0, totalBeforeGate: 0 })
    ).not.toThrow()
  })
})

// ── GROUP 2: Matcher-level pipeline integration ────────────────────────────────
// Tests events emitted by matcher.ts (match_selected, match_no_result).
// These fire regardless of which provider returned the result.

describe('Logging integration — matcher-emitted events (mocked providers)', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('match_selected event fires when pipeline successfully matches a food', async () => {
    mockUsdaSearch.mockResolvedValue([goodFood()])

    await calculateNutrition({
      ingredients: [{ name: 'apple', quantity: 100, unit: 'g' }],
    })

    const logs = diagLogs(consoleSpy)
    const selected = logs.find(l => l.parsed.kind === 'match_selected')

    expect(selected, 'Expected match_selected event after successful match').toBeDefined()
    expect(selected!.parsed).toHaveProperty('query')
    expect(selected!.parsed).toHaveProperty('provider')
    expect(selected!.parsed).toHaveProperty('confidence')
    expect(selected!.parsed).toHaveProperty('score')
    expect(typeof selected!.parsed.score).toBe('number')
  })

  it('match_no_result event fires when no provider returns usable results', async () => {
    mockUsdaSearch.mockResolvedValue([])

    await calculateNutrition({
      ingredients: [{ name: 'completely unknown food xyz123', quantity: 100, unit: 'g' }],
    })

    const logs = diagLogs(consoleSpy)
    const noResult = logs.find(l => l.parsed.kind === 'match_no_result')

    expect(noResult, 'Expected match_no_result event when no providers return results').toBeDefined()
    expect(noResult!.parsed).toHaveProperty('query')
    expect(noResult!.parsed).toHaveProperty('reason')
  })

  it('all [nutrition-diag] log lines are valid JSON with a kind field', async () => {
    mockUsdaSearch.mockResolvedValue([goodFood()])

    await calculateNutrition({
      ingredients: [{ name: 'apple', quantity: 100, unit: 'g' }],
    })

    const prefixedLogs = (consoleSpy.mock.calls as unknown[][])
      .map((call: unknown[]) => String(call[0] ?? ''))
      .filter((msg: string) => msg.startsWith(DIAG_PREFIX))

    expect(prefixedLogs.length).toBeGreaterThanOrEqual(1)

    for (const line of prefixedLogs) {
      const json = line.slice(DIAG_PREFIX.length)
      let parsed: unknown
      expect(() => { parsed = JSON.parse(json) }, `Malformed JSON: ${line}`).not.toThrow()
      expect((parsed as Record<string, unknown>)).toHaveProperty('kind')
    }
  })

  it('pipeline completes successfully even when telemetry emitter is broken', async () => {
    // Replace console.log to throw, simulating a broken log sink.
    // The emit() function must swallow this and not interrupt the pipeline.
    consoleSpy.mockImplementation((...args: unknown[]) => {
      if (String(args[0] ?? '').startsWith(DIAG_PREFIX)) {
        throw new Error('log sink broken')
      }
    })

    mockUsdaSearch.mockResolvedValue([goodFood()])

    const result = await calculateNutrition({
      ingredients: [{ name: 'apple', quantity: 100, unit: 'g' }],
    })

    // Pipeline must still produce a result despite broken telemetry
    expect(result).not.toBeNull()
  })
})
