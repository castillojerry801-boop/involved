// Running/walking pace and race-time calculator.
//
// Canonical unit: all distances stored and computed in meters.
// Pace and speed are derived for both km and mi; the UI picks the display unit.
//
// Race prediction uses the Riegel fatigue formula: T2 = T1 × (D2/D1)^1.06
// Reference: Riegel PS (1981). American Scientist 69(3):285–290.
//
// MI_PER_KM matches the canonical constant in lib/hooks/use-distance-unit.ts.

export const MI_PER_KM = 0.6213711922

export const STANDARD_DISTANCES: ReadonlyArray<{ key: string; label: string; meters: number }> = [
  { key: '1mi',      label: '1 Mile',        meters: 1609.344 },
  { key: '5k',       label: '5K',            meters: 5000     },
  { key: '10k',      label: '10K',           meters: 10000    },
  { key: 'half',     label: 'Half Marathon', meters: 21097.5  },
  { key: 'marathon', label: 'Marathon',      meters: 42195    },
  { key: 'custom',   label: 'Custom',        meters: 0        },
]

export type PaceErrorReason =
  | 'invalid_distance'
  | 'invalid_time'
  | 'invalid_pace'
  | 'zero_distance'
  | 'zero_time'

export interface PaceResult {
  totalSeconds:  number
  distanceM:     number
  paceSecPerKm:  number
  paceSecPerMi:  number
  speedKmh:      number
  speedMph:      number
}

export interface RaceProjection {
  key:              string
  label:            string
  meters:           number
  predictedSeconds: number
}

export type PaceOutcome =
  | ({ ok: true }  & PaceResult)
  | ({ ok: false } & { reason: PaceErrorReason; message: string })

export type RaceProjectionOutcome =
  | { ok: true;  projections: RaceProjection[] }
  | ({ ok: false } & { reason: PaceErrorReason; message: string })

// ─── Validation helpers ──────────────────────────────────────────────────────

function isValidDistanceM(m: number): boolean {
  return isFinite(m) && m > 0 && m <= 1_000_000
}

function isValidTimeComponents(h: number, m: number, s: number): boolean {
  return (
    isFinite(h) && isFinite(m) && isFinite(s) &&
    Number.isInteger(h) && Number.isInteger(m) && Number.isInteger(s) &&
    h >= 0 && m >= 0 && s >= 0 &&
    m < 60 && s < 60 &&
    h + m + s > 0
  )
}

// ─── Unit conversion helpers ─────────────────────────────────────────────────

export function hmsToSeconds(h: number, m: number, s: number): number {
  return h * 3600 + m * 60 + s
}

export function secondsToHms(totalSec: number): { h: number; m: number; s: number } {
  const rounded = Math.round(totalSec)
  const h = Math.floor(rounded / 3600)
  const m = Math.floor((rounded % 3600) / 60)
  const s = rounded % 60
  return { h, m, s }
}

/**
 * Format pace in seconds per unit as "M:SS" (e.g. "5:02").
 * Handles > 60 min/unit (e.g. very slow walk).
 */
