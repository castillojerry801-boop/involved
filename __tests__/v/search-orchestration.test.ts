/**
 * Deterministic search-phase orchestration — the fix for two production incidents:
 *
 *   dpl_...SadX: a model-driven search loop ran ~12 rounds on Luna, never proposed.
 *   (next run):  routing fixed, but the loop spent rounds 0–10 making NO tool call,
 *                then searched 5 patterns at round 11 and exited before transitioning —
 *                genPhase stayed "search", proposeProgramAttempted stayed false, and the
 *                pool (21 candidates, only horizontal_pull missing) never reached Luna.
 *
 * The search phase is now fully DETERMINISTIC (server-driven, zero model turns): a
 * fixed plan of movement-pattern searches that cannot wander, cannot skip a pattern,
 * and cannot run to an outer model round. These tests lock that logic.
 */

import { describe, it, expect } from 'vitest'
import {
  CORE_MOVEMENT_PATTERNS,
  ENRICHMENT_PATTERNS,
  MIN_VIABLE_CORE_PATTERNS,
  MIN_VIABLE_CANDIDATES,
  createCandidatePool,
  addCandidates,
  coveredCorePatterns,
  missingCorePatterns,
  hasFullCoreCoverage,
  canHandoffToDraft,
  buildDeterministicSearchPlan,
  filterCandidatesByEquipment,
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

// ─── Deterministic search plan — the structural fix ────────────────────────────

describe('buildDeterministicSearchPlan — bounded, cannot skip a pattern', () => {
  const plan = buildDeterministicSearchPlan()

  it('is a fixed-length plan (6 core + 8 enrichment), not an open-ended model loop', () => {
    expect(plan).toHaveLength(CORE_MOVEMENT_PATTERNS.length + ENRICHMENT_PATTERNS.length)
    expect(plan.length).toBeLessThan(16) // never the 12-round runaway, and bounded
  })

  it('searches EVERY core pattern — including horizontal_pull, which mini never reached', () => {
    const patterns = plan.filter(s => s.core).map(s => s.pattern)
    for (const core of CORE_MOVEMENT_PATTERNS) expect(patterns).toContain(core)
    expect(patterns).toContain('horizontal_pull')
  })

  it('core patterns come before enrichment patterns', () => {
    const firstEnrichment = plan.findIndex(s => !s.core)
    const lastCore = plan.map(s => s.core).lastIndexOf(true)
    expect(lastCore).toBeLessThan(firstEnrichment)
  })
})

// ─── Candidate pool + dedup ────────────────────────────────────────────────────

describe('candidate pool accumulation and dedup', () => {
  it('adds new candidates and reports the new count', () => {
    const pool = createCandidatePool()
    expect(addCandidates(pool, [ex('squat'), ex('hinge')])).toBe(2)
    expect(pool.byId.size).toBe(2)
  })

  it('does NOT re-add exercises already in the pool (dedup by id)', () => {
    const pool = createCandidatePool()
    const a = ex('squat', { id: '0001' })
    addCandidates(pool, [a])
    expect(addCandidates(pool, [a, ex('hinge', { id: '0002' })])).toBe(1)
    expect(pool.byId.size).toBe(2)
  })
})

// ─── Equipment filtering — must match the draft validator exactly ──────────────

describe('filterCandidatesByEquipment', () => {
  it('unrestricted profile (null/empty) keeps everything', () => {
    const results = [ex('squat', { equipment: 'barbell' }), ex('hinge', { equipment: 'cable' })]
    expect(filterCandidatesByEquipment(results, null)).toHaveLength(2)
    expect(filterCandidatesByEquipment(results, [])).toHaveLength(2)
  })

  it('keeps only exact (lowercased) equipment matches, plus body weight always', () => {
    const results = [
      ex('squat', { equipment: 'barbell' }),
      ex('fly', { equipment: 'cable' }),
      ex('core_antiextension', { equipment: 'body weight' }),
    ]
    const kept = filterCandidatesByEquipment(results, ['Barbell'])
    const names = kept.map(e => e.equipment)
    expect(names).toContain('barbell')
    expect(names).toContain('body weight') // always allowed
    expect(names).not.toContain('cable')   // not in profile
  })
})

// ─── Coverage + handoff rule ───────────────────────────────────────────────────

describe('core coverage and handoff', () => {
  it('full core coverage once every core pattern has a candidate', () => {
    const pool = createCandidatePool()
    addCandidates(pool, CORE_MOVEMENT_PATTERNS.map(p => ex(p)))
    expect(missingCorePatterns(pool)).toEqual([])
    expect(hasFullCoreCoverage(pool)).toBe(true)
    expect(canHandoffToDraft(pool)).toBe(true)
  })

  it('empty pool does not hand off', () => {
    expect(canHandoffToDraft(createCandidatePool())).toBe(false)
  })

  it('a thin pool (few core patterns, few candidates) does NOT hand off', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [ex('squat'), ex('hinge')]) // 2 core, 2 candidates
    expect(canHandoffToDraft(pool)).toBe(false)
  })

  it('needs BOTH enough core patterns AND enough total candidates', () => {
    // 4 core patterns but only 4 candidates → below candidate floor
    const pool = createCandidatePool()
    addCandidates(pool, [ex('squat'), ex('hinge'), ex('horizontal_push'), ex('vertical_pull')])
    expect(coveredCorePatterns(pool).length).toBeGreaterThanOrEqual(MIN_VIABLE_CORE_PATTERNS)
    expect(pool.byId.size).toBeLessThan(MIN_VIABLE_CANDIDATES)
    expect(canHandoffToDraft(pool)).toBe(false)
  })
})

