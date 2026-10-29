// Heart rate zone calculator.
//
// Basic mode  — age-estimated max HR using the Tanaka formula (2001).
// Advanced mode — user-supplied measured max HR, optionally with resting HR.
//
// When resting HR is provided, zone boundaries use the Karvonen
// heart-rate-reserve (HRR) method. Otherwise, zones are a direct percentage
// of maximum HR.
//
// All zone boundaries are displayed as guidance, not precise physiological
// thresholds. Individual response varies.
//
// References:
//   Tanaka H et al. (2001). J Am Coll Cardiol 37(1):153–156.
//     maxHR = 208 − 0.7 × age
//   Karvonen MJ et al. (1957). Ann Med Exp Biol Fenn 35(3):307–315.
//     zone_bpm = restingHR + pct × (maxHR − restingHR)

export type HRZoneMethod = 'age_estimated' | 'measured_max' | 'karvonen'

export interface HRZone {
  zone:    number   // 1–5
  name:    string
  purpose: string
  minBpm:  number
  maxBpm:  number
  color:   string   // Tailwind bg class for visual coding
}

export type HRZoneErrorReason =
  | 'invalid_age'
  | 'invalid_max_hr'
  | 'invalid_resting_hr'
  | 'resting_exceeds_max'

export type HRZoneOutcome =
  | { ok: true;  maxHR: number; restingHR: number | null; method: HRZoneMethod; zones: HRZone[] }
  | { ok: false; reason: HRZoneErrorReason; message: string }

// Zone definitions: lo/hi as fraction of max (or HRR for Karvonen)
const ZONE_DEFS: Array<{
  zone:    number
  name:    string
  purpose: string
  color:   string
  lo:      number
  hi:      number
}> = [
  {
    zone:    1,
    name:    'Zone 1 — Recovery',
    purpose: 'Active recovery, warm-up and cool-down',
    color:   'bg-sky-400',
    lo: 0.50, hi: 0.60,
  },
  {
    zone:    2,
    name:    'Zone 2 — Aerobic Base',
    purpose: 'Base endurance, fat oxidation, conversational pace',
    color:   'bg-emerald-400',
    lo: 0.60, hi: 0.70,
  },
  {
    zone:    3,
    name:    'Zone 3 — Tempo',
    purpose: 'Aerobic fitness, comfortably hard effort',
    color:   'bg-yellow-400',
    lo: 0.70, hi: 0.80,
  },
  {
    zone:    4,
    name:    'Zone 4 — Threshold',
    purpose: 'Lactate threshold, race-pace training',
    color:   'bg-orange-400',
    lo: 0.80, hi: 0.90,
  },
  {
    zone:    5,
    name:    'Zone 5 — Maximum',
    purpose: 'VO₂ max intervals, short high-intensity bursts',
    color:   'bg-red-500',
    lo: 0.90, hi: 1.00,
  },
]

// ─── Input validation ────────────────────────────────────────────────────────

function isValidAge(age: number): boolean {
  return isFinite(age) && Number.isInteger(age) && age >= 10 && age <= 100
}

function isValidMaxHR(hr: number): boolean {
  return isFinite(hr) && hr >= 100 && hr <= 230
}

function isValidRestingHR(hr: number): boolean {
  return isFinite(hr) && hr >= 30 && hr <= 120
}

// ─── Zone builder ─────────────────────────────────────────────────────────────

function buildZones(maxHR: number, restingHR: number | null): HRZone[] {
  return ZONE_DEFS.map(({ zone, name, purpose, color, lo, hi }) => {
    let minBpm: number
    let maxBpm: number
    if (restingHR != null) {
      const hrr = maxHR - restingHR
      minBpm = Math.round(restingHR + lo * hrr)
      maxBpm = Math.round(restingHR + hi * hrr)
    } else {
      minBpm = Math.round(lo * maxHR)
      maxBpm = Math.round(hi * maxHR)
    }
    return { zone, name, purpose, color, minBpm, maxBpm }
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Estimate max HR from age using the Tanaka (2001) formula: 208 − 0.7 × age.
 * Rounded to the nearest whole number.
 */
export function estimateMaxHR(age: number): number {
  return Math.round(208 - 0.7 * age)
}

/**
 * Calculate zones from age only (basic mode).
 * Max HR is estimated via the Tanaka formula; zones are % of estimated max HR.
 */
export function calcHRZonesFromAge(age: number): HRZoneOutcome {
  if (!isValidAge(age)) {
    return {
      ok: false, reason: 'invalid_age',
      message: 'Age must be a whole number between 10 and 100.',
    }
  }
  const maxHR = estimateMaxHR(age)
  return { ok: true, maxHR, restingHR: null, method: 'age_estimated', zones: buildZones(maxHR, null) }
}

/**
 * Calculate zones from a measured max HR and optional resting HR (advanced mode).
 *
 * With restingHR → Karvonen heart-rate-reserve method.
 * Without        → direct % of measured maxHR.
 */
export function calcHRZonesAdvanced(
  maxHR:      number,
  restingHR?: number | null,
): HRZoneOutcome {
  if (!isValidMaxHR(maxHR)) {
    return {
      ok: false, reason: 'invalid_max_hr',
      message: 'Maximum heart rate must be a whole number between 100 and 230 bpm.',
    }
  }
  if (restingHR != null) {
    if (!isValidRestingHR(restingHR)) {
      return {
        ok: false, reason: 'invalid_resting_hr',
        message: 'Resting heart rate must be between 30 and 100 bpm.',
      }
    }
    if (restingHR >= maxHR) {
      return {
        ok: false, reason: 'resting_exceeds_max',
        message: 'Resting heart rate must be lower than maximum heart rate.',
      }
    }
  }
  const method: HRZoneMethod = restingHR != null ? 'karvonen' : 'measured_max'
  return {
    ok: true,
    maxHR,
    restingHR: restingHR ?? null,
    method,
    zones: buildZones(maxHR, restingHR ?? null),
  }
}
