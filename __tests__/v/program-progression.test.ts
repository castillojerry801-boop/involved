import { describe, it, expect } from 'vitest'
import {
  getWeekPrescription,
  getDeloadWeeks,
  dayHasProgressionForWeek,
  formatPrescription,
  type ProgramExerciseBase,
  type WeekPrescription,
} from '../../lib/v/program-progression'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEx(overrides: Partial<ProgramExerciseBase> = {}): ProgramExerciseBase {
  return {
    sets: 3,
    reps_min: 8,
    reps_max: 10,
    duration_seconds: null,
    distance_m: null,
    notes: null,
    week_progressions: [],
    ...overrides,
  }
}

// ─── getWeekPrescription ──────────────────────────────────────────────────────

describe('getWeekPrescription', () => {
  it('returns base values when no week_progressions present', () => {
    const ex = makeEx({ sets: 4, reps_min: 6, reps_max: 8 })
    const rx = getWeekPrescription(ex, 1)
    expect(rx.sets).toBe(4)
    expect(rx.reps_min).toBe(6)
    expect(rx.reps_max).toBe(8)
    expect(rx.hasSpecificEntry).toBe(false)
    expect(rx.deload).toBe(false)
    expect(rx.taper).toBe(false)
  })

  it('returns base values when week has no matching entry', () => {
    const ex = makeEx({
      sets: 3,
      reps_min: 10,
      reps_max: 12,
      week_progressions: [{ week: 1, sets: 3, reps_min: 10, reps_max: 12 }],
    })
    const rx = getWeekPrescription(ex, 5)
    expect(rx.sets).toBe(3)
    expect(rx.reps_min).toBe(10)
    expect(rx.reps_max).toBe(12)
    expect(rx.hasSpecificEntry).toBe(false)
  })

  it('overrides sets from week_progressions entry', () => {
    const ex = makeEx({
      sets: 3,
      reps_min: 8,
      reps_max: 10,
      week_progressions: [
        { week: 1, sets: 3, reps_min: 8, reps_max: 10 },
        { week: 4, sets: 4, reps_min: 10, reps_max: 12 },
      ],
    })
    const rx = getWeekPrescription(ex, 4)
    expect(rx.sets).toBe(4)
    expect(rx.reps_min).toBe(10)
    expect(rx.reps_max).toBe(12)
    expect(rx.hasSpecificEntry).toBe(true)
  })

  it('marks deload week correctly', () => {
    const ex = makeEx({
      sets: 3,
      reps_min: 10,
      reps_max: 12,
      week_progressions: [
        { week: 8, sets: 2, reps_min: 10, reps_max: 12, deload: true },
      ],
    })
    const rx = getWeekPrescription(ex, 8)
    expect(rx.deload).toBe(true)
    expect(rx.taper).toBe(false)
  })

  it('marks taper week correctly', () => {
    const ex = makeEx({
      sets: 3,
      reps_min: 10,
      reps_max: 12,
      week_progressions: [
        { week: 7, sets: 3, reps_min: 10, reps_max: 12, taper: true },
      ],
    })
    const rx = getWeekPrescription(ex, 7)
    expect(rx.taper).toBe(true)
    expect(rx.deload).toBe(false)
  })

  it('carries load_note from week entry', () => {
    const ex = makeEx({
      week_progressions: [
        { week: 3, sets: 3, reps_min: 8, reps_max: 10, load_note: 'Increase weight by 5 lb' },
      ],
    })
    const rx = getWeekPrescription(ex, 3)
    expect(rx.load_note).toBe('Increase weight by 5 lb')
  })

  it('falls back to base notes when no load_note in entry', () => {
    const ex = makeEx({
      notes: 'Focus on form',
      week_progressions: [{ week: 2, sets: 3 }],
    })
    const rx = getWeekPrescription(ex, 2)
    expect(rx.load_note).toBe('Focus on form')
  })

  it('handles distance_m from week entry (Saturday cardio)', () => {
    const ex = makeEx({
      sets: 1,
      reps_min: null,
      reps_max: null,
      distance_m: 1609,
      week_progressions: [
        { week: 1, sets: 1, distance_m: 1609 },
        { week: 4, sets: 1, distance_m: 3218 },
        { week: 8, sets: 1, distance_m: 4827, deload: false },
      ],
    })
    expect(getWeekPrescription(ex, 1).distance_m).toBe(1609)
    expect(getWeekPrescription(ex, 4).distance_m).toBe(3218)
    expect(getWeekPrescription(ex, 8).distance_m).toBe(4827)
  })

  it('week_progressions=[undefined] does not crash (empty array)', () => {
    const ex = makeEx({ week_progressions: undefined })
    const rx = getWeekPrescription(ex, 3)
    expect(rx.hasSpecificEntry).toBe(false)
  })
})

// ─── getDeloadWeeks ───────────────────────────────────────────────────────────

