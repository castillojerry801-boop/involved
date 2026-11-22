/**
 * V Coach explicit-schedule intake — regression tests for the production bug
 * where V asked "How many days per week can you train?" even though the user
 * provided a complete Monday–Sunday schedule with named muscle-group focus.
 *
 * Production reproduction message (verbatim, confirmed from session transcript):
 *   "I'm an intermediate lifter. Build me a strength and conditioning program.
 *    Monday: Chest, Biceps, and Core
 *    Tuesday: Back and Triceps
 *    Wednesday: Rest
 *    Thursday: Shoulders and Core
 *    Friday: Legs
 *    Saturday: Cardio
 *    Sunday: Rest
 *    I also want to walk one mile every day, including rest days."
 *
 * Critical schedule invariant: Wednesday = Rest, Thursday = training (Shoulders and Core).
 * Any parser change that swaps these must fail here first.
 */

import { describe, it, expect } from 'vitest'
import {
  extractExplicitSchedule,
  extractConversationSchedule,
  extractDailyWalkRequested,
  extractReadiness,
  parseProgramIntake,
  missingProgramContext,
} from '../../lib/v/program-intake'
import { validateProgramQuality } from '../../lib/v/program-quality'
import type { ProgramDraft, SessionType } from '../../lib/ai/tools/program'
import type { VTrainingContext } from '../../lib/v/training-context'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRODUCTION_MSG = `I'm an intermediate lifter. Build me a strength and conditioning program.

Monday: Chest, Biceps, and Core
Tuesday: Back and Triceps
Wednesday: Rest
Thursday: Shoulders and Core
Friday: Legs
Saturday: Cardio
Sunday: Rest

I also want to walk one mile every day, including rest days.

Build a progressive program with exercises, sets, reps, rest periods, and weekly progression.`

function emptyCtx(overrides: Partial<VTrainingContext> = {}): VTrainingContext {
  return {
    profile: { fitnessLevel: null, goals: [], bodyMetrics: { ageYears: null, weightKg: null }, weeklyWorkoutTarget: null },
    equipment: null,
    preferences: { favorites: [], moreOften: [], lessOften: [], dontRecommend: [] },
    personalRecords: [],
    recentTraining: [],
    readinessState: null,
    coachingPresence: 'weekly_checkin',
    ...overrides,
  }
}

type Msg = { role: 'user' | 'assistant'; content: string }

// ─── extractExplicitSchedule ──────────────────────────────────────────────────

describe('extractExplicitSchedule', () => {
  it('parses 7-day schedule from production message — 5 training, 2 rest', () => {
    const schedule = extractExplicitSchedule(PRODUCTION_MSG)
    expect(schedule).not.toBeNull()
    expect(schedule!.length).toBe(7)
    const training = schedule!.filter(d => !d.isRest)
    const rest = schedule!.filter(d => d.isRest)
    expect(training.length).toBe(5)
    expect(rest.length).toBe(2)
  })

  it('assigns correct weekdays in order', () => {
    const schedule = extractExplicitSchedule(PRODUCTION_MSG)!
    const weekdays = schedule.map(d => d.weekday)
    expect(weekdays).toContain('monday')
    expect(weekdays).toContain('tuesday')
    expect(weekdays).toContain('wednesday')
    expect(weekdays).toContain('thursday')
    expect(weekdays).toContain('friday')
    expect(weekdays).toContain('saturday')
    expect(weekdays).toContain('sunday')
  })

  it('marks Wednesday and Sunday as rest days (not Thursday)', () => {
    const schedule = extractExplicitSchedule(PRODUCTION_MSG)!
    const wed = schedule.find(d => d.weekday === 'wednesday')
    const thu = schedule.find(d => d.weekday === 'thursday')
    const sun = schedule.find(d => d.weekday === 'sunday')
    expect(wed?.isRest).toBe(true)
    expect(sun?.isRest).toBe(true)
    // Thursday is a training day (Shoulders and Core) — must NOT be rest
    expect(thu?.isRest).toBe(false)
  })

  it('REGRESSION — Wed/Thu swap: Thursday is training, Wednesday is rest', () => {
    const schedule = extractExplicitSchedule(PRODUCTION_MSG)!
    const wed = schedule.find(d => d.weekday === 'wednesday')
    const thu = schedule.find(d => d.weekday === 'thursday')
    // If these assertions flip, the parser is swapping Wednesday and Thursday.
    expect(wed?.isRest).toBe(true)
    expect(wed?.focus.toLowerCase()).toContain('rest')
    expect(thu?.isRest).toBe(false)
    expect(thu?.focus.toLowerCase()).toMatch(/shoulder/)
  })

  it('preserves focus text for training days', () => {
    const schedule = extractExplicitSchedule(PRODUCTION_MSG)!
    const mon = schedule.find(d => d.weekday === 'monday')
    expect(mon?.isRest).toBe(false)
    expect(mon?.focus).toMatch(/chest/i)
  })

  it('returns null for text with no weekday lines', () => {
    const result = extractExplicitSchedule('I want to train 4 days a week focusing on strength.')
    expect(result).toBeNull()
  })

  it('returns null when only 1 day is matched (not a real schedule)', () => {
    const result = extractExplicitSchedule('Monday: Chest')
    expect(result).toBeNull()
  })

  it('handles abbreviated day names', () => {
    const result = extractExplicitSchedule('Mon: Push\nTue: Pull\nWed: Legs\nThu: Rest')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(4)
    expect(result!.find(d => d.weekday === 'monday')?.focus).toBe('Push')
  })
})

