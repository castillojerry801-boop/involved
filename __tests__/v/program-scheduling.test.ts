/**
 * V Program Engine — weekday scheduling tests
 *
 * Verifies that weekday assignments on ProgramDayDraft are validated,
 * persisted through validateProgramDraft, and compatible with the
 * resolveScheduledDay utility from lib/training/program-scheduling.
 *
 * Scenarios:
 *   1 — Explicit schedule: Mon/Tue/Thu/Sat (weekday 0/1/3/5)
 *   2 — Rest day: no day has weekday=2 (Wednesday)
 *   3 — Duplicate weekday → rejected
 *   4 — Modification: move Legs from Friday(4) to Thursday(3)
 *   5 — Unscheduled program: resolveScheduledDay returns null for all weekdays
 *   6 — Save compatibility: resolved day matches expected
 *   7 — Spartan/hybrid: 4-day program with weekdays distributed Mon/Tue/Thu/Sat
 */

import { describe, it, expect } from 'vitest'
import { validateProgramDraft } from '../../lib/ai/tools/program'
import type { ProgramDraft, ProgramDayDraft } from '../../lib/ai/tools/program'
import { resolveScheduledDay } from '../../lib/training/program-scheduling'
import type { SchedulableProgramDay } from '../../lib/training/program-scheduling'

// ─── Shared exercise stubs (IDs verified from exercises.json) ─────────────────
//   0662  push-up           → horizontal_push
//   0652  pull-up           → vertical_pull
//   0025  barbell bench     → horizontal_push
//   0027  barbell bent row  → horizontal_pull
//   0032  barbell deadlift  → hinge
//   1760  goblet squat      → squat
//   3470  forward lunge     → lunge
//   0031  barbell curl      → bicep
//   2330  cable lat pull    → vertical_pull
//   0464  front plank twist → core_antiextension

function makeDay(
  name: string,
  weekday: number | undefined,
  overrides?: Partial<ProgramDayDraft>,
): ProgramDayDraft {
  return {
    name,
    weekday,
    estimated_duration_minutes: 45,
    exercises: [
      {
        exercise_id: '0662',
        intended_pattern: 'horizontal_push',
        sets: 3,
        reps_min: 8,
        reps_max: 12,
        rest_seconds: 60,
      },
    ],
    ...overrides,
  }
}

// ─── Scenario 1 — Explicit schedule Mon/Tue/Thu/Sat ──────────────────────────

