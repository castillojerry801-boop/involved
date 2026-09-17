'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Turnstile } from '@/components/turnstile'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileError, setTurnstileError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Honeypot — bot filled the hidden field, silently drop
    if (honeypot) return

    if (!turnstileToken) {
      setError('Please wait for the security check to complete.')
      return
    }

    setLoading(true)

    try {
      // Verify Turnstile token server-side
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
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: `${location.origin}/api/auth/callback`,
        },
      })

      if (error) {
        setError(error.message)
        return
      }

      setSuccess(true)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20">
          <svg className="size-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-black text-zinc-900 dark:text-white">Check your email</h2>
        <p className="text-sm text-zinc-500">
          We sent a confirmation link to{' '}
          <strong className="text-zinc-900 dark:text-white">{email}</strong>.
          Click it to activate your account and start training.
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Free to start. No credit card needed.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Honeypot — hidden from real users, bots fill it */}
        <input
          type="text"
          name="website"
          value={honeypot}
          onChange={e => setHoneypot(e.target.value)}
          style={{ display: 'none' }}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />

        <Input
          label="Full name"
          type="text"
          placeholder="Your name"
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="name"
          required
        />
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <Input
          label="Password"
          type="password"
          placeholder="Min. 8 characters"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          hint="At least 8 characters"
          required
          minLength={8}
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
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-zinc-900 hover:underline dark:text-white">
          Sign in
        </Link>
      </p>

      <p className="mt-4 text-center text-xs text-zinc-400">
        By creating an account, you agree to our terms of service and privacy policy.
      </p>
    </div>
  )
}
