'use client'

import { useEffect } from 'react'
import { syncIfStale } from '@/lib/native/healthkit-sync-manager'
import { isNativeApp } from '@/lib/native/healthkit'

// Silently triggers a background HealthKit sync on mount.
// Does NOT call router.refresh() — each AI message re-fetches context server-side,
// so fresh data is available on the next message without destroying client state.
export function HealthSyncTrigger() {
  useEffect(() => {
    if (!isNativeApp()) return
    void syncIfStale('today_focus')
  }, [])

  return null
}
