// Model routing — all model names configurable via env vars.
// No model names are ever exposed to the client.

export const MODELS = {
  coach: {
    free: process.env.AI_MODEL_COACH_FREE ?? 'gpt-4o-mini',
    plus: process.env.AI_MODEL_COACH_PLUS ?? 'gpt-4o',
  },
  workout: {
    free: process.env.AI_MODEL_WORKOUT_FREE ?? 'gpt-4o-mini',
    plus: process.env.AI_MODEL_WORKOUT_PLUS ?? 'gpt-4o',
  },
  vision: {
    default: process.env.AI_MODEL_VISION ?? 'gpt-4o',
  },
  extraction: {
    default: process.env.AI_MODEL_EXTRACTION ?? 'gpt-4o-mini',
  },
} as const

export type SubscriptionTier = 'free' | 'plus'

export function coachModel(tier: SubscriptionTier): string {
  return MODELS.coach[tier]
}

export function workoutModel(tier: SubscriptionTier): string {
  return MODELS.workout[tier]
}
