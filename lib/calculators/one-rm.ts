// One-rep max calculator utilities for the Fitness Calculator Hub.
//
// The Epley estimation formula lives in lib/training/one-rm.ts and is
// reused here unchanged. This module adds unit conversion and a training
// percentage table for display; it does not introduce a second formula.
//
// IMPORTANT: Estimates produced by this module are statistical approximations.
// They must never be presented as safe maximal lifting targets.

import { estimated1RM, isValid1RMEstimate } from '@/lib/training/one-rm'

export { estimated1RM, isValid1RMEstimate }

export const KG_TO_LBS = 2.20462
export const LBS_TO_KG = 1 / KG_TO_LBS

// ─── Types ────────────────────────────────────────────────────────────────────

export type WeightUnit = 'kg' | 'lbs'

export interface OneRMInput {
  weight: number
  unit:   WeightUnit
  reps:   number
}

export interface OneRMResult {
  oneRMKg:  number
  oneRMLbs: number
}

export type OneRMOutcome =
  | { ok: true }  & OneRMResult
  | { ok: false; reason: string; message: string }

export interface TrainingPercentageRow {
  percent:  number
  label:    string
  weightKg: number
  weightLbs: number
  repRange: string
}

// ─── Reference table (percent → approximate rep range) ────────────────────────
// Based on the %1RM–rep range relationship from the NSCA Strength Training
// reference. Ranges are approximations; individual response varies.

const PERCENTAGE_TABLE: Array<{ percent: number; repRange: string }> = [
  { percent: 100, repRange: '1 rep'       },
  { percent:  95, repRange: '~2–3 reps'   },
  { percent:  90, repRange: '~3–4 reps'   },
  { percent:  85, repRange: '~5–6 reps'   },
  { percent:  80, repRange: '~7–8 reps'   },
  { percent:  75, repRange: '~9–10 reps'  },
  { percent:  70, repRange: '~11–12 reps' },
  { percent:  65, repRange: '~13–15 reps' },
  { percent:  60, repRange: '~16–20 reps' },
]

// ─── Unit conversion helpers ─────────────────────────────────────────────────

export function kgToLbs(kg: number): number {
  return Math.round(kg * KG_TO_LBS * 10) / 10
}

export function lbsToKg(lbs: number): number {
  return Math.round((lbs / KG_TO_LBS) * 100) / 100
}

// ─── Core calculator ─────────────────────────────────────────────────────────

/**
 * Estimate 1RM from a lifted weight and rep count, with unit handling.
 *
 * When reps === 1 the lifted weight IS the observed 1RM; the Epley formula
 * returns it unchanged (no upward extrapolation). This is by design: there is
 * no basis for projecting a higher 1RM from a single observed rep.
 *
 * Rejects inputs outside the reliable range of the Epley formula (1–12 reps).
 * Also rejects non-positive weight and non-positive rep counts.
 */
export function calcOneRM(input: OneRMInput): OneRMOutcome {
  const { weight, unit, reps } = input

  if (!isFinite(weight) || weight <= 0) {
    return { ok: false, reason: 'invalid_weight', message: 'Weight must be a positive number.' }
  }
  if (!isFinite(reps) || !Number.isInteger(reps) || reps <= 0) {
    return { ok: false, reason: 'invalid_reps', message: 'Reps must be a positive whole number.' }
  }
  if (!isValid1RMEstimate(reps)) {
    return {
      ok:      false,
      reason:  'reps_out_of_range',
      message: `The Epley formula is reliable for 1–12 reps. ${reps} reps is outside this range.`,
    }
  }

  const weightKg = unit === 'lbs' ? lbsToKg(weight) : weight
  const oneRMKg  = estimated1RM(weightKg, reps)
  const oneRMLbs = kgToLbs(oneRMKg)

  return { ok: true, oneRMKg, oneRMLbs }
}

/**
 * Generate a training percentage table from an estimated 1RM (in kg).
 *
 * Returns rows at standard training percentages with both kg and lbs values.
 * All weight values are rounded to one decimal place for display.
 */
export function trainingPercentages(oneRMKg: number): TrainingPercentageRow[] {
  if (!isFinite(oneRMKg) || oneRMKg <= 0) return []

  return PERCENTAGE_TABLE.map(({ percent, repRange }) => {
    const weightKg  = Math.round((oneRMKg * percent / 100) * 10) / 10
    const weightLbs = kgToLbs(weightKg)
    return {
      percent,
      label:    `${percent}%`,
      weightKg,
      weightLbs,
      repRange,
    }
  })
}