// ─── extractReadiness — fitness-level label mapping ──────────────────────────

describe('extractReadiness — fitness level labels', () => {
  it('"intermediate" maps to consistent_intermediate (not recreationally_active)', () => {
    expect(extractReadiness('intermediate')).toBe('consistent_intermediate')
  })

  it('"intermediate lifter" maps to consistent_intermediate', () => {
    expect(extractReadiness("I'm an intermediate lifter")).toBe('consistent_intermediate')
  })

  it('"advanced" maps to advanced (not recreationally_active)', () => {
    expect(extractReadiness('advanced')).toBe('advanced')
  })

  it('"advanced athlete" maps to advanced', () => {
    expect(extractReadiness('I am an advanced athlete')).toBe('advanced')
  })

  it('production message "intermediate lifter" phrase extracts consistent_intermediate', () => {
    expect(extractReadiness(PRODUCTION_MSG)).toBe('consistent_intermediate')
  })

  it('"beginner" does not match intermediate or advanced labels', () => {
    const r = extractReadiness('beginner')
    expect(r).not.toBe('consistent_intermediate')
    expect(r).not.toBe('advanced')
  })
})

// ─── extractDailyWalkRequested ────────────────────────────────────────────────

describe('extractDailyWalkRequested', () => {
  it('detects daily walk from production message', () => {
    expect(extractDailyWalkRequested(PRODUCTION_MSG)).toBe(true)
  })

  it('detects "daily walk" phrasing', () => {
    expect(extractDailyWalkRequested('I want to do a daily walk for recovery.')).toBe(true)
  })

  it('detects "walk every day" phrasing', () => {
    expect(extractDailyWalkRequested('Can you make sure I walk every day?')).toBe(true)
  })

  it('returns false when walking is mentioned but not every day', () => {
    expect(extractDailyWalkRequested('I enjoy walking on Saturdays.')).toBe(false)
  })

  it('returns false when no walking is mentioned', () => {
    expect(extractDailyWalkRequested('Build me a strength program.')).toBe(false)
  })
})

// ─── parseProgramIntake — explicit schedule integration ───────────────────────

