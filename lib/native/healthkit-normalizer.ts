import type { RawHKWorkout, RawBodyMassSample, RawRHRSample } from './healthkit'

// Raw values verified against:
// HKWorkoutActivityType.h — HealthKit SDK (iOS 8–17, Xcode 16)
const HK_TYPE_MAP: Record<number, string> = {
  1:  'other',              // americanFootball
  2:  'other',              // archery
  3:  'other',              // australianFootball
  4:  'other',              // badminton
  5:  'other',              // baseball
  6:  'other',              // basketball
  7:  'other',              // bowling
  8:  'other',              // boxing
  9:  'other',              // climbing
  10: 'other',              // cricket
  11: 'cross_training',     // crossTraining
  12: 'other',              // curling
  13: 'cycling',            // cycling
  14: 'other',              // dance (deprecated iOS 14)
  15: 'other',              // danceInspiredTraining (deprecated iOS 10)
  16: 'elliptical',         // elliptical
  17: 'other',              // equestrianSports
  18: 'other',              // fencing
  19: 'other',              // fishing
  20: 'functional_strength', // functionalStrengthTraining
  21: 'other',              // golf
  22: 'other',              // gymnastics
  23: 'other',              // handball
  24: 'hiking',             // hiking
  25: 'other',              // hockey
  26: 'other',              // hunting
  27: 'other',              // lacrosse
  28: 'other',              // martialArts
  29: 'other',              // mindAndBody
  30: 'cross_training',     // mixedMetabolicCardioTraining (deprecated iOS 11)
  31: 'other',              // paddleSports
  32: 'other',              // play
  33: 'other',              // preparationAndRecovery
  34: 'other',              // racquetball
  35: 'rowing',             // rowing
  36: 'other',              // rugby
  37: 'running',            // running
  38: 'other',              // sailing
  39: 'other',              // skatingSports
  40: 'other',              // snowSports
  41: 'other',              // soccer
  42: 'other',              // softball
  43: 'other',              // squash
  44: 'stair_climbing',     // stairClimbing
  45: 'other',              // surfingSports
  46: 'swimming',           // swimming
  47: 'other',              // tableTennis
  48: 'other',              // tennis
  49: 'other',              // trackAndField
  50: 'strength_training',  // traditionalStrengthTraining
  51: 'other',              // volleyball
  52: 'walking',            // walking
  53: 'other',              // waterFitness
  54: 'other',              // waterPolo
  55: 'other',              // waterSports
  56: 'other',              // wrestling
  57: 'yoga',               // yoga
  58: 'other',              // barre (iOS 10)
  59: 'strength_training',  // coreTraining (iOS 10)
  60: 'other',              // crossCountrySkiing (iOS 10)
  61: 'other',              // downhillSkiing (iOS 10)
  62: 'other',              // flexibility (iOS 10)
  63: 'hiit',               // highIntensityIntervalTraining (iOS 10)
  64: 'other',              // jumpRope (iOS 10)
  65: 'other',              // kickboxing (iOS 10)
  66: 'other',              // pilates (iOS 10)
  67: 'other',              // snowboarding (iOS 10)
  68: 'stair_climbing',     // stairs (iOS 10)
  69: 'other',              // stepTraining (iOS 10)
  70: 'other',              // wheelchairWalkPace (iOS 10)
  71: 'other',              // wheelchairRunPace (iOS 10)
  72: 'other',              // taiChi (iOS 11)
  73: 'cross_training',     // mixedCardio (iOS 11)
  74: 'cycling',            // handCycling (iOS 11)
  75: 'other',              // discSports (iOS 13)
  76: 'other',              // fitnessGaming (iOS 13)
  77: 'other',              // cardioDance (iOS 14)
  78: 'other',              // socialDance (iOS 14)
  79: 'other',              // pickleball (iOS 14)
  80: 'other',              // cooldown (iOS 14)
  82: 'other',              // swimBikeRun (iOS 16)
  83: 'other',              // transition (iOS 16)
  84: 'other',              // underwaterDiving (iOS 17)
  3000: 'other',            // other
}

const HK_DISPLAY_NAMES: Record<number, string> = {
  11: 'Cross Training',
  13: 'Cycling',
  16: 'Elliptical',
  20: 'Functional Strength',
  24: 'Hiking',
  35: 'Rowing',
  37: 'Running',
  44: 'Stair Climbing',
  46: 'Swimming',
  50: 'Strength Training',
  52: 'Walking',
  57: 'Yoga',
  59: 'Core Training',
  63: 'HIIT',
  66: 'Pilates',
  68: 'Stairs',
  72: 'Tai Chi',
  73: 'Mixed Cardio',
  74: 'Hand Cycling',
  77: 'Cardio Dance',
  78: 'Social Dance',
  79: 'Pickleball',
  3000: 'Workout',
}

export function normalizeActivityType(hkRawValue: number): string {
  return HK_TYPE_MAP[hkRawValue] ?? 'other'
}

export function activityTitle(hkRawValue: number): string {
  return HK_DISPLAY_NAMES[hkRawValue] ?? 'Workout'
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
    title: activityTitle(raw.workoutActivityType),
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
