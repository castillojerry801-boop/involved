'use client'

import { useEffect, useState, useCallback } from 'react'
import { Heart, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isHealthKitAvailable } from '@/lib/native/healthkit'
import {
  connectHealthKit,
  disconnectHealthKit,
  runHealthKitSync,
} from '@/lib/native/healthkit-sync'

type ConnectionStatus = 'checking' | 'unavailable' | 'not_connected' | 'connected' | 'syncing'

interface SyncStatus {
  connected: boolean
  lastSyncedAt: string | null
  activityCount: number
}

function formatLastSync(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return d.toLocaleDateString()
}

export function AppleHealthCard() {
  const [status, setStatus] = useState<ConnectionStatus>('checking')
  const [syncInfo, setSyncInfo] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/healthkit/status')
      if (res.ok) {
        const data: SyncStatus = await res.json()
        setSyncInfo(data)
        setStatus(data.connected ? 'connected' : 'not_connected')
      } else {
        setStatus('not_connected')
      }
    } catch {
      setStatus('not_connected')
    }
  }, [])

  useEffect(() => {
    isHealthKitAvailable().then((available) => {
      if (!available) {
        setStatus('unavailable')
        return
      }
      fetchStatus()
    })
  }, [fetchStatus])

  async function handleConnect() {
    setError(null)
    setStatus('syncing')
    const result = await connectHealthKit()
    if (result.success) {
      await fetchStatus()
    } else {
      setError(result.error ?? 'Could not connect to Apple Health')
      setStatus('not_connected')
    }
  }

  async function handleSync() {
    setError(null)
    setStatus('syncing')
    try {
      await runHealthKitSync()
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
      setStatus('connected')
    }
  }

  async function handleDisconnect() {
    setError(null)
    await disconnectHealthKit()
    setSyncInfo(null)
    setStatus('not_connected')
  }

  if (status === 'unavailable') return null

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">Integrations</p>

      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950">
          <Heart className="size-5 text-rose-500" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">Apple Health</p>

          {status === 'checking' && (
            <p className="text-xs text-zinc-400 mt-0.5">Checking connection…</p>
          )}

          {status === 'not_connected' && (
            <p className="text-xs text-zinc-400 mt-0.5">Import workouts, heart rate, and body weight</p>
          )}

          {(status === 'connected' || status === 'syncing') && syncInfo && (
            <div className="mt-0.5 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="size-3 text-emerald-500 shrink-0" />
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Connected</p>
              </div>
              <p className="text-xs text-zinc-400">
                {syncInfo.activityCount} {syncInfo.activityCount === 1 ? 'activity' : 'activities'} synced · Last sync {formatLastSync(syncInfo.lastSyncedAt)}
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-1.5 mt-1">
              <AlertCircle className="size-3 text-red-500 shrink-0" />
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {(status === 'connected' || status === 'syncing') && (
            <>
              <button
                onClick={handleSync}
                disabled={status === 'syncing'}
                className="flex size-8 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
                title="Sync now"
              >
                <RefreshCw className={cn('size-4', status === 'syncing' && 'animate-spin')} />
              </button>
              <button
                onClick={handleDisconnect}
                disabled={status === 'syncing'}
                className="text-xs font-medium text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-40 px-1"
              >
                Disconnect
              </button>
            </>
          )}

          {status === 'not_connected' && (
            <button
              onClick={handleConnect}
              className="rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 text-xs font-semibold hover:bg-zinc-700 dark:hover:bg-zinc-100 transition-colors"
            >
              Connect
            </button>
          )}

          {status === 'checking' && (
            <div className="size-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  )
}
