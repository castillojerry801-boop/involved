'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Turnstile } from '@/components/turnstile'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileError, setTurnstileError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        setError(error.message)
        return
      }

      router.push('/today')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Sign in to continue your training</p>
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
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <div className="flex justify-end -mt-2">
          <Link
            href="/forgot-password"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          >
            Forgot password?
          </Link>
        </div>

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
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-medium text-zinc-900 hover:underline dark:text-white">
          Create one
        </Link>
      </p>
    </div>
  )
}
