'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, Loader2, Users, LogIn, UserPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface InviteInfo {
  trainerName: string | null
  status:      string
  expiresAt:   string
}

type PageState =
  | 'loading'
  | 'needs_auth'
  | 'ready'
  | 'expired'
  | 'already_accepted'
  | 'capacity'
  | 'accepting'
  | 'success'
  | 'error'

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token }   = use(params)
  const router      = useRouter()
  const [info, setInfo]         = useState<InviteInfo | null>(null)
  const [state, setState]       = useState<PageState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      // Parallel: fetch invitation info (public) + check auth session
      const [inviteRes, session] = await Promise.all([
        fetch(`/api/trainer/invite?token=${token}`),
        createClient().auth.getSession(),
      ])

      if (!inviteRes.ok) {
        setState('error')
        setErrorMsg('Invitation not found.')
        return
      }

      const d = await inviteRes.json() as { invitation?: InviteInfo; error?: string }
      if (!d.invitation) {
        setState('error')
        setErrorMsg(d.error ?? 'Invalid invitation.')
        return
      }

      setInfo(d.invitation)

      if (d.invitation.status === 'accepted') { setState('already_accepted'); return }
      if (d.invitation.status !== 'pending' || new Date(d.invitation.expiresAt) < new Date()) {
        setState('expired'); return
      }

      // Valid invitation — check if the user is authenticated
      const isAuthed = !!session.data.session?.user
      setState(isAuthed ? 'ready' : 'needs_auth')
    }
    void load()
  }, [token])

  async function handleAccept() {
    setState('accepting')
    const r = await fetch('/api/trainer/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const d = await r.json() as { ok?: boolean; error?: string }

    if (r.status === 401) {
      // Session expired between load and accept — send them to sign in
      setState('needs_auth')
      return
    }
    if (!r.ok || !d.ok) {
      if (d.error?.includes('limit reached')) {
        setState('capacity')
        return
      }
      setState('error')
      setErrorMsg(d.error ?? 'Failed to accept invitation.')
      return
    }
    setState('success')
    // After acceptance, check whether the user has completed onboarding.
    // New users (no fitnessLevel set) are sent through onboarding so they can
    // personalise their experience. The trainer sponsorship is already active
    // in the DB and survives the onboarding flow unchanged.
    // Established users skip directly to /today.
    try {
      const ob = await fetch('/api/onboarding')
      const obData = ob.ok ? await ob.json() as { complete: boolean } : { complete: true }
      setTimeout(() => router.push(obData.complete ? '/today' : '/onboarding'), 2000)
    } catch {
      setTimeout(() => router.push('/today'), 2000)
    }
  }

  const nextParam = `/invite/${token}`

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="size-8 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500">Loading invitation…</p>
      </div>
    )
  }

  // ── Needs auth ───────────────────────────────────────────────────────────────
  if (state === 'needs_auth') {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center">
        <div className="inline-flex size-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 mb-6">
          <Users className="size-8 text-zinc-600 dark:text-zinc-300" />
        </div>
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white mb-2">
          Trainer Invitation
        </h1>
        {info?.trainerName && (
          <p className="text-base font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {info.trainerName}
          </p>
        )}
        <p className="text-sm text-zinc-500 mb-6">
          has invited you to train together on Involved.
        </p>
        <p className="text-sm text-zinc-400 mb-8">
          Sign in or create a free account to accept this invitation.
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(nextParam)}`}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base hover:opacity-90 transition-opacity"
          >
            <LogIn className="size-5" />
            Sign In
          </Link>
          <Link
            href={`/signup?next=${encodeURIComponent(nextParam)}`}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-white py-4 font-black text-base hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <UserPlus className="size-5" />
            Create Account
          </Link>
        </div>
        <p className="mt-6 text-xs text-zinc-400">
          Free to join. No credit card required.
        </p>
      </div>
    )
  }

  // ── Expired ──────────────────────────────────────────────────────────────────
  if (state === 'expired') {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <XCircle className="size-12 text-red-400 mx-auto mb-4" />
        <h1 className="text-xl font-black text-zinc-900 dark:text-white mb-2">Invitation Expired</h1>
        <p className="text-sm text-zinc-500">
          This invitation is no longer valid. Ask your trainer to send a new one.
        </p>
      </div>
    )
  }

  // ── Already accepted ─────────────────────────────────────────────────────────
  if (state === 'already_accepted') {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <CheckCircle className="size-12 text-emerald-500 mx-auto mb-4" />
        <h1 className="text-xl font-black text-zinc-900 dark:text-white mb-2">Already Accepted</h1>
        <p className="text-sm text-zinc-500 mb-6">You&apos;re already connected with this trainer.</p>
        <button
          onClick={() => router.push('/today')}
          className="rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity"
        >
          Go to Dashboard
        </button>
      </div>
    )
  }

  // ── Capacity full ────────────────────────────────────────────────────────────
  if (state === 'capacity') {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <XCircle className="size-12 text-amber-400 mx-auto mb-4" />
        <h1 className="text-xl font-black text-zinc-900 dark:text-white mb-2">Trainer is Full</h1>
        <p className="text-sm text-zinc-500">
          This trainer has reached their client limit. Let them know so they can free up a spot.
        </p>
      </div>
    )
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  if (state === 'success') {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <CheckCircle className="size-12 text-emerald-500 mx-auto mb-4" />
        <h1 className="text-xl font-black text-zinc-900 dark:text-white mb-2">You&apos;re connected!</h1>
        <p className="text-sm text-zinc-500">
          {info?.trainerName ?? 'Your trainer'} can now view your progress and assign programs.
          Redirecting…
        </p>
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <XCircle className="size-12 text-red-400 mx-auto mb-4" />
        <h1 className="text-xl font-black text-zinc-900 dark:text-white mb-2">Something went wrong</h1>
        <p className="text-sm text-zinc-500">{errorMsg}</p>
      </div>
    )
  }

  // ── Ready / Accepting ────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-sm px-4 py-20 text-center">
      <div className="inline-flex size-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 mb-6">
        <Users className="size-8 text-zinc-600 dark:text-zinc-300" />
      </div>
      <h1 className="text-2xl font-black text-zinc-900 dark:text-white mb-2">
        Trainer Invitation
      </h1>
      {info?.trainerName && (
        <p className="text-base font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {info.trainerName}
        </p>
      )}
      <p className="text-sm text-zinc-500 mb-2">has invited you to train together on Involved.</p>
      <p className="text-xs text-zinc-400 mb-8">
        Accepting gives your trainer read access to your workouts, goals, and progress. You can remove
        the relationship at any time — your history always stays yours.
      </p>
      <button
        onClick={handleAccept}
        disabled={state === 'accepting'}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {state === 'accepting' ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <CheckCircle className="size-5" />
        )}
        {state === 'accepting' ? 'Connecting…' : 'Accept Invitation'}
      </button>
      <button
        onClick={() => router.push('/today')}
        className="mt-3 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        Decline
      </button>
    </div>
  )
}
