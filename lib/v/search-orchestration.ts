/**
 * Deterministic search-phase orchestration for V program generation.
 *
 * The program-generation tool loop has two model phases:
 *   1. SEARCH  — the cheap chat model (gpt-4o-mini) discovers exercise candidates
 *                by calling search_exercises. Bounded by a hard round budget and a
 *                coverage target so it can never wander indefinitely.
 *   2. DRAFT   — the program model (Luna) receives the accumulated candidate pool
 *                and builds the structured ProgramDraft (propose_program). Sol is
 *                reached only on quality escalation.
 *
 * This module holds the pure decision logic (no I/O, no model calls) so it is
 * unit-testable in isolation. The route wires it to OpenAI and the exercise tool.
 */

import type { ExerciseSummary } from '@/lib/ai/tools/exercises'

// Foundational compound movement patterns any resistance program needs to cover.
// Accessory patterns (bicep, tricep, fly, calf, core, shoulder_isolation, lunge)
// are intentionally NOT here — a missing accessory must never block the handoff to
// the drafting model. Luna builds accessories from whatever appropriate candidates
// are already in the pool.
export const CORE_MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'horizontal_push',
  'vertical_push',
  'vertical_pull',
  'horizontal_pull',
] as const

// Deterministic search budget. A well-behaved mini covers all six core patterns in
// ~5 broad searches; this leaves headroom without ever approaching the runaway that
// produced 12 model rounds. Kept well under MAX_ROUNDS so the draft/quality phases
// always have rounds left.
export const MAX_SEARCH_ROUNDS = 6

// Minimum distinct movement patterns that must have at least one candidate before we
// consider the pool viable when core coverage is only partial (e.g. equipment can't
// support a squat). Below this, handing off to Luna would produce a thin program.
export const MIN_VIABLE_PATTERNS = 4

// Hard orchestration cost ceiling for a single program-generation request. The
// production failure consumed 75,143 tokens on Luna without ever proposing. This cap
// (comfortably below that) aborts with a targeted failure rather than burning more.
export const MAX_ORCHESTRATION_TOKENS = 60_000

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
 * search round made progress or just re-covered known ground.
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
 * Full core coverage — every foundational compound pattern has a candidate. This is
 * the BEST-CASE early-exit signal for the search phase: once true, more searching
 * only wastes tokens. It is deliberately strict (all six) so we never hand off a
 * pool that is missing a squat, hinge, or press just because a few accessory
 * patterns happen to be present.
 */
export function hasFullCoreCoverage(pool: CandidatePool): boolean {
  return pool.byId.size > 0 && missingCorePatterns(pool).length === 0
}

/**
 * Minimum viable coverage for a handoff to the drafting model when the search phase
 * ends WITHOUT full core coverage (budget/token/model-done). Requires at least
 * MIN_VIABLE_PATTERNS distinct movement patterns so Luna has a real base to build
 * from. Perfect coverage is deliberately NOT required — a missing accessory role must
 * never block generation; the drafting model fills gaps from the available pool.
 */
export function hasMinimumViableCoverage(pool: CandidatePool): boolean {
  return pool.patterns.size >= MIN_VIABLE_PATTERNS
}

export interface SearchTerminationInput {
  /** Number of search-phase rounds already completed. */
  searchRounds: number
  pool: CandidatePool
  /** promptTokens + completionTokens accumulated so far. */
  totalTokens: number
  /** True when the last search-phase model turn returned no tool calls. */
  modelStoppedSearching: boolean
}

export type SearchEndReason =
  | 'coverage_met'
  | 'model_done'
  | 'budget_exhausted'
  | 'token_budget'

export interface SearchTerminationDecision {
  end: boolean
  reason: SearchEndReason | null
}

/**
 * Deterministic rule for ending the search phase. End when ANY of:
 *   - minimum viable candidate coverage exists (best case — early exit),
 *   - the model itself stopped calling search (it thinks it's done),
 *   - the search round budget is exhausted,
 *   - the orchestration token ceiling is hit.
 * The route decides what to do next (draft handoff vs. targeted failure) based on
 * whether the pool actually has candidates.
 */
export function shouldEndSearchPhase(input: SearchTerminationInput): SearchTerminationDecision {
  const { searchRounds, pool, totalTokens, modelStoppedSearching } = input

  if (totalTokens >= MAX_ORCHESTRATION_TOKENS) return { end: true, reason: 'token_budget' }
  if (hasFullCoreCoverage(pool)) return { end: true, reason: 'coverage_met' }
  if (modelStoppedSearching && pool.byId.size > 0) return { end: true, reason: 'model_done' }
  if (searchRounds >= MAX_SEARCH_ROUNDS) return { end: true, reason: 'budget_exhausted' }

  return { end: false, reason: null }
}

/**
 * True when the accumulated pool is rich enough to hand to the drafting model —
 * at least MIN_VIABLE_PATTERNS distinct movement patterns. A pool that is empty or
 * too thin (every search returned nothing, or only a couple of patterns) must NOT
 * hand off — that becomes a targeted generation failure instead of a thin program.
 */
export function canHandoffToDraft(pool: CandidatePool): boolean {
  return hasMinimumViableCoverage(pool)
}

/**
 * Compact candidate summary injected into the drafting model's context. Groups
 * candidates by movement pattern and lists id + name so Luna builds strictly from
 * validated ids without re-searching. Never includes provider/internal fields the
 * user shouldn't see (those never reach the user anyway — this is model context).
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
