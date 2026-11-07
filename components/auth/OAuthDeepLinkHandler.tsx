'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { App, type URLOpenListenerEvent } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { createClient } from '@/lib/supabase/client'

/**
 * Registers the native deep-link listener that handles OAuth callbacks on iOS
 * and Android. Must be mounted inside a client component tree (added to root
 * layout via a client wrapper).
 *
 * Flow: SFSafariViewController/Custom Tabs redirects to
 *   com.involved.app://auth/callback?code=...
 * iOS/Android opens the app and fires 'appUrlOpen'. We exchange the code for a
 * session, close the browser, then navigate to the app.
 */
export function OAuthDeepLinkHandler() {
  const router = useRouter()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const listener = App.addListener('appUrlOpen', async ({ url }: URLOpenListenerEvent) => {
      if (!url.startsWith('com.involved.app://auth/callback')) return

      try {
        await Browser.close()
      } catch {
        // Browser might already be closed
      }

      const supabase = createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(url)

      if (error) {
        router.push(`/login?error=oauth_failed`)
        return
      }

      // Determine where to send the user
      const urlObj = new URL(url)
      const next = urlObj.searchParams.get('next')
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/today'
      router.push(safeNext)
      router.refresh()
    })

    return () => {
      listener.then((l: { remove(): void }) => l.remove())
    }
  }, [router])

  return null
}
