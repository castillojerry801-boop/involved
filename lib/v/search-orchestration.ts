/**
 * Deterministic search-phase orchestration for V program generation.
 *
 * Program generation runs in two steps:
 *   1. SEARCH — a DETERMINISTIC, server-driven pass. For each movement pattern the
 *               program needs, the route calls search_exercises directly (no model
 *               turn). This cannot wander, cannot skip a pattern, and costs zero
 *               model tokens. It replaced a model-driven loop that spent up to 12
 *               rounds "deciding" whether to search and never reached horizontal_pull.
 *   2. DRAFT  — the program model (Luna) receives the accumulated candidate pool and
 *               builds the ProgramDraft (propose_program, forced). Sol is reached
 *               only on quality escalation.
 *
 * This module holds the pure logic (no I/O, no model calls) so it is unit-testable
 * in isolation. The route wires it to the exercise search tool and OpenAI.
 */

import type { ExerciseSummary } from '@/lib/ai/tools/exercises'

// Foundational compound movement patterns any resistance program needs to cover.
// These are searched first and define "coverage". Accessory patterns are searched
// too (ENRICHMENT_PATTERNS) but a missing accessory never blocks the draft handoff.
export const CORE_MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'horizontal_push',
  'vertical_push',
  'vertical_pull',
  'horizontal_pull',
] as const

// Accessory / isolation patterns searched deterministically after the core so Luna
// has arms, delts, calves, and trunk work to build a complete hypertrophy program.
// Their absence is never fatal — they only enrich the pool.
export const ENRICHMENT_PATTERNS = [
  'incline_push',
  'fly',
  'shoulder_isolation',
  'bicep',
  'tricep',
  'lunge',
  'calf',
  'core_antiextension',
] as const

// Handoff thresholds when core coverage is only partial (e.g. equipment can't support
// a given pattern). The drafting model can build from a partial-but-adequate pool;
// perfect coverage is NEVER required. The production pool (21 candidates, 5/6 core,
// only horizontal_pull missing) clears these easily.
export const MIN_VIABLE_CORE_PATTERNS = 4
export const MIN_VIABLE_CANDIDATES = 8

// Emergency orchestration cost ceiling. With deterministic search the search phase
// spends ZERO model tokens, so in practice only the Luna draft (+ any quality retry)
// consumes tokens. This ceiling is a last-resort guard against a pathological draft
// loop — not the practical budget. The real cost control is: deterministic search
// (0 tokens) + a single forced Luna draft.
export const MAX_ORCHESTRATION_TOKENS = 45_000

export type SearchPhase = 'search' | 'draft' | 'escalation'

export interface CandidatePool {
  /** Deduplicated by exercise id. */
  byId: Map<string, ExerciseSummary>
  /** Distinct primary movement patterns present in the pool. */
  patterns: Set<string>
}

export function createCandidatePool(): CandidatePool {
  return { byId: new Map(), patterns: new Set() }
}

/**
 * Merge search results into the pool. Returns the number of genuinely NEW
 * candidates added (already-seen ids are ignored) so telemetry can show whether a
 * search made progress or just re-covered known ground.
 */
export function addCandidates(pool: CandidatePool, results: ExerciseSummary[]): number {
  let added = 0
  for (const ex of results) {
    if (pool.byId.has(ex.id)) continue
    pool.byId.set(ex.id, ex)
    if (ex.movementPattern) pool.patterns.add(ex.movementPattern)
    added++
  }
  return added
}

export function coveredCorePatterns(pool: CandidatePool): string[] {
  return CORE_MOVEMENT_PATTERNS.filter(p => pool.patterns.has(p))
}

export function missingCorePatterns(pool: CandidatePool): string[] {
  return CORE_MOVEMENT_PATTERNS.filter(p => !pool.patterns.has(p))
}

/**
 * Full core coverage — every foundational compound pattern has a candidate. The
 * best case: the deterministic search found something for all six.
 */
export function hasFullCoreCoverage(pool: CandidatePool): boolean {
  return pool.byId.size > 0 && missingCorePatterns(pool).length === 0
}

/**
 * Whether the accumulated pool is rich enough to hand to the drafting model.
 *   - full core coverage, OR
 *   - at least MIN_VIABLE_CORE_PATTERNS core patterns AND MIN_VIABLE_CANDIDATES total.
 * One missing pattern (e.g. horizontal_pull) must NOT fail the request — Luna builds
 * from the available pool. Only a genuinely thin pool is rejected.
 */
export function canHandoffToDraft(pool: CandidatePool): boolean {
  if (hasFullCoreCoverage(pool)) return true
  return coveredCorePatterns(pool).length >= MIN_VIABLE_CORE_PATTERNS
    && pool.byId.size >= MIN_VIABLE_CANDIDATES
}

export interface SearchStep {
  pattern: string
  /** True for the six core compound patterns; false for enrichment/accessory. */
  core: boolean
}

/**
 * The deterministic search plan: core patterns first (define coverage), then
 * accessory patterns (enrich the pool). The route executes each step with a direct
 * search_exercises call — no model decides the query. This is the fix for "mini
 * never searched horizontal_pull": the server always searches every needed pattern.
 */
export function buildDeterministicSearchPlan(): SearchStep[] {
  return [
    ...CORE_MOVEMENT_PATTERNS.map(pattern => ({ pattern, core: true })),
    ...ENRICHMENT_PATTERNS.map(pattern => ({ pattern, core: false })),
  ]
}

/**
 * Filter raw search results to the user's equipment profile using the SAME exact
 * (lowercased) equality the draft validator uses (validateProgramDraft →
 * allowedEquipment), so a candidate placed in the pool can never be rejected later.
 * "body weight" is always allowed. A null/empty profile means unrestricted.
 */
export function filterCandidatesByEquipment(
  results: ExerciseSummary[],
  allowedEquipment: string[] | null | undefined,
): ExerciseSummary[] {
  if (!allowedEquipment || allowedEquipment.length === 0) return results
  const allowed = new Set([...allowedEquipment.map(e => e.toLowerCase()), 'body weight'])
  return results.filter(e => allowed.has(e.equipment.toLowerCase()))
}

/**
 * Compact candidate summary injected into the drafting model's context. Groups
 * candidates by movement pattern and lists id + name so Luna builds strictly from
 * validated ids without re-searching.
 */
export function buildCandidatePoolSummary(pool: CandidatePool): string {
  const byPattern = new Map<string, ExerciseSummary[]>()
  for (const ex of pool.byId.values()) {
    const key = ex.movementPattern || 'other'
    const list = byPattern.get(key) ?? []
    list.push(ex)
    byPattern.set(key, list)
  }
  const lines: string[] = []
  for (const [pattern, list] of byPattern) {
    const items = list.map(e => `${e.id}=${e.name} (${e.equipment})`).join('; ')
    lines.push(`${pattern}: ${items}`)
  }
  return lines.join('\n')
}
