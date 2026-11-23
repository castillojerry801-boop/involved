/**
 * Pure, side-effect-free helpers for the program progression viewer.
 * No React, no server imports — safe for Node.js unit tests.
 */

export interface WeekProgressionEntry {
  week: number
  sets?: number
  reps_min?: number
  reps_max?: number
  deload?: boolean
  taper?: boolean
  load_note?: string
  distance_m?: number
}

export interface ProgramExerciseBase {
  sets: number
  reps_min?: number | null
  reps_max?: number | null
  duration_seconds?: number | null
  distance_m?: number | null
  notes?: string | null
  week_progressions?: WeekProgressionEntry[]
}

export interface WeekPrescription {
  sets: number
  reps_min?: number
  reps_max?: number
  load_note?: string
  distance_m?: number
  hasSpecificEntry: boolean
  deload: boolean
  taper: boolean
}

/**
 * Merges the base exercise prescription with the week-specific entry (if any).
 * When no entry exists for the given week the base values are returned as-is
 * (the prescription is constant for that week — not missing data).
 */
export function getWeekPrescription(
  ex: ProgramExerciseBase,
  week: number,
): WeekPrescription {
  const wp = ex.week_progressions?.find(p => p.week === week) ?? null
  return {
    sets:      wp?.sets    ?? ex.sets,
    reps_min:  (wp?.reps_min  ?? ex.reps_min  ?? undefined) ?? undefined,
    reps_max:  (wp?.reps_max  ?? ex.reps_max  ?? undefined) ?? undefined,
    load_note: (wp?.load_note ?? ex.notes     ?? undefined) ?? undefined,
    distance_m:(wp?.distance_m ?? ex.distance_m ?? undefined) ?? undefined,
    hasSpecificEntry: wp !== null,
    deload:    wp?.deload ?? false,
    taper:     wp?.taper  ?? false,
  }
}

/**
 * Returns the set of week numbers where any exercise in the program has
 * deload:true in its week_progressions. Used to colour deload week buttons.
 */
export function getDeloadWeeks(
  days: Array<{ exercises: Array<ProgramExerciseBase> }>,
): Set<number> {
  const result = new Set<number>()
  for (const day of days) {
    for (const ex of day.exercises) {
      for (const wp of ex.week_progressions ?? []) {
        if (wp.deload) result.add(wp.week)
      }
    }
  }
  return result
}

/**
 * Returns true when every exercise in the given day that has any
 * week_progressions has an entry for the given week.
 * Used to show a "base prescription" notice when no entries exist.
 */
export function dayHasProgressionForWeek(
  day: { exercises: Array<ProgramExerciseBase> },
  week: number,
): boolean {
  const exercisesWithWP = day.exercises.filter(
    ex => (ex.week_progressions?.length ?? 0) > 0,
  )
  if (exercisesWithWP.length === 0) return false
  return exercisesWithWP.some(ex =>
    ex.week_progressions!.some(wp => wp.week === week),
  )
}

/**
 * Human-readable prescription line: "3 sets × 8–10 reps", "1 set × 1.0 mi",
 * "3 sets × 15 min", etc.  Falls back to base duration when present.
 */
export function formatPrescription(
  rx: WeekPrescription,
  baseDurationSeconds?: number | null,
): string {
  let effort: string
  if (rx.reps_min != null && rx.reps_max != null) {
    effort = rx.reps_min === rx.reps_max
      ? `${rx.reps_min} reps`
      : `${rx.reps_min}–${rx.reps_max} reps`
  } else if (rx.distance_m != null) {
    effort = `${(rx.distance_m / 1609.344).toFixed(1)} mi`
  } else if (baseDurationSeconds != null) {
    const mins = Math.round(baseDurationSeconds / 60)
    effort = `${mins} min`
  } else {
    effort = '—'
  }
  const setsLabel = rx.sets === 1 ? '1 set' : `${rx.sets} sets`
  return `${setsLabel} × ${effort}`
}
