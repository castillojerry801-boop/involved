'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Send, Clock, CheckCircle, XCircle, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Invitation {
  id:          string
  invitedEmail: string
  status:      string
  expiresAt:   string
  createdAt:   string
  token?:      string
}

export default function TrainerInvitePage() {
  const [email, setEmail]           = useState('')
  const [sending, setSending]       = useState(false)
  const [sendError, setSendError]   = useState<string | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading]       = useState(true)
  const [copied, setCopied]         = useState<string | null>(null)
  const [lastToken, setLastToken]   = useState<string | null>(null)

  useEffect(() => { loadInvitations() }, [])

  async function loadInvitations() {
    setLoading(true)
    const r = await fetch('/api/trainer/invite')
    if (r.ok) {
      const d = await r.json() as { invitations: Invitation[] }
      setInvitations(d.invitations ?? [])
    }
    setLoading(false)
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    setSendError(null)
    setLastToken(null)

    const r = await fetch('/api/trainer/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    })
    const d = await r.json() as { token?: string; error?: string; message?: string }

    if (!r.ok) {
      setSendError(d.error ?? 'Failed to send invitation.')
    } else {
      setEmail('')
      if (d.token) setLastToken(d.token)
      await loadInvitations()
    }
    setSending(false)
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/invite/${token}`
    void navigator.clipboard.writeText(url)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  const statusIcon = (status: string) => {
    if (status === 'accepted') return <CheckCircle className="size-4 text-emerald-500" />
    if (status === 'expired' || status === 'cancelled') return <XCircle className="size-4 text-red-400" />
    return <Clock className="size-4 text-yellow-500" />
  }

  const statusLabel: Record<string, string> = {
    pending:   'Pending',
    accepted:  'Accepted',
    expired:   'Expired',
    cancelled: 'Cancelled',
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/trainer"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div>
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Invite a Client</h1>
          <p className="text-sm text-zinc-500">Client must accept to activate the relationship</p>
        </div>
      </div>

      {/* Send form */}
      <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 mb-6">
        <form onSubmit={handleSend} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-zinc-500 block mb-1.5">
              Client email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="client@example.com"
              required
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
            />
          </div>
          {sendError && (
            <p className="text-sm text-red-600 dark:text-red-400">{sendError}</p>
          )}
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-3 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            <Send className="size-4" />
            {sending ? 'Sending…' : 'Send Invitation'}
          </button>
        </form>

        {/* Dev: show invite link since email isn't wired yet */}
        {lastToken && (
          <div className="mt-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-3">
            <p className="text-xs font-semibold text-zinc-500 mb-2">
              Email sending not yet configured — share this link directly:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-zinc-700 dark:text-zinc-300 break-all">
                {typeof window !== 'undefined' ? window.location.origin : ''}/invite/{lastToken}
              </code>
              <button
                onClick={() => copyLink(lastToken)}
                className="shrink-0 flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                {copied === lastToken ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                {copied === lastToken ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Invitation list */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
          Sent Invitations
        </h2>
        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : invitations.length === 0 ? (
          <p className="text-sm text-zinc-400">No invitations sent yet.</p>
        ) : (
          <div className="space-y-2">
            {invitations.map(inv => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {statusIcon(inv.status)}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                      {inv.invitedEmail}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {statusLabel[inv.status] ?? inv.status} · {new Date(inv.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                {inv.status === 'pending' && inv.token && (
                  <button
                    onClick={() => copyLink(inv.token!)}
                    className={cn(
                      'shrink-0 flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors',
                      'border-zinc-200 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    )}
                  >
                    {copied === inv.token ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    {copied === inv.token ? 'Copied' : 'Copy link'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
