import type { WeekProgression, ProgramPhase } from '@/lib/ai/tools/program'
import type { PersistedWeekProgression, PersistedPhase } from './prescription'

/**
 * Map a validated ProgramDraft's per-exercise week_progressions (snake_case, the
 * AI/tool shape) to the persisted camelCase JSON stored on ProgramExercise.
 * Only defined fields are kept, so a week stores just what differs from base.
 */
export function toPersistedWeekProgressions(
  wps: WeekProgression[] | undefined,
): PersistedWeekProgression[] | null {
  if (!wps?.length) return null
  const out = wps.map(w => {
    const p: PersistedWeekProgression = { week: w.week }
    if (w.sets != null) p.sets = w.sets
    if (w.reps_min != null) p.repsMin = w.reps_min
    if (w.reps_max != null) p.repsMax = w.reps_max
    if (w.rir != null) p.targetRir = w.rir
    if (w.load != null) p.load = w.load
    if (w.duration_seconds != null) p.durationSeconds = w.duration_seconds
    if (w.distance_m != null) p.distance = w.distance_m
    if (w.rpe != null) p.targetRpe = w.rpe
    if (w.deload) p.deload = true
    if (w.taper) p.taper = true
    return p
  })
  return out.length ? out : null
}

/**
 * Parse a draft phase's week range ("1-4", "5", "9 - 12") into start/end weeks.
 * Returns null for an unparseable range so bad data doesn't crash the save.
 */
function parseWeekRange(weeks: string): { startWeek: number; endWeek: number } | null {
  const m = weeks.match(/(\d+)\s*(?:[-–—]\s*(\d+))?/)
  if (!m) return null
  const startWeek = parseInt(m[1], 10)
  const endWeek = m[2] != null ? parseInt(m[2], 10) : startWeek
  if (!Number.isFinite(startWeek) || !Number.isFinite(endWeek)) return null
  return { startWeek, endWeek }
}

/** Map draft phases (name + "weeks" range string) to persisted { name, startWeek, endWeek }. */
export function toPersistedPhases(phases: ProgramPhase[] | undefined): PersistedPhase[] | null {
  if (!phases?.length) return null
  const out: PersistedPhase[] = []
  for (const p of phases) {
    const range = parseWeekRange(p.weeks ?? '')
    if (!range) continue
    out.push({ name: p.name, startWeek: range.startWeek, endWeek: range.endWeek })
  }
  return out.length ? out : null
}

/**
 * Extract an absolute numeric starting load (kg) from the draft's free-text
 * starting_load. Percentages ("75% 1RM") and bare numbers are NOT guessed — for
 * unknown/relative load we keep null and rely on rep-range + RIR + progression
 * condition instead of inventing a weight.
 */
export function parseStartingLoadKg(startingLoad: string | undefined): number | null {
  if (!startingLoad) return null
  if (/%/.test(startingLoad)) return null                 // relative — not an absolute load
  const kg = startingLoad.match(/(\d+(?:\.\d+)?)\s*kg/i)
  if (kg) return round1(parseFloat(kg[1]))
  const lb = startingLoad.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds)/i)
  if (lb) return round1(parseFloat(lb[1]) * 0.453592)
  return null                                             // ambiguous bare number — don't guess a unit
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
