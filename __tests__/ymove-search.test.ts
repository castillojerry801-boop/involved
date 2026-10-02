import { describe, it, expect } from 'vitest'
import {
  buildSearchQuery,
  scoreCandidate,
  rankCandidates,
  STARTER_BATCH_IDS,
  type ExerciseMetadata,
  type YmoveCandidateRaw,
} from '@/lib/ymove/search'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const META_BARBELL_BENCH: ExerciseMetadata = {
  exerciseDbId: '0025',
  displayName: 'Barbell Bench Press',
  equipment: 'barbell',
  bodyPart: 'chest',
  target: 'pectorals',
  technicalPattern: 'horizontal_press',
  primaryMuscles: ['pectorals', 'triceps'],
}

const META_DUMBBELL_CURL: ExerciseMetadata = {
  exerciseDbId: '0294',
  displayName: 'Dumbbell Biceps Curl',
  equipment: 'dumbbell',
  bodyPart: 'upper arms',
  target: 'biceps',
  technicalPattern: 'elbow_flexion',
  primaryMuscles: ['biceps'],
}

const META_BARBELL_SQUAT: ExerciseMetadata = {
  exerciseDbId: '0043',
  displayName: 'Barbell Back Squat',
  equipment: 'barbell',
  bodyPart: 'upper legs',
  target: 'glutes',
  technicalPattern: 'squat',
  primaryMuscles: ['glutes', 'quads'],
}

const META_PULLUP: ExerciseMetadata = {
  exerciseDbId: '0652',
  displayName: 'Pull-Up',
  equipment: 'body weight',
  bodyPart: 'back',
  target: 'lats',
  technicalPattern: 'vertical_pull',
  primaryMuscles: ['lats'],
}

// ── buildSearchQuery ──────────────────────────────────────────────────────────

describe('buildSearchQuery', () => {
  it('returns display name when it already contains equipment', () => {
    const q = buildSearchQuery(META_BARBELL_BENCH)
    expect(q).toBe('Barbell Bench Press')
  })

  it('prepends equipment when display name lacks it', () => {
    const meta: ExerciseMetadata = {
      ...META_BARBELL_BENCH,
      displayName: 'Bench Press',  // no "barbell" in name
    }
    const q = buildSearchQuery(meta)
    expect(q).toBe('barbell Bench Press')
  })

  it('does not prepend body weight (generic equipment)', () => {
    const q = buildSearchQuery(META_PULLUP)
    expect(q).toBe('Pull-Up')
  })

  it('handles cable equipment', () => {
    const meta: ExerciseMetadata = {
      exerciseDbId: '0241',
      displayName: 'Triceps Pushdown',
      equipment: 'cable',
      bodyPart: 'upper arms',
      target: 'triceps',
      technicalPattern: 'elbow_extension',
    }
    const q = buildSearchQuery(meta)
    expect(q).toBe('cable Triceps Pushdown')
  })
})

// ── scoreCandidate ────────────────────────────────────────────────────────────

