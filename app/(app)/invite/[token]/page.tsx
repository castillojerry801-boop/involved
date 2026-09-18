'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, Loader2, Users } from 'lucide-react'

interface InviteInfo {
  trainerName:  string | null
  invitedEmail: string
  status:       string
  expiresAt:    string
}

type PageState = 'loading' | 'ready' | 'expired' | 'already_accepted' | 'accepting' | 'success' | 'error'

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token }   = use(params)
  const router      = useRouter()
  const [info, setInfo]         = useState<InviteInfo | null>(null)
  const [state, setState]       = useState<PageState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const r = await fetch(`/api/trainer/invite?token=${token}`)
      if (!r.ok) { setState('error'); setErrorMsg('Invitation not found.'); return }
      const d = await r.json() as { invitation?: InviteInfo; error?: string }
      if (!d.invitation) { setState('error'); setErrorMsg(d.error ?? 'Invalid invitation.'); return }

      setInfo(d.invitation)

      if (d.invitation.status === 'accepted') { setState('already_accepted'); return }
      if (d.invitation.status !== 'pending' || new Date(d.invitation.expiresAt) < new Date()) {
        setState('expired'); return
      }
      setState('ready')
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
    if (!r.ok || !d.ok) {
      setState('error')
      setErrorMsg(d.error ?? 'Failed to accept invitation.')
      return
    }
    setState('success')
    setTimeout(() => router.push('/today'), 2500)
  }

  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="size-8 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500">Loading invitation…</p>
      </div>
    )
  }

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

  if (state === 'error') {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <XCircle className="size-12 text-red-400 mx-auto mb-4" />
        <h1 className="text-xl font-black text-zinc-900 dark:text-white mb-2">Something went wrong</h1>
        <p className="text-sm text-zinc-500">{errorMsg}</p>
      </div>
    )
  }

  // state === 'ready' | 'accepting'
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
