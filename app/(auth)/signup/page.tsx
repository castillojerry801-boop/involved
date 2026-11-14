'use client'

import Link from 'next/link'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Turnstile } from '@/components/turnstile'
import { SocialAuthButtons } from '@/components/auth/social-auth-buttons'
import { MIN_PASSWORD_LENGTH, validatePassword } from '@/lib/auth/password'

function safeRedirect(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null
  return next
}

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = safeRedirect(searchParams.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileError, setTurnstileError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (honeypot) return

    if (!turnstileToken) {
      setError('Please wait for the security check to complete.')
      return
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      setError(passwordError)
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, turnstileToken }),
      })

      const data = await res.json() as { success?: boolean; error?: string }

      if (!res.ok || !data.success) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }

      // Session is set via cookie by the server.
      // If a next param was provided (e.g. an invite link), honour it;
      // otherwise send new users through onboarding.
      // router.refresh() clears the RSC cache so the next Server Component
      // render picks up the newly established session rather than a stale
      // pre-auth snapshot.
      router.push(next ?? '/onboarding')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">
          Create your account
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Free to start. No credit card needed.</p>
      </div>

      <SocialAuthButtons next={next ?? undefined} />

      <div className="relative my-2">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-zinc-50 dark:bg-zinc-950 px-2 text-zinc-400">or sign up with email</span>
        </div>
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
          placeholder={`Min. ${MIN_PASSWORD_LENGTH} characters`}
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters — try a passphrase`}
          required
          minLength={MIN_PASSWORD_LENGTH}
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
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className="font-medium text-zinc-900 hover:underline dark:text-white"
        >
          Sign in
        </Link>
      </p>

      <p className="mt-4 text-center text-xs text-zinc-400">
        By creating an account, you agree to our terms of service and privacy policy.
      </p>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}
