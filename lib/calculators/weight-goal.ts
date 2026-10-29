// Weight-goal timeline estimator.
//
// Linear projection of weeks to a target weight given a weekly rate of change.
// Real weight change is nonlinear — these estimates are illustrative only.
// This module does not make medical recommendations or apply to users under 18.

export type WeightGoalDirection = 'loss' | 'gain' | 'maintain'

export type WeightGoalErrorReason =
  | 'invalid_current_weight'
  | 'invalid_goal_weight'
  | 'invalid_rate'

// Weekly-rate options in kg; UI converts to the display unit.
// Loss allows up to 1.0 kg/week; gain is capped at 0.5 kg/week.
export const LOSS_RATE_OPTIONS_KG: ReadonlyArray<number> = [0.125, 0.25, 0.5, 0.75, 1.0]
export const GAIN_RATE_OPTIONS_KG: ReadonlyArray<number> = [0.125, 0.25, 0.5]
// Backward-compat alias
export const RATE_OPTIONS_KG = LOSS_RATE_OPTIONS_KG

export interface WeightGoalResult {
  direction:      WeightGoalDirection
  weightDiffKg:   number   // absolute difference
  weeks:          number   // ceiling division — 0 when already at goal
  projectedDate:  Date     // today + weeks × 7 days
}

export type WeightGoalOutcome =
  | ({ ok: true }  & WeightGoalResult)
  | ({ ok: false } & { reason: WeightGoalErrorReason; message: string })

function isValidWeight(kg: number): boolean {
  return isFinite(kg) && kg > 0 && kg <= 500
}

function isValidRate(kgPerWeek: number): boolean {
  return isFinite(kgPerWeek) && kgPerWeek > 0 && kgPerWeek <= 10
}

/**
 * Estimate weeks and projected date to reach a weight goal.
 *
 * All inputs in kg; the `today` parameter lets callers pin the reference date
 * (useful for testing without real-time dependency).
 */
export function calcWeightGoalTimeline(
  currentWeightKg: number,
  goalWeightKg:    number,
  weeklyRateKg:    number,
  today:           Date = new Date(),
): WeightGoalOutcome {
  if (!isValidWeight(currentWeightKg)) {
    return {
      ok: false, reason: 'invalid_current_weight',
      message: 'Current weight must be a positive number up to 500 kg.',
    }
  }
  if (!isValidWeight(goalWeightKg)) {
    return {
      ok: false, reason: 'invalid_goal_weight',
      message: 'Goal weight must be a positive number up to 500 kg.',
    }
  }
  if (!isValidRate(weeklyRateKg)) {
    return {
      ok: false, reason: 'invalid_rate',
      message: 'Weekly rate must be a positive number.',
    }
  }

  const diff    = goalWeightKg - currentWeightKg
  const absDiff = Math.abs(diff)

  // Treat a difference < 0.05 kg as "already at goal" to avoid floating-point
  // noise generating a spurious week when the user types the same value.
  const direction: WeightGoalDirection =
    diff < -0.05 ? 'loss' : diff > 0.05 ? 'gain' : 'maintain'

  if (direction === 'maintain') {
    return { ok: true, direction, weightDiffKg: 0, weeks: 0, projectedDate: new Date(today) }
  }

  const weeks = Math.ceil(absDiff / weeklyRateKg)
  const projectedDate = new Date(today)
  projectedDate.setDate(projectedDate.getDate() + weeks * 7)

  return { ok: true, direction, weightDiffKg: absDiff, weeks, projectedDate }
}
