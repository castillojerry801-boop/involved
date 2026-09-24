import { Capacitor, registerPlugin } from '@capacitor/core'

interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>
  requestPermissions(): Promise<{ granted: boolean }>
  queryWorkouts(options: { startDate: string; endDate: string }): Promise<{ workouts: RawHKWorkout[] }>
  queryBodyMass(options: { startDate: string; endDate: string }): Promise<{ samples: RawBodyMassSample[] }>
  queryRestingHeartRate(options: { startDate: string; endDate: string }): Promise<{ samples: RawRHRSample[] }>
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

const HealthKit = registerPlugin<HealthKitPlugin>('HealthKit')

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

export async function isHealthKitAvailable(): Promise<boolean> {
  const platform = Capacitor.getPlatform()
  const pluginAvailable = Capacitor.isPluginAvailable('HealthKit')
  console.log('[Involved] platform:', platform, '| HealthKit in PluginHeaders:', pluginAvailable)

  if (!isNativeApp()) {
    console.log('[Involved] isHealthKitAvailable: false — not native platform')
    return false
  }
  if (!pluginAvailable) {
    console.log('[Involved] isHealthKitAvailable: false — HealthKit plugin not registered')
    return false
  }
  try {
    const { available } = await HealthKit.isAvailable()
    console.log('[Involved] HealthKit.isAvailable() native result:', available)
    return available
  } catch (err) {
    console.log('[Involved] HealthKit.isAvailable() threw:', String(err))
    return false
  }
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  const { granted } = await HealthKit.requestPermissions()
  return granted
}

export async function queryWorkouts(startDate: Date, endDate: Date): Promise<RawHKWorkout[]> {
  const { workouts } = await HealthKit.queryWorkouts({
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  })
  return workouts
}

export async function queryBodyMass(startDate: Date, endDate: Date): Promise<RawBodyMassSample[]> {
  const { samples } = await HealthKit.queryBodyMass({
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  })
  return samples
}

export async function queryRestingHeartRate(startDate: Date, endDate: Date): Promise<RawRHRSample[]> {
  const { samples } = await HealthKit.queryRestingHeartRate({
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  })
  return samples
}