describe('getDeloadWeeks', () => {
  it('returns empty set when no deload weeks exist', () => {
    const days = [
      {
        exercises: [
          makeEx({
            week_progressions: [
              { week: 1, sets: 3 },
              { week: 2, sets: 4 },
            ],
          }),
        ],
      },
    ]
    expect(getDeloadWeeks(days).size).toBe(0)
  })

  it('collects deload weeks from any exercise on any day', () => {
    const days = [
      {
        exercises: [
          makeEx({
            week_progressions: [
              { week: 1, sets: 3 },
              { week: 8, sets: 2, deload: true },
            ],
          }),
        ],
      },
      {
        exercises: [
          makeEx({
            week_progressions: [
              { week: 4, sets: 3, deload: true },
              { week: 8, sets: 2, deload: true },
            ],
          }),
        ],
      },
    ]
    const result = getDeloadWeeks(days)
    expect(result.has(4)).toBe(true)
    expect(result.has(8)).toBe(true)
    expect(result.has(1)).toBe(false)
  })

  it('handles days with no exercises', () => {
    const days = [{ exercises: [] }]
    expect(getDeloadWeeks(days).size).toBe(0)
  })

  it('handles exercises with no week_progressions', () => {
    const days = [{ exercises: [makeEx({ week_progressions: undefined })] }]
    expect(getDeloadWeeks(days).size).toBe(0)
  })

  it('deduplicates the same deload week across multiple exercises', () => {
    const days = [
      {
        exercises: [
          makeEx({ week_progressions: [{ week: 8, deload: true }] }),
          makeEx({ week_progressions: [{ week: 8, deload: true }] }),
        ],
      },
    ]
    const result = getDeloadWeeks(days)
    expect(result.size).toBe(1)
    expect(result.has(8)).toBe(true)
  })
})

// ─── dayHasProgressionForWeek ─────────────────────────────────────────────────

describe('dayHasProgressionForWeek', () => {
  it('returns false when no exercises have week_progressions', () => {
    const day = { exercises: [makeEx({ week_progressions: [] })] }
    expect(dayHasProgressionForWeek(day, 1)).toBe(false)
  })

  it('returns false when day has no exercises', () => {
    const day = { exercises: [] }
    expect(dayHasProgressionForWeek(day, 1)).toBe(false)
  })

  it('returns true when at least one exercise has an entry for the week', () => {
    const day = {
      exercises: [
        makeEx({ week_progressions: [{ week: 1, sets: 3 }, { week: 2, sets: 3 }] }),
        makeEx({ week_progressions: [{ week: 1, sets: 4 }] }),
      ],
    }
    expect(dayHasProgressionForWeek(day, 1)).toBe(true)
    expect(dayHasProgressionForWeek(day, 2)).toBe(true)
  })

  it('returns false when exercises have progressions but not for the queried week', () => {
    const day = {
      exercises: [
        makeEx({ week_progressions: [{ week: 1, sets: 3 }, { week: 2, sets: 4 }] }),
      ],
    }
    expect(dayHasProgressionForWeek(day, 5)).toBe(false)
  })
})

// ─── formatPrescription ───────────────────────────────────────────────────────

describe('formatPrescription', () => {
  const baseRx = (): WeekPrescription => ({
    sets: 3,
    hasSpecificEntry: false,
    deload: false,
    taper: false,
  })

  it('formats sets × reps range', () => {
    const rx = { ...baseRx(), reps_min: 8, reps_max: 10 }
    expect(formatPrescription(rx)).toBe('3 sets × 8–10 reps')
  })

  it('formats sets × single rep count when min=max', () => {
    const rx = { ...baseRx(), reps_min: 5, reps_max: 5 }
    expect(formatPrescription(rx)).toBe('3 sets × 5 reps')
  })

  it('formats "1 set" (singular) correctly', () => {
    const rx = { ...baseRx(), sets: 1, reps_min: 10, reps_max: 10 }
    expect(formatPrescription(rx)).toBe('1 set × 10 reps')
  })

  it('formats distance in miles (Saturday cardio)', () => {
    const rx = { ...baseRx(), sets: 1, distance_m: 1609.344 }
    expect(formatPrescription(rx)).toBe('1 set × 1.0 mi')
  })

  it('formats distance for 2-mile run', () => {
    const rx = { ...baseRx(), sets: 1, distance_m: 3218.688 }
    const result = formatPrescription(rx)
    expect(result).toBe('1 set × 2.0 mi')
  })

  it('falls back to duration in minutes when no reps or distance', () => {
    const rx = baseRx()
    expect(formatPrescription(rx, 1800)).toBe('3 sets × 30 min')
  })

  it('falls back to — when no reps, distance, or duration', () => {
    const rx = baseRx()
    expect(formatPrescription(rx)).toBe('3 sets × —')
  })

  it('prefers reps over duration when both are present', () => {
    const rx = { ...baseRx(), reps_min: 12, reps_max: 15 }
    expect(formatPrescription(rx, 60)).toBe('3 sets × 12–15 reps')
  })

  it('prefers distance over duration when both are present', () => {
    const rx = { ...baseRx(), sets: 1, distance_m: 1609.344 }
    expect(formatPrescription(rx, 600)).toBe('1 set × 1.0 mi')
  })
})

