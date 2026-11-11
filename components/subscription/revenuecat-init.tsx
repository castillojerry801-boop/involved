'use client'

import { useEffect } from 'react'
import { isRevenueCatSupported } from '@/lib/revenuecat/config'
import { initializePurchases } from '@/lib/revenuecat/purchases'

export function RevenueCatInit({ userId }: { userId: string }) {
  useEffect(() => {
    if (!isRevenueCatSupported()) return
    initializePurchases(userId).catch(() => null)
  }, [userId])
  return null
}
