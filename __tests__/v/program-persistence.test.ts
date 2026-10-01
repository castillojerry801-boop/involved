/**
 * Multi-week persistence + runtime resolution — regression tests.
 *
 * Covers the pure correctness layer that both the save path and the workout-start
 * bridge use: draft → persisted JSON → shared resolver → resolved set specs.
 * If these hold, Week 4 in the UI and the Week 4 live workout cannot disagree.
 */

import { describe, it, expect } from 'vitest'
import type { WeekProgression, ProgramPhase } from '../../lib/ai/tools/program'
import {
  toPersistedWeekProgressions,
  toPersistedPhases,
  parseStartingLoadKg,
} from '../../lib/training/program-draft-persist'
import {
  resolveExercisePrescriptionForWeek,
  buildResolvedSetSpecs,
  phaseForWeek,
  type ResolvableExercise,
  type PersistedWeekProgression,
} from '../../lib/training/prescription'
import { getInvolvedDisplayName } from '../../lib/exercises/canonical'

// A saved bench press: base 3×6-8 @ RIR 2, 60 kg; deload wk4 → 2 sets RIR 4; taper wk12.
const benchDraftWPs: WeekProgression[] = [
  { week: 1, sets: 3, reps_min: 6, reps_max: 8, rir: 3, load: 60 },
  { week: 4, sets: 2, rir: 4, deload: true },
  { week: 12, sets: 2, rir: 3, taper: true },
]

function savedBench(): ResolvableExercise {
  const wp = toPersistedWeekProgressions(benchDraftWPs)!
  return {
    restSeconds: 120,
    startingLoad: parseStartingLoadKg('60 kg'),   // 60
    weekProgressions: wp,
    sets: Array.from({ length: 3 }, () => ({
      targetRepsMin: 6, targetRepsMax: 8, targetRir: 2, targetWeightKg: 60,
      targetDurationSeconds: null, targetDistanceM: null, restSeconds: 120,
    })),
  }
}

// ─── draft → persisted transform ──────────────────────────────────────────────

describe('toPersistedWeekProgressions', () => {
  it('maps snake_case draft fields to camelCase, keeping only present fields', () => {
    const p = toPersistedWeekProgressions(benchDraftWPs)!
    expect(p[0]).toEqual({ week: 1, sets: 3, repsMin: 6, repsMax: 8, targetRir: 3, load: 60 })
    expect(p[1]).toEqual({ week: 4, sets: 2, targetRir: 4, deload: true })
    expect(p[2]).toEqual({ week: 12, sets: 2, targetRir: 3, taper: true })
  })
  it('returns null for empty/absent progressions', () => {
    expect(toPersistedWeekProgressions(undefined)).toBeNull()
    expect(toPersistedWeekProgressions([])).toBeNull()
  })
})

describe('parseStartingLoadKg', () => {
  it('reads kg directly', () => expect(parseStartingLoadKg('60 kg')).toBe(60))
  it('converts lb to kg', () => expect(parseStartingLoadKg('315 lb')).toBe(142.9))
  it('does NOT invent a load from a percentage', () => expect(parseStartingLoadKg('75% 1RM')).toBeNull())
  it('does NOT guess a unit from a bare number', () => expect(parseStartingLoadKg('225')).toBeNull())
  it('null-safe', () => expect(parseStartingLoadKg(undefined)).toBeNull())
})

// ─── Strength deload: sets + RIR resolve, and the WORKOUT gets the reduced count ─

describe('strength deload — Week 4 resolves to reduced volume + RIR', () => {
  it('base week (2, no override) resolves to the base prescription', () => {
    const r = resolveExercisePrescriptionForWeek(savedBench(), 2)
    expect(r.sets).toBe(3)
    expect(r.targetRir).toBe(2)
    expect(r.deload).toBe(false)
  })

  it('Week 4 resolves to 2 sets at RIR 4 and is flagged deload', () => {
    const r = resolveExercisePrescriptionForWeek(savedBench(), 4)
    expect(r.sets).toBe(2)
    expect(r.targetRir).toBe(4)
    expect(r.repsMin).toBe(6)   // not overridden → base carries through
    expect(r.repsMax).toBe(8)
    expect(r.load).toBe(60)
    expect(r.deload).toBe(true)
  })

  it('starting a Week 4 workout creates exactly 2 prescribed sets, each RIR 4', () => {
    const specs = buildResolvedSetSpecs(resolveExercisePrescriptionForWeek(savedBench(), 4))
    expect(specs).toHaveLength(2)                          // not the base 3
    expect(specs.every(s => s.targetRir === 4)).toBe(true)
    expect(specs.every(s => s.targetWeightKg === 60)).toBe(true)
  })

  it('starting a Week 1 workout creates 3 sets (base count preserved)', () => {
    const specs = buildResolvedSetSpecs(resolveExercisePrescriptionForWeek(savedBench(), 1))
    expect(specs).toHaveLength(3)
  })

  it('Week 12 is a taper: 2 sets and taper flag set', () => {
    const r = resolveExercisePrescriptionForWeek(savedBench(), 12)
    expect(r.sets).toBe(2)
    expect(r.taper).toBe(true)
    expect(buildResolvedSetSpecs(r)).toHaveLength(2)
  })
})

// ─── Cardio duration progression ──────────────────────────────────────────────

