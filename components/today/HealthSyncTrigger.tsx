'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { syncIfStale } from '@/lib/native/healthkit-sync-manager'
import { isNativeApp } from '@/lib/native/healthkit'

export function HealthSyncTrigger() {
  const router = useRouter()

  useEffect(() => {
    if (!isNativeApp()) return
    void syncIfStale('today_focus').then(ran => {
      if (ran) router.refresh()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
