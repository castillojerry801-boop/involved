'use client'

import Link from 'next/link'
import { useState, Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Turnstile } from '@/components/turnstile'
import { createClient } from '@/lib/supabase/client'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.involvedfit.com'

function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileError, setTurnstileError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!turnstileToken) {
      setError('Please wait for the security check to complete.')
      return
    }

    setLoading(true)

    try {
      // Verify Turnstile before triggering the email send
      const verify = await fetch('/api/security/turnstile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: turnstileToken }),
      })
      if (!verify.ok) {
        setError('Security check failed. Please try again.')
        setTurnstileToken(null)
        return
      }

      const supabase = createClient()
      // Always use the production app URL so the email link opens on the web,
      // not inside a Capacitor webview origin.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${APP_URL}/auth/confirm?next=/reset-password`,
      })

      // Always show success — never disclose whether the email exists
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <svg className="size-7 text-zinc-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
          </div>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">Check your email</h1>
        <p className="mt-3 text-sm text-zinc-500">
          If an account exists for <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span>, you&apos;ll receive a password recovery link shortly. Check your spam folder if it doesn&apos;t arrive.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block text-sm font-medium text-zinc-900 hover:underline dark:text-white"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">
          Forgot your password?
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Enter your email and we&apos;ll send a recovery link.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <Turnstile
          onVerify={token => { setTurnstileToken(token); setTurnstileError(false) }}
          onError={() => setTurnstileError(true)}
          onExpire={() => setTurnstileToken(null)}
        />

        {turnstileError && (
          <p className="text-xs text-red-500">Security check failed. Please refresh and try again.</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}

        <Button
          type="submit"
          loading={loading}
          size="lg"
          className="w-full mt-1"
          disabled={loading || !turnstileToken}
        >
          Send recovery link
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        Remember your password?{' '}
        <Link href="/login" className="font-medium text-zinc-900 hover:underline dark:text-white">
          Sign in
        </Link>
      </p>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  )
}
