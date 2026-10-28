// Mifflin–St Jeor resting metabolic rate estimate (adult formula, validated for ages 18+).
// Results are statistical estimates, not measured energy expenditure.
// Reference: Mifflin MD et al. (1990). Am J Clin Nutr, 51(2), 241–247.

export type CalculatorSex = 'male' | 'female'

export type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active'

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary:   'Sedentary (little or no exercise)',
  light:       'Lightly active (1–3 days/week)',
  moderate:    'Moderately active (3–5 days/week)',
  active:      'Very active (6–7 days/week)',
  very_active: 'Extremely active (physical job + daily training)',
}

// Standard TDEE activity multipliers (Harris-Benedict / Katch-McArdle variant)
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary:   1.2,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.9,
}

export type TDEEErrorReason =
  | 'minor'
  | 'invalid_age'
  | 'invalid_weight'
  | 'invalid_height'

export type BMRResult =
  | { ok: true;  bmr: number; sex: CalculatorSex }
  | { ok: false; reason: TDEEErrorReason; message: string }

export type TDEEResult =
  | { ok: true;  bmr: number; tdee: number; sex: CalculatorSex; activityLevel: ActivityLevel }
  | { ok: false; reason: TDEEErrorReason; message: string }

export interface CalorieProjection {
  id:           'maintenance' | 'modest_deficit' | 'moderate_deficit' | 'lean_surplus'
  label:        string
  calories:     number
  description:  string
  floorApplied: boolean
}

// ─── Floors ──────────────────────────────────────────────────────────────────
// Commonly referenced clinical minimums for adult deficit calculations.
const CALORIE_FLOOR: Record<CalculatorSex, number> = {
  male:   1500,
  female: 1200,
}

// ─── Input validation ────────────────────────────────────────────────────────

function isValidWeight(kg: number): boolean {
  return isFinite(kg) && kg > 0 && kg <= 500
}

function isValidHeight(cm: number): boolean {
  return isFinite(cm) && cm > 0 && cm <= 300
}

function isValidAge(age: number): boolean {
  return isFinite(age) && age >= 0 && age <= 120
}

// ─── Core calculations ────────────────────────────────────────────────────────

/**
 * Mifflin–St Jeor BMR.
 *
 * Male:   10 × weightKg + 6.25 × heightCm − 5 × age + 5
 * Female: 10 × weightKg + 6.25 × heightCm − 5 × age − 161
 *
 * Only the two biological-sex variants are implemented. When sex is
 * unavailable (prefer_not_to_say or null), callers should prompt the
 * user before calling this function rather than passing a fabricated value.
 *
 * Returns an error for minors (age < 18) because the equation is not
 * validated for paediatric populations and adult weight-management
 * presets must not be applied to users under 18.
 */
export function calcBMR(
  weightKg: number,
  heightCm: number,
  age:      number,
  sex:      CalculatorSex,
): BMRResult {
  if (!isValidWeight(weightKg)) {
    return {
      ok:      false,
      reason:  'invalid_weight',
      message: 'Weight must be greater than 0 and no more than 500 kg.',
    }
  }
  if (!isValidHeight(heightCm)) {
    return {
      ok:      false,
      reason:  'invalid_height',
      message: 'Height must be greater than 0 and no more than 300 cm.',
    }
  }
  if (!isValidAge(age)) {
    return {
      ok:      false,
      reason:  'invalid_age',
      message: 'Age must be between 0 and 120 years.',
    }
  }
  if (age < 18) {
    return {
      ok:      false,
      reason:  'minor',
      message:
        'This calculator uses adult metabolic equations (Mifflin–St Jeor, validated for ages 18+). ' +
        'For users under 18, please consult a registered dietitian or healthcare provider.',
    }
  }

  const sexConstant = sex === 'male' ? 5 : -161
  const bmr = Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + sexConstant)

  return { ok: true, bmr, sex }
}

/**
 * Estimate Total Daily Energy Expenditure from BMR × activity multiplier.
 * TDEE is rounded to the nearest kcal.
 */
export function calcTDEE(
  weightKg:      number,
  heightCm:      number,
  age:           number,
  sex:           CalculatorSex,
  activityLevel: ActivityLevel,
): TDEEResult {
  const bmrResult = calcBMR(weightKg, heightCm, age, sex)
  if (!bmrResult.ok) return bmrResult

  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel]
  const tdee = Math.round(bmrResult.bmr * multiplier)

  return { ok: true, bmr: bmrResult.bmr, tdee, sex, activityLevel }
}

/**
 * Calorie projections derived from a valid TDEE estimate.
 *
 * Deficit rows are floored at the sex-appropriate clinical minimum
 * (1 500 kcal male / 1 200 kcal female). When the floor is applied,
 * `floorApplied` is set so the UI can surface an appropriate note.
 *
 * These are estimates for informational purposes, not medical prescriptions.
 */
export function calorieProjections(
  tdee: number,
  sex:  CalculatorSex,
): CalorieProjection[] {
  if (!isFinite(tdee) || tdee <= 0) return []

  const floor = CALORIE_FLOOR[sex]

  const modest   = tdee - 250
  const moderate = tdee - 500
  const surplus  = tdee + 250

  return [
    {
      id:           'maintenance',
      label:        'Maintenance',
      calories:     tdee,
      description:  'Estimated daily energy to maintain current weight.',
      floorApplied: false,
    },
    {
      id:           'modest_deficit',
      label:        'Modest deficit',
      calories:     Math.max(modest, floor),
      description:  'Targets approximately 0.5 lb / 0.25 kg loss per week.',
      floorApplied: modest < floor,
    },
    {
      id:           'moderate_deficit',
      label:        'Moderate deficit',
      calories:     Math.max(moderate, floor),
      description:  'Targets approximately 1 lb / 0.5 kg loss per week.',
      floorApplied: moderate < floor,
    },
    {
      id:           'lean_surplus',
      label:        'Lean surplus',
      calories:     surplus,
      description:  'Supports gradual muscle gain with limited fat accumulation.',
      floorApplied: false,
    },
  ]
}
