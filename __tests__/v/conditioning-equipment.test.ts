/**
 * Equipment filtering for conditioning exercises.
 *
 * Covers the removal of the blanket conditioning bypass in filterCandidatesByEquipment:
 *   - Bodyweight cardio (walking, running) is always available regardless of equipment profile
 *   - Machine-dependent cardio (stationary bike, elliptical, leverage machine) requires
 *     the user to have gym/machine access
 *   - Users with no equipment restriction get all conditioning options
 *
 * Also covers the CONDITIONING_NO_AEROBIC_MODALITY error escalation:
 *   - session_type === 'conditioning' + no aerobic exercise → error (not warning)
 *   - Name/focus match + different session_type + no aerobic exercise → warning (unchanged)
 */

import { describe, it, expect } from 'vitest'
import { filterCandidatesByEquipment } from '../../lib/v/search-orchestration'
import { validateProgramQuality } from '../../lib/v/program-quality'
import type { ExerciseSummary } from '../../lib/ai/tools/exercises'
import type { ProgramDraft } from '../../lib/ai/tools/program'

// ─── Shared exercise stubs ────────────────────────────────────────────────────

function makeConditioning(id: string, name: string, equipment: string): ExerciseSummary {
  return {
    id,
    name,
    bodyPart: 'cardio',
    equipment,
    target: 'cardiovascular system',
    secondaryMuscles: [],
    movementPattern: 'cardio',
    secondaryMovementPatterns: [],
    movementFamily: 'cardio',
    exerciseRole: 'conditioning',
    laterality: 'bilateral',
    classificationConfidence: 'high',
  }
}

const WALK_9001       = makeConditioning('9001',  'walking',                      'body weight')
const RUNNING_BODY    = makeConditioning('0300',  'running',                       'body weight')
const STATIONARY_BIKE = makeConditioning('2138',  'stationary bike run v. 3',     'stationary bike')
const ELLIPTICAL      = makeConditioning('2141',  'walk elliptical cross trainer', 'elliptical machine')
const LEVERAGE_CARDIO = makeConditioning('3666',  'walking on incline treadmill',  'leverage machine')
const STEPMILL        = makeConditioning('9999',  'stepmill walk',                 'stepmill machine')

// ─── Tests: equipment filtering ──────────────────────────────────────────────

describe('filterCandidatesByEquipment — conditioning exercises', () => {
  describe('bodyweight-only user (["body weight"])', () => {
    const allowed = ['body weight']

    it('allows bodyweight conditioning (walking)', () => {
      const result = filterCandidatesByEquipment([WALK_9001], allowed)
      expect(result.map(e => e.id)).toContain('9001')
    })

    it('allows bodyweight running', () => {
      const result = filterCandidatesByEquipment([RUNNING_BODY], allowed)
      expect(result.map(e => e.id)).toContain('0300')
    })

    it('excludes stationary bike (needs gym access)', () => {
      const result = filterCandidatesByEquipment([STATIONARY_BIKE], allowed)
      expect(result).toHaveLength(0)
    })

    it('excludes elliptical machine', () => {
      const result = filterCandidatesByEquipment([ELLIPTICAL], allowed)
      expect(result).toHaveLength(0)
    })

    it('excludes leverage-machine treadmill', () => {
      const result = filterCandidatesByEquipment([LEVERAGE_CARDIO], allowed)
      expect(result).toHaveLength(0)
    })

    it('excludes stepmill', () => {
      const result = filterCandidatesByEquipment([STEPMILL], allowed)
      expect(result).toHaveLength(0)
    })

    it('mixed pool: returns only bodyweight options', () => {
      const pool = [WALK_9001, RUNNING_BODY, STATIONARY_BIKE, ELLIPTICAL, LEVERAGE_CARDIO]
      const result = filterCandidatesByEquipment(pool, allowed)
      expect(result.map(e => e.id).sort()).toEqual(['0300', '9001'])
    })
  })

  describe('gym user (["body weight", "leverage machine"])', () => {
    const allowed = ['body weight', 'leverage machine']

    it('allows bodyweight conditioning', () => {
      const result = filterCandidatesByEquipment([WALK_9001, RUNNING_BODY], allowed)
      expect(result).toHaveLength(2)
    })

    it('allows leverage-machine treadmill (maps to machine family)', () => {
      const result = filterCandidatesByEquipment([LEVERAGE_CARDIO], allowed)
      expect(result.map(e => e.id)).toContain('3666')
    })

    it('allows stationary bike (stationary bike maps to machine family)', () => {
      const result = filterCandidatesByEquipment([STATIONARY_BIKE], allowed)
      expect(result.map(e => e.id)).toContain('2138')
    })

    it('allows elliptical (elliptical machine maps to machine family)', () => {
      const result = filterCandidatesByEquipment([ELLIPTICAL], allowed)
      expect(result.map(e => e.id)).toContain('2141')
    })

    it('full conditioning pool available to gym user', () => {
      const pool = [WALK_9001, RUNNING_BODY, STATIONARY_BIKE, ELLIPTICAL, LEVERAGE_CARDIO, STEPMILL]
      const result = filterCandidatesByEquipment(pool, allowed)
      expect(result).toHaveLength(6)
    })
  })

  describe('unrestricted user (null / empty profile)', () => {
    it('null profile returns all conditioning exercises', () => {
      const pool = [WALK_9001, RUNNING_BODY, STATIONARY_BIKE, ELLIPTICAL, LEVERAGE_CARDIO]
      expect(filterCandidatesByEquipment(pool, null)).toHaveLength(5)
    })

    it('empty profile returns all conditioning exercises', () => {
      const pool = [WALK_9001, RUNNING_BODY, STATIONARY_BIKE, ELLIPTICAL, LEVERAGE_CARDIO]
      expect(filterCandidatesByEquipment(pool, [])).toHaveLength(5)
    })
  })
})

