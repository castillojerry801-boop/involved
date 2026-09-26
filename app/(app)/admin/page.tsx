'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, X, Shield, ChevronDown, ChevronUp } from 'lucide-react'

interface Grant {
  id: string
  status: string
  sourceRef: string | null
  grantedAt: string
  expiresAt: string | null
  revokedAt: string | null
}

interface UserResult {
  id: string
  email?: string
  displayName?: string | null
  grants: Grant[]
}

interface ActiveGrant {
  id: string
  userId: string
  displayName?: string | null
  sourceRef: string | null
  grantedAt: string
  expiresAt: string | null
  status: string
}

export default function AdminPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [activeGrants, setActiveGrants] = useState<ActiveGrant[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingGrants, setLoadingGrants] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Grant form state
  const [grantingFor, setGrantingFor] = useState<UserResult | null>(null)
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [granting, setGranting] = useState(false)
  const [grantError, setGrantError] = useState<string | null>(null)

  const [revoking, setRevoking] = useState<string | null>(null)

  const loadActiveGrants = useCallback(async () => {
    setLoadingGrants(true)
    try {
      const res = await fetch('/api/admin/grants')
      if (!res.ok) {
        if (res.status === 403) { setError('Access denied.'); return }
        setError('Failed to load active grants.')
        return
      }
      const data = await res.json() as { grants: ActiveGrant[] }
      setActiveGrants(data.grants)
    } catch {
      setError('Network error.')
    } finally {
      setLoadingGrants(false)
    }
  }, [])

  useEffect(() => { void loadActiveGrants() }, [loadActiveGrants])

  const handleSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/admin/grants?q=${encodeURIComponent(q)}`)
      if (!res.ok) { setResults([]); return }
      const data = await res.json() as { users: UserResult[] }
      setResults(data.users)
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void handleSearch(query), 350)
    return () => clearTimeout(t)
  }, [query, handleSearch])

  const handleGrant = async () => {
    if (!grantingFor) return
    setGranting(true)
    setGrantError(null)
    try {
      const res = await fetch('/api/admin/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: grantingFor.id,
          reason: reason.trim() || undefined,
          expiresAt: expiresAt || undefined,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setGrantError(data.error ?? 'Failed'); return }
      setGrantingFor(null)
      setReason('')
      setExpiresAt('')
      void loadActiveGrants()
      // Refresh search results
      void handleSearch(query)
    } catch {
      setGrantError('Network error.')
    } finally {
      setGranting(false)
    }
  }

  const handleRevoke = async (grantId: string) => {
    setRevoking(grantId)
    try {
      const res = await fetch(`/api/admin/grants/${grantId}`, { method: 'DELETE' })
      if (!res.ok) return
      setActiveGrants(prev => prev.filter(g => g.id !== grantId))
      // Refresh search results if open
      if (query.length >= 2) void handleSearch(query)
    } finally {
      setRevoking(null)
    }
  }

  if (error) {
    return (
      <div className="p-8 text-center text-zinc-500">
        <Shield className="mx-auto mb-3 size-10 text-zinc-300" />
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Shield className="size-6 text-emerald-500" />
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Admin — Complimentary Access</h1>
      </div>

      {/* Search */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Find user</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by email or name..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {searching && <p className="text-xs text-zinc-400">Searching...</p>}

        {results.length > 0 && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
            {results.map(u => {
              const activeGrant = u.grants.find(g => g.status === 'active')
              return (
                <div key={u.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                      {u.displayName ?? u.email ?? u.id}
                    </p>
                    {u.email && u.displayName && (
                      <p className="text-xs text-zinc-400 truncate">{u.email}</p>
                    )}
                    {activeGrant && (
                      <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                        Active grant{activeGrant.expiresAt ? ` · expires ${new Date(activeGrant.expiresAt).toLocaleDateString()}` : ' · permanent'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {activeGrant ? (
                      <button
                        onClick={() => void handleRevoke(activeGrant.id)}
                        disabled={revoking === activeGrant.id}
                        className="flex items-center gap-1 rounded-md bg-red-50 dark:bg-red-900/20 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50"
                      >
                        <X className="size-3" />
                        {revoking === activeGrant.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    ) : (
                      <button
                        onClick={() => { setGrantingFor(u); setGrantError(null) }}
                        className="flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                      >
                        <Plus className="size-3" />
                        Grant Plus
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {query.length >= 2 && !searching && results.length === 0 && (
          <p className="text-xs text-zinc-400">No users found.</p>
        )}
      </div>

      {/* Grant form */}
      {grantingFor && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                Grant Plus to {grantingFor.displayName ?? grantingFor.email ?? grantingFor.id}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">Leave expiry blank for a permanent grant.</p>
            </div>
            <button onClick={() => setGrantingFor(null)} className="text-zinc-400 hover:text-zinc-600">
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Reason (optional)</label>
              <input
                type="text"
                placeholder="e.g. beta tester, team member"
                value={reason}
                onChange={e => setReason(e.target.value)}
                maxLength={150}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Expiry date (optional)</label>
              <input
                type="date"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {grantError && <p className="text-xs text-red-500">{grantError}</p>}

          <button
            onClick={() => void handleGrant()}
            disabled={granting}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {granting ? 'Granting...' : 'Confirm grant'}
          </button>
        </div>
      )}

      {/* Active grants list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Active admin grants</h2>
        {loadingGrants ? (
          <p className="text-xs text-zinc-400">Loading...</p>
        ) : activeGrants.length === 0 ? (
          <p className="text-xs text-zinc-400">No active admin grants.</p>
        ) : (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
            {activeGrants.map(g => (
              <div key={g.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                    {g.displayName ?? g.userId}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Granted {new Date(g.grantedAt).toLocaleDateString()}
                    {g.expiresAt ? ` · expires ${new Date(g.expiresAt).toLocaleDateString()}` : ' · permanent'}
                    {g.sourceRef ? ` · ${g.sourceRef.replace(/granted_by:[^|]+\|?/, '').replace('reason:', '')}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => void handleRevoke(g.id)}
                  disabled={revoking === g.id}
                  className="flex items-center gap-1 rounded-md bg-red-50 dark:bg-red-900/20 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 shrink-0"
                >
                  <X className="size-3" />
                  {revoking === g.id ? 'Revoking...' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
