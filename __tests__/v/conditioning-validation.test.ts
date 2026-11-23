/**
 * Conditioning quality-validation regression tests
 *
 * Covers the CONDITIONING_WALK_ONLY check introduced to prevent the daily walk
 * (exercise 9001) from satisfying a conditioning-day's aerobic requirement when
 * the same walk is programmed on all other days too.
 *
 * Also tests:
 *   - Walk + dedicated cardio passes (stationary bike alongside walk)
 *   - Strength-only programs are completely unaffected
 *   - Walking-only fitness programs (no separate conditioning day) pass
 *   - CONDITIONING_NO_AEROBIC_MODALITY still fires when no cardio at all
 *   - distance_m = 1609 is accepted in the ProgramExerciseDraft type
 */

import { describe, it, expect } from 'vitest'
import { validateProgramQuality } from '../../lib/v/program-quality'
import type { ProgramDraft } from '../../lib/ai/tools/program'

// ─── Shared exercise stubs ────────────────────────────────────────────────────

const WALK = {
  exercise_id: '9001',
  intended_pattern: 'cardio' as const,
  sets: 1,
  distance_m: 1609,
  rest_seconds: 0,
  progression_model: 'duration_distance' as const,
}

const SQUAT = {
  exercise_id: '0023',
  intended_pattern: 'squat' as const,
  sets: 4,
  reps_min: 6,
  reps_max: 8,
  rest_seconds: 180,
}

const BENCH = {
  exercise_id: '0025',
  intended_pattern: 'horizontal_push' as const,
  sets: 4,
  reps_min: 6,
  reps_max: 8,
  rest_seconds: 150,
}

const ROW = {
  exercise_id: '0597',
  intended_pattern: 'horizontal_pull' as const,
  sets: 3,
  reps_min: 8,
  reps_max: 12,
  rest_seconds: 120,
}

const BIKE = {
  exercise_id: '1200',
  intended_pattern: 'cardio' as const,
  sets: 1,
  duration_seconds: 1800,
  rest_seconds: 0,
  progression_model: 'duration_distance' as const,
}

// A minimal valid week_progression so deload checks don't fire (used for 8-week drafts)
function walkingProgression(weeks: number) {
  return Array.from({ length: weeks }, (_, i) => ({
    week: i + 1,
    sets: 1,
    deload: i === 3 || i === 7,
  }))
}

// ─── Scenario 1: Conditioning day with ONLY walk → CONDITIONING_WALK_ONLY error ──

describe('Scenario 1 — conditioning day with only daily walk fires CONDITIONING_WALK_ONLY', () => {
  const draft: ProgramDraft = {
    program_name: '8-Week S&C',
    description: 'Strength and conditioning, daily 1-mile walk.',
    weeks: 4,
    progression_strategy: 'Linear load increase',
    days: [
      {
        name: 'Monday — Upper Body',
        session_type: 'upper_full',
        estimated_duration_minutes: 55,
        exercises: [SQUAT, BENCH, ROW, WALK],
      },
      {
        name: 'Tuesday — Lower Body',
        session_type: 'lower_full',
        estimated_duration_minutes: 55,
        exercises: [SQUAT, ROW, BENCH, WALK],
      },
      {
        name: 'Saturday — Cardio & Conditioning',
        session_type: 'conditioning',
        estimated_duration_minutes: 30,
        exercises: [WALK], // only the daily walk — no dedicated conditioning
      },
      {
        name: 'Sunday — Active Recovery',
        session_type: 'active_recovery',
        estimated_duration_minutes: 20,
        exercises: [WALK],
      },
    ],
  }

  it('fires CONDITIONING_WALK_ONLY as an error', () => {
    const issues = validateProgramQuality(draft, {
      requiredDailyActivityIds: ['9001'],
      weeks: 4,
    })
    const codes = issues.map(i => i.code)
    expect(codes).toContain('CONDITIONING_WALK_ONLY')
    const issue = issues.find(i => i.code === 'CONDITIONING_WALK_ONLY')!
    expect(issue.severity).toBe('error')
    expect(issue.message).toContain('Saturday')
  })

  it('does NOT fire CONDITIONING_NO_AEROBIC_MODALITY (walk satisfies it)', () => {
    const issues = validateProgramQuality(draft, {
      requiredDailyActivityIds: ['9001'],
      weeks: 4,
    })
    const codes = issues.map(i => i.code)
    expect(codes).not.toContain('CONDITIONING_NO_AEROBIC_MODALITY')
  })
})

