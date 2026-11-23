'use client'

import { useState, useEffect } from 'react'
import { ArrowRight, Smartphone } from 'lucide-react'
import { getNativePlatform } from '@/lib/native/platform'

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.involved.app'

/**
 * Renders the "Also available on Android" badge only on web and native Android.
 * Returns null in the iOS WebView so the binary contains no Android promotion
 * (Apple App Store Review Guideline 2.3.10).
 */
export function AndroidHeroBadge() {
  const [platform, setPlatform] = useState<'ios' | 'android' | 'web' | null>(null)

  useEffect(() => {
    setPlatform(getNativePlatform())
  }, [])

  // null before hydration — renders nothing, no flash
  if (platform === null || platform === 'ios') return null

  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
    >
      <Smartphone className="size-4" />
      Also available on Android
      <ArrowRight className="size-3" />
    </a>
  )
}

/**
 * Renders the "Android App" footer link only on web and native Android.
 */
export function AndroidFooterLink() {
  const [platform, setPlatform] = useState<'ios' | 'android' | 'web' | null>(null)

  useEffect(() => {
    setPlatform(getNativePlatform())
  }, [])

  if (platform === null || platform === 'ios') return null

  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-zinc-900 dark:hover:text-white transition-colors"
    >
      Android App
    </a>
  )
}
