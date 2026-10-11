import { describe, it, expect } from 'vitest'
import { trainingContextToPrompt } from '../../lib/v/training-context'
import { contextToSystemSnippet } from '../../lib/ai/context'
import type { VTrainingContext } from '../../lib/v/training-context'
import type { CoachContext } from '../../lib/ai/context'

// ─── Minimal valid VTrainingContext fixture ───────────────────────────────────

function makeCtx(overrides: Partial<VTrainingContext> = {}): VTrainingContext {
  return {
    profile: {
      fitnessLevel: 'intermediate',
      goals: [{ type: 'body_composition', title: 'Lose fat and build muscle' }],
      bodyMetrics: { ageYears: 28, weightKg: 80 },
      weeklyWorkoutTarget: 4,
    },
    equipment: { profileName: 'Full Gym', items: ['barbell', 'dumbbell', 'cable'] },
    preferences: { favorites: [], moreOften: [], lessOften: [], dontRecommend: [] },
    personalRecords: [],
    recentTraining: [],
    readinessState: 'consistent_intermediate',
    coachingPresence: 'weekly_checkin',
    ...overrides,
  }
}

// ─── plannedThisWeek renders correctly ───────────────────────────────────────

describe('trainingContextToPrompt — plannedThisWeek', () => {
  it('omits the section when plannedThisWeek is absent', () => {
    const out = trainingContextToPrompt(makeCtx())
    expect(out).not.toContain('PLANNED THIS WEEK')
  })

  it('omits the section when plannedThisWeek is empty', () => {
    const out = trainingContextToPrompt(makeCtx({ plannedThisWeek: [] }))
    expect(out).not.toContain('PLANNED THIS WEEK')
  })

  it('renders planned workouts with day and title', () => {
    const ctx = makeCtx({
      plannedThisWeek: [
        { title: 'Upper A', scheduledDate: 'Mon' },
        { title: 'Lower B', scheduledDate: 'Wed', focus: 'Quads & Hamstrings' },
      ],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('PLANNED THIS WEEK')
    expect(out).toContain('Mon: Upper A')
    expect(out).toContain('Wed: Lower B — Quads & Hamstrings')
  })

  it('renders focus when present', () => {
    const ctx = makeCtx({
      plannedThisWeek: [{ title: 'Pull Day', scheduledDate: 'Fri', focus: 'Back & Biceps' }],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('Fri: Pull Day — Back & Biceps')
  })

  it('omits focus dash when focus is absent', () => {
    const ctx = makeCtx({
      plannedThisWeek: [{ title: 'Push Day', scheduledDate: 'Tue' }],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('Tue: Push Day')
    expect(out).not.toContain('Tue: Push Day —')
  })
})

// ─── contextToSystemSnippet — nutrition sections ─────────────────────────────

function makeCoachCtx(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    user: { name: 'Athlete', tier: 'plus' },
    goals: [],
    nutrition: {
      targetsSet: false,
      history: [],
    },
    healthMetrics: {},
    trainingSnippet: 'TRAINING: No data available.',
    trainingCtx: null,
    ...overrides,
  }
}

describe('contextToSystemSnippet — nutrition history', () => {
  it('omits history section when fewer than 2 days have data', () => {
    const ctx = makeCoachCtx({
      nutrition: {
        targetsSet: false,
        history: [
          { date: '2026-10-09', calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 },
          { date: '2026-10-10', calories: 2000, protein: 150, carbs: 200, fat: 70, meals: 4 },
        ],
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).not.toContain('NUTRITION HISTORY')
  })

  it('renders history when 2+ days have data', () => {
    const ctx = makeCoachCtx({
      nutrition: {
        targetsSet: false,
        history: [
          { date: '2026-10-08', calories: 1800, protein: 140, carbs: 180, fat: 60, meals: 3 },
          { date: '2026-10-09', calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 },
          { date: '2026-10-10', calories: 2000, protein: 150, carbs: 200, fat: 70, meals: 4 },
        ],
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('NUTRITION HISTORY')
    expect(out).toContain('2026-10-08')
    expect(out).toContain('2026-10-10')
    expect(out).not.toContain('2026-10-09') // zero-meal days not rendered
  })
})

describe('contextToSystemSnippet — health metrics', () => {
  it('renders steps and sleep when present', () => {
    const ctx = makeCoachCtx({
      healthMetrics: {
        stepsToday: 8432,
        stepsAvg7d: 7200,
        sleepLastNightHours: 7.5,
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('HEALTH METRICS')
    expect(out).toContain('Steps today: 8,432')
    expect(out).toContain('7-day avg steps: 7,200')
    expect(out).toContain('Sleep last night: 7.5h')
  })

  it('renders body weight in lb and kg', () => {
    const ctx = makeCoachCtx({
      healthMetrics: { bodyWeightKg: 80, bodyWeightDate: '2026-10-09' },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('176 lb')
    expect(out).toContain('80 kg')
  })

  it('includes energy balance warning when health metrics present', () => {
    const ctx = makeCoachCtx({
      healthMetrics: { stepsToday: 5000 },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('resting expenditure')
  })

  it('omits health metrics section when empty', () => {
    const ctx = makeCoachCtx({ healthMetrics: {} })
    const out = contextToSystemSnippet(ctx)
    expect(out).not.toContain('HEALTH METRICS')
  })
})

describe('contextToSystemSnippet — nutrition today with meal breakdown', () => {
  it('renders by-meal breakdown when present', () => {
    const ctx = makeCoachCtx({
      nutrition: {
        targetsSet: true,
        targets: { calories: 2200, protein: 165, carbs: 220, fat: 73 },
        today: {
          calories: 1400,
          protein: 110,
          carbs: 140,
          fat: 46,
          remaining: 800,
          mealsLogged: 2,
          byMeal: {
            breakfast: { calories: 600, protein: 40, carbs: 60, fat: 20, count: 2 },
            lunch:     { calories: 800, protein: 70, carbs: 80, fat: 26, count: 3 },
          },
        },
        history: [],
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('By meal:')
    expect(out).toContain('breakfast:')
    expect(out).toContain('lunch:')
  })
})