// ─── Tests: CONDITIONING_NO_AEROBIC_MODALITY escalation ──────────────────────

const SQUAT = {
  exercise_id: '0023', intended_pattern: 'squat' as const,
  sets: 4, reps_min: 6, reps_max: 8, rest_seconds: 180,
}
const BENCH = {
  exercise_id: '0025', intended_pattern: 'horizontal_push' as const,
  sets: 4, reps_min: 6, reps_max: 8, rest_seconds: 150,
}

describe('CONDITIONING_NO_AEROBIC_MODALITY severity escalation', () => {
  it('fires as ERROR when session_type === "conditioning" (explicit conditioning day)', () => {
    const draft: ProgramDraft = {
      program_name: '4-Week MetCon',
      description: 'MetCon.',
      weeks: 4,
      progression_strategy: 'Linear',
      days: [{
        name: 'Saturday — Conditioning',
        session_type: 'conditioning',
        estimated_duration_minutes: 40,
        exercises: [SQUAT, BENCH],
      }],
    }
    const issues = validateProgramQuality(draft, { weeks: 4 })
    const issue = issues.find(i => i.code === 'CONDITIONING_NO_AEROBIC_MODALITY')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('error')
  })

  it('fires as WARNING when day name contains "conditioning" but session_type differs', () => {
    const draft: ProgramDraft = {
      program_name: '4-Week Training',
      description: 'Mixed training.',
      weeks: 4,
      progression_strategy: 'Linear',
      days: [{
        name: 'Saturday — Conditioning Circuit',
        session_type: 'full_body',  // AI chose full_body, not conditioning
        estimated_duration_minutes: 40,
        exercises: [SQUAT, BENCH],
      }],
    }
    const issues = validateProgramQuality(draft, { weeks: 4 })
    const issue = issues.find(i => i.code === 'CONDITIONING_NO_AEROBIC_MODALITY')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('warning')
  })

  it('error message is actionable (names valid cardio pool options)', () => {
    const draft: ProgramDraft = {
      program_name: '4-Week MetCon',
      description: 'MetCon.',
      weeks: 4,
      progression_strategy: 'Linear',
      days: [{
        name: 'Saturday — Conditioning',
        session_type: 'conditioning',
        estimated_duration_minutes: 40,
        exercises: [SQUAT, BENCH],
      }],
    }
    const issues = validateProgramQuality(draft, { weeks: 4 })
    const issue = issues.find(i => i.code === 'CONDITIONING_NO_AEROBIC_MODALITY')!
    expect(issue.message).toMatch(/cardio/)
    expect(issue.message).toMatch(/9001/)  // exercise 9001 walking mentioned
  })
})
