'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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
  const pathname = usePathname()
  const [processing, setProcessing] = useState(false)

  // Keep a ref so the timeout below can read the current pathname without being
  // in its dependency array (which would restart the 5-second clock on every route change).
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  // Clear the loading overlay once Next.js commits the navigation to the destination route.
  useEffect(() => {
    setProcessing(false)
  }, [pathname])

  // Safety net: if 5 seconds pass and we're still on /login, the navigation stalled.
  // Clear the overlay and show an error — silent failure is worse than a visible message.
  // In the success path this timeout is always cancelled by the pathname effect above.
  useEffect(() => {
    if (!processing) return
    const id = setTimeout(() => {
      setProcessing(false)
      if (pathnameRef.current === '/login') {
        console.log('[OAuth] Processing timeout — navigation stalled, showing error')
        router.push('/login?error=oauth_failed')
      }
    }, 5000)
    return () => clearTimeout(id)
  }, [processing, router])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const listener = App.addListener('appUrlOpen', async ({ url }: URLOpenListenerEvent) => {
      // --- Diagnostic 4: did a URL arrive at all? ---
      // Log scheme + path only — never query params (may contain codes/tokens).
      try {
        const { protocol, pathname: urlPath } = new URL(url)
        console.log(`[OAuth] appUrlOpen — scheme: ${protocol.replace(':', '')}, path: ${urlPath}`)
      } catch {
        console.log('[OAuth] appUrlOpen — unparseable URL')
      }

      if (!url.startsWith('com.involved.app://auth/callback')) {
        console.log('[OAuth] URL does not match auth/callback — ignoring')
        return
      }

      // Show loading overlay immediately — it renders in the WebView while the browser
      // dismiss animation is in-flight, so the login form is hidden by the time the
      // SFSafariViewController has fully slid away.
      setProcessing(true)

      // Parse callback params once — reused for classification, code extraction, and next redirect.
      let params: URLSearchParams
      try {
        params = new URL(url).searchParams
      } catch {
        console.log('[OAuth] Callback: could not parse URL params')
        setProcessing(false)
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
        setProcessing(false)
        router.push('/login?error=oauth_failed')
        return
      }

      const supabase = createClient()
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        // --- Diagnostic 2: exchange failed ---
        console.log(`[OAuth] Session exchange failed — ${error.message}`)
        setProcessing(false)
        router.push(`/login?error=oauth_failed`)
        return
      }

      // --- Diagnostic 3: exchange succeeded — check session presence ---
      const sessionPresent = !!data?.session
      const userPresent    = !!data?.session?.user
      console.log(`[OAuth] Session exchange succeeded — session: ${sessionPresent}, user: ${userPresent}`)

      if (!sessionPresent) {
        console.log('[OAuth] Warning: exchange returned no session')
        setProcessing(false)
        router.push('/login?error=oauth_failed')
        return
      }

      const next = params.get('next')
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/today'
      console.log(`[OAuth] Navigating to: ${safeNext}`)
      router.push(safeNext)
      router.refresh()
      // processing stays true; the usePathname effect clears it once /today has rendered
    })

    return () => {
      listener.then((l: { remove(): void }) => l.remove())
    }
  }, [router])

  if (!processing) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <svg className="size-8 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}
