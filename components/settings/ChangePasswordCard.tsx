'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export function ChangePasswordCard() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
  }, [])

  // Don't render until we know the user's identity providers.
  // Accounts with only OAuth identities (Google/Apple) have no password to change.
  if (user === undefined) return null
  if (!user) return null

  const hasEmailIdentity = user.identities?.some(id => id.provider === 'email') ?? false
  if (!hasEmailIdentity) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      const data = await res.json() as { success?: boolean; error?: string }

      if (!res.ok || !data.success) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }

      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">Security</p>

      <p className="text-sm font-semibold text-zinc-900 dark:text-white mb-4">Change password</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Current password"
          type="password"
          placeholder="Your current password"
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <Input
          label="New password"
          type="password"
          placeholder="Min. 8 characters"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          autoComplete="new-password"
          hint="At least 8 characters"
          required
          minLength={8}
        />
        <Input
          label="Confirm new password"
          type="password"
          placeholder="Repeat your new password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />

        {success && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">Password updated successfully.</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}

        <Button
          type="submit"
          loading={loading}
          disabled={loading}
          className="w-full"
        >
          Update password
        </Button>
      </form>
    </div>
  )
}