describe('scoreCandidate', () => {
  // 1. Exact name + equipment ranks highest
  it('exact name + matching equipment gives strong confidence', () => {
    const candidate: YmoveCandidateRaw = {
      ymoveId: 'abc',
      name: 'Barbell Bench Press',
    }
    const scored = scoreCandidate(candidate, META_BARBELL_BENCH)
    expect(scored.confidence).toBe('strong')
    expect(scored.matchReasons).toContain('name match')
    expect(scored.matchReasons).toContain('equipment match')
  })

  // 2. Wrong equipment is penalised
  it('penalises equipment mismatch', () => {
    const exact: YmoveCandidateRaw = { ymoveId: 'a', name: 'Barbell Bench Press' }
    const wrong: YmoveCandidateRaw = { ymoveId: 'b', name: 'Dumbbell Bench Press' }
    const scoreExact = scoreCandidate(exact, META_BARBELL_BENCH).score
    const scoreWrong = scoreCandidate(wrong, META_BARBELL_BENCH).score
    expect(scoreExact).toBeGreaterThan(scoreWrong)
    expect(scoreCandidate(wrong, META_BARBELL_BENCH).penaltyReasons.some(r => r.includes('mismatch'))).toBe(true)
  })

  // 3. Band variant penalised when canonical is barbell
  it('penalises band variant when canonical is barbell', () => {
    const band: YmoveCandidateRaw = { ymoveId: 'c', name: 'Band Bench Press' }
    const barbell: YmoveCandidateRaw = { ymoveId: 'd', name: 'Barbell Bench Press' }
    const scoreBand = scoreCandidate(band, META_BARBELL_BENCH).score
    const scoreBarbell = scoreCandidate(barbell, META_BARBELL_BENCH).score
    expect(scoreBarbell).toBeGreaterThan(scoreBand)
  })

  // 4. Assisted variant is penalised
  it('penalises assisted variant', () => {
    const assisted: YmoveCandidateRaw = { ymoveId: 'e', name: 'Assisted Pull-Up' }
    const standard: YmoveCandidateRaw = { ymoveId: 'f', name: 'Pull-Up' }
    const scoreAssisted = scoreCandidate(assisted, META_PULLUP).score
    const scoreStandard = scoreCandidate(standard, META_PULLUP).score
    expect(scoreStandard).toBeGreaterThan(scoreAssisted)
    expect(scoreCandidate(assisted, META_PULLUP).penaltyReasons).toContain('assisted variant')
  })

  // 5. Unilateral penalised for bilateral canonical
  it('penalises unilateral variant when canonical is bilateral', () => {
    const uni: YmoveCandidateRaw = { ymoveId: 'g', name: 'Dumbbell Single Arm Biceps Curl' }
    const bi: YmoveCandidateRaw = { ymoveId: 'h', name: 'Dumbbell Biceps Curl' }
    const scoreUni = scoreCandidate(uni, META_DUMBBELL_CURL).score
    const scoreBi = scoreCandidate(bi, META_DUMBBELL_CURL).score
    expect(scoreBi).toBeGreaterThan(scoreUni)
    expect(scoreCandidate(uni, META_DUMBBELL_CURL).penaltyReasons).toContain('unilateral variant')
  })

  // 6. Movement pattern contributes positively
  it('awards movement pattern bonus when technicalPattern matches', () => {
    const withMovement: YmoveCandidateRaw = { ymoveId: 'i', name: 'Barbell Squat' }
    const withoutMovement: YmoveCandidateRaw = { ymoveId: 'j', name: 'Barbell Hip Thrust' }
    const s1 = scoreCandidate(withMovement, META_BARBELL_SQUAT).score
    const s2 = scoreCandidate(withoutMovement, META_BARBELL_SQUAT).score
    expect(s1).toBeGreaterThan(s2)
    expect(scoreCandidate(withMovement, META_BARBELL_SQUAT).matchReasons).toContain('movement match')
  })

  // 7. Score clamped 0–100
  it('score is always between 0 and 100', () => {
    const candidates: YmoveCandidateRaw[] = [
      { ymoveId: '1', name: 'Barbell Bench Press' },
      { ymoveId: '2', name: 'Cable Assisted Seated Decline Machine Bench Press' },
      { ymoveId: '3', name: 'Something Completely Unrelated' },
    ]
    for (const c of candidates) {
      const { score } = scoreCandidate(c, META_BARBELL_BENCH)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  // 8. Broad movement name (just "curl") still produces sensible ordering
  it('broad movement names still rank barbell above band variant', () => {
    const meta: ExerciseMetadata = {
      exerciseDbId: '0294',
      displayName: 'Biceps Curl',
      equipment: 'dumbbell',
      bodyPart: 'upper arms',
      target: 'biceps',
      technicalPattern: 'elbow_flexion',
    }
    const dumbbell: YmoveCandidateRaw = { ymoveId: 'a', name: 'Dumbbell Biceps Curl' }
    const band: YmoveCandidateRaw = { ymoveId: 'b', name: 'Band Biceps Curl' }
    const scoreDumbbell = scoreCandidate(dumbbell, meta).score
    const scoreBand = scoreCandidate(band, meta).score
    expect(scoreDumbbell).toBeGreaterThan(scoreBand)
  })

  // 9. Incline variant penalised for flat bench canonical
  it('penalises incline variant for flat bench press canonical', () => {
    const incline: YmoveCandidateRaw = { ymoveId: 'x', name: 'Barbell Incline Bench Press' }
    const flat: YmoveCandidateRaw = { ymoveId: 'y', name: 'Barbell Bench Press' }
    const s1 = scoreCandidate(incline, META_BARBELL_BENCH).score
    const s2 = scoreCandidate(flat, META_BARBELL_BENCH).score
    expect(s2).toBeGreaterThan(s1)
    expect(scoreCandidate(incline, META_BARBELL_BENCH).penaltyReasons.some(r => r.includes('incline'))).toBe(true)
  })
})

// ── rankCandidates ────────────────────────────────────────────────────────────

describe('rankCandidates', () => {
  it('returns candidates sorted by score descending', () => {
    const candidates: YmoveCandidateRaw[] = [
      { ymoveId: '1', name: 'Band Biceps Curl' },
      { ymoveId: '2', name: 'Dumbbell Biceps Curl' },
      { ymoveId: '3', name: 'Assisted Single Arm Dumbbell Biceps Curl' },
    ]
    const ranked = rankCandidates(candidates, META_DUMBBELL_CURL)
    expect(ranked[0].ymoveId).toBe('2')
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i].score).toBeGreaterThanOrEqual(ranked[i + 1].score)
    }
  })

  it('returns empty array for empty input', () => {
    const ranked = rankCandidates([], META_BARBELL_BENCH)
    expect(ranked).toEqual([])
  })
})

// ── STARTER_BATCH_IDS ─────────────────────────────────────────────────────────

describe('STARTER_BATCH_IDS', () => {
  it('contains exactly 20 entries', () => {
    expect(STARTER_BATCH_IDS.size).toBe(20)
  })

  it('includes the key foundational exercises', () => {
    expect(STARTER_BATCH_IDS.has('0025')).toBe(true) // Barbell Bench Press
    expect(STARTER_BATCH_IDS.has('0043')).toBe(true) // Barbell Back Squat
    expect(STARTER_BATCH_IDS.has('0032')).toBe(true) // Barbell Deadlift
    expect(STARTER_BATCH_IDS.has('0652')).toBe(true) // Pull-Up
    expect(STARTER_BATCH_IDS.has('0662')).toBe(true) // Push-Up
    expect(STARTER_BATCH_IDS.has('0549')).toBe(true) // Kettlebell Swing
  })
})

