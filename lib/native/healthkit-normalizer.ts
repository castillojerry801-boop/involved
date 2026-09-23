import type { RawHKWorkout, RawBodyMassSample, RawRHRSample } from './healthkit'

// Maps HKWorkoutActivityType rawValue → Involved HealthActivityType enum string.
// Only valid HealthActivityType values are used as targets.
const HK_TYPE_MAP: Record<number, string> = {
  1: 'other',           // american_football
  2: 'other',           // archery
  3: 'other',           // australian_football
  4: 'other',           // badminton
  5: 'other',           // baseball
  6: 'other',           // basketball
  7: 'other',           // bowling
  8: 'other',           // boxing → could be hiit
  9: 'other',           // climbing
  10: 'other',          // cricket
  11: 'cross_training',
  13: 'cycling',
  16: 'elliptical',
  20: 'functional_strength',
  24: 'other',          // golf
  25: 'other',          // gymnastics
  26: 'other',          // handball
  27: 'hiking',
  28: 'other',          // hockey
  29: 'other',          // hunting
  31: 'other',          // lacrosse
  32: 'other',          // martial_arts
  34: 'cross_training', // mixed_cardio
  35: 'other',          // paddle_sports
  36: 'other',          // play
  37: 'other',          // preparation_and_recovery
  38: 'other',          // racquetball
  39: 'rowing',
  40: 'other',          // rugby
  41: 'running',
  42: 'other',          // sailing
  43: 'other',          // skating
  44: 'other',          // skiing
  45: 'other',          // snowboarding
  46: 'other',          // snowshoeing
  47: 'other',          // soccer
  48: 'other',          // softball
  49: 'other',          // squash
  50: 'stair_climbing',
  51: 'other',          // surfing
  52: 'swimming',
  53: 'other',          // table_tennis
  54: 'other',          // tennis
  55: 'other',          // track_and_field
  56: 'strength_training',
  57: 'other',          // volleyball
  58: 'walking',
  59: 'other',          // water_fitness
  60: 'other',          // water_polo
  61: 'other',          // water_sports
  62: 'other',          // wrestling
  63: 'yoga',
  64: 'other',          // barre
  65: 'strength_training', // core_training
  66: 'other',          // cross_country_skiing
  67: 'other',          // downhill_skiing
  68: 'other',          // flexibility
  69: 'hiit',
  70: 'other',          // jump_rope
  71: 'other',          // kickboxing
  72: 'yoga',           // pilates
  74: 'stair_climbing', // stairs
  75: 'other',          // step_training
  76: 'walking',        // wheelchair_walk_pace
  77: 'running',        // wheelchair_run_pace
  78: 'yoga',           // tai_chi
  79: 'hiit',           // mixed_metabolic_cardio
  80: 'cycling',        // hand_cycling
  82: 'other',          // disc_sports
  83: 'other',          // fitness_gaming
  3000: 'other',
}

const HK_DISPLAY_NAMES: Record<number, string> = {
  11: 'Cross Training',
  13: 'Cycling',
  16: 'Elliptical',
  20: 'Functional Strength',
  27: 'Hiking',
  39: 'Rowing',
  41: 'Running',
  50: 'Stair Climbing',
  52: 'Swimming',
  56: 'Strength Training',
  58: 'Walking',
  63: 'Yoga',
  65: 'Core Training',
  69: 'HIIT',
  72: 'Pilates',
  78: 'Tai Chi',
  79: 'Cardio Training',
  3000: 'Workout',
}

export function normalizeActivityType(hkRawValue: number): string {
  return HK_TYPE_MAP[hkRawValue] ?? 'other'
}

export function activityTitle(hkRawValue: number, sourceName?: string): string {
  if (HK_DISPLAY_NAMES[hkRawValue]) return HK_DISPLAY_NAMES[hkRawValue]
  // Use source app name as a fallback for unmapped types
  return sourceName ?? 'Workout'
}

export interface NormalizedWorkout {
  externalId: string
  provider: 'apple_health'
  activityType: string
  title: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  distanceMeters: number | null
  activeEnergyKcal: number | null
  totalEnergyKcal: number | null
  avgHeartRate: number | null
  maxHeartRate: number | null
  sourceApp: string
}

export function normalizeWorkout(raw: RawHKWorkout): NormalizedWorkout {
  return {
    externalId: raw.uuid,
    provider: 'apple_health',
    activityType: normalizeActivityType(raw.workoutActivityType),
    title: activityTitle(raw.workoutActivityType, raw.sourceName),
    startedAt: raw.startDate,
    endedAt: raw.endDate,
    durationSeconds: Math.round(raw.duration),
    distanceMeters: raw.distanceM ?? null,
    activeEnergyKcal: raw.activeEnergyKcal ?? null,
    totalEnergyKcal: raw.totalEnergyKcal ?? null,
    avgHeartRate: raw.avgHeartRate ?? null,
    maxHeartRate: raw.maxHeartRate ?? null,
    sourceApp: raw.sourceName,
  }
}

export interface NormalizedMetric {
  externalId: string
  provider: 'apple_health'
  metricType: 'body_weight_kg' | 'heart_rate_resting_bpm'
  value: number
  unit: string
  recordedAt: string
}

export function normalizeBodyMass(raw: RawBodyMassSample): NormalizedMetric {
  return {
    externalId: raw.uuid,
    provider: 'apple_health',
    metricType: 'body_weight_kg',
    value: raw.weightKg,
    unit: 'kg',
    recordedAt: raw.recordedAt,
  }
}

export function normalizeRHR(raw: RawRHRSample): NormalizedMetric {
  return {
    externalId: raw.uuid,
    provider: 'apple_health',
    metricType: 'heart_rate_resting_bpm',
    value: raw.bpm,
    unit: 'bpm',
    recordedAt: raw.recordedAt,
  }
}