export function formatPace(secPerUnit: number): string {
  if (!isFinite(secPerUnit) || secPerUnit <= 0) return '—'
  const total = Math.round(secPerUnit)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

/**
 * Format total seconds as "H:MM:SS" or "M:SS".
 */
export function formatTime(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return '—'
  const { h, m, s } = secondsToHms(totalSec)
  const mm = m < 10 ? `0${m}` : `${m}`
  const ss = s < 10 ? `0${s}` : `${s}`
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

// ─── Core calculations ────────────────────────────────────────────────────────

/**
 * Calculate pace and speed from a distance and completion time.
 */
export function calcPace(
  distanceM: number,
  hours:     number,
  minutes:   number,
  seconds:   number,
): PaceOutcome {
  if (!isValidDistanceM(distanceM)) {
    return {
      ok: false,
      reason: distanceM <= 0 ? 'zero_distance' : 'invalid_distance',
      message: 'Distance must be a positive number.',
    }
  }
  if (!isValidTimeComponents(hours, minutes, seconds)) {
    return {
      ok: false,
      reason: hours + minutes + seconds === 0 ? 'zero_time' : 'invalid_time',
      message: 'Time must be valid (minutes and seconds < 60, total > 0).',
    }
  }

  const totalSeconds = hmsToSeconds(hours, minutes, seconds)
  const distanceKm   = distanceM / 1000
  const distanceMi   = distanceKm * MI_PER_KM

  return {
    ok:           true,
    totalSeconds,
    distanceM,
    paceSecPerKm: totalSeconds / distanceKm,
    paceSecPerMi: totalSeconds / distanceMi,
    speedKmh:     (distanceKm / totalSeconds) * 3600,
    speedMph:     (distanceMi / totalSeconds) * 3600,
  }
}

/**
 * Calculate finish time from distance and target pace.
 *
 * @param paceMinutes  - Whole minutes of the pace per unit
 * @param paceSeconds  - Additional seconds of the pace per unit (0–59)
 * @param unit         - 'km' or 'mi' — determines which pace value was entered
 */
export function calcFinishTime(
  distanceM:    number,
  paceMinutes:  number,
  paceSeconds:  number,
  unit:         'km' | 'mi',
): PaceOutcome {
  if (!isValidDistanceM(distanceM)) {
    return {
      ok: false,
      reason: distanceM <= 0 ? 'zero_distance' : 'invalid_distance',
      message: 'Distance must be a positive number.',
    }
  }
  if (
    !isFinite(paceMinutes) || !isFinite(paceSeconds) ||
    !Number.isInteger(paceMinutes) || !Number.isInteger(paceSeconds) ||
    paceMinutes < 0 || paceSeconds < 0 || paceSeconds >= 60 ||
    paceMinutes + paceSeconds === 0
  ) {
    return {
      ok: false, reason: 'invalid_pace',
      message: 'Pace must be valid (seconds < 60, total > 0).',
    }
  }

  const paceSecPerUnit = paceMinutes * 60 + paceSeconds
  const distanceKm = distanceM / 1000
  const distanceMi = distanceKm * MI_PER_KM

  const distanceInUnit = unit === 'km' ? distanceKm : distanceMi
  const totalSeconds   = Math.round(distanceInUnit * paceSecPerUnit)

  const paceSecPerKm = unit === 'km' ? paceSecPerUnit : paceSecPerUnit / MI_PER_KM
  const paceSecPerMi = unit === 'mi' ? paceSecPerUnit : paceSecPerUnit * MI_PER_KM
  const speedKmh = (distanceKm / totalSeconds) * 3600
  const speedMph = (distanceMi / totalSeconds) * 3600

  return { ok: true, totalSeconds, distanceM, paceSecPerKm, paceSecPerMi, speedKmh, speedMph }
}

/**
 * Project finishing times for standard race distances from a known performance.
 * Uses the Riegel exponent 1.06 (empirical fatigue factor).
 *
 * Excludes the reference distance from results and the 'custom' placeholder.
 */
export function projectRaceTimes(
  knownDistanceM: number,
  knownSeconds:   number,
): RaceProjectionOutcome {
  if (!isFinite(knownDistanceM) || knownDistanceM < 0) {
    return { ok: false, reason: 'invalid_distance', message: 'Reference distance must be a positive number.' }
  }
  if (knownDistanceM === 0) {
    return { ok: false, reason: 'zero_distance', message: 'Reference distance must be a positive number.' }
  }
  if (!isValidDistanceM(knownDistanceM)) {
    return {
      ok: false, reason: 'invalid_distance',
      message: 'Reference distance must be a positive number.',
    }
  }
  if (!isFinite(knownSeconds) || knownSeconds <= 0) {
    return {
      ok: false, reason: 'zero_time',
      message: 'Reference time must be positive.',
    }
  }

  const projections = STANDARD_DISTANCES
    .filter(d => d.key !== 'custom' && Math.abs(d.meters - knownDistanceM) > 1)
    .map(({ key, label, meters }) => ({
      key,
      label,
      meters,
      predictedSeconds: Math.round(knownSeconds * Math.pow(meters / knownDistanceM, 1.06)),
    }))

  return { ok: true, projections }
}
