// Calorie-to-macro allocation using standard energy density constants.
// 4 kcal/g protein · 4 kcal/g carbohydrate · 9 kcal/g fat
//
// Functions are pure and produce no side effects.
// Callers are responsible for validating that inputs are within
// reasonable nutritional ranges before persisting results.

export type MacroGoal = 'weight_loss' | 'maintenance' | 'muscle_gain' | 'endurance'

export const MACRO_GOAL_LABELS: Record<MacroGoal, string> = {
  weight_loss: 'Weight loss',
  maintenance: 'Maintenance',
  muscle_gain: 'Muscle gain',
  endurance:   'Endurance',
}

interface MacroSplit {
  proteinPct: number
  fatPct:     number
  carbPct:    number
}

// Preset macro percentage splits. Each triple sums to exactly 100.
// These are adjustable starting points, not medical recommendations.
const MACRO_SPLITS: Record<MacroGoal, MacroSplit> = {
  weight_loss: { proteinPct: 35, fatPct: 30, carbPct: 35 },
  maintenance: { proteinPct: 30, fatPct: 30, carbPct: 40 },
  muscle_gain: { proteinPct: 30, fatPct: 25, carbPct: 45 },
  endurance:   { proteinPct: 20, fatPct: 25, carbPct: 55 },
}

export const KCAL_PER_PROTEIN  = 4
export const KCAL_PER_CARB     = 4
export const KCAL_PER_FAT      = 9

export interface MacroTargets {
  calories:      number
  proteinG:      number
  carbohydrateG: number
  fatG:          number
  // The split percentages used to derive these grams.
  proteinPct: number
  fatPct:     number
  carbPct:    number
}

export type MacroResult =
  | { ok: true;  targets: MacroTargets }
  | { ok: false; reason: string; message: string }

// ─── Input validation ────────────────────────────────────────────────────────

function isValidCalories(cal: number): boolean {
  return isFinite(cal) && cal > 0
}

function isValidPct(pct: number): boolean {
  return isFinite(pct) && pct >= 0 && pct <= 100
}

// ─── Core allocation ─────────────────────────────────────────────────────────

/**
 * Allocate grams from a total calorie target using a percentage split.
 *
 * Protein and fat grams are derived first (anchors), then carbohydrates
 * absorb the remaining calorie slack so that rounding does not compound
 * across all three macros.
 *
 * Negative carbohydrate results are clamped to 0 — this can occur when
 * extreme splits (e.g. very high fat + protein) leave no calorie room.
 */
function allocate(
  calories:   number,
  proteinPct: number,
  fatPct:     number,
  carbPct:    number,
): MacroTargets {
  const proteinG      = Math.round((calories * proteinPct / 100) / KCAL_PER_PROTEIN)
  const fatG          = Math.round((calories * fatPct     / 100) / KCAL_PER_FAT)
  const carbCalSlack  = calories - proteinG * KCAL_PER_PROTEIN - fatG * KCAL_PER_FAT
  const carbohydrateG = Math.max(0, Math.round(carbCalSlack / KCAL_PER_CARB))

  return { calories, proteinG, carbohydrateG, fatG, proteinPct, fatPct, carbPct }
}

/**
 * Suggest macro gram targets for a given calorie goal and preset.
 *
 * Rejects zero, negative, non-finite, and unreasonably extreme calorie
 * values — callers must provide a valid positive number.
 */
export function suggestMacros(calories: number, goal: MacroGoal): MacroResult {
  if (!isValidCalories(calories)) {
    return { ok: false, reason: 'invalid_calories', message: 'Calories must be a positive finite number.' }
  }
  if (calories < 400) {
    return {
      ok:      false,
      reason:  'calories_too_low',
      message: 'Calorie target is too low to distribute meaningfully across macros.',
    }
  }
  if (calories > 15000) {
    return {
      ok:      false,
      reason:  'calories_too_high',
      message: 'Calorie target exceeds the supported range of 15 000 kcal.',
    }
  }

  const split = MACRO_SPLITS[goal]
  return { ok: true, targets: allocate(calories, split.proteinPct, split.fatPct, split.carbPct) }
}

/**
 * Validate that three macro percentages are non-negative and sum to exactly 100.
 */
export function validateMacroSplit(
  proteinPct: number,
  fatPct:     number,
  carbPct:    number,
): boolean {
  return (
    isValidPct(proteinPct) &&
    isValidPct(fatPct)     &&
    isValidPct(carbPct)    &&
    proteinPct + fatPct + carbPct === 100
  )
}

/**
 * Allocate macro grams from calories and caller-supplied percentage splits.
 *
 * Use `validateMacroSplit` to guard inputs before calling this function.
 * Returns an error if the split does not total 100 or calories are invalid.
 */
export function macrosFromSplit(
  calories:   number,
  proteinPct: number,
  fatPct:     number,
  carbPct:    number,
): MacroResult {
  if (!validateMacroSplit(proteinPct, fatPct, carbPct)) {
    return {
      ok:      false,
      reason:  'invalid_split',
      message: 'Macro percentages must each be non-negative and total exactly 100.',
    }
  }
  if (!isValidCalories(calories)) {
    return { ok: false, reason: 'invalid_calories', message: 'Calories must be a positive finite number.' }
  }

  return { ok: true, targets: allocate(calories, proteinPct, fatPct, carbPct) }
}

/**
 * Check whether the macro gram values in a MacroTargets object are consistent
 * with its declared calorie value, within a rounding tolerance of ±10 kcal.
 *
 * Useful for displaying a consistency note in the UI.
 */
export function macroCalorieConsistency(targets: MacroTargets): {
  impliedCalories: number
  withinTolerance: boolean
} {
  const impliedCalories =
    targets.proteinG * KCAL_PER_PROTEIN +
    targets.carbohydrateG * KCAL_PER_CARB +
    targets.fatG * KCAL_PER_FAT

  return {
    impliedCalories,
    withinTolerance: Math.abs(impliedCalories - targets.calories) <= 10,
  }
}
