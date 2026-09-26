/**
 * V2 Coaching Intelligence — deterministic logic tests
 *
 * Covers:
 *   - deriveReadinessState() — all 6 readiness states
 *   - assessIntakeGaps() — gap detection, sport-specific gaps
 *   - buildAdaptationPrompt() — content coverage for all 9 triggers
 *   - buildWeeklyReview() — adherence, progression, RPE flag, needsAdaptation
 */

import { describe, it, expect } from 'vitest'

import { deriveReadinessState } from '../../lib/v/training-context'
import type { VTrainingContext } from '../../lib/v/training-context'

import { assessIntakeGaps } from '../../lib/v/intake'
import { buildAdaptationPrompt } from '../../lib/v/adaptation'
import type { AdaptationTrigger } from '../../lib/v/adaptation'
import { buildWeeklyReview } from '../../lib/v/weekly-review'
import type { CompletedWorkoutSummary } from '../../lib/v/weekly-review'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const noRecentTraining: VTrainingContext['recentTraining'] = []
const noRecords: VTrainingContext['personalRecords'] = []

function recentSession(daysBack: number): VTrainingContext['recentTraining'][0] {
  return { date: daysAgo(daysBack), title: 'Test', musclesWorked: ['chest'], totalSets: 12, topSets: [] }
}

function makePr(name = 'Barbell Squat'): VTrainingContext['personalRecords'][0] {
  return { exerciseName: name, exerciseId: 'squat-01', metric: 'estimated_1rm', value: 300, unit: 'lb', achievedAt: '2024-01-01' }
}

