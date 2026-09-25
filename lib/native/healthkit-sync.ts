import {
  isHealthKitAvailable,
  requestHealthKitPermissions,
  queryWorkouts,
  queryBodyMass,
  queryRestingHeartRate,
  querySteps,
  queryDailyEnergy,
} from './healthkit'
import {
  normalizeWorkout,
  normalizeBodyMass,
  normalizeRHR,
  normalizeStepDay,
  normalizeDailyActiveEnergy,
  normalizeDailyBasalEnergy,
  type NormalizedWorkout,
  type NormalizedMetric,
} from './healthkit-normalizer'

const BATCH_SIZE = 50
const INITIAL_SYNC_DAYS = 30

async function postJSON(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function syncWorkouts(startDate: Date, endDate: Date): Promise<{ synced: number; errors: number }> {
  const raw = await queryWorkouts(startDate, endDate)
  const normalized = raw.map(normalizeWorkout)

  let synced = 0
  let errors = 0

  for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
    const batch = normalized.slice(i, i + BATCH_SIZE)
    const res = await postJSON('/api/healthkit/activities', { activities: batch })
    if (res.ok) {
      const data = await res.json()
      synced += data.synced ?? batch.length
    } else {
      errors += batch.length
    }
  }

  return { synced, errors }
}

async function syncMetrics(startDate: Date, endDate: Date): Promise<{ synced: number; errors: number }> {
  const [bodyMassRaw, rhrRaw, stepsRaw, dailyEnergyRaw] = await Promise.all([
    queryBodyMass(startDate, endDate),
    queryRestingHeartRate(startDate, endDate),
    querySteps(startDate, endDate),
    queryDailyEnergy(startDate, endDate),
  ])

  const metrics: NormalizedMetric[] = [
    ...bodyMassRaw.map(normalizeBodyMass),
    ...rhrRaw.map(normalizeRHR),
    ...stepsRaw.map(normalizeStepDay),
    ...dailyEnergyRaw.flatMap(r => {
      const active = normalizeDailyActiveEnergy(r)
      const basal  = normalizeDailyBasalEnergy(r)
      return [active, basal].filter((m): m is NormalizedMetric => m !== null)
    }),
  ]

  let synced = 0
  let errors = 0

  for (let i = 0; i < metrics.length; i += BATCH_SIZE) {
    const batch = metrics.slice(i, i + BATCH_SIZE)
    const res = await postJSON('/api/healthkit/metrics', { metrics: batch })
    if (res.ok) {
      const json = await res.json()
      synced += json.synced ?? batch.length
    } else {
      errors += batch.length
    }
  }

  return { synced, errors }
}

export interface SyncResult {
  activitiesSynced: number
  metricsSynced: number
  errors: number
  syncedAt: string
}

export async function runHealthKitSync(sinceDate?: Date): Promise<SyncResult> {
  const endDate = new Date()
  const startDate = sinceDate ?? (() => {
    const d = new Date()
    d.setDate(d.getDate() - INITIAL_SYNC_DAYS)
    return d
  })()

  const [activityResult, metricResult] = await Promise.all([
    syncWorkouts(startDate, endDate),
    syncMetrics(startDate, endDate),
  ])

  return {
    activitiesSynced: activityResult.synced,
    metricsSynced: metricResult.synced,
    errors: activityResult.errors + metricResult.errors,
    syncedAt: endDate.toISOString(),
  }
}

export async function connectHealthKit(): Promise<{ success: boolean; error?: string }> {
  const available = await isHealthKitAvailable()
  if (!available) {
    return { success: false, error: 'HealthKit not available on this device' }
  }

  const granted = await requestHealthKitPermissions()
  if (!granted) {
    return { success: false, error: 'Permission denied' }
  }

  try {
    await runHealthKitSync()
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Sync failed' }
  }
}

export async function disconnectHealthKit(): Promise<void> {
  await fetch('/api/healthkit/status', { method: 'DELETE' })
}
