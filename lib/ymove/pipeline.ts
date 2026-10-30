/**
 * Pure pipeline types and classification logic for the automated
 * ExerciseDB → YMove catalog matching pipeline.
 *
 * No network calls, no server-only imports — safe for scripts and tests.
 */

export type { ScoredCandidate } from './search'
import { type ScoredCandidate } from './search'

export type MatchClass = 'high_confidence' | 'needs_review' | 'unmatched'

// Score thresholds for classification — mirror search.ts confidence boundaries.
export const THRESHOLD_HIGH  = 65  // strong confidence: safe to present for quick approval
export const THRESHOLD_NEEDS = 45  // likely: needs closer inspection before approval

export interface MatchSuggestion {
  exerciseDbId:    string
  displayName:     string
  equipment:       string
  bodyPart:        string
  target:          string
  searchQuery:     string
  status:          MatchClass
  topMatch:        ScoredCandidate | null
  otherCandidates: ScoredCandidate[]  // up to 4 alternates
  searchedAt:      string
}

export interface SuggestionsSummary {
  total:          number
  highConfidence: number
  needsReview:    number
  unmatched:      number
}

export interface SuggestionsFile {
  version:     1
  generatedAt: string
  summary:     SuggestionsSummary
  suggestions: MatchSuggestion[]
}

/** Classify a top-match score into one of three review tiers. */
export function classifyScore(score: number): MatchClass {
  if (score >= THRESHOLD_HIGH)  return 'high_confidence'
  if (score >= THRESHOLD_NEEDS) return 'needs_review'
  return 'unmatched'
}

/** Build a summary from a list of suggestions. */
export function summarizeSuggestions(suggestions: MatchSuggestion[]): SuggestionsSummary {
  let highConfidence = 0
  let needsReview    = 0
  let unmatched      = 0
  for (const s of suggestions) {
    if      (s.status === 'high_confidence') highConfidence++
    else if (s.status === 'needs_review')    needsReview++
    else                                     unmatched++
  }
  return { total: suggestions.length, highConfidence, needsReview, unmatched }
}