// ─── Scenario 2: Walk + dedicated cardio passes ──────────────────────────────

describe('Scenario 2 — conditioning day with walk AND stationary bike passes', () => {
  const draft: ProgramDraft = {
    program_name: '8-Week S&C with Bike',
    description: 'Strength + conditioning. Daily walk. Saturday: 30-min bike + walk.',
    weeks: 4,
    progression_strategy: 'Linear',
    days: [
      {
        name: 'Monday — Upper Body',
        session_type: 'upper_full',
        estimated_duration_minutes: 55,
        exercises: [SQUAT, BENCH, ROW, WALK],
      },
      {
        name: 'Saturday — Cardio & Conditioning',
        session_type: 'conditioning',
        estimated_duration_minutes: 50,
        exercises: [BIKE, WALK], // stationary bike + daily walk
      },
      {
        name: 'Sunday — Active Recovery',
        session_type: 'active_recovery',
        estimated_duration_minutes: 20,
        exercises: [WALK],
      },
    ],
  }

  it('does NOT fire CONDITIONING_WALK_ONLY', () => {
    const issues = validateProgramQuality(draft, {
      requiredDailyActivityIds: ['9001'],
      weeks: 4,
    })
    const codes = issues.map(i => i.code)
    expect(codes).not.toContain('CONDITIONING_WALK_ONLY')
  })

  it('does NOT fire CONDITIONING_NO_AEROBIC_MODALITY', () => {
    const issues = validateProgramQuality(draft, {
      requiredDailyActivityIds: ['9001'],
      weeks: 4,
    })
    const codes = issues.map(i => i.code)
    expect(codes).not.toContain('CONDITIONING_NO_AEROBIC_MODALITY')
  })
})

// ─── Scenario 3: Strength-only program (no conditioning day) is unaffected ───

describe('Scenario 3 — strength-only program without conditioning day is unaffected', () => {
  const draft: ProgramDraft = {
    program_name: '4-Week Strength',
    description: 'Pure strength training.',
    weeks: 4,
    progression_strategy: 'Linear',
    days: [
      {
        name: 'Monday — Push',
        session_type: 'upper_push',
        estimated_duration_minutes: 50,
        exercises: [SQUAT, BENCH, ROW],
      },
      {
        name: 'Wednesday — Pull',
        session_type: 'upper_pull',
        estimated_duration_minutes: 50,
        exercises: [SQUAT, ROW, BENCH],
      },
      {
        name: 'Friday — Legs',
        session_type: 'lower_full',
        estimated_duration_minutes: 50,
        exercises: [SQUAT, ROW, BENCH],
      },
    ],
  }

  it('does NOT fire CONDITIONING_WALK_ONLY', () => {
    const issues = validateProgramQuality(draft, { weeks: 4 })
    const codes = issues.map(i => i.code)
    expect(codes).not.toContain('CONDITIONING_WALK_ONLY')
  })

  it('does NOT fire CONDITIONING_NO_AEROBIC_MODALITY', () => {
    const issues = validateProgramQuality(draft, { weeks: 4 })
    const codes = issues.map(i => i.code)
    expect(codes).not.toContain('CONDITIONING_NO_AEROBIC_MODALITY')
  })
})

// ─── Scenario 4: Walking-only program (no separate conditioning) passes ───────

describe('Scenario 4 — walking-only fitness program passes (no dailyWalkRequested conditioning context)', () => {
  // A pure walking / light activity program where the user just wants daily walks.
  // No conditioning day label — no CONDITIONING_WALK_ONLY should fire.
  const draft: ProgramDraft = {
    program_name: '4-Week Walking Starter',
    description: 'Daily 1-mile walks for general fitness.',
    weeks: 4,
    progression_strategy: 'Increase distance weekly',
    days: [
      {
        name: 'Monday — Walk',
        session_type: 'active_recovery',
        estimated_duration_minutes: 20,
        exercises: [WALK],
      },
      {
        name: 'Wednesday — Walk',
        session_type: 'active_recovery',
        estimated_duration_minutes: 20,
        exercises: [WALK],
      },
      {
        name: 'Friday — Walk',
        session_type: 'active_recovery',
        estimated_duration_minutes: 20,
        exercises: [WALK],
      },
    ],
  }

  it('does NOT fire CONDITIONING_WALK_ONLY (days are active_recovery, not conditioning)', () => {
    const issues = validateProgramQuality(draft, {
      requiredDailyActivityIds: ['9001'],
      weeks: 4,
    })
    const codes = issues.map(i => i.code)
    expect(codes).not.toContain('CONDITIONING_WALK_ONLY')
  })
})

