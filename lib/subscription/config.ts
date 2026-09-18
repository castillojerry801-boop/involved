// Centralized subscription configuration.
// All prices, limits, and feature entitlements live here.
// UI and server code derive values from this file — never hard-code.
// Safe to import from both client and server code.

// ─── Tiers ───────────────────────────────────────────────────────────────────

export type EffectiveTier = 'free' | 'trial' | 'plus'

// ─── Pricing ─────────────────────────────────────────────────────────────────

export const PRICING = {
  currency: 'USD',
  currencySymbol: '$',
  monthly: {
    amount: 5.99,
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

/** Computed annual savings — never hard-coded in marketing copy. */
export function annualSavings() {
  const monthlyAnnualized = +(PRICING.monthly.amount * 12).toFixed(2)
  const saved = +(monthlyAnnualized - PRICING.annual.amount).toFixed(2)
  const effectiveMonthly = +(PRICING.annual.amount / 12).toFixed(2)
  const savingsPct = Math.round((saved / monthlyAnnualized) * 100)
  return { monthlyAnnualized, saved, effectiveMonthly, savingsPct }
}

// ─── Feature entitlements ─────────────────────────────────────────────────────
// Extend this map to add new features without touching UI gate components.

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

const ALL: readonly EffectiveTier[] = ['free', 'trial', 'plus']
const PLUS_ONLY: readonly EffectiveTier[] = ['trial', 'plus']

export const FEATURE_ENTITLEMENTS: Record<FeatureKey, { tiers: readonly EffectiveTier[] }> = {
  // Available to everyone
  coach_basic:           { tiers: ALL },
  workout_generation:    { tiers: ALL },
  // Involved+ and trial only
  coach_unlimited:       { tiers: PLUS_ONLY },
  workout_generation_ai: { tiers: PLUS_ONLY },
  meal_photo_analysis:   { tiers: PLUS_ONLY },
  nutrition_label_scan:  { tiers: PLUS_ONLY },
  advanced_insights:     { tiers: PLUS_ONLY },
  weekly_review:         { tiers: PLUS_ONLY },
  premium_programs:      { tiers: PLUS_ONLY },
}

export function hasFeatureAccess(tier: EffectiveTier, feature: FeatureKey): boolean {
  return (FEATURE_ENTITLEMENTS[feature].tiers as readonly string[]).includes(tier)
}

// ─── AI usage limits ──────────────────────────────────────────────────────────
// null = unlimited. Numbers can be overridden via env vars.
// All AI categories the app currently meters.

export type AiFeatureKey =
  | 'coach_message'
  | 'workout_generation'
  | 'meal_photo'
  | 'label_scan'
  | 'progress_insight'
  | 'weekly_review'

export type AiLimitRecord = Record<AiFeatureKey, number | null>

function envInt(key: string, fallback: number): number {
  const v = parseInt(process.env[key] ?? '')
  return Number.isFinite(v) ? v : fallback
}

export const AI_LIMITS: Record<EffectiveTier, AiLimitRecord> = {
  free: {
    coach_message:      envInt('LIMIT_FREE_COACH',        25),
    workout_generation: envInt('LIMIT_FREE_WORKOUT',       5),
    meal_photo:         envInt('LIMIT_FREE_MEAL_PHOTO',    0),
    label_scan:         envInt('LIMIT_FREE_LABEL_SCAN',    0),
    progress_insight:   envInt('LIMIT_FREE_INSIGHT',       0),
    weekly_review:      envInt('LIMIT_FREE_REVIEW',        0),
  },
  trial: {
    coach_message:      envInt('LIMIT_TRIAL_COACH',      100),
    workout_generation: envInt('LIMIT_TRIAL_WORKOUT',     20),
    meal_photo:         envInt('LIMIT_TRIAL_MEAL_PHOTO',  15),
    label_scan:         envInt('LIMIT_TRIAL_LABEL_SCAN',  20),
    progress_insight:   envInt('LIMIT_TRIAL_INSIGHT',     10),
    weekly_review:      envInt('LIMIT_TRIAL_REVIEW',       4),
  },
  plus: {
    coach_message:      null,
    workout_generation: null,
    meal_photo:         null,
    label_scan:         null,
    progress_insight:   null,
    weekly_review:      null,
  },
}

export function getAiLimit(tier: EffectiveTier, feature: AiFeatureKey): number | null {
  return AI_LIMITS[tier][feature]
}

// ─── Upgrade messaging ────────────────────────────────────────────────────────
// Used by upgrade gates to describe what's included with Involved+.

// ─── Trainer tier config ──────────────────────────────────────────────────────
// Pricing is placeholder — finalize before launch.
// maxClients drives the DB-enforced client limit per trainer.

export const TRAINER_TIERS = {
  trainer_10: { maxClients: 10, monthlyAmount: 29.99, label: 'Starter' },
  trainer_20: { maxClients: 20, monthlyAmount: 49.99, label: 'Growth' },
  trainer_50: { maxClients: 50, monthlyAmount: 99.99, label: 'Pro' },
} as const

export type TrainerTierKey = keyof typeof TRAINER_TIERS

// ─── Upgrade messaging ────────────────────────────────────────────────────────

export const PLUS_HIGHLIGHTS = [
  'Unlimited AI Coach conversations',
  'Personalized AI workout generation',
  'Meal photo nutrition analysis',
  'Nutrition label scanning',
  'Advanced progress insights',
  'Weekly AI review',
] as const