// ─── The exact production scenario ─────────────────────────────────────────────
// 21 candidates, 5/6 core patterns covered, ONLY horizontal_pull missing. The prior
// build failed the whole request here. It must now hand off to Luna.

describe('production scenario — 5/6 core, horizontal_pull missing, 21 candidates', () => {
  function productionPool() {
    const pool = createCandidatePool()
    // squat(5), deadlift→hinge(5), bench→horizontal_push(5), pull-up→vertical_pull(5),
    // overhead press→vertical_push(1) = 21 candidates. horizontal_pull: none.
    addCandidates(pool, Array.from({ length: 5 }, () => ex('squat')))
    addCandidates(pool, Array.from({ length: 5 }, () => ex('hinge')))
    addCandidates(pool, Array.from({ length: 5 }, () => ex('horizontal_push')))
    addCandidates(pool, Array.from({ length: 5 }, () => ex('vertical_pull')))
    addCandidates(pool, Array.from({ length: 1 }, () => ex('vertical_push')))
    return pool
  }

  it('reproduces the pool: 21 candidates, only horizontal_pull missing', () => {
    const pool = productionPool()
    expect(pool.byId.size).toBe(21)
    expect(missingCorePatterns(pool)).toEqual(['horizontal_pull'])
    expect(coveredCorePatterns(pool)).toHaveLength(5)
  })

  it('HANDS OFF to the drafting model instead of failing the request', () => {
    const pool = productionPool()
    expect(hasFullCoreCoverage(pool)).toBe(false)  // one missing
    expect(canHandoffToDraft(pool)).toBe(true)      // but still viable → draft, not fail
  })

  it('the deterministic plan WOULD have searched horizontal_pull (root-cause fix)', () => {
    // The incident was mini never issuing a horizontal_pull search. The deterministic
    // plan always does — so in production this pattern would be covered too.
    const planned = buildDeterministicSearchPlan().map(s => s.pattern)
    expect(planned).toContain('horizontal_pull')
  })
})

// ─── Candidate summary for the drafting model ──────────────────────────────────

describe('buildCandidatePoolSummary', () => {
  it('groups by movement pattern and lists id=name (equipment)', () => {
    const pool = createCandidatePool()
    addCandidates(pool, [
      ex('squat', { id: '0026', name: 'Barbell Back Squat', equipment: 'barbell' }),
      ex('horizontal_pull', { id: '0100', name: 'Barbell Row', equipment: 'barbell' }),
    ])
    const summary = buildCandidatePoolSummary(pool)
    expect(summary).toContain('squat:')
    expect(summary).toContain('0026=Barbell Back Squat (barbell)')
    expect(summary).toContain('horizontal_pull:')
    expect(summary).toContain('0100=Barbell Row (barbell)')
  })
})