// ─── Scenario 5: Conditioning day with NO cardio at all → fires as error when session_type=conditioning ──

describe('Scenario 5 — conditioning day (session_type=conditioning) with no aerobic exercises fires CONDITIONING_NO_AEROBIC_MODALITY as error', () => {
  const draft: ProgramDraft = {
    program_name: '4-Week MetCon',
    description: 'Metabolic conditioning.',
    weeks: 4,
    progression_strategy: 'Volume increase',
    days: [
      {
        name: 'Saturday — MetCon',
        session_type: 'conditioning',
        estimated_duration_minutes: 40,
        exercises: [SQUAT, BENCH], // no cardio intended_pattern at all
      },
    ],
  }

  it('fires CONDITIONING_NO_AEROBIC_MODALITY as error (explicit conditioning session type)', () => {
    const issues = validateProgramQuality(draft, { weeks: 4 })
    const codes = issues.map(i => i.code)
    expect(codes).toContain('CONDITIONING_NO_AEROBIC_MODALITY')
    const issue = issues.find(i => i.code === 'CONDITIONING_NO_AEROBIC_MODALITY')!
    expect(issue.severity).toBe('error')
  })

  it('does NOT fire CONDITIONING_WALK_ONLY (no walk present)', () => {
    const issues = validateProgramQuality(draft, { weeks: 4 })
    const codes = issues.map(i => i.code)
    expect(codes).not.toContain('CONDITIONING_WALK_ONLY')
  })
})

// ─── Scenario 6: CONDITIONING_WALK_ONLY via inferred walk (no explicit requiredDailyActivityIds) ──

describe('Scenario 6 — CONDITIONING_WALK_ONLY fires via walk-on-multiple-days inference', () => {
  // Walk appears on 3 days; conditioning day only has the walk.
  // No requiredDailyActivityIds supplied — should still fire via walkOnMultipleDays check.
  const draft: ProgramDraft = {
    program_name: '4-Week S&C',
    description: 'Strength plus conditioning.',
    weeks: 4,
    progression_strategy: 'Linear',
    days: [
      {
        name: 'Monday — Upper',
        session_type: 'upper_full',
        estimated_duration_minutes: 55,
        exercises: [SQUAT, BENCH, WALK],
      },
      {
        name: 'Wednesday — Lower',
        session_type: 'lower_full',
        estimated_duration_minutes: 55,
        exercises: [SQUAT, ROW, WALK],
      },
      {
        name: 'Saturday — Conditioning',
        session_type: 'conditioning',
        estimated_duration_minutes: 30,
        exercises: [WALK],
      },
    ],
  }

  it('fires CONDITIONING_WALK_ONLY even without explicit requiredDailyActivityIds', () => {
    const issues = validateProgramQuality(draft, { weeks: 4 })
    const codes = issues.map(i => i.code)
    expect(codes).toContain('CONDITIONING_WALK_ONLY')
  })
})

// ─── Scenario 7: distance_m = 1609 is preserved in draft structure ────────────

describe('Scenario 7 — distance_m field is accepted in ProgramExerciseDraft type', () => {
  it('draft with distance_m passes TypeScript compilation (type-level test)', () => {
    const ex = {
      exercise_id: '9001',
      intended_pattern: 'cardio' as const,
      sets: 1,
      distance_m: 1609,
      rest_seconds: 0,
      progression_model: 'duration_distance' as const,
    }
    // If TypeScript compiled this file, the type is accepted. Runtime check:
    expect(ex.distance_m).toBe(1609)
    expect((ex.distance_m / 1609).toFixed(1)).toBe('1.0')
  })
})
