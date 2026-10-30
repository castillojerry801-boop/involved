/**
 * Tests for lib/ymove/pipeline.ts — pure classification and summary logic.
 * No network calls; no server-only imports.
 */

import { describe, it, expect } from 'vitest'
import {
  classifyScore,
  summarizeSuggestions,
  THRESHOLD_HIGH,
  THRESHOLD_NEEDS,
  type MatchSuggestion,
  type ScoredCandidate,
} from '@/lib/ymove/pipeline'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeScoredCandidate(ymoveId: string, score: number): ScoredCandidate {
  const confidence =
    score >= 65 ? 'strong' :
    score >= 45 ? 'likely' :
    score >= 25 ? 'possible' :
    'weak'
  return {
    ymoveId,
    name:           `Exercise ${ymoveId}`,
    score,
    confidence,
    matchReasons:   [],
    penaltyReasons: [],
  }
}

function makeSuggestion(
  exerciseDbId: string,
  status: MatchSuggestion['status'],
  topScore: number | null = null,
): MatchSuggestion {
  const topMatch = topScore !== null ? makeScoredCandidate('uuid-top', topScore) : null
  return {
    exerciseDbId,
    displayName:     `Exercise ${exerciseDbId}`,
    equipment:       'barbell',
    bodyPart:        'chest',
    target:          'pectorals',
    searchQuery:     `barbell ${exerciseDbId}`,
    status,
    topMatch,
    otherCandidates: [],
    searchedAt:      '2026-10-29T00:00:00.000Z',
  }
}

// ── classifyScore ─────────────────────────────────────────────────────────────

describe('classifyScore', () => {
  it('classifies score ≥ THRESHOLD_HIGH as high_confidence', () => {
    expect(classifyScore(THRESHOLD_HIGH)).toBe('high_confidence')
    expect(classifyScore(THRESHOLD_HIGH + 1)).toBe('high_confidence')
    expect(classifyScore(100)).toBe('high_confidence')
  })

  it('classifies score exactly at THRESHOLD_HIGH as high_confidence', () => {
    expect(classifyScore(65)).toBe('high_confidence')
  })

  it('classifies score ≥ THRESHOLD_NEEDS but < THRESHOLD_HIGH as needs_review', () => {
    expect(classifyScore(THRESHOLD_NEEDS)).toBe('needs_review')
    expect(classifyScore(THRESHOLD_HIGH - 1)).toBe('needs_review')
    expect(classifyScore(50)).toBe('needs_review')
  })

  it('classifies score < THRESHOLD_NEEDS as unmatched', () => {
    expect(classifyScore(THRESHOLD_NEEDS - 1)).toBe('unmatched')
    expect(classifyScore(0)).toBe('unmatched')
    expect(classifyScore(25)).toBe('unmatched')
  })

  it('returns high_confidence for score 65 and needs_review for 64', () => {
    expect(classifyScore(65)).toBe('high_confidence')
    expect(classifyScore(64)).toBe('needs_review')
  })

  it('returns needs_review for score 45 and unmatched for 44', () => {
    expect(classifyScore(45)).toBe('needs_review')
    expect(classifyScore(44)).toBe('unmatched')
  })
})

// ── summarizeSuggestions ──────────────────────────────────────────────────────

describe('summarizeSuggestions', () => {
  it('returns all zeros for empty input', () => {
    const s = summarizeSuggestions([])
    expect(s).toEqual({ total: 0, highConfidence: 0, needsReview: 0, unmatched: 0 })
  })

  it('counts each status correctly', () => {
    const suggestions: MatchSuggestion[] = [
      makeSuggestion('A', 'high_confidence'),
      makeSuggestion('B', 'high_confidence'),
      makeSuggestion('C', 'needs_review'),
      makeSuggestion('D', 'unmatched'),
      makeSuggestion('E', 'unmatched'),
      makeSuggestion('F', 'unmatched'),
    ]
    const s = summarizeSuggestions(suggestions)
    expect(s.total).toBe(6)
    expect(s.highConfidence).toBe(2)
    expect(s.needsReview).toBe(1)
    expect(s.unmatched).toBe(3)
  })

  it('total equals highConfidence + needsReview + unmatched', () => {
    const suggestions: MatchSuggestion[] = [
      makeSuggestion('1', 'high_confidence'),
      makeSuggestion('2', 'needs_review'),
      makeSuggestion('3', 'unmatched'),
    ]
    const s = summarizeSuggestions(suggestions)
    expect(s.total).toBe(s.highConfidence + s.needsReview + s.unmatched)
  })

  it('handles all-unmatched input', () => {
    const suggestions = [
      makeSuggestion('X', 'unmatched'),
      makeSuggestion('Y', 'unmatched'),
    ]
    const s = summarizeSuggestions(suggestions)
    expect(s.highConfidence).toBe(0)
    expect(s.needsReview).toBe(0)
    expect(s.unmatched).toBe(2)
  })
})

// ── MatchSuggestion shape ─────────────────────────────────────────────────────

describe('MatchSuggestion shape', () => {
  it('topMatch is null for unmatched suggestions', () => {
    const s = makeSuggestion('0001', 'unmatched', null)
    expect(s.topMatch).toBeNull()
  })

  it('topMatch is present for high_confidence suggestions', () => {
    const s = makeSuggestion('0002', 'high_confidence', 80)
    expect(s.topMatch).not.toBeNull()
    expect(s.topMatch?.score).toBe(80)
  })

  it('otherCandidates does not include the topMatch', () => {
    const top = makeScoredCandidate('top-uuid', 90)
    const others = [makeScoredCandidate('other-1', 70), makeScoredCandidate('other-2', 55)]
    const s: MatchSuggestion = {
      exerciseDbId:    '0003',
      displayName:     'Test',
      equipment:       'cable',
      bodyPart:        'back',
      target:          'lats',
      searchQuery:     'cable lat pulldown',
      status:          'high_confidence',
      topMatch:        top,
      otherCandidates: others,
      searchedAt:      '2026-10-29T00:00:00.000Z',
    }
    expect(s.otherCandidates.map(c => c.ymoveId)).not.toContain('top-uuid')
  })
})

// ── Threshold alignment ───────────────────────────────────────────────────────

describe('threshold alignment with search.ts confidence levels', () => {
  it('THRESHOLD_HIGH aligns with "strong" confidence boundary (65)', () => {
    expect(THRESHOLD_HIGH).toBe(65)
  })

  it('THRESHOLD_NEEDS aligns with "likely" confidence boundary (45)', () => {
    expect(THRESHOLD_NEEDS).toBe(45)
  })

  it('a high_confidence suggestion always has topMatch.confidence strong', () => {
    const topMatch = makeScoredCandidate('uuid', 70)
    expect(topMatch.confidence).toBe('strong')
    expect(classifyScore(topMatch.score)).toBe('high_confidence')
  })
})
