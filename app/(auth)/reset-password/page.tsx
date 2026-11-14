'use client'

import Link from 'next/link'
import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import type { Session } from '@supabase/supabase-js'

function ResetPasswordForm() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) {
        const isExpired = updateError.message.toLowerCase().includes('expired') ||
                          updateError.message.toLowerCase().includes('session')
        setError(
          isExpired
            ? 'Your recovery session has expired. Please request a new password recovery email.'
            : 'Something went wrong. Please try again.'
        )
        return
      }

      setDone(true)

      // Sign out all sessions globally so the old password cannot be reused
      await supabase.auth.signOut({ scope: 'global' })

      router.push('/login?message=password_reset')
    } finally {
      setLoading(false)
    }
  }

  // Session loading
  if (session === undefined) {
    return (
      <div className="flex justify-center py-12">
        <svg className="size-6 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  // No session — recovery link expired or not used
  if (session === null) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">Link expired</h1>
        <p className="mt-3 text-sm text-zinc-500">
          This recovery link has expired or was already used. Request a new one to reset your password.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-block font-medium text-zinc-900 hover:underline dark:text-white text-sm"
        >
          Request a new recovery link
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">Password updated</h1>
        <p className="mt-3 text-sm text-zinc-500">Redirecting you to sign in…</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">
          Set a new password
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Choose a password you haven&apos;t used before.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="New password"
          type="password"
          placeholder="Min. 8 characters"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          hint="At least 8 characters"
          required
          minLength={8}
        />
        <Input
          label="Confirm password"
          type="password"
          placeholder="Repeat your new password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />

        {error && <p className="text-xs text-red-500">{error}</p>}

        <Button
          type="submit"
          loading={loading}
          size="lg"
          className="w-full mt-1"
          disabled={loading}
        >
          Update password
        </Button>
      </form>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
