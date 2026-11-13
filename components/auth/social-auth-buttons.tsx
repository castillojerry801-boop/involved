'use client'

import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface SocialAuthButtonsProps {
  next?: string
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" />
      <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01c-.72.48-1.63.76-2.7.76-2.08 0-3.84-1.4-4.47-3.29H1.87v2.07A8 8 0 0 0 8.98 17z" />
      <path fill="#FBBC05" d="M4.51 10.52A4.8 4.8 0 0 1 4.26 9c0-.53.1-1.04.25-1.52V5.41H1.87A8 8 0 0 0 .98 9c0 1.29.31 2.51.89 3.59l2.64-2.07z" />
      <path fill="#EA4335" d="M8.98 3.58c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 8.98 1a8 8 0 0 0-7.1 4.41l2.64 2.07c.62-1.9 2.38-3.9 4.46-3.9z" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="fill-current">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

export function SocialAuthButtons({ next }: SocialAuthButtonsProps) {
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const callbackUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`
    : `/api/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`

  async function signInWithProvider(provider: 'google' | 'apple') {
    const setLoading = provider === 'google' ? setGoogleLoading : setAppleLoading
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()
      const isNative = Capacitor.isNativePlatform()

      if (isNative) {
        // Native: get OAuth URL without navigating, then open in system browser
        const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: `com.involved.app://auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`,
            skipBrowserRedirect: true,
          },
        })

        if (oauthError || !data.url) {
          setError(oauthError?.message ?? 'Could not start sign-in. Please try again.')
          return
        }

        await Browser.open({ url: data.url, windowName: '_self' })
        // The deep link handler in OAuthDeepLinkHandler picks up the callback
      } else {
        // Web: standard OAuth redirect
        const { error: oauthError } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: callbackUrl },
        })

        if (oauthError) {
          setError(oauthError.message)
        }
        // On success, browser navigates away — no further state updates needed
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      // Keep button disabled while redirect is in-flight on web
      if (!Capacitor.isNativePlatform()) return
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full flex items-center justify-center gap-2.5"
        onClick={() => signInWithProvider('google')}
        loading={googleLoading}
        disabled={googleLoading || appleLoading}
      >
        {!googleLoading && <GoogleIcon />}
        <span>Continue with Google</span>
      </Button>

      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full flex items-center justify-center gap-2.5"
        onClick={() => signInWithProvider('apple')}
        loading={appleLoading}
        disabled={googleLoading || appleLoading}
      >
        {!appleLoading && <AppleIcon />}
        <span>Continue with Apple</span>
      </Button>

      {error && <p className="text-xs text-red-500 text-center">{error}</p>}
    </div>
  )
}