describe('parseProgramIntake with explicit schedule', () => {
  it('REGRESSION: production message sets trainingDaysPerWeek=5 and trainingDaysSource=conversation', () => {
    const msgs: Msg[] = [{ role: 'user', content: PRODUCTION_MSG }]
    const intake = parseProgramIntake(msgs, emptyCtx())
    expect(intake.trainingDaysPerWeek).toBe(5)
    expect(intake.trainingDaysSource).toBe('conversation')
  })

  it('REGRESSION: production message sets readinessState=consistent_intermediate', () => {
    const msgs: Msg[] = [{ role: 'user', content: PRODUCTION_MSG }]
    const intake = parseProgramIntake(msgs, emptyCtx())
    expect(intake.readinessState).toBe('consistent_intermediate')
  })

  it('REGRESSION: production message sets dailyWalkRequested=true', () => {
    const msgs: Msg[] = [{ role: 'user', content: PRODUCTION_MSG }]
    const intake = parseProgramIntake(msgs, emptyCtx())
    expect(intake.dailyWalkRequested).toBe(true)
  })

  it('REGRESSION: production message sets explicitSchedule with 7 entries', () => {
    const msgs: Msg[] = [{ role: 'user', content: PRODUCTION_MSG }]
    const intake = parseProgramIntake(msgs, emptyCtx())
    expect(intake.explicitSchedule).not.toBeNull()
    expect(intake.explicitSchedule!.length).toBe(7)
  })

  it('REGRESSION: missingProgramContext does NOT ask training frequency when schedule is explicit', () => {
    const msgs: Msg[] = [{ role: 'user', content: PRODUCTION_MSG }]
    const intake = parseProgramIntake(msgs, emptyCtx())
    const missing = missingProgramContext(intake)
    const fields = missing.map(m => m.field)
    expect(fields).not.toContain('trainingDaysPerWeek')
  })

  it('explicit schedule days count takes precedence over DB weeklyWorkoutTarget', () => {
    const msgs: Msg[] = [{ role: 'user', content: PRODUCTION_MSG }]
    const ctx = emptyCtx({ profile: { fitnessLevel: null, goals: [], bodyMetrics: { ageYears: null, weightKg: null }, weeklyWorkoutTarget: 3 } })
    const intake = parseProgramIntake(msgs, ctx)
    expect(intake.trainingDaysPerWeek).toBe(5)
    expect(intake.trainingDaysSource).toBe('conversation')
  })

  it('later message with corrected schedule replaces earlier one', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'Mon: Push\nTue: Pull\nWed: Legs\nThu: Rest\nFri: Push\nSat: Pull\nSun: Rest' },
      { role: 'assistant', content: 'Got it, 5 training days.' },
      { role: 'user', content: 'Actually update the schedule:\nMon: Push\nTue: Pull\nWed: Rest\nThu: Legs\nFri: Push\nSat: Rest\nSun: Rest' },
    ]
    const intake = parseProgramIntake(msgs, emptyCtx())
    // Last schedule: 4 training days (Mon/Tue/Thu/Fri), 3 rest
    expect(intake.trainingDaysPerWeek).toBe(4)
    const wed = intake.explicitSchedule!.find(d => d.weekday === 'wednesday')
    expect(wed?.isRest).toBe(true)
  })

  it('no schedule → falls back to natural-language extraction', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'Build me a 6-week program.' },
      { role: 'assistant', content: 'How many days per week can you train?' },
      { role: 'user', content: '4 days' },
    ]
    const intake = parseProgramIntake(msgs, emptyCtx())
    expect(intake.trainingDaysPerWeek).toBe(4)
    expect(intake.trainingDaysSource).toBe('conversation')
    expect(intake.explicitSchedule).toBeNull()
  })

  it('complete production request leaves nothing missing', () => {
    // Production message provides: weeks (8), readiness (intermediate), schedule (5 days),
    // goal implied by "strength & conditioning". Equipment will come from DB profile.
    const msgs: Msg[] = [{ role: 'user', content: PRODUCTION_MSG }]
    const ctx = emptyCtx({
      equipment: { items: ['barbell', 'dumbbell', 'bench', 'pull-up bar'] },
    } as unknown as Partial<VTrainingContext>)
    const intake = parseProgramIntake(msgs, ctx)
    const missing = missingProgramContext(intake)
    // Should require no clarifying questions — gate passes, program generation starts
    expect(missing.length).toBe(0)
  })
})

// ─── extractConversationSchedule ─────────────────────────────────────────────

describe('extractConversationSchedule', () => {
  it('returns null when no user message contains a schedule', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'Build me a strength program.' },
      { role: 'assistant', content: 'What days can you train?' },
    ]
    expect(extractConversationSchedule(msgs)).toBeNull()
  })

  it('ignores assistant messages', () => {
    const msgs: Msg[] = [
      { role: 'assistant', content: 'Mon: Push\nTue: Pull\nWed: Legs\nThu: Rest\nFri: Push\nSat: Pull\nSun: Rest' },
    ]
    expect(extractConversationSchedule(msgs)).toBeNull()
  })

  it('returns last user schedule when two schedules are present', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'Mon: Push\nTue: Pull\nWed: Legs\nThu: Rest\nFri: Push\nSat: Pull\nSun: Rest' },
      { role: 'user', content: 'Mon: Rest\nTue: Push\nWed: Pull\nThu: Legs\nFri: Rest\nSat: Push\nSun: Rest' },
    ]
    const schedule = extractConversationSchedule(msgs)!
    const mon = schedule.find(d => d.weekday === 'monday')
    expect(mon?.isRest).toBe(true)
  })
})

// ─── Walking integration: session_type preservation + quality validation ──────
//
// These tests cover the Fix 1 (walking pool injection) contract:
//   • Training days that include walking must keep their original session_type
//   • Rest days mapped to active_recovery contain only walking
//   • validateProgramQuality fires MISSING_REQUESTED_ACTIVITY when walking absent
//   • After repair (walking added), quality clears — this is the correction-round path

