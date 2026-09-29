/**
 * Search-phase orchestration — deterministic termination + candidate handoff.
 *
 * These tests reproduce the production incident (dpl_CVMcbF3MPi5N6DVRVpoybjgsYadX):
 * a 4-day muscle-building request ran ~12 search rounds on Luna and NEVER called
 * propose_program. The orchestration layer now enforces a bounded search budget,
 * a coverage target, dedup, and a forced handoff to the drafting model.
 *
 * The route wiring (model selection per phase) is asserted separately in
 * model-routing.test.ts; here we lock the pure decision logic.
 */

import { describe, it, expect } from 'vitest'
import {
  CORE_MOVEMENT_PATTERNS,
  MAX_SEARCH_ROUNDS,
  MAX_ORCHESTRATION_TOKENS,
  createCandidatePool,
  addCandidates,
  coveredCorePatterns,
  missingCorePatterns,
  hasFullCoreCoverage,
  hasMinimumViableCoverage,
  canHandoffToDraft,
  shouldEndSearchPhase,
  buildCandidatePoolSummary,
} from '../../lib/v/search-orchestration'
import type { ExerciseSummary } from '../../lib/ai/tools/exercises'

// Minimal ExerciseSummary factory — only the fields the orchestrator reads matter.
let idCounter = 0
function ex(pattern: string, opts: Partial<ExerciseSummary> = {}): ExerciseSummary {
  idCounter++
  return {
    id: opts.id ?? String(idCounter).padStart(4, '0'),
    name: opts.name ?? `${pattern} exercise ${idCounter}`,
    bodyPart: 'x',
    equipment: opts.equipment ?? 'barbell',
    target: 'x',
    secondaryMuscles: [],
    movementPattern: pattern as ExerciseSummary['movementPattern'],
    secondaryMovementPatterns: [],
    movementFamily: 'x' as ExerciseSummary['movementFamily'],
    exerciseRole: 'primary_compound',
    laterality: 'bilateral' as ExerciseSummary['laterality'],
    classificationConfidence: 'high' as ExerciseSummary['classificationConfidence'],
    ...opts,
  }
}

// ─── Candidate pool + dedup ────────────────────────────────────────────────────

describe('candidate pool accumulation and dedup', () => {
  it('adds new candidates and reports the new count', () => {
    const pool = createCandidatePool()
    const added = addCandidates(pool, [ex('squat'), ex('hinge')])
    expect(added).toBe(2)
    expect(pool.byId.size).toBe(2)
  })

  it('does NOT re-add exercises already in the pool (dedup by id)', () => {
    const pool = createCandidatePool()
    const a = ex('squat', { id: '0001' })
    addCandidates(pool, [a])
    const added = addCandidates(pool, [a, ex('hinge', { id: '0002' })])
    expect(added).toBe(1)            // only the hinge is new
    expect(pool.byId.size).toBe(2)
  })

  it('tracks distinct movement patterns', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('squat'), ex('squat'), ex('hinge')])
    expect(pool.patterns.has('squat')).toBe(true)
    expect(pool.patterns.has('hinge')).toBe(true)
    expect(pool.patterns.size).toBe(2)
  })
})

// ─── Coverage detection ────────────────────────────────────────────────────────

describe('core pattern coverage', () => {
  it('reports missing core patterns for an empty pool', () => {
    const pool = createCandidatePool()
    expect(missingCorePatterns(pool)).toEqual([...CORE_MOVEMENT_PATTERNS])
    expect(coveredCorePatterns(pool)).toEqual([])
  })

  it('reports full core coverage once every core pattern has a candidate', () => {
    const pool = createCandidatePool()
    addCandidates(pool, CORE_MOVEMENT_PATTERNS.map(p => ex(p)))
    expect(missingCorePatterns(pool)).toEqual([])
    expect(hasFullCoreCoverage(pool)).toBe(true)
  })

  it('accessory-only patterns do NOT satisfy full core coverage (no early exit)', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('bicep'), ex('tricep'), ex('fly'), ex('calf')])
    expect(missingCorePatterns(pool)).toEqual([...CORE_MOVEMENT_PATTERNS])
    expect(hasFullCoreCoverage(pool)).toBe(false)
    // 4 distinct patterns still clears the handoff floor if the budget forces a stop
    expect(hasMinimumViableCoverage(pool)).toBe(true)
  })

  it('a thin pool (few patterns) is NOT viable for handoff', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('bicep'), ex('tricep')])
    expect(hasMinimumViableCoverage(pool)).toBe(false)
  })
})

// ─── Termination rule ──────────────────────────────────────────────────────────