describe('Scenario 1 — Explicit weekday schedule Mon/Tue/Thu/Sat', () => {
  const draft: ProgramDraft = {
    program_name: '4-Day Push/Pull/Legs/Full',
    days: [
      makeDay('Push Day',  0),  // Monday
      makeDay('Pull Day',  1),  // Tuesday
      makeDay('Legs Day',  3),  // Thursday
      makeDay('Full Body', 5),  // Saturday
    ],
  }

  it('validates successfully', () => {
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('preserves weekday values through validation', () => {
    const result = validateProgramDraft(draft)
    const days = result.program!.days
    expect(days[0].weekday).toBe(0)  // Monday
    expect(days[1].weekday).toBe(1)  // Tuesday
    expect(days[2].weekday).toBe(3)  // Thursday
    expect(days[3].weekday).toBe(5)  // Saturday
  })

  it('has no Wednesday assignment (rest day gap)', () => {
    const result = validateProgramDraft(draft)
    const weekdays = result.program!.days.map(d => d.weekday)
    expect(weekdays).not.toContain(2)
  })
})

// ─── Scenario 2 — Rest day: no day scheduled on Wednesday ────────────────────

describe('Scenario 2 — Rest day (Wednesday=2 is absent)', () => {
  const draft: ProgramDraft = {
    program_name: '3-Day with Wednesday Rest',
    days: [
      makeDay('Upper', 0),  // Monday
      makeDay('Lower', 1),  // Tuesday
      // Wednesday = rest (no day)
      makeDay('Full Body', 3),  // Thursday
    ],
  }

  it('validates successfully', () => {
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(true)
  })

  it('no day has weekday=2 (Wednesday)', () => {
    const result = validateProgramDraft(draft)
    const weekdays = result.program!.days.map(d => d.weekday)
    expect(weekdays.includes(2)).toBe(false)
  })

  it('resolveScheduledDay returns null for Wednesday', () => {
    const schedulableDays: SchedulableProgramDay[] = [
      { id: '1', name: 'Upper',     weekday: 0, exerciseCount: 4 },
      { id: '2', name: 'Lower',     weekday: 1, exerciseCount: 4 },
      { id: '3', name: 'Full Body', weekday: 3, exerciseCount: 5 },
    ]
    expect(resolveScheduledDay(schedulableDays, 2)).toBeNull()
  })
})

// ─── Scenario 3 — Duplicate weekday is rejected ──────────────────────────────

describe('Scenario 3 — Duplicate weekday assignment is rejected', () => {
  it('rejects two days both scheduled on Tuesday (weekday=1)', () => {
    const draft: ProgramDraft = {
      program_name: 'Bad Schedule',
      days: [
        makeDay('Day A', 1),  // Tuesday
        makeDay('Day B', 1),  // Tuesday — duplicate!
      ],
    }
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.toLowerCase().includes('duplicate') || e.toLowerCase().includes('tuesday'))).toBe(true)
  })

  it('rejects out-of-range weekday (7)', () => {
    const draft: ProgramDraft = {
      program_name: 'Bad Weekday',
      days: [makeDay('Day A', 7)],
    }
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('weekday'))).toBe(true)
  })

  it('rejects negative weekday (-1)', () => {
    const draft: ProgramDraft = {
      program_name: 'Bad Weekday Neg',
      days: [makeDay('Day A', -1)],
    }
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(false)
  })
})

// ─── Scenario 4 — Modification: move Legs from Friday to Thursday ─────────────

describe('Scenario 4 — Move Legs from Friday(4) to Thursday(3)', () => {
  const original: ProgramDraft = {
    program_name: 'PPL',
    days: [
      makeDay('Push',  0),  // Monday
      makeDay('Pull',  1),  // Tuesday
      makeDay('Legs',  4),  // Friday
    ],
  }

  const modified: ProgramDraft = {
    ...original,
    days: [
      makeDay('Push',  0),  // Monday — unchanged
      makeDay('Pull',  1),  // Tuesday — unchanged
      makeDay('Legs',  3),  // Thursday — moved from Friday
    ],
  }

  it('original program has Legs on Friday (4)', () => {
    const result = validateProgramDraft(original)
    expect(result.valid).toBe(true)
    expect(result.program!.days[2].weekday).toBe(4)
  })

  it('modified program has Legs on Thursday (3) and Push/Pull unchanged', () => {
    const result = validateProgramDraft(modified)
    expect(result.valid).toBe(true)
    const days = result.program!.days
    expect(days[0].weekday).toBe(0)  // Push unchanged
    expect(days[1].weekday).toBe(1)  // Pull unchanged
    expect(days[2].weekday).toBe(3)  // Legs moved to Thursday
  })

  it('modified program has no Friday assignment', () => {
    const result = validateProgramDraft(modified)
    const weekdays = result.program!.days.map(d => d.weekday)
    expect(weekdays).not.toContain(4)
  })
})

// ─── Scenario 5 — Unscheduled program: resolveScheduledDay returns null ───────

describe('Scenario 5 — Unscheduled program (no weekday preference)', () => {
  const draft: ProgramDraft = {
    program_name: 'Unscheduled PPL',
    days: [
      makeDay('Push', undefined),
      makeDay('Pull', undefined),
      makeDay('Legs', undefined),
    ],
  }

  it('validates successfully with no weekday fields', () => {
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(true)
  })

  it('weekday is absent on all validated days', () => {
    const result = validateProgramDraft(draft)
    for (const day of result.program!.days) {
      expect(day.weekday).toBeUndefined()
    }
  })

  it('resolveScheduledDay returns null for every weekday', () => {
    const schedulableDays: SchedulableProgramDay[] = [
      { id: '1', name: 'Push', weekday: null, exerciseCount: 5 },
      { id: '2', name: 'Pull', weekday: null, exerciseCount: 5 },
      { id: '3', name: 'Legs', weekday: null, exerciseCount: 6 },
    ]
    for (let wd = 0; wd <= 6; wd++) {
      expect(resolveScheduledDay(schedulableDays, wd as 0|1|2|3|4|5|6)).toBeNull()
    }
  })
})

