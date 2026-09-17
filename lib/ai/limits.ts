// Usage limits per subscription tier.
// All values are configurable via env vars — not hard-coded.
// null = unlimited.

export type AiFeature = 'coach_message' | 'workout_generation' | 'meal_photo' | 'label_scan'

interface TierLimits {
  coach_message: number | null
  workout_generation: number | null
  meal_photo: number | null
  label_scan: number | null
}

export const LIMITS: Record<'free' | 'plus', TierLimits> = {
  free: {
    coach_message:       parseInt(process.env.LIMIT_FREE_COACH ?? '25'),
    workout_generation:  parseInt(process.env.LIMIT_FREE_WORKOUT ?? '5'),
    meal_photo:          parseInt(process.env.LIMIT_FREE_MEAL_PHOTO ?? '5'),
    label_scan:          parseInt(process.env.LIMIT_FREE_LABEL_SCAN ?? '10'),
  },
  plus: {
    coach_message:      null,
    workout_generation: null,
    meal_photo:         null,
    label_scan:         null,
  },
}

export function getLimit(tier: 'free' | 'plus', feature: AiFeature): number | null {
  return LIMITS[tier][feature]
}
