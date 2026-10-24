// Centralized subscription configuration.
// All prices, limits, and feature entitlements live here.
// UI and server code derive values from this file — never hard-code.
// Safe to import from both client and server code.

// ─── Tiers ───────────────────────────────────────────────────────────────────

export type EffectiveTier = 'free' | 'trial' | 'plus' | 'trainer'

// ─── Pricing ─────────────────────────────────────────────────────────────────

export const PRICING = {
  currency: 'USD',
  currencySymbol: '$',
  monthly: {
    amount: 6.99,
    productIds: {
      stripe: 'prod_involved_plus_monthly',
      apple:  'com.involved.plus.monthly',
      google: 'involved_plus_monthly',
    },
  },
  annual: {
    amount: 49.99,
    productIds: {
      stripe: 'prod_involved_plus_annual',
      apple:  'com.involved.plus.annual',
      google: 'involved_plus_annual',
    },
  },
} as const

export const TRIAL_DAYS = 14

export function annualSavings() {
  const monthlyAnnualized = +(PRICING.monthly.amount * 12).toFixed(2)
  const saved = +(monthlyAnnualized - PRICING.annual.amount).toFixed(2)
  const effectiveMonthly = +(PRICING.annual.amount / 12).toFixed(2)
  const savingsPct = Math.round((saved / monthlyAnnualized) * 100)
  return { monthlyAnnualized, saved, effectiveMonthly, savingsPct }
}

// ─── Trainer tier config ──────────────────────────────────────────────────────
// Three fixed monthly plans — Apple App Store and Google Play only (no Stripe).
// maxClients is enforced at the application layer; Studio (50) is the hard ceiling.
// Product IDs are placeholders — configure in App Store Connect and Google Play
// Console before enabling billing.

export const TRAINER_TIERS = {
  trainer_starter: { maxClients:  5, monthlyAmount: 24.99, label: 'Starter' },
  trainer_pro:     { maxClients: 20, monthlyAmount: 49.99, label: 'Pro'     },
  trainer_studio:  { maxClients: 50, monthlyAmount: 99.99, label: 'Studio'  },
} as const

export type TrainerTierKey = keyof typeof TRAINER_TIERS

// Maximum active clients across all plans — Studio cap is the absolute ceiling.
export const TRAINER_MAX_CLIENTS_ABSOLUTE = 50

export const TRAINER_PRODUCT_IDS: Record<TrainerTierKey, { apple: string; google: string }> = {
  trainer_starter: {
    apple:  'com.involved.trainer.starter.monthly',
    google: 'involved_trainer_starter_monthly',
  },
  trainer_pro: {
    apple:  'com.involved.trainer.pro.monthly',
    google: 'involved_trainer_pro_monthly',
  },
  trainer_studio: {
    apple:  'com.involved.trainer.studio.monthly',
    google: 'involved_trainer_studio_monthly',
  },
}

// ─── Feature entitlements ─────────────────────────────────────────────────────

export type FeatureKey =
  | 'coach_basic'
  | 'coach_unlimited'
  | 'workout_generation'
  | 'workout_generation_ai'
  | 'meal_photo_analysis'
  | 'nutrition_label_scan'
  | 'advanced_insights'
  | 'weekly_review'
  | 'premium_programs'
  | 'voice_logging'
  | 'shorten_workout'
  | 'health_sync'
  | 'trainer_dashboard'
  | 'trainer_client_management'
  | 'trainer_program_library'
  | 'trainer_v_summaries'

const ALL: readonly EffectiveTier[] = ['free', 'trial', 'plus', 'trainer']
const PLUS_AND_UP: readonly EffectiveTier[] = ['trial', 'plus', 'trainer']
const TRAINER_ONLY: readonly EffectiveTier[] = ['trainer']

export const FEATURE_ENTITLEMENTS: Record<FeatureKey, { tiers: readonly EffectiveTier[] }> = {
  coach_basic:                { tiers: ALL },
  workout_generation:         { tiers: ALL },
  health_sync:                { tiers: ALL },
  coach_unlimited:            { tiers: PLUS_AND_UP },
  workout_generation_ai:      { tiers: ALL },
  meal_photo_analysis:        { tiers: PLUS_AND_UP },
  nutrition_label_scan:       { tiers: PLUS_AND_UP },
  advanced_insights:          { tiers: PLUS_AND_UP },
  weekly_review:              { tiers: PLUS_AND_UP },
  premium_programs:           { tiers: PLUS_AND_UP },
  voice_logging:              { tiers: PLUS_AND_UP },
  shorten_workout:            { tiers: PLUS_AND_UP },
  trainer_dashboard:          { tiers: TRAINER_ONLY },
  trainer_client_management:  { tiers: TRAINER_ONLY },
  trainer_program_library:    { tiers: TRAINER_ONLY },
  trainer_v_summaries:        { tiers: TRAINER_ONLY },
}

