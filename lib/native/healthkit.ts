import { Capacitor, registerPlugin } from '@capacitor/core'

interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>
  requestPermissions(): Promise<{ granted: boolean }>
  queryWorkouts(options: { startDate: string; endDate: string }): Promise<{ workouts: RawHKWorkout[] }>
  queryBodyMass(options: { startDate: string; endDate: string }): Promise<{ samples: RawBodyMassSample[] }>
  queryRestingHeartRate(options: { startDate: string; endDate: string }): Promise<{ samples: RawRHRSample[] }>
  querySteps(options: { startDate: string; endDate: string }): Promise<{ dailySteps: RawStepDay[] }>
  queryDailyEnergy(options: { startDate: string; endDate: string }): Promise<{ dailyEnergy: RawDailyEnergy[] }>
}

export interface RawHKWorkout {
  uuid: string
  workoutActivityType: number
  startDate: string
  endDate: string
  duration: number
  sourceName: string
  sourceBundle: string
  activeEnergyKcal?: number
  totalEnergyKcal?: number
  distanceM?: number
  avgHeartRate?: number
  maxHeartRate?: number
  hrSampleCount?: number
}

export interface RawBodyMassSample {
  uuid: string
  weightKg: number
  recordedAt: string
  sourceName: string
}

export interface RawRHRSample {
  uuid: string
  bpm: number
  recordedAt: string
}

export interface RawStepDay {
  // ISO 8601 string for midnight of the day (from HKStatisticsCollectionQuery startDate)
  date: string
  steps: number
}

export interface RawDailyEnergy {
  // ISO 8601 string for device-local midnight of the day
  date: string
  activeEnergyKcal?: number
  basalEnergyKcal?: number
}

const HealthKit = registerPlugin<HealthKitPlugin>('HealthKit')

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

export async function isHealthKitAvailable(): Promise<boolean> {
  if (!isNativeApp()) return false
  try {
    const { available } = await HealthKit.isAvailable()
    return available
  } catch {
    return false
  }
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  const { granted } = await HealthKit.requestPermissions()
  return granted
}

export async function queryWorkouts(startDate: Date, endDate: Date): Promise<RawHKWorkout[]> {
  const { workouts } = await HealthKit.queryWorkouts({
    startDate: startDate.toISOString().slice(0, 19) + 'Z',
    endDate: endDate.toISOString().slice(0, 19) + 'Z',
  })
  return workouts
}

export async function queryBodyMass(startDate: Date, endDate: Date): Promise<RawBodyMassSample[]> {
  const { samples } = await HealthKit.queryBodyMass({
    startDate: startDate.toISOString().slice(0, 19) + 'Z',
    endDate: endDate.toISOString().slice(0, 19) + 'Z',
  })
  return samples
}

export async function queryRestingHeartRate(startDate: Date, endDate: Date): Promise<RawRHRSample[]> {
  const { samples } = await HealthKit.queryRestingHeartRate({
    startDate: startDate.toISOString().slice(0, 19) + 'Z',
    endDate: endDate.toISOString().slice(0, 19) + 'Z',
  })
  return samples
}

export async function querySteps(startDate: Date, endDate: Date): Promise<RawStepDay[]> {
  const { dailySteps } = await HealthKit.querySteps({
    startDate: startDate.toISOString().slice(0, 19) + 'Z',
    endDate: endDate.toISOString().slice(0, 19) + 'Z',
  })
  return dailySteps
}

export async function queryDailyEnergy(startDate: Date, endDate: Date): Promise<RawDailyEnergy[]> {
  const { dailyEnergy } = await HealthKit.queryDailyEnergy({
    startDate: startDate.toISOString().slice(0, 19) + 'Z',
    endDate: endDate.toISOString().slice(0, 19) + 'Z',
  })
  return dailyEnergy
}