// ─── Scenario 6 — Save compatibility: weekday persists → resolveScheduledDay ─

describe('Scenario 6 — Save compatibility: generated weekday resolves correctly', () => {
  const draft: ProgramDraft = {
    program_name: 'Mon/Wed/Fri Full Body',
    days: [
      makeDay('Full Body A', 0),  // Monday
      makeDay('Full Body B', 2),  // Wednesday
      makeDay('Full Body C', 4),  // Friday
    ],
  }

  it('validates and produces correct weekday values', () => {
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(true)
    expect(result.program!.days[0].weekday).toBe(0)
    expect(result.program!.days[1].weekday).toBe(2)
    expect(result.program!.days[2].weekday).toBe(4)
  })

  it('resolveScheduledDay finds Wednesday workout', () => {
    const schedulableDays: SchedulableProgramDay[] = [
      { id: 'a', name: 'Full Body A', weekday: 0, exerciseCount: 5 },
      { id: 'b', name: 'Full Body B', weekday: 2, exerciseCount: 5 },
      { id: 'c', name: 'Full Body C', weekday: 4, exerciseCount: 5 },
    ]
    const result = resolveScheduledDay(schedulableDays, 2)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Full Body B')
    expect(result!.id).toBe('b')
  })

  it('resolveScheduledDay returns null for Tuesday (no training day)', () => {
    const schedulableDays: SchedulableProgramDay[] = [
      { id: 'a', name: 'Full Body A', weekday: 0, exerciseCount: 5 },
      { id: 'b', name: 'Full Body B', weekday: 2, exerciseCount: 5 },
      { id: 'c', name: 'Full Body C', weekday: 4, exerciseCount: 5 },
    ]
    expect(resolveScheduledDay(schedulableDays, 1)).toBeNull()
  })
})

// ─── Scenario 7 — Spartan/hybrid: 4-day strength + conditioning ───────────────