export function hasFeatureAccess(tier: EffectiveTier, feature: FeatureKey): boolean {
  return (FEATURE_ENTITLEMENTS[feature].tiers as readonly string[]).includes(tier)
}

// ─── AI usage limits ──────────────────────────────────────────────────────────

export type AiFeatureKey =
  | 'coach_message'
  | 'workout_generation'
  | 'meal_photo'
  | 'label_scan'
  | 'progress_insight'
  | 'weekly_review'
  | 'voice_transcription'
  | 'voice_intent'
  | 'workout_adjustment'
  | 'substitution'

export type AiLimitRecord = Record<AiFeatureKey, number | null>

function envInt(key: string, fallback: number): number {
  const v = parseInt(process.env[key] ?? '')
  return Number.isFinite(v) ? v : fallback
}

export const AI_LIMITS: Record<EffectiveTier, AiLimitRecord> = {
  free: {
    coach_message:       envInt('LIMIT_FREE_COACH',         20),
    workout_generation:  envInt('LIMIT_FREE_WORKOUT',        5),
    meal_photo:          envInt('LIMIT_FREE_MEAL_PHOTO',     0),
    label_scan:          envInt('LIMIT_FREE_LABEL_SCAN',     0),
    progress_insight:    envInt('LIMIT_FREE_INSIGHT',        0),
    weekly_review:       envInt('LIMIT_FREE_REVIEW',         0),
    voice_transcription: envInt('LIMIT_FREE_VOICE_TX',       0),
    voice_intent:        envInt('LIMIT_FREE_VOICE_INTENT',   0),
    workout_adjustment:  envInt('LIMIT_FREE_WO_ADJUST',      0),
    substitution:        envInt('LIMIT_FREE_SUBSTITUTION',   5),
  },
  trial: {
    coach_message:       envInt('LIMIT_TRIAL_COACH',       100),
    workout_generation:  envInt('LIMIT_TRIAL_WORKOUT',      20),
    meal_photo:          envInt('LIMIT_TRIAL_MEAL_PHOTO',   15),
    label_scan:          envInt('LIMIT_TRIAL_LABEL_SCAN',   20),
    progress_insight:    envInt('LIMIT_TRIAL_INSIGHT',      10),
    weekly_review:       envInt('LIMIT_TRIAL_REVIEW',        4),
    voice_transcription: envInt('LIMIT_TRIAL_VOICE_TX',     50),
    voice_intent:        envInt('LIMIT_TRIAL_VOICE_INTENT', 50),
    workout_adjustment:  envInt('LIMIT_TRIAL_WO_ADJUST',     5),
    substitution:        envInt('LIMIT_TRIAL_SUBSTITUTION', 20),
  },
  plus: {
    coach_message:       null,
    workout_generation:  null,
    meal_photo:          null,
    label_scan:          null,
    progress_insight:    null,
    weekly_review:       null,
    voice_transcription: null,
    voice_intent:        null,
    workout_adjustment:  null,
    substitution:        null,
  },
  // Trainers get unlimited AI on their own account
  trainer: {
    coach_message:       null,
    workout_generation:  null,
    meal_photo:          null,
    label_scan:          null,
    progress_insight:    null,
    weekly_review:       null,
    voice_transcription: null,
    voice_intent:        null,
    workout_adjustment:  null,
    substitution:        null,
  },
}

export function getAiLimit(tier: EffectiveTier, feature: AiFeatureKey): number | null {
  return AI_LIMITS[tier][feature]
}

// ─── Upgrade messaging ────────────────────────────────────────────────────────

export const PLUS_HIGHLIGHTS = [
  'Unlimited AI Coach conversations',
  'Personalized AI workout generation',
  'Voice workout logging',
  'Meal photo nutrition analysis',
  'Nutrition label scanning',
  'Advanced progress insights',
  'Weekly AI review',
] as const

export const TRAINER_HIGHLIGHTS = [
  'Full client dashboard with progress tracking',
  'Reusable program template library',
  'Assign and customize programs per client',
  'Set nutrition and training targets per client',
  'V AI summaries and draft suggestions for clients',
  'Clients keep their data if the relationship ends',
] as const