// ─── Integration: switching days ─────────────────────────────────────────────

describe('day switching', () => {
  const mondayExercises: ProgramExerciseBase[] = [
    makeEx({ sets: 4, reps_min: 6, reps_max: 8, week_progressions: [{ week: 1, sets: 4 }, { week: 2, sets: 5 }] }),
    makeEx({ sets: 3, reps_min: 10, reps_max: 12, week_progressions: [{ week: 1, sets: 3 }] }),
  ]
  const tuesdayExercises: ProgramExerciseBase[] = [
    makeEx({ sets: 3, reps_min: 15, reps_max: 15, week_progressions: [{ week: 1, sets: 3 }, { week: 3, sets: 4 }] }),
  ]
  const saturdayExercises: ProgramExerciseBase[] = [
    makeEx({ sets: 1, reps_min: null, reps_max: null, distance_m: 1609, week_progressions: [{ week: 1, distance_m: 1609 }, { week: 4, distance_m: 3218 }] }),
  ]

  const days = [
    { exercises: mondayExercises },
    { exercises: tuesdayExercises },
    { exercises: [] },
    { exercises: saturdayExercises },
  ]

  it('Monday Week 1 — first exercise returns sets=4', () => {
    expect(getWeekPrescription(days[0].exercises[0], 1).sets).toBe(4)
  })

  it('Monday Week 2 — first exercise returns sets=5', () => {
    expect(getWeekPrescription(days[0].exercises[0], 2).sets).toBe(5)
  })

  it('Tuesday Week 1 — exercise returns 15 reps', () => {
    const rx = getWeekPrescription(days[1].exercises[0], 1)
    expect(formatPrescription(rx)).toBe('3 sets × 15 reps')
  })

  it('Tuesday Week 3 — exercise returns sets=4', () => {
    expect(getWeekPrescription(days[1].exercises[0], 3).sets).toBe(4)
  })

  it('Rest day (index 2) — exercises array is empty', () => {
    expect(days[2].exercises.length).toBe(0)
  })

  it('Saturday Week 1 — cardio distance is 1609 m (1.0 mi)', () => {
    const rx = getWeekPrescription(days[3].exercises[0], 1)
    expect(formatPrescription(rx)).toBe('1 set × 1.0 mi')
  })

  it('Saturday Week 4 — cardio distance progressed to 3218 m (2.0 mi)', () => {
    const rx = getWeekPrescription(days[3].exercises[0], 4)
    expect(formatPrescription(rx)).toBe('1 set × 2.0 mi')
  })
})

// ─── Integration: 8-week deload detection ────────────────────────────────────

describe('8-week program with deload on week 8', () => {
  const days = [
    {
      exercises: [
        makeEx({
          sets: 4,
          reps_min: 6,
          reps_max: 8,
          week_progressions: [
            { week: 1, sets: 4, reps_min: 6, reps_max: 8 },
            { week: 2, sets: 4, reps_min: 7, reps_max: 9 },
            { week: 3, sets: 4, reps_min: 8, reps_max: 10 },
            { week: 4, sets: 5, reps_min: 6, reps_max: 8 },
            { week: 5, sets: 5, reps_min: 7, reps_max: 9 },
            { week: 6, sets: 5, reps_min: 8, reps_max: 10 },
            { week: 7, sets: 5, reps_min: 8, reps_max: 10, taper: true },
            { week: 8, sets: 3, reps_min: 6, reps_max: 8, deload: true },
          ],
        }),
      ],
    },
  ]

  it('deload weeks set contains week 8', () => {
    const dw = getDeloadWeeks(days)
    expect(dw.has(8)).toBe(true)
    expect(dw.has(7)).toBe(false)
  })

  it('week 8 prescription has deload=true', () => {
    expect(getWeekPrescription(days[0].exercises[0], 8).deload).toBe(true)
  })

  it('week 7 prescription has taper=true, deload=false', () => {
    const rx = getWeekPrescription(days[0].exercises[0], 7)
    expect(rx.taper).toBe(true)
    expect(rx.deload).toBe(false)
  })

  it('week 4 progression shows sets=5', () => {
    expect(getWeekPrescription(days[0].exercises[0], 4).sets).toBe(5)
  })

  it('dayHasProgressionForWeek returns true for all weeks 1–8', () => {
    for (let w = 1; w <= 8; w++) {
      expect(dayHasProgressionForWeek(days[0], w)).toBe(true)
    }
  })
})