describe('cardio duration resolves per week', () => {
  const cardio: ResolvableExercise = {
    restSeconds: 0,
    startingLoad: null,
    weekProgressions: toPersistedWeekProgressions([
      { week: 1, duration_seconds: 1200 },
      { week: 6, duration_seconds: 1650 },
      { week: 11, duration_seconds: 2100 },
      { week: 12, duration_seconds: 1500, taper: true },
    ]),
    sets: [{ targetRepsMin: null, targetRepsMax: null, targetRir: null, targetWeightKg: null, targetDurationSeconds: 1200, targetDistanceM: null, restSeconds: 0 }],
  }
  it('week 1 → 1200s, week 6 → 1650s, week 11 → 2100s, week 12 → 1500s taper', () => {
    expect(resolveExercisePrescriptionForWeek(cardio, 1).durationSeconds).toBe(1200)
    expect(resolveExercisePrescriptionForWeek(cardio, 6).durationSeconds).toBe(1650)
    expect(resolveExercisePrescriptionForWeek(cardio, 11).durationSeconds).toBe(2100)
    const w12 = resolveExercisePrescriptionForWeek(cardio, 12)
    expect(w12.durationSeconds).toBe(1500)
    expect(w12.taper).toBe(true)
  })
})

// ─── Phases survive + label the right weeks ───────────────────────────────────

describe('phases survive save/read and label deload/taper weeks', () => {
  const draftPhases: ProgramPhase[] = [
    { name: 'Base', weeks: '1-3', focus: 'x' },
    { name: 'Deload', weeks: '4', focus: 'x' },
    { name: 'Build', weeks: '5-7', focus: 'x' },
    { name: 'Deload', weeks: '8', focus: 'x' },
    { name: 'Build', weeks: '9-11', focus: 'x' },
    { name: 'Taper', weeks: '12', focus: 'x' },
  ]
  const phases = toPersistedPhases(draftPhases)!

  it('parses week ranges (single + hyphenated)', () => {
    expect(phases[0]).toEqual({ name: 'Base', startWeek: 1, endWeek: 3 })
    expect(phases[1]).toEqual({ name: 'Deload', startWeek: 4, endWeek: 4 })
    expect(phases[5]).toEqual({ name: 'Taper', startWeek: 12, endWeek: 12 })
  })
  it('week 4 reports Deload, week 12 reports Taper', () => {
    expect(phaseForWeek(phases, 4)?.name).toBe('Deload')
    expect(phaseForWeek(phases, 12)?.name).toBe('Taper')
    expect(phaseForWeek(phases, 6)?.name).toBe('Build')
  })
})

// ─── Legacy compatibility ─────────────────────────────────────────────────────

describe('legacy program (no weekProgressions) resolves to base', () => {
  const legacy: ResolvableExercise = {
    restSeconds: 90,
    startingLoad: null,
    weekProgressions: null,
    sets: [
      { targetRepsMin: 8, targetRepsMax: 12, targetRir: null, targetWeightKg: null, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 90 },
      { targetRepsMin: 8, targetRepsMax: 12, targetRir: null, targetWeightKg: null, targetDurationSeconds: null, targetDistanceM: null, restSeconds: 90 },
    ],
  }
  it('every week resolves to the base prescription, no deload/taper', () => {
    for (const w of [1, 4, 8, 12]) {
      const r = resolveExercisePrescriptionForWeek(legacy, w)
      expect(r.sets).toBe(2)
      expect(r.repsMin).toBe(8)
      expect(r.deload).toBe(false)
      expect(r.taper).toBe(false)
    }
  })
  it('workout creation from a legacy program yields the base set count', () => {
    expect(buildResolvedSetSpecs(resolveExercisePrescriptionForWeek(legacy, 1))).toHaveLength(2)
  })
  it('null phases → no phase label', () => {
    expect(phaseForWeek(null, 3)).toBeNull()
  })
})

// ─── Canonical display names ──────────────────────────────────────────────────

describe('canonical display names never expose raw provider strings', () => {
  it('"stationary bike run v. 3" → a clean name, id preserved', () => {
    const name = getInvolvedDisplayName('2138', 'stationary bike run v. 3')
    expect(name).not.toBe('stationary bike run v. 3')
    expect(name).not.toMatch(/v\.\s*\d/)   // no "v. 3"
  })

  // Scaffold fixes — these names were appearing verbatim from ExerciseDB in production
  it('0977 Band Front Lateral Raise → Resistance Band Front Raise', () => {
    const name = getInvolvedDisplayName('0977', 'band front lateral raise')
    expect(name).toBe('Resistance Band Front Raise')
    expect(name.startsWith('Band ')).toBe(false)
  })

  it('0988 Band Single-Arm Standing Low Row → Resistance Band Row (Single Arm)', () => {
    const name = getInvolvedDisplayName('0988', 'band single-arm standing low row')
    expect(name).toBe('Resistance Band Row (Single Arm)')
    expect(name.startsWith('Band ')).toBe(false)
  })

  it('0998 Band Side Triceps Extension → Resistance Band Triceps Extension (Single Arm)', () => {
    const name = getInvolvedDisplayName('0998', 'band side triceps extension')
    expect(name).toBe('Resistance Band Triceps Extension (Single Arm)')
    expect(name.startsWith('Band ')).toBe(false)
  })
})