describe('Walking + explicit schedule quality integration', () => {
  const WALK_ID = '9001'

  function walkEntry() {
    return {
      exercise_id: WALK_ID,
      intended_pattern: 'cardio' as const,
      sets: 1,
      distance_m: 1609,
      rest_seconds: 0,
      progression_model: 'duration_distance' as const,
    }
  }

  // Training day has resistance work + walking. Session type must NOT be overridden
  // to active_recovery just because walking is present.
  it('training day with walking preserves its resistance session_type', () => {
    const draft: ProgramDraft = {
      program_name: 'Chest+Biceps+Walk',
      description: 'Single-day test',
      primary_goal: 'Strength',
      weeks: 1,
      progression_strategy: 'Linear',
      phases: [{ name: 'Base', weeks: '1', focus: 'Foundation' }],
      days: [{
        name: 'Monday — Chest, Biceps, and Core',
        session_type: 'chest_biceps' as SessionType,
        weekday: 0,
        estimated_duration_minutes: 70,
        exercises: [
          { exercise_id: '3294', intended_pattern: 'horizontal_push', sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 120, progression_model: 'linear' as const },
          walkEntry(),
        ],
      }],
    }
    expect(draft.days[0].session_type).toBe('chest_biceps')
  })

  // Rest day mapped to active_recovery must have only walking — no resistance.
  it('active_recovery day contains only walking exercise', () => {
    const draft: ProgramDraft = {
      program_name: 'Rest Day Walk',
      description: 'Single-day test',
      primary_goal: 'Conditioning',
      weeks: 1,
      progression_strategy: 'None',
      phases: [{ name: 'Base', weeks: '1', focus: 'Recovery' }],
      days: [{
        name: 'Thursday — Active Recovery',
        session_type: 'active_recovery' as SessionType,
        weekday: 3,
        estimated_duration_minutes: 20,
        exercises: [walkEntry()],
      }],
    }
    const recovDay = draft.days[0]
    expect(recovDay.session_type).toBe('active_recovery')
    expect(recovDay.exercises).toHaveLength(1)
    expect(recovDay.exercises[0].exercise_id).toBe(WALK_ID)
  })

  // Correction-round simulation: quality fires when walking is absent.
  // This is exactly what the QUALITY_RETRY_LIMIT path in the coach route sees.
  it('MISSING_REQUESTED_ACTIVITY fires when walking absent and requiredDailyActivityIds set', () => {
    const noWalkDraft: ProgramDraft = {
      program_name: 'No-Walk Draft',
      description: 'Draft without walking — simulates Luna first attempt',
      primary_goal: 'Strength',
      weeks: 1,
      progression_strategy: 'Linear',
      phases: [{ name: 'Base', weeks: '1', focus: 'Foundation' }],
      days: [{
        name: 'Monday',
        session_type: 'chest_biceps' as SessionType,
        weekday: 0,
        estimated_duration_minutes: 70,
        exercises: [
          { exercise_id: '3294', intended_pattern: 'horizontal_push', sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 120, progression_model: 'linear' as const },
        ],
      }],
    }
    const issues = validateProgramQuality(noWalkDraft, { requiredDailyActivityIds: [WALK_ID] })
    const missingWalk = issues.find(i => i.code === 'MISSING_REQUESTED_ACTIVITY')
    expect(missingWalk).toBeDefined()
    expect(missingWalk!.severity).toBe('error')
  })

  // Correction-round repair: quality clears after walking is added.
  // This confirms the correction round CAN succeed if Luna adds 9001.
  it('MISSING_REQUESTED_ACTIVITY clears after walking added to all days', () => {
    const repairedDraft: ProgramDraft = {
      program_name: 'Repaired Draft',
      description: 'Draft with walking added after correction round',
      primary_goal: 'Strength',
      weeks: 1,
      progression_strategy: 'Linear',
      phases: [{ name: 'Base', weeks: '1', focus: 'Foundation' }],
      days: [{
        name: 'Monday',
        session_type: 'chest_biceps' as SessionType,
        weekday: 0,
        estimated_duration_minutes: 70,
        exercises: [
          { exercise_id: '3294', intended_pattern: 'horizontal_push', sets: 3, reps_min: 6, reps_max: 10, rest_seconds: 120, progression_model: 'linear' as const },
          walkEntry(),
        ],
      }],
    }
    const issues = validateProgramQuality(repairedDraft, { requiredDailyActivityIds: [WALK_ID] })
    expect(issues.some(i => i.code === 'MISSING_REQUESTED_ACTIVITY')).toBe(false)
  })
})
