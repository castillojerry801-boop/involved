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
  voice: {
    transcription: process.env.AI_MODEL_VOICE_TRANSCRIPTION ?? 'whisper-1',
    intent:        process.env.AI_MODEL_VOICE_INTENT        ?? 'gpt-4o-mini',
  },
} as const

// ── V Coach routing ───────────────────────────────────────────────────────────
// Cost-conscious split: a cheap model handles chat / intake / clarification /
// exercise-search orchestration; a stronger-but-still-low-cost model drafts the
// full structured multi-week program; the strongest model is used ONLY as the
// final recovery attempt when the program still has hard validation errors.
export const V_CHAT_MODEL       = process.env.AI_MODEL_V_CHAT       ?? 'gpt-4o-mini'
export const V_PROGRAM_MODEL    = process.env.AI_MODEL_V_PROGRAM    ?? 'gpt-6-luna'
export const V_ESCALATION_MODEL = process.env.AI_MODEL_V_ESCALATION ?? 'gpt-6-sol'

export type SubscriptionTier = 'free' | 'plus'

export function coachModel(tier: SubscriptionTier): string {
  return MODELS.coach[tier]
}

export function workoutModel(tier: SubscriptionTier): string {
  return MODELS.workout[tier]
}