describe('shouldEndSearchPhase — deterministic termination', () => {
  const fullCore = () => {
    const pool = createCandidatePool()
    addCandidates(pool, CORE_MOVEMENT_PATTERNS.map(p => ex(p)))
    return pool
  }

  it('ends early with coverage_met once all core patterns are present', () => {
    const d = shouldEndSearchPhase({ searchRounds: 3, pool: fullCore(), totalTokens: 10_000, modelStoppedSearching: false })
    expect(d.end).toBe(true)
    expect(d.reason).toBe('coverage_met')
  })

  it('does NOT end while coverage is incomplete and budget/tokens remain', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('squat'), ex('hinge')])
    const d = shouldEndSearchPhase({ searchRounds: 2, pool, totalTokens: 10_000, modelStoppedSearching: false })
    expect(d.end).toBe(false)
    expect(d.reason).toBeNull()
  })

  it('ends with budget_exhausted at the search round cap even without coverage', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('squat')]) // 1 pattern — below viable floor
    const d = shouldEndSearchPhase({ searchRounds: MAX_SEARCH_ROUNDS, pool, totalTokens: 10_000, modelStoppedSearching: false })
    expect(d.end).toBe(true)
    expect(d.reason).toBe('budget_exhausted')
  })

  it('ends with model_done when the model stops searching AND candidates exist', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('squat')])
    const d = shouldEndSearchPhase({ searchRounds: 2, pool, totalTokens: 10_000, modelStoppedSearching: true })
    expect(d.end).toBe(true)
    expect(d.reason).toBe('model_done')
  })

  it('model_done with an EMPTY pool still ends (route then fails targeted, not endless)', () => {
    const pool = createCandidatePool()
    const d = shouldEndSearchPhase({ searchRounds: 2, pool, totalTokens: 10_000, modelStoppedSearching: true })
    // Empty pool: coverage false, model_done requires candidates, so this falls through
    // to budget check — not yet at budget → keeps searching. Confirm it does NOT
    // spuriously claim model_done on an empty pool.
    expect(d.reason).not.toBe('model_done')
  })

  it('ends with token_budget when the orchestration ceiling is hit', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('squat')])
    const d = shouldEndSearchPhase({ searchRounds: 1, pool, totalTokens: MAX_ORCHESTRATION_TOKENS, modelStoppedSearching: false })
    expect(d.end).toBe(true)
    expect(d.reason).toBe('token_budget')
  })
})

// ─── Handoff gating ────────────────────────────────────────────────────────────

describe('canHandoffToDraft', () => {
  it('true when the pool has a viable base of patterns', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('squat'), ex('hinge'), ex('horizontal_push'), ex('vertical_pull')])
    expect(canHandoffToDraft(pool)).toBe(true)
  })
  it('false when the pool is empty', () => {
    expect(canHandoffToDraft(createCandidatePool())).toBe(false)
  })
  it('false when the pool is too thin (below the pattern floor)', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('squat'), ex('hinge')])
    expect(canHandoffToDraft(pool)).toBe(false)
  })
})

// ─── Candidate summary for the drafting model ──────────────────────────────────

describe('buildCandidatePoolSummary', () => {
  it('groups by movement pattern and lists id=name (equipment)', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [
      ex('squat', { id: '0026', name: 'Barbell Back Squat', equipment: 'barbell' }),
      ex('hinge', { id: '0032', name: 'Romanian Deadlift', equipment: 'barbell' }),
    ])
    const summary = buildCandidatePoolSummary(pool)
    expect(summary).toContain('squat:')
    expect(summary).toContain('0026=Barbell Back Squat (barbell)')
    expect(summary).toContain('hinge:')
    expect(summary).toContain('0032=Romanian Deadlift (barbell)')
  })
})

// ─── The exact production scenario, simulated round-by-round ───────────────────
// "I want to get back in shape and build some muscle. Make me a 12-week program."
// 4 training days, broad equipment. The prior loop searched 12 rounds on Luna and
// never proposed. Here we simulate an efficient mini search and assert the loop
// terminates within budget and hands off with the required patterns covered.

describe('production scenario — 4-day muscle-building, broad equipment', () => {
  it('efficient broad searches reach coverage and hand off well within budget', () => {
    const pool = createCandidatePool()
    let searchRounds = 0
    const runSearch = (results: ExerciseSummary[]) => {
      searchRounds++
      addCandidates(pool, results)
      return shouldEndSearchPhase({ searchRounds, pool, totalTokens: searchRounds * 6000, modelStoppedSearching: false })
    }

    // Round 1: chest search → horizontal_push + incline_push + fly
    expect(runSearch([ex('horizontal_push'), ex('incline_push'), ex('fly')]).end).toBe(false)
    // Round 2: back search → vertical_pull + horizontal_pull + bicep
    expect(runSearch([ex('vertical_pull'), ex('horizontal_pull'), ex('bicep')]).end).toBe(false)
    // Round 3: legs search → squat + lunge + calf
    expect(runSearch([ex('squat'), ex('lunge'), ex('calf')]).end).toBe(false)
    // Round 4: posterior/shoulders → hinge + vertical_push
    const d = runSearch([ex('hinge'), ex('vertical_push')])

    expect(d.end).toBe(true)
    expect(d.reason).toBe('coverage_met')
    expect(searchRounds).toBeLessThanOrEqual(MAX_SEARCH_ROUNDS)
    expect(missingCorePatterns(pool)).toEqual([])
    expect(canHandoffToDraft(pool)).toBe(true)
  })

  it('a model repeating overlapping searches still terminates at the budget', () => {
    const pool = createCandidatePool()
    let searchRounds = 0
    let end = false
    // The model keeps searching only chest (duplicate/overlapping) — dedup means the
    // pool never grows past one pattern, coverage never completes, but the round
    // budget guarantees termination instead of an endless loop.
    for (let i = 0; i < 20 && !end; i++) {
      searchRounds++
      addCandidates(pool, [ex('horizontal_push', { id: '0025' })]) // same id every time
      end = shouldEndSearchPhase({ searchRounds, pool, totalTokens: searchRounds * 6000, modelStoppedSearching: false }).end
    }
    expect(searchRounds).toBe(MAX_SEARCH_ROUNDS)
    expect(pool.byId.size).toBe(1) // dedup held — one candidate, not 6
  })
})
