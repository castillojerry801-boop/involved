import { describe, it, expect } from 'vitest'
import { trainingContextToPrompt } from '../../lib/v/training-context'
import { contextToSystemSnippet } from '../../lib/ai/context'
import type { VTrainingContext } from '../../lib/v/training-context'
import type { CoachContext } from '../../lib/ai/context'
import { jsToWeekday, WEEKDAY_SHORT } from '../../lib/training/program-scheduling'

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
  it('omits history section when no days have food entries', () => {
    const ctx = makeCoachCtx({
      nutrition: {
        targetsSet: false,
        history: [
          { date: '2026-10-09', calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 },
          { date: '2026-10-10', calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 },
        ],
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).not.toContain('NUTRITION HISTORY')
  })

  it('renders history even with only 1 day of data', () => {
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
    expect(out).toContain('NUTRITION HISTORY')
    expect(out).toContain('1 of 7 days logged')
    expect(out).toContain('2026-10-10')
    expect(out).not.toContain('2026-10-09')
  })

  it('includes pre-computed average and day count', () => {
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
    expect(out).toContain('2 of 7 days logged')
    expect(out).toContain('Avg over 2 logged days: 1900 cal')
    expect(out).toContain('2026-10-08')
    expect(out).toContain('2026-10-10')
    expect(out).not.toContain('2026-10-09')
  })

  it('adds incomplete-log warning when fewer than 5 days have data', () => {
    const ctx = makeCoachCtx({
      nutrition: {
        targetsSet: false,
        history: [
          { date: '2026-10-10', calories: 2000, protein: 150, carbs: 200, fat: 70, meals: 3 },
        ],
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('Do NOT infer a calorie surplus or deficit from partial logs')
  })

  it('omits incomplete-log warning when 5+ days have data', () => {
    const history = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-10-0${i + 1}`,
      calories: 2000, protein: 150, carbs: 200, fat: 70, meals: 3,
    }))
    const ctx = makeCoachCtx({ nutrition: { targetsSet: false, history } })
    const out = contextToSystemSnippet(ctx)
    expect(out).not.toContain('Do NOT infer a calorie surplus or deficit')
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

// ─── Steps data days count ────────────────────────────────────────────────────

describe('contextToSystemSnippet — steps data days', () => {
  it('appends days-synced note when fewer than 7 days have data', () => {
    const ctx = makeCoachCtx({
      healthMetrics: { stepsAvg7d: 2537, stepsDataDays: 1 },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('1 of 7 days synced')
    expect(out).toContain('may not be representative')
  })

  it('omits the days note when all 7 days have data', () => {
    const ctx = makeCoachCtx({
      healthMetrics: { stepsAvg7d: 8000, stepsDataDays: 7 },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('7-day avg steps: 8,000')
    expect(out).not.toContain('days synced')
  })

  it('omits the days note when stepsDataDays is not set', () => {
    const ctx = makeCoachCtx({
      healthMetrics: { stepsAvg7d: 6000 },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('7-day avg steps: 6,000')
    expect(out).not.toContain('days synced')
  })
})

// ─── Zero-set workouts with actual data ───────────────────────────────────────

describe('trainingContextToPrompt — set data quality notes', () => {
  it('shows bodyweight/cardio note when sets present but no weight data', () => {
    const ctx = makeCtx({
      recentTraining: [{
        date: '2026-10-05',
        title: 'Full Body',
        musclesWorked: ['chest', 'back'],
        totalSets: 12,
        topSets: [],  // no weight data
      }],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('12 sets performed')
    expect(out).toContain('no barbell/dumbbell weight recorded')
  })

  it('does not show quality note when topSets are present', () => {
    const ctx = makeCtx({
      recentTraining: [{
        date: '2026-10-05',
        title: 'Push Day',
        musclesWorked: ['chest'],
        totalSets: 6,
        topSets: [{ exerciseName: 'Bench Press', exerciseId: '0026', maxWeightKg: 80, topReps: 8, setCount: 3 }],
      }],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).not.toContain('no barbell/dumbbell weight recorded')
    expect(out).toContain('Bench Press: 3 sets @ 80 kg × 8 reps')
  })

  it('shows zero-set line without bodyweight note when totalSets is 0', () => {
    const ctx = makeCtx({
      recentTraining: [{
        date: '2026-10-05',
        title: 'Push Day',
        musclesWorked: ['chest'],
        totalSets: 0,
        topSets: [],
      }],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('0 sets')
    expect(out).not.toContain('bodyweight or cardio')
  })

  it('adds per-set-tracking note when totalSets is 0 so V does not infer zero volume', () => {
    const ctx = makeCtx({
      recentTraining: [{
        date: '2026-10-05',
        title: 'Day 4 — Push',
        musclesWorked: ['chest', 'triceps'],
        totalSets: 0,
        topSets: [],
      }],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('no sets individually tracked in-app')
    expect(out).toContain('per-set logging was not used')
  })

  it('does NOT add per-set-tracking note when totalSets > 0 even with no weight data', () => {
    const ctx = makeCtx({
      recentTraining: [{
        date: '2026-10-05', title: 'Cardio', musclesWorked: [],
        totalSets: 8, topSets: [],
      }],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).not.toContain('per-set logging was not used')
    expect(out).toContain('no barbell/dumbbell weight recorded')
  })
})

// ─── Program-day fallback for planned workouts ────────────────────────────────

describe('trainingContextToPrompt — planned workouts program-day fallback', () => {
  it('renders weekday-derived schedule as PLANNED THIS WEEK when no source', () => {
    const ctx = makeCtx({
      plannedThisWeek: [
        { title: 'Upper A', scheduledDate: 'Mon', focus: 'Chest & Shoulders' },
        { title: 'Lower A', scheduledDate: 'Wed' },
        { title: 'Upper B', scheduledDate: 'Fri', focus: 'Back & Arms' },
      ],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('PLANNED THIS WEEK')
    expect(out).toContain('Mon: Upper A — Chest & Shoulders')
    expect(out).toContain('Wed: Lower A')
    expect(out).toContain('Fri: Upper B — Back & Arms')
  })

  it('uses PROGRAM SCHEDULE template header when source is program_template', () => {
    const ctx = makeCtx({
      plannedThisWeek: [
        { title: 'Upper A', scheduledDate: 'Mon', source: 'program_template' },
        { title: 'Lower A', scheduledDate: 'Wed', source: 'program_template' },
      ],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('PROGRAM SCHEDULE (template')
    expect(out).not.toContain('PLANNED THIS WEEK')
    expect(out).toContain('Mon: Upper A')
    expect(out).toContain('Wed: Lower A')
  })

  it('includes template NOTE so V knows sessions require user to start them', () => {
    const ctx = makeCtx({
      plannedThisWeek: [
        { title: 'Push Day', scheduledDate: 'Tue', source: 'program_template' },
      ],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('NOTE:')
    expect(out).toContain('confirmed when the user starts it')
  })

  it('uses PLANNED THIS WEEK header for source:scheduled items', () => {
    const ctx = makeCtx({
      plannedThisWeek: [
        { title: 'Push Day', scheduledDate: 'Mon', source: 'scheduled' },
      ],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('PLANNED THIS WEEK')
    expect(out).not.toContain('PROGRAM SCHEDULE')
  })
})

// ─── Fix 4: Midnight / zero-meals nutrition guard ─────────────────────────────

describe('contextToSystemSnippet — zero-meals midnight guard', () => {
  it('emits nothing-logged-yet when mealsLogged is 0 and targets are set', () => {
    const ctx = makeCoachCtx({
      nutrition: {
        targetsSet: true,
        targets: { calories: 2200, protein: 165, carbs: 220, fat: 73 },
        today: { calories: 0, protein: 0, carbs: 0, fat: 0, remaining: 2200, mealsLogged: 0, byMeal: {} },
        history: [],
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('nothing logged today yet')
    expect(out).not.toContain('Consumed:')
    expect(out).not.toContain('Remaining:')
    expect(out).not.toContain('0 cal')
  })

  it('still shows full NUTRITION TODAY table when mealsLogged > 0', () => {
    const ctx = makeCoachCtx({
      nutrition: {
        targetsSet: true,
        targets: { calories: 2200, protein: 165, carbs: 220, fat: 73 },
        today: {
          calories: 1400, protein: 110, carbs: 140, fat: 46,
          remaining: 800, mealsLogged: 2, byMeal: {},
        },
        history: [],
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('NUTRITION TODAY:')
    expect(out).toContain('Consumed:  1400 cal')
    expect(out).toContain('Meals logged: 2')
    expect(out).not.toContain('nothing logged today yet')
  })

  it('preserves targets line in history section even when today has 0 meals', () => {
    const ctx = makeCoachCtx({
      nutrition: {
        targetsSet: true,
        targets: { calories: 2200, protein: 165, carbs: 220, fat: 73 },
        today: { calories: 0, protein: 0, carbs: 0, fat: 0, remaining: 2200, mealsLogged: 0, byMeal: {} },
        history: [
          { date: '2026-10-10', calories: 2100, protein: 160, carbs: 210, fat: 70, meals: 4 },
          { date: '2026-10-09', calories: 1950, protein: 155, carbs: 195, fat: 65, meals: 3 },
        ],
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).toContain('NUTRITION HISTORY')
    expect(out).toContain('2026-10-10')
    expect(out).toContain('2026-10-09')
  })

  it('no-targets path: shows nothing when mealsLogged is 0', () => {
    // Existing behavior: when targetsSet=false and mealsLogged=0, no NUTRITION TODAY line
    const ctx = makeCoachCtx({
      nutrition: {
        targetsSet: false,
        today: { calories: 0, protein: 0, carbs: 0, fat: 0, mealsLogged: 0, byMeal: {} },
        history: [],
      },
    })
    const out = contextToSystemSnippet(ctx)
    expect(out).not.toContain('NUTRITION TODAY')
    expect(out).not.toContain('Consumed:')
  })
})

// ─── Fix 1: 7-day calendar step averaging (unit logic) ───────────────────────
// Exercises the window-boundary logic used by the health dashboard fix.
// The health page derives the last-7-dates set and filters dailySteps by it;
// these tests verify that approach produces the correct avg vs. the old slice(-7).

describe('7-day calendar step averaging', () => {
  function last7Dates(today: string): Set<string> {
    return new Set(Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() - (6 - i))
      return d.toISOString().slice(0, 10)
    }))
  }

  it('last7Dates spans exactly the 7 days ending on today', () => {
    const dates = last7Dates('2026-10-11')
    expect(dates.size).toBe(7)
    expect(dates.has('2026-10-05')).toBe(true)
    expect(dates.has('2026-10-11')).toBe(true)
    expect(dates.has('2026-10-04')).toBe(false) // day 8 — excluded
  })

  it('calendar filter excludes stale records older than 7 days while slice(-7) includes them', () => {
    // Scenario: 5 days of correct data (Oct 7–11) + 2 stale days from before the sync fix
    const dailySteps = [
      { date: '2026-10-03', steps: 2200 }, // stale — 8 days ago
      { date: '2026-10-04', steps: 2200 }, // stale — 7 days ago (just outside)
      { date: '2026-10-07', steps: 9000 },
      { date: '2026-10-08', steps: 9500 },
      { date: '2026-10-09', steps: 10000 },
      { date: '2026-10-10', steps: 11000 },
      { date: '2026-10-11', steps: 8000 },
    ]
    const today = '2026-10-11'

    // Old behavior: slice(-7) picks all 7 entries including the 2 stale ones
    const oldAvg = Math.round(dailySteps.slice(-7).reduce((s, d) => s + d.steps, 0) / 7)

    // New behavior: filter to last 7 calendar dates
    const dates = last7Dates(today)
    const filtered = dailySteps.filter(d => dates.has(d.date))
    const newAvg = Math.round(filtered.reduce((s, d) => s + d.steps, 0) / filtered.length)

    expect(filtered).not.toContainEqual(expect.objectContaining({ date: '2026-10-03' }))
    expect(filtered).not.toContainEqual(expect.objectContaining({ date: '2026-10-04' }))
    expect(filtered).toHaveLength(5)
    expect(oldAvg).toBeLessThan(newAvg) // stale data dragged old avg down
    expect(newAvg).toBe(9500) // (9000+9500+10000+11000+8000)/5
  })

  it('handles gaps correctly: denominator is days-with-data, not 7', () => {
    const dailySteps = [
      { date: '2026-10-05', steps: 8000 },
      // Oct 6–9: no data
      { date: '2026-10-10', steps: 12000 },
      { date: '2026-10-11', steps: 4000 },
    ]
    const dates = last7Dates('2026-10-11')
    const filtered = dailySteps.filter(d => dates.has(d.date))
    const avg = Math.round(filtered.reduce((s, d) => s + d.steps, 0) / filtered.length)
    expect(filtered).toHaveLength(3)
    expect(avg).toBe(8000) // (8000+12000+4000)/3, not /7
  })
})

// ─── Fix 3: Template day week-boundary (Sunday/Monday scheduling) ─────────────
// These tests verify the filtering logic that buildVTrainingContext uses to
// exclude ProgramDays already completed within the current Mon–Sun week.

describe('template day completed-this-week exclusion', () => {
  // Replicates the filtering logic from buildVTrainingContext
  function computeCompletedIds(
    workouts: Array<{ programDayId: string | null; completedAt: Date | null }>,
    weekStart: Date,
  ): Set<string> {
    return new Set<string>(
      workouts
        .filter(w => w.programDayId != null && w.completedAt != null && w.completedAt >= weekStart)
        .map(w => w.programDayId!)
    )
  }

  it('includes a day completed on Sunday within Mon–Sun week', () => {
    const weekStart = new Date('2026-10-05T00:00:00.000Z') // Mon Oct 5
    const workouts = [{ programDayId: 'day4-uuid', completedAt: new Date('2026-10-11T18:00:00.000Z') }]
    const ids = computeCompletedIds(workouts, weekStart)
    expect(ids.has('day4-uuid')).toBe(true)
  })

  it('excludes a day completed before this week (previous Mon–Sun)', () => {
    const weekStart = new Date('2026-10-12T00:00:00.000Z') // Mon Oct 12 (new week)
    const workouts = [{ programDayId: 'day4-uuid', completedAt: new Date('2026-10-11T18:00:00.000Z') }]
    const ids = computeCompletedIds(workouts, weekStart)
    expect(ids.has('day4-uuid')).toBe(false) // last week — not excluded from new week
  })

  it('excludes nulls — workout with no programDayId is ignored', () => {
    const weekStart = new Date('2026-10-05T00:00:00.000Z')
    const workouts = [{ programDayId: null, completedAt: new Date('2026-10-11T18:00:00.000Z') }]
    const ids = computeCompletedIds(workouts, weekStart)
    expect(ids.size).toBe(0)
  })

  it('multiple completions this week: all are excluded from template', () => {
    const weekStart = new Date('2026-10-05T00:00:00.000Z')
    const workouts = [
      { programDayId: 'day1-uuid', completedAt: new Date('2026-10-06T17:00:00.000Z') },
      { programDayId: 'day2-uuid', completedAt: new Date('2026-10-07T17:00:00.000Z') },
      { programDayId: 'day4-uuid', completedAt: new Date('2026-10-11T17:00:00.000Z') },
    ]
    const ids = computeCompletedIds(workouts, weekStart)
    expect(ids.size).toBe(3)
    expect(ids.has('day1-uuid')).toBe(true)
    expect(ids.has('day2-uuid')).toBe(true)
    expect(ids.has('day4-uuid')).toBe(true)
  })

  it('day completed exactly at weekStart boundary is included (>= not >)', () => {
    const weekStart = new Date('2026-10-05T00:00:00.000Z')
    const workouts = [{ programDayId: 'day1-uuid', completedAt: new Date('2026-10-05T00:00:00.000Z') }]
    const ids = computeCompletedIds(workouts, weekStart)
    expect(ids.has('day1-uuid')).toBe(true)
  })
})

// ─── Fix 6: Weekday convention — ProgramDay uses 0=Mon; JS Date.getDay() uses 0=Sun ──────────
// ProgramDay.weekday is stored with Monday=0…Sunday=6 (ISO/V convention).
// JavaScript Date.getDay() returns Sunday=0…Saturday=6.
// training-context.ts must convert with jsToWeekday before comparing or displaying.

describe('weekday convention — jsToWeekday and WEEKDAY_SHORT', () => {
  it('jsToWeekday converts all 7 JS days to Monday-first index', () => {
    expect(jsToWeekday(0)).toBe(6) // JS Sunday → Mon-first 6
    expect(jsToWeekday(1)).toBe(0) // JS Monday → Mon-first 0
    expect(jsToWeekday(2)).toBe(1) // JS Tuesday → Mon-first 1
    expect(jsToWeekday(3)).toBe(2) // JS Wednesday → Mon-first 2
    expect(jsToWeekday(4)).toBe(3) // JS Thursday → Mon-first 3
    expect(jsToWeekday(5)).toBe(4) // JS Friday → Mon-first 4
    expect(jsToWeekday(6)).toBe(5) // JS Saturday → Mon-first 5
  })

  it('WEEKDAY_SHORT[d.weekday] displays correct label for Mon-first ProgramDay weekday', () => {
    expect(WEEKDAY_SHORT[0]).toBe('Mon')
    expect(WEEKDAY_SHORT[1]).toBe('Tue')
    expect(WEEKDAY_SHORT[2]).toBe('Wed')
    expect(WEEKDAY_SHORT[3]).toBe('Thu')
    expect(WEEKDAY_SHORT[4]).toBe('Fri')
    expect(WEEKDAY_SHORT[5]).toBe('Sat')
    expect(WEEKDAY_SHORT[6]).toBe('Sun')
  })

  it('Monday workout (weekday=0) is included on Monday — old bug excluded it', () => {
    // With old bug: todayDow = getDay()=1 (JS Monday), d.weekday=0 → 0 >= 1 = false (excluded!)
    // With fix: todayDow = jsToWeekday(1)=0, d.weekday=0 → 0 >= 0 = true (included ✓)
    const jsTodayMonday = 1
    const todayDow = jsToWeekday(jsTodayMonday)
    const mondayWorkoutWeekday = 0 // ProgramDay.weekday=0 means Monday
    expect(mondayWorkoutWeekday >= todayDow).toBe(true)
  })

  it('Sunday workout (weekday=6) is included on Sunday', () => {
    // JS Sunday = getDay()=0 → jsToWeekday(0)=6; d.weekday=6 → 6 >= 6 = true ✓
    const jsTodaySunday = 0
    const todayDow = jsToWeekday(jsTodaySunday)
    const sundayWorkoutWeekday = 6
    expect(sundayWorkoutWeekday >= todayDow).toBe(true)
  })

  it('past days in week are excluded from upcoming filter', () => {
    // Wednesday (JS=3, Mon-first=2): Mon(0) and Tue(1) workouts should be excluded
    const jsTodayWednesday = 3
    const todayDow = jsToWeekday(jsTodayWednesday) // 2
    expect(0 >= todayDow).toBe(false) // Monday — past
    expect(1 >= todayDow).toBe(false) // Tuesday — past
    expect(2 >= todayDow).toBe(true)  // Wednesday — today, included
    expect(3 >= todayDow).toBe(true)  // Thursday — upcoming
    expect(6 >= todayDow).toBe(true)  // Sunday — upcoming
  })

  it('Sunday→Monday boundary: Sunday workout label is Sun not Sat (old display bug)', () => {
    // Old bug: DAY_ABBR=['Sun','Mon',...,'Sat'], d.weekday=6(Sun) → DAY_ABBR[6]='Sat' (WRONG)
    // Fix: WEEKDAY_SHORT=['Mon','Tue',...,'Sun'], d.weekday=6(Sun) → WEEKDAY_SHORT[6]='Sun' (✓)
    expect(WEEKDAY_SHORT[6]).toBe('Sun')
    expect(WEEKDAY_SHORT[5]).toBe('Sat')
  })

  it('plannedThisWeek renders Mon-first day labels correctly', () => {
    const ctx = makeCtx({
      plannedThisWeek: [
        { title: 'Push Day', scheduledDate: 'Mon', source: 'program_template' },
        { title: 'Pull Day', scheduledDate: 'Sun', source: 'program_template' },
      ],
    })
    const out = trainingContextToPrompt(ctx)
    expect(out).toContain('Mon: Push Day')
    expect(out).toContain('Sun: Pull Day')
    expect(out).not.toContain('Sun: Push Day') // old bug: weekday=0 showed as 'Sun'
    expect(out).not.toContain('Sat: Pull Day') // old bug: weekday=6 showed as 'Sat'
  })
})
