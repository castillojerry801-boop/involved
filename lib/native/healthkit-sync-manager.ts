import { runHealthKitSync } from './healthkit-sync'
import { isHealthKitAvailable } from './healthkit'

export const FRESHNESS_THRESHOLD_MS = 15 * 60 * 1000
const LOOKBACK_OVERLAP_MS = 24 * 60 * 60 * 1000
const INITIAL_SYNC_DAYS = 30

let syncInProgress = false

export type SyncTrigger = 'launch' | 'resume' | 'today_focus' | 'health_focus' | 'manual'

interface SyncStatusResponse {
  connected: boolean
  lastFullSyncAt: string | null
}

async function getSyncStatus(): Promise<SyncStatusResponse> {
  try {
    const res = await fetch('/api/healthkit/sync-status')
    if (!res.ok) return { connected: false, lastFullSyncAt: null }
    return await res.json() as SyncStatusResponse
  } catch {
    return { connected: false, lastFullSyncAt: null }
  }
}

async function markSyncComplete(syncedAt: Date): Promise<void> {
  try {
    await fetch('/api/healthkit/sync-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncedAt: syncedAt.toISOString() }),
    })
  } catch {
    // Non-critical — health data is still written even if mark fails
  }
}

async function executeSync(trigger: SyncTrigger, lastSyncAt: string | null): Promise<boolean> {
  const available = await isHealthKitAvailable()
  if (!available) {
    syncInProgress = false
    return false
  }

  const t0 = Date.now()

  let sinceDate: Date
  if (lastSyncAt) {
    sinceDate = new Date(new Date(lastSyncAt).getTime() - LOOKBACK_OVERLAP_MS)
  } else {
    sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - INITIAL_SYNC_DAYS)
  }

  console.log('[HealthSync]', JSON.stringify({
    trigger,
    lastSuccessfulSyncAt: lastSyncAt,
    queryStart: sinceDate.toISOString(),
    queryEnd: new Date().toISOString(),
  }))

  try {
    const result = await runHealthKitSync(sinceDate)
    const syncedAt = new Date()
    await markSyncComplete(syncedAt)

    console.log('[HealthSync] complete', JSON.stringify({
      trigger,
      activitiesSynced: result.activitiesSynced,
      metricsSynced: result.metricsSynced,
      errors: result.errors,
      durationMs: Date.now() - t0,
      outcome: result.errors > 0 ? 'partial' : 'success',
    }))
    return true
  } catch (err) {
    console.error('[HealthSync] failed', { trigger, error: String(err), durationMs: Date.now() - t0 })
    return false
  } finally {
    syncInProgress = false
  }
}

export async function syncIfStale(trigger: SyncTrigger): Promise<boolean> {
  if (syncInProgress) return false
  // Reserve the lock synchronously before any await so concurrent callers are blocked
  syncInProgress = true

  try {
    const { connected, lastFullSyncAt } = await getSyncStatus()
    if (!connected) {
      syncInProgress = false
      return false
    }

    if (lastFullSyncAt) {
      const ageMs = Date.now() - new Date(lastFullSyncAt).getTime()
      if (ageMs < FRESHNESS_THRESHOLD_MS) {
        console.log(`[HealthSync] skipping — fresh (${Math.round(ageMs / 1000)}s old)`)
        syncInProgress = false
        return false
      }
    }

    // executeSync will manage syncInProgress from here
    return executeSync(trigger, lastFullSyncAt)
  } catch {
    syncInProgress = false
    return false
  }
}

export async function forceSync(trigger: SyncTrigger): Promise<boolean> {
  if (syncInProgress) return false
  // Reserve the lock synchronously before any await
  syncInProgress = true
  try {
    const { lastFullSyncAt } = await getSyncStatus()
    return executeSync(trigger, lastFullSyncAt)
  } catch {
    syncInProgress = false
    return false
  }
}

export function isSyncInProgress(): boolean {
  return syncInProgress
}

export function _resetForTest(): void {
  syncInProgress = false
}