describe('Scenario 7 — Spartan/hybrid 4-day program Mon/Tue/Thu/Sat', () => {
  const hybridDraft: ProgramDraft = {
    program_name: 'Spartan Race Prep — 4 Day',
    description: 'Strength + conditioning hybrid for obstacle race prep.',
    primary_goal: 'Athletic performance',
    weeks: 8,
    days: [
      {
        name: 'Strength A',
        focus: 'Lower body compound + posterior chain',
        weekday: 0,  // Monday
        estimated_duration_minutes: 60,
        exercises: [
          { exercise_id: '1760', intended_pattern: 'squat',          sets: 4, reps_min: 5, reps_max: 8,  rest_seconds: 180 },
          { exercise_id: '0032', intended_pattern: 'hinge',          sets: 3, reps_min: 5, reps_max: 5,  rest_seconds: 180 },
          { exercise_id: '3470', intended_pattern: 'lunge',          sets: 3, reps_min: 8, reps_max: 10, rest_seconds: 90 },
          { exercise_id: '0464', intended_pattern: 'core_antiextension', sets: 3, duration_seconds: 30, rest_seconds: 60 },
        ],
      },
      {
        name: 'Upper Strength',
        focus: 'Horizontal push + pull, vertical pull',
        weekday: 1,  // Tuesday
        estimated_duration_minutes: 55,
        exercises: [
          { exercise_id: '0025', intended_pattern: 'horizontal_push', sets: 4, reps_min: 5, reps_max: 8,  rest_seconds: 150 },
          { exercise_id: '0027', intended_pattern: 'horizontal_pull', sets: 4, reps_min: 6, reps_max: 10, rest_seconds: 120 },
          { exercise_id: '0652', intended_pattern: 'vertical_pull',   sets: 3, reps_min: 5, reps_max: 8,  rest_seconds: 120 },
          { exercise_id: '0031', intended_pattern: 'bicep',           sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60 },
        ],
      },
      {
        name: 'Strength B',
        focus: 'Lower body accessory + grip work',
        weekday: 3,  // Thursday (not Wednesday — avoids back-to-back with Tuesday upper)
        estimated_duration_minutes: 55,
        exercises: [
          { exercise_id: '1760', intended_pattern: 'squat',            sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 120 },
          { exercise_id: '3470', intended_pattern: 'lunge',            sets: 3, reps_min: 10, reps_max: 12, rest_seconds: 90 },
          { exercise_id: '2330', intended_pattern: 'vertical_pull',    sets: 4, reps_min: 8, reps_max: 12, rest_seconds: 90 },
          { exercise_id: '0464', intended_pattern: 'core_antiextension', sets: 3, duration_seconds: 30, rest_seconds: 60 },
        ],
      },
      {
        name: 'Conditioning',
        focus: 'OCR-specific conditioning + carries',
        weekday: 5,  // Saturday
        estimated_duration_minutes: 50,
        exercises: [
          { exercise_id: '0662', intended_pattern: 'horizontal_push', sets: 4, reps_min: 15, reps_max: 20, rest_seconds: 60 },
          { exercise_id: '0652', intended_pattern: 'vertical_pull',   sets: 4, reps_min: 8,  reps_max: 12, rest_seconds: 60 },
          { exercise_id: '3561', intended_pattern: 'hinge',           sets: 3, reps_min: 15, reps_max: 20, rest_seconds: 45, notes: 'Circuit-style, minimal rest' },
          { exercise_id: '0031', intended_pattern: 'bicep',           sets: 3, reps_min: 12, reps_max: 15, rest_seconds: 45 },
        ],
      },
    ],
  }

  it('validates the 4-day hybrid program', () => {
    const result = validateProgramDraft(hybridDraft)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.program!.days).toHaveLength(4)
  })

  it('weekdays are Mon(0)/Tue(1)/Thu(3)/Sat(5)', () => {
    const result = validateProgramDraft(hybridDraft)
    const weekdays = result.program!.days.map(d => d.weekday)
    expect(weekdays).toEqual([0, 1, 3, 5])
  })

  it('has no consecutive heavy lower-body days (Mon=lower, Tue=upper push/pull)', () => {
    const result = validateProgramDraft(hybridDraft)
    const days = result.program!.days
    // Monday = lower body compound; Tuesday = upper push/pull
    const mon = days.find(d => d.weekday === 0)!
    const tue = days.find(d => d.weekday === 1)!
    expect(mon.focus?.toLowerCase()).toContain('lower')
    // Tuesday focus is upper-body (horizontal push + pull) — not lower body
    expect(tue.focus?.toLowerCase()).not.toContain('lower')
    expect(tue.focus?.toLowerCase()).toMatch(/push|pull|horizontal/)
  })

  it('no weekday duplicates', () => {
    const result = validateProgramDraft(hybridDraft)
    const weekdays = result.program!.days.map(d => d.weekday)
    const unique = new Set(weekdays)
    expect(unique.size).toBe(weekdays.length)
  })

  it('resolveScheduledDay finds Saturday conditioning day', () => {
    const result = validateProgramDraft(hybridDraft)
    const schedulableDays: SchedulableProgramDay[] = result.program!.days.map((d, i) => ({
      id: String(i),
      name: d.name,
      weekday: d.weekday ?? null,
      exerciseCount: d.exercises.length,
    }))
    const satDay = resolveScheduledDay(schedulableDays, 5)
    expect(satDay).not.toBeNull()
    expect(satDay!.name).toBe('Conditioning')
  })

  it('resolveScheduledDay returns null for Friday (rest day)', () => {
    const result = validateProgramDraft(hybridDraft)
    const schedulableDays: SchedulableProgramDay[] = result.program!.days.map((d, i) => ({
      id: String(i),
      name: d.name,
      weekday: d.weekday ?? null,
      exerciseCount: d.exercises.length,
    }))
    expect(resolveScheduledDay(schedulableDays, 4)).toBeNull()
  })
})
