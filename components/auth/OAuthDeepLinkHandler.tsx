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
      // --- Diagnostic 4: did a URL arrive at all? ---
      // Log scheme + path only — never query params (may contain codes/tokens).
      try {
        const { protocol, pathname } = new URL(url)
        console.log(`[OAuth] appUrlOpen — scheme: ${protocol.replace(':', '')}, path: ${pathname}`)
      } catch {
        console.log('[OAuth] appUrlOpen — unparseable URL')
      }

      if (!url.startsWith('com.involved.app://auth/callback')) {
        console.log('[OAuth] URL does not match auth/callback — ignoring')
        return
      }

      // Parse callback params once — reused for classification, code extraction, and next redirect.
      let params: URLSearchParams
      try {
        params = new URL(url).searchParams
      } catch {
        console.log('[OAuth] Callback: could not parse URL params')
        router.push('/login?error=oauth_failed')
        return
      }

      // --- Diagnostic 1 / 2: classify what the callback contains ---
      const errorCode = params.get('error')
      if (errorCode) {
        // OAuth error codes (e.g. 'access_denied', 'server_error') are not sensitive.
        // error_description may contain readable text; truncate to avoid inadvertent leakage.
        const desc = (params.get('error_description') ?? '').slice(0, 100)
        console.log(`[OAuth] Callback: error — code: ${errorCode}${desc ? `, description: ${desc}` : ''}`)
      } else if (params.has('code')) {
        console.log('[OAuth] Callback: authorization_code present (value not logged)')
      } else {
        console.log(`[OAuth] Callback: no error or code — param keys: ${[...params.keys()].join(', ') || '(none)'}`)
      }

      try {
        await Browser.close()
      } catch {
        // Browser might already be closed
      }

      // exchangeCodeForSession expects the bare authorization code, not the full callback URL.
      // Passing the full URL causes the server to look up a PKCE flow state keyed by the entire
      // URL string, find nothing, and return "invalid flow state, no valid flow state found".
      const code = params.get('code')
      if (!code) {
        console.log('[OAuth] Cannot exchange — no code in callback URL')
        router.push('/login?error=oauth_failed')
        return
      }

      const supabase = createClient()
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        // --- Diagnostic 2: exchange failed ---
        console.log(`[OAuth] Session exchange failed — ${error.message}`)
        router.push(`/login?error=oauth_failed`)
        return
      }

      // --- Diagnostic 3: exchange succeeded — check session presence ---
      const sessionPresent = !!data?.session
      const userPresent    = !!data?.session?.user
      console.log(`[OAuth] Session exchange succeeded — session: ${sessionPresent}, user: ${userPresent}`)

      if (!sessionPresent) {
        console.log('[OAuth] Warning: exchange returned no session')
        router.push('/login?error=oauth_failed')
        return
      }

      const next = params.get('next')
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/today'
      console.log(`[OAuth] Navigating to: ${safeNext}`)
      router.push(safeNext)
      router.refresh()
    })

    return () => {
      listener.then((l: { remove(): void }) => l.remove())
    }
  }, [router])

  return null
}
