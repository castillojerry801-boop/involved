import { describe, it, expect } from 'vitest'
import {
  jsToWeekday,
  todayWeekday,
  resolveScheduledDay,
  upcomingSchedule,
  quickEntryToSets,
  defaultPrescription,
  prescriptionFromSets,
  WEEKDAY_SHORT,
  WEEKDAY_FULL,
  type Weekday,
  type SchedulableProgramDay,
  type ProgramSetInput,
} from '@/lib/training/program-scheduling'

// ─── Scenario A: Weekday assignment and conversion ────────────────────────────

describe('Scenario A: weekday conversion', () => {
  it('jsToWeekday maps Monday (JS=1) to 0', () => {
    expect(jsToWeekday(1)).toBe(0)
  })

  it('jsToWeekday maps Thursday (JS=4) to 3', () => {
    expect(jsToWeekday(4)).toBe(3)
  })

  it('jsToWeekday maps Sunday (JS=0) to 6', () => {
    expect(jsToWeekday(0)).toBe(6)
  })

  it('jsToWeekday maps Saturday (JS=6) to 5', () => {
    expect(jsToWeekday(6)).toBe(5)
  })

  it('WEEKDAY_FULL has 7 entries starting with Monday', () => {
    expect(WEEKDAY_FULL[0]).toBe('Monday')
    expect(WEEKDAY_FULL[6]).toBe('Sunday')
    expect(WEEKDAY_FULL).toHaveLength(7)
  })

  it('WEEKDAY_SHORT mirrors WEEKDAY_FULL order', () => {
    expect(WEEKDAY_SHORT[0]).toBe('Mon')
    expect(WEEKDAY_SHORT[6]).toBe('Sun')
  })
})

// ─── Scenario B: Quick entry → ProgramSets ───────────────────────────────────

describe('Scenario B: quickEntryToSets', () => {
  it('generates correct number of sets', () => {
    const sets = quickEntryToSets({
      sets: 3, repsMin: 8, repsMax: 12, duration: null,
      rest: 90, progressionMode: 'same', progressionStep: null, baseWeightKg: null,
    })
    expect(sets).toHaveLength(3)
  })

  it('sets correct reps and rest on each set', () => {
    const sets = quickEntryToSets({
      sets: 3, repsMin: 8, repsMax: 12, duration: null,
      rest: 90, progressionMode: 'same', progressionStep: null, baseWeightKg: null,
    })
    for (const s of sets) {
      expect(s.targetRepsMin).toBe(8)
      expect(s.targetRepsMax).toBe(12)
      expect(s.restSeconds).toBe(90)
    }
  })

  it('assigns sequential set numbers', () => {
    const sets = quickEntryToSets({
      sets: 3, repsMin: 8, repsMax: 12, duration: null,
      rest: 90, progressionMode: 'same', progressionStep: null, baseWeightKg: null,
    })
    expect(sets[0].setNumber).toBe(1)
    expect(sets[1].setNumber).toBe(2)
    expect(sets[2].setNumber).toBe(3)
  })

  it('null weight when baseWeightKg is null', () => {
    const sets = quickEntryToSets({
      sets: 2, repsMin: 8, repsMax: 12, duration: null,
      rest: 90, progressionMode: 'same', progressionStep: null, baseWeightKg: null,
    })
    expect(sets[0].targetWeightKg).toBeNull()
  })

  it('sets setType to working by default', () => {
    const sets = quickEntryToSets({
      sets: 2, repsMin: 5, repsMax: 5, duration: null,
      rest: 180, progressionMode: 'same', progressionStep: null, baseWeightKg: 100,
    })
    expect(sets.every(s => s.setType === 'working')).toBe(true)
  })
})

// ─── Scenario C: Progressions ─────────────────────────────────────────────────

describe('Scenario C: weight progressions', () => {
  it('increase: 135 → 145 → 155 with step 10', () => {
    const sets = quickEntryToSets({
      sets: 3, repsMin: 5, repsMax: 5, duration: null,
      rest: 180, progressionMode: 'increase', progressionStep: 10, baseWeightKg: 135,
    })
    expect(sets[0].targetWeightKg).toBe(135)
    expect(sets[1].targetWeightKg).toBe(145)
    expect(sets[2].targetWeightKg).toBe(155)
  })

  it('decrease: 155 → 145 → 135 with step 10', () => {
    const sets = quickEntryToSets({
      sets: 3, repsMin: 5, repsMax: 5, duration: null,
      rest: 180, progressionMode: 'decrease', progressionStep: 10, baseWeightKg: 155,
    })
    expect(sets[0].targetWeightKg).toBe(155)
    expect(sets[1].targetWeightKg).toBe(145)
    expect(sets[2].targetWeightKg).toBe(135)
  })

  it('decrease is floored at 0', () => {
    const sets = quickEntryToSets({
      sets: 3, repsMin: 5, repsMax: 5, duration: null,
      rest: 180, progressionMode: 'decrease', progressionStep: 10, baseWeightKg: 5,
    })
    expect(sets[0].targetWeightKg).toBe(5)
    expect(sets[1].targetWeightKg).toBe(0)
    expect(sets[2].targetWeightKg).toBe(0)
  })

  it('same mode: all sets same weight', () => {
    const sets = quickEntryToSets({
      sets: 3, repsMin: 8, repsMax: 12, duration: null,
      rest: 90, progressionMode: 'same', progressionStep: null, baseWeightKg: 80,
    })
    expect(sets.every(s => s.targetWeightKg === 80)).toBe(true)
  })
})