function makeCtx(overrides: Partial<VTrainingContext> = {}): VTrainingContext {
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

// ─── deriveReadinessState ────────────────────────────────────────────────────

describe('deriveReadinessState', () => {
  it('returns never_trained with no data', () => {
    expect(deriveReadinessState(null, noRecentTraining, noRecords)).toBe('never_trained')
  })

  it('returns never_trained when fitnessLevel is null and no history', () => {
    expect(deriveReadinessState(null, [], [])).toBe('never_trained')
  })

  it('returns new_beginner: beginner level + recent training', () => {
    const recent = [recentSession(7), recentSession(14)]
    expect(deriveReadinessState('beginner', recent, noRecords)).toBe('new_beginner')
  })

  it('returns new_beginner for novice level with recent sessions', () => {
    const recent = [recentSession(5)]
    expect(deriveReadinessState('novice', recent, noRecords)).toBe('new_beginner')
  })

  it('returns detrained: has PRs but no training in 4+ months', () => {
    const staleSession = [recentSession(140)]
    expect(deriveReadinessState('intermediate', staleSession, [makePr()])).toBe('detrained')
  })

  it('returns detrained: advanced with PRs but inactive for 4 months', () => {
    const staleSession = [recentSession(130)]
    expect(deriveReadinessState('advanced', staleSession, [makePr()])).toBe('detrained')
  })

  it('returns detrained: has PRs and no session history at all', () => {
    expect(deriveReadinessState(null, [], [makePr()])).toBe('detrained')
  })

  it('returns recreationally_active: intermediate but inconsistent (1 session/4 weeks)', () => {
    const sparse = [recentSession(20)]
    expect(deriveReadinessState('intermediate', sparse, noRecords)).toBe('recreationally_active')
  })

  it('returns consistent_intermediate: intermediate + 3+ sessions in 4 weeks', () => {
    const dense = [recentSession(5), recentSession(10), recentSession(18)]
    expect(deriveReadinessState('intermediate', dense, noRecords)).toBe('consistent_intermediate')
  })

  it('returns advanced: advanced + recent active training', () => {
    const active = [recentSession(3), recentSession(8), recentSession(13)]
    expect(deriveReadinessState('advanced', active, [makePr()])).toBe('advanced')
  })

  it('returns advanced for expert level with recent training', () => {
    const active = [recentSession(2)]
    expect(deriveReadinessState('expert', active, noRecords)).toBe('advanced')
  })
})

// ─── assessIntakeGaps ────────────────────────────────────────────────────────

describe('assessIntakeGaps', () => {
  it('returns no high-value gaps when context is complete', () => {
    const ctx = makeCtx({
      profile: { fitnessLevel: 'intermediate', goals: [], bodyMetrics: { ageYears: 30, weightKg: 80 }, weeklyWorkoutTarget: 4 },
      equipment: { profileName: 'Gym', items: ['barbell', 'dumbbell'] },
      readinessState: 'consistent_intermediate',
    })
    const result = assessIntakeGaps(ctx, { days: 4, weeks: 8 })
    expect(result.hasEnough).toBe(true)
    expect(result.missingHighValue).toHaveLength(0)
  })

  it('flags readiness question when readinessState is null', () => {
    const ctx = makeCtx({ readinessState: null })
    const result = assessIntakeGaps(ctx, {})
    expect(result.missingHighValue).toContainEqual(expect.stringMatching(/training consistently/i))
  })

  it('flags equipment question when equipment is null and no home cue', () => {
    const ctx = makeCtx({ equipment: null, readinessState: 'consistent_intermediate' })
    const result = assessIntakeGaps(ctx, { days: 3 })
    expect(result.missingHighValue).toContainEqual(expect.stringMatching(/gym|home/i))
  })

  it('does NOT flag equipment when focus mentions home', () => {
    const ctx = makeCtx({ equipment: null, readinessState: 'consistent_intermediate' })
    const result = assessIntakeGaps(ctx, { days: 3, focus: 'home workout' })
    expect(result.missingHighValue).not.toContainEqual(expect.stringMatching(/gym|home/i))
  })

  it('flags days question when days and weeklyWorkoutTarget are both missing', () => {
    const ctx = makeCtx({ readinessState: 'consistent_intermediate' })
    const result = assessIntakeGaps(ctx, { weeks: 4 })
    expect(result.missingHighValue).toContainEqual(expect.stringMatching(/days per week/i))
  })

  it('does NOT flag days question when days is provided in request', () => {
    const ctx = makeCtx({ readinessState: 'consistent_intermediate' })
    const result = assessIntakeGaps(ctx, { days: 4, weeks: 4 })
    const daysQ = result.missingHighValue.filter(q => /days per week/i.test(q))
    expect(daysQ).toHaveLength(0)
  })

  it('flags fitness level for long programs (≥8 weeks) without fitnessLevel', () => {
    const ctx = makeCtx({
      profile: { fitnessLevel: null, goals: [], bodyMetrics: { ageYears: null, weightKg: null }, weeklyWorkoutTarget: 4 },
      equipment: { profileName: 'Gym', items: ['barbell'] },
      readinessState: 'consistent_intermediate',
    })
    const result = assessIntakeGaps(ctx, { days: 4, weeks: 8 })
    expect(result.missingHighValue).toContainEqual(expect.stringMatching(/fitness level/i))
  })

  it('flags running mileage for running sport without running signal', () => {
    const ctx = makeCtx({ readinessState: 'recreationally_active', equipment: { profileName: 'Shoes', items: ['body weight'] } })
    const result = assessIntakeGaps(ctx, { days: 4, sport: 'running' })
    expect(result.missingHighValue).toContainEqual(expect.stringMatching(/running|mileage/i))
  })

  it('flags running mileage for marathon sport', () => {
    const ctx = makeCtx({ readinessState: 'consistent_intermediate' })
    const result = assessIntakeGaps(ctx, { days: 4, sport: 'marathon' })
    expect(result.missingHighValue).toContainEqual(expect.stringMatching(/running|mileage/i))
  })

  it('does NOT flag running mileage when running goal exists', () => {
    const ctx = makeCtx({
      readinessState: 'consistent_intermediate',
      profile: {
        fitnessLevel: 'intermediate', goals: [{ type: 'sport', title: 'Run 5k' }],
        bodyMetrics: { ageYears: null, weightKg: null }, weeklyWorkoutTarget: 4,
      },
    })
    const result = assessIntakeGaps(ctx, { days: 4, sport: 'running' })
    const runQ = result.missingHighValue.filter(q => /running|mileage/i.test(q))
    expect(runQ).toHaveLength(0)
  })

  it('flags squat/bench/deadlift question for powerlifting sport without PRs', () => {
    const ctx = makeCtx({ readinessState: 'consistent_intermediate', equipment: { profileName: 'Gym', items: ['barbell'] } })
    const result = assessIntakeGaps(ctx, { days: 4, sport: 'powerlifting' })
    expect(result.missingHighValue).toContainEqual(expect.stringMatching(/squat|bench|deadlift|maxes/i))
  })

  it('does NOT flag powerlifting maxes when PRs already exist', () => {
    const ctx = makeCtx({
      readinessState: 'consistent_intermediate',
      personalRecords: [makePr('Barbell Squat')],
      equipment: { profileName: 'Gym', items: ['barbell'] },
    })
    const result = assessIntakeGaps(ctx, { days: 4, sport: 'powerlifting' })
    const maxQ = result.missingHighValue.filter(q => /maxes|squat/i.test(q))
    expect(maxQ).toHaveLength(0)
  })

  it('returns optional questions in every case', () => {
    const ctx = makeCtx()
    const result = assessIntakeGaps(ctx, {})
    expect(result.optional.length).toBeGreaterThan(0)
  })
})

// ─── buildAdaptationPrompt ───────────────────────────────────────────────────

const ALL_TRIGGERS: AdaptationTrigger[] = [
  'missed_workout', 'missed_week', 'too_easy', 'too_hard',
  'exercise_pain', 'time_constraint', 'equipment_unavailable',
  'return_from_illness', 'exceeded_rpe',
]

describe('buildAdaptationPrompt', () => {
  it.each(ALL_TRIGGERS)('generates non-empty output for trigger: %s', (trigger) => {
    const result = buildAdaptationPrompt({ trigger })
    expect(result.length).toBeGreaterThan(50)
    expect(result).toContain('ADAPTATION:')
  })

  it('includes user detail when provided', () => {
    const result = buildAdaptationPrompt({ trigger: 'too_hard', detail: 'Really struggled with the squats' })
    expect(result).toContain('Really struggled with the squats')
  })

  it('includes affected day when provided', () => {
    const result = buildAdaptationPrompt({ trigger: 'exercise_pain', affectedDay: 'Push Day' })
    expect(result).toContain('Push Day')
  })

  it('includes affected exercise when provided', () => {
    const result = buildAdaptationPrompt({ trigger: 'exercise_pain', affectedExercise: 'Barbell Bench Press' })
    expect(result).toContain('Barbell Bench Press')
  })

  it('includes program position when week info is provided', () => {
    const result = buildAdaptationPrompt({ trigger: 'missed_week', programWeek: 5, totalWeeks: 12 })
    expect(result).toContain('Week 5 of 12')
  })

  it('missed_workout: mentions NOT doubling up', () => {
    const result = buildAdaptationPrompt({ trigger: 'missed_workout' })
    expect(result).toMatch(/double up|NOT double/i)
  })

  it('too_easy: advises small adjustments without restructuring', () => {
    const result = buildAdaptationPrompt({ trigger: 'too_easy' })
    expect(result).toMatch(/restructure/i)
  })

  it('exercise_pain: advises NOT pushing through', () => {
    const result = buildAdaptationPrompt({ trigger: 'exercise_pain' })
    expect(result).toMatch(/pain|consult/i)
  })

  it('time_constraint: advises keeping compound work', () => {
    const result = buildAdaptationPrompt({ trigger: 'time_constraint' })
    expect(result).toMatch(/compound|accessory/i)
  })

  it('ended with minimum-change instruction', () => {
    const result = buildAdaptationPrompt({ trigger: 'missed_week' })
    expect(result).toContain('minimum necessary change')
  })
})

// ─── buildWeeklyReview ───────────────────────────────────────────────────────

function makeWorkout(daysBack: number, completed = true, sets: CompletedWorkoutSummary['sets'] = []): CompletedWorkoutSummary {
  return { date: daysAgo(daysBack), dayName: 'Push Day', completed, sets }
}

describe('buildWeeklyReview', () => {
  it('computes 100% adherence for a fully completed week', () => {
    const workouts = [makeWorkout(1), makeWorkout(3), makeWorkout(5)]
    const review = buildWeeklyReview(workouts, 3, 2, 'Test Program')
    expect(review.adherencePercent).toBe(100)
    expect(review.workoutsCompleted).toBe(3)
  })

  it('computes partial adherence correctly', () => {
    const workouts = [makeWorkout(1), makeWorkout(3), makeWorkout(5, false)]
    const review = buildWeeklyReview(workouts, 3, 1, 'Test Program')
    expect(review.workoutsCompleted).toBe(2)
    expect(review.adherencePercent).toBe(67)
  })

  it('sets needsAdaptation true when adherence < 60%', () => {
    const workouts = [makeWorkout(1, true), makeWorkout(3, false), makeWorkout(5, false)]
    const review = buildWeeklyReview(workouts, 3, 1, 'Test Program')
    expect(review.needsAdaptation).toBe(true)
    expect(review.adaptationReason).toMatch(/adherence|completed/i)
  })

  it('detects progression successes when actual > prescribed weight', () => {
    const sets: CompletedWorkoutSummary['sets'] = [{
      exerciseName: 'Barbell Squat',
      prescribedWeightKg: 100,
      actualWeightKg: 105,
      prescribedReps: 5,
      actualReps: 5,
    }]
    const workouts = [makeWorkout(2, true, sets)]
    const review = buildWeeklyReview(workouts, 1, 1, 'Strength Block')
    expect(review.progressionSuccesses).toHaveLength(1)
    expect(review.progressionSuccesses[0].exerciseName).toBe('Barbell Squat')
  })

  it('does NOT flag progression when actual weight matches prescribed', () => {
    const sets: CompletedWorkoutSummary['sets'] = [{
      exerciseName: 'Bench Press',
      prescribedWeightKg: 80,
      actualWeightKg: 80,
    }]
    const workouts = [makeWorkout(2, true, sets)]
    const review = buildWeeklyReview(workouts, 1, 1, 'Test')
    expect(review.progressionSuccesses).toHaveLength(0)
  })

  it('sets rpeFlag when actual RPE exceeds target by 1.5+', () => {
    const sets: CompletedWorkoutSummary['sets'] = [{
      exerciseName: 'Deadlift',
      rpe: 9.5,
      targetRpe: 7,
    }]
    const workouts = [makeWorkout(1, true, sets)]
    const review = buildWeeklyReview(workouts, 1, 1, 'Test')
    expect(review.rpeFlag).toBe(true)
    expect(review.needsAdaptation).toBe(true)
    expect(review.adaptationReason).toMatch(/rpe|fatigue/i)
  })

  it('does NOT set rpeFlag when RPE is within range', () => {
    const sets: CompletedWorkoutSummary['sets'] = [{
      exerciseName: 'Squat',
      rpe: 8,
      targetRpe: 7,
    }]
    const workouts = [makeWorkout(1, true, sets)]
    const review = buildWeeklyReview(workouts, 1, 1, 'Test')
    expect(review.rpeFlag).toBe(false)
  })

  it('returns zero adherence and needsAdaptation for zero sessions completed', () => {
    const workouts = [makeWorkout(1, false), makeWorkout(3, false)]
    const review = buildWeeklyReview(workouts, 3, 1, 'Test')
    expect(review.adherencePercent).toBe(0)
    expect(review.needsAdaptation).toBe(true)
  })

  it('returns no adaptation needed for perfect week', () => {
    const workouts = [makeWorkout(1), makeWorkout(4), makeWorkout(6)]
    const review = buildWeeklyReview(workouts, 3, 3, 'Test')
    expect(review.needsAdaptation).toBe(false)
    expect(review.adaptationReason).toBeUndefined()
  })

  it('always returns coachingSummary as undefined (no AI call)', () => {
    const review = buildWeeklyReview([], 0, 1, 'Test')
    expect(review.coachingSummary).toBeUndefined()
  })

  it('counts missedSessions correctly', () => {
    const workouts = [makeWorkout(1, true), makeWorkout(3, false)]
    const review = buildWeeklyReview(workouts, 2, 1, 'Test')
    expect(review.missedSessions).toBe(1)
  })
})
