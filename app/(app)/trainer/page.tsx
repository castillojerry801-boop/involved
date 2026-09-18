'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Plus, FileText, Dumbbell, Trophy, AlertTriangle, Loader2, ChevronRight, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ClientSummary {
  clientId:         string
  displayName:      string | null
  fitnessLevel:     string | null
  lastWorkout:      { date: string; title: string } | null
  weeklyTarget:     number | null
  workoutsThisWeek: number
  missedThisWeek:   number
  goals:            Array<{ type: string; title: string }>
  latestPR:         { exerciseId: string; metric: string; value: number; unit: string } | null
}

function initials(name: string | null) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function ClientCard({ client }: { client: ClientSummary }) {
  const atRisk = client.missedThisWeek >= 2
  const onTrack = client.weeklyTarget
    ? client.workoutsThisWeek >= client.weeklyTarget
    : false

  return (
    <Link href={`/trainer/clients/${client.clientId}`}>
      <div className={cn(
        'rounded-2xl border bg-white dark:bg-zinc-900 p-4 hover:shadow-sm transition-all cursor-pointer',
        atRisk ? 'border-amber-200 dark:border-amber-800/40' : 'border-zinc-100 dark:border-zinc-800'
      )}>
        <div className="flex items-center gap-3 mb-3">
          <div className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-black',
            atRisk
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          )}>
            {initials(client.displayName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-zinc-900 dark:text-white truncate">
              {client.displayName ?? 'Unnamed Client'}
            </p>
            {client.fitnessLevel && (
              <p className="text-xs text-zinc-400 capitalize">{client.fitnessLevel}</p>
            )}
          </div>
          {atRisk && <AlertTriangle className="size-4 text-amber-500 shrink-0" />}
          {onTrack && !atRisk && <Zap className="size-4 text-emerald-500 shrink-0" />}
        </div>

        {client.weeklyTarget ? (
          <div className="mb-3">
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span>This week</span>
              <span className={cn(
                'font-semibold',
                onTrack ? 'text-emerald-600 dark:text-emerald-400' : atRisk ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-700 dark:text-zinc-300'
              )}>
                {client.workoutsThisWeek}/{client.weeklyTarget}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', onTrack ? 'bg-emerald-500' : atRisk ? 'bg-amber-400' : 'bg-zinc-400')}
                style={{ width: `${Math.min((client.workoutsThisWeek / client.weeklyTarget) * 100, 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        {client.lastWorkout ? (
          <p className="text-xs text-zinc-400 truncate">
            Last: {client.lastWorkout.title} · {client.lastWorkout.date}
          </p>
        ) : (
          <p className="text-xs text-zinc-300 dark:text-zinc-600">No workouts yet</p>
        )}

        {client.latestPR && (
          <div className="mt-2 flex items-center gap-1 text-xs text-amber-500">
            <Trophy className="size-3" />
            <span>PR — {client.latestPR.metric} {client.latestPR.value}{client.latestPR.unit}</span>
          </div>
        )}
      </div>
    </Link>
  )
}

export default function TrainerDashboard() {
  const [clients, setClients]   = useState<ClientSummary[]>([])
  const [loading, setLoading]   = useState(true)
  const [noAccess, setNoAccess] = useState(false)

  useEffect(() => {
    fetch('/api/trainer/clients')
      .then(r => {
        if (r.status === 403) { setNoAccess(true); return null }
        return r.json() as Promise<{ clients: ClientSummary[] }>
      })
      .then(d => d && setClients(d.clients ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  )

  if (noAccess) return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mx-auto">
        <Users className="size-7 text-zinc-400" />
      </div>
      <p className="font-bold text-zinc-900 dark:text-white mb-2">Trainer subscription required</p>
      <p className="text-sm text-zinc-400 mb-6">Upgrade to access the trainer dashboard and manage clients.</p>
      <Link href="/trainer/upgrade" className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-5 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity">
        View Plans
      </Link>
    </div>
  )

  const atRiskCount = clients.filter(c => c.missedThisWeek >= 2).length

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Clients</h1>
          {atRiskCount > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
              <AlertTriangle className="size-3.5" />
              {atRiskCount} client{atRiskCount !== 1 ? 's' : ''} behind this week
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/trainer/drafts" className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
            <FileText className="size-4" />
            Drafts
          </Link>
          <Link href="/trainer/programs" className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
            <Dumbbell className="size-4" />
            Programs
          </Link>
          <Link href="/trainer/invite" className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-2 text-sm font-bold hover:opacity-90 transition-opacity">
            <Plus className="size-4" />
            Invite
          </Link>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <Users className="size-7 text-zinc-400" />
          </div>
          <p className="font-bold text-zinc-900 dark:text-white mb-1">No clients yet</p>
          <p className="text-sm text-zinc-400 mb-6 max-w-xs">
            Invite clients to start tracking their progress and assigning programs.
          </p>
          <Link href="/trainer/invite" className="flex items-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity">
            <Plus className="size-4" /> Send first invitation
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {clients.map(client => (
            <ClientCard key={client.clientId} client={client} />
          ))}
        </div>
      )}
    </div>
  )
}