// ─── Scenario D: resolveScheduledDay ─────────────────────────────────────────

describe('Scenario D: resolveScheduledDay', () => {
  const days: SchedulableProgramDay[] = [
    { id: 'chest', name: 'Chest', weekday: 0, exerciseCount: 5 },   // Monday
    { id: 'legs', name: 'Legs', weekday: 3, exerciseCount: 6 },     // Thursday
    { id: 'back', name: 'Back', weekday: 1, exerciseCount: 4 },     // Tuesday
  ]

  it('resolves Thursday (3) to Legs day', () => {
    const result = resolveScheduledDay(days, 3 as Weekday)
    expect(result?.id).toBe('legs')
    expect(result?.name).toBe('Legs')
  })

  it('returns null for Wednesday (2) — no day assigned', () => {
    expect(resolveScheduledDay(days, 2 as Weekday)).toBeNull()
  })

  it('resolves Monday (0) to Chest day', () => {
    expect(resolveScheduledDay(days, 0 as Weekday)?.id).toBe('chest')
  })
})

// ─── Scenario E: quickEntryToSets output has fields required by start route ──

describe('Scenario E: start route field compatibility', () => {
  it('output has all required ProgramSetInput fields', () => {
    const sets = quickEntryToSets({
      sets: 1, repsMin: 8, repsMax: 12, duration: null,
      rest: 90, progressionMode: 'same', progressionStep: null, baseWeightKg: 100,
    })
    const s = sets[0]
    expect(s).toHaveProperty('setNumber')
    expect(s).toHaveProperty('setType')
    expect(s).toHaveProperty('targetRepsMin')
    expect(s).toHaveProperty('targetRepsMax')
    expect(s).toHaveProperty('targetWeightKg')
    expect(s).toHaveProperty('targetDurationSeconds')
    expect(s).toHaveProperty('targetDistanceM')
    expect(s).toHaveProperty('restSeconds')
  })
})

// ─── Scenario F: legacy programs — null weekdays and prescriptionFromSets ────

describe('Scenario F: legacy programs', () => {
  const legacyDays: SchedulableProgramDay[] = [
    { id: 'day1', name: 'Day 1', weekday: null, exerciseCount: 4 },
    { id: 'day2', name: 'Day 2', weekday: null, exerciseCount: 3 },
    { id: 'day3', name: 'Day 3', weekday: null, exerciseCount: 5 },
  ]

  it('all legacy days resolve to null for any weekday', () => {
    for (let wd = 0; wd < 7; wd++) {
      expect(resolveScheduledDay(legacyDays, wd as Weekday)).toBeNull()
    }
  })

  it('prescriptionFromSets infers quick mode from uniform legacy sets', () => {
    const sets: ProgramSetInput[] = [
      { setNumber: 1, setType: 'working', targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: 80, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 90 },
      { setNumber: 2, setType: 'working', targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: 80, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 90 },
      { setNumber: 3, setType: 'working', targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: 80, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 90 },
    ]
    const { mode, prescription } = prescriptionFromSets(sets)
    expect(mode).toBe('quick')
    expect(prescription.sets).toBe(3)
    expect(prescription.repsMin).toBe(8)
    expect(prescription.repsMax).toBe(12)
    expect(prescription.rest).toBe(90)
    expect(prescription.progressionMode).toBe('same')
  })

  it('prescriptionFromSets detects increase progression from legacy sets', () => {
    const sets: ProgramSetInput[] = [
      { setNumber: 1, setType: 'working', targetRepsMin: 5, targetRepsMax: 5, targetWeightKg: 100, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 180 },
      { setNumber: 2, setType: 'working', targetRepsMin: 5, targetRepsMax: 5, targetWeightKg: 110, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 180 },
      { setNumber: 3, setType: 'working', targetRepsMin: 5, targetRepsMax: 5, targetWeightKg: 120, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 180 },
    ]
    const { mode, prescription } = prescriptionFromSets(sets)
    expect(mode).toBe('quick')
    expect(prescription.progressionMode).toBe('increase')
    expect(prescription.progressionStep).toBe(10)
    expect(prescription.baseWeightKg).toBe(100)
  })

  it('prescriptionFromSets returns advanced mode for mixed set types', () => {
    const sets: ProgramSetInput[] = [
      { setNumber: 1, setType: 'warmup', targetRepsMin: 10, targetRepsMax: 10, targetWeightKg: 40, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 60 },
      { setNumber: 2, setType: 'working', targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: 80, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 90 },
    ]
    const { mode } = prescriptionFromSets(sets)
    expect(mode).toBe('advanced')
  })

  it('upcomingSchedule skips today and returns next 6 days', () => {
    const schedule = upcomingSchedule(legacyDays, 0 as Weekday) // today is Monday
    expect(schedule).toHaveLength(6)
    expect(schedule[0].weekday).toBe(1) // Tuesday
    expect(schedule[5].weekday).toBe(6) // Sunday
    expect(schedule.every(u => u.day === null)).toBe(true)
  })
})
