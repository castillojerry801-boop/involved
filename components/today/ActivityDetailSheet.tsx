'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  X, Flame, Footprints, Activity, Dumbbell,
  PersonStanding, Waves, Zap, Heart, Clock, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TodayActivity {
  id: string
  activityType: string
  title: string | null
  startedAt: string
  durationSeconds: number | null
  activeEnergyKcal: number | null
  avgHeartRateBpm: number | null
  distanceM: number | null
}

interface Props {
  connected: boolean
  lastSyncedAt: string | null
  provider: string | null
  activities: TodayActivity[]
  allDayActiveKcal: number | null
  basalKcal: number | null
  totalBurnKcal: number | null
  stepCount: number | null
}

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  strength_training:   Dumbbell,
  functional_strength: Dumbbell,
  running:             Activity,
  cycling:             Activity,
  walking:             Activity,
  swimming:            Waves,
  hiking:              Activity,
  yoga:                PersonStanding,
  hiit:                Zap,
  rowing:              Activity,
  elliptical:          Activity,
  stair_climbing:      Activity,
  cross_training:      Activity,
  other:               Activity,
}

const ACTIVITY_LABELS: Record<string, string> = {
  strength_training:   'Strength Training',
  functional_strength: 'Functional Strength',
  running:             'Running',
  cycling:             'Cycling',
  walking:             'Walking',
  swimming:            'Swimming',
  hiking:              'Hiking',
  yoga:                'Yoga',
  hiit:                'HIIT',
  rowing:              'Rowing',
  elliptical:          'Elliptical',
  stair_climbing:      'Stair Climbing',
  cross_training:      'Cross Training',
  other:               'Workout',
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60 > 0 ? ` ${m % 60}m` : ''}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatSyncAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function providerLabel(p: string | null) {
  if (p === 'apple_health') return 'Apple Health'
  if (p === 'health_connect') return 'Health Connect'
  return p ?? 'Health'
}

// Compact stat tile used in the sheet's 2×2 grid
function StatTile({
  icon: Icon, iconClass, label, value, unit,
}: {
  icon: React.ElementType
  iconClass: string
  label: string
  value: number | null
  unit: string
}) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={cn('size-3.5 shrink-0', iconClass)} />
        <p className="text-[11px] text-zinc-500">{label}</p>
      </div>
      <p className="text-lg font-bold text-white leading-tight">
        {value != null ? value.toLocaleString() : '—'}
      </p>
      <p className="text-[10px] text-zinc-600 mt-0.5">{unit}</p>
    </div>
  )
}

export function ActivityDetailSheet({
  connected, lastSyncedAt, provider, activities,
  allDayActiveKcal, basalKcal, totalBurnKcal, stepCount,
}: Props) {
  const [open, setOpen] = useState(false)
  const hasData = activities.length > 0

  return (
    <>
      {/* ── Inline summary row (3 metrics) ─────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">

          {/* Active Calories — all-day HealthKit metric */}
          <div className="flex items-center gap-1.5">
            <div className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              allDayActiveKcal != null ? 'bg-orange-500/15' : 'bg-zinc-100 dark:bg-zinc-800'
            )}>
              <Flame className={cn('size-3.5', allDayActiveKcal != null ? 'text-orange-400' : 'text-zinc-400')} />
            </div>
            <div>
              <p className={cn('text-sm font-bold leading-tight', allDayActiveKcal != null ? 'text-zinc-900 dark:text-white' : 'text-zinc-400')}>
                {allDayActiveKcal != null ? allDayActiveKcal.toLocaleString() : '—'}
              </p>
              <p className="text-[10px] text-zinc-400 leading-tight">Active kcal</p>
            </div>
          </div>

          {/* Total Calories Burned */}
          <div className="flex items-center gap-1.5">
            <div className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              totalBurnKcal != null ? 'bg-amber-500/15' : 'bg-zinc-100 dark:bg-zinc-800'
            )}>
              <Zap className={cn('size-3.5', totalBurnKcal != null ? 'text-amber-400' : 'text-zinc-400')} />
            </div>
            <div>
              <p className={cn('text-sm font-bold leading-tight', totalBurnKcal != null ? 'text-zinc-900 dark:text-white' : 'text-zinc-400')}>
                {totalBurnKcal != null ? totalBurnKcal.toLocaleString() : '—'}
              </p>
              <p className="text-[10px] text-zinc-400 leading-tight">Total burn</p>
            </div>
          </div>

          {/* Steps */}
          <div className="flex items-center gap-1.5">
            <div className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              stepCount != null ? 'bg-sky-500/15' : 'bg-zinc-100 dark:bg-zinc-800'
            )}>
              <Footprints className={cn('size-3.5', stepCount != null ? 'text-sky-400' : 'text-zinc-400')} />
            </div>
            <div>
              <p className={cn('text-sm font-bold leading-tight', stepCount != null ? 'text-zinc-900 dark:text-white' : 'text-zinc-400')}>
                {stepCount != null ? stepCount.toLocaleString() : '—'}
              </p>
              <p className="text-[10px] text-zinc-400 leading-tight">Steps</p>
            </div>
          </div>

        </div>

        {/* Details button */}
        {connected ? (
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            {hasData ? `${activities.length} workout${activities.length !== 1 ? 's' : ''}` : 'Details'}
            <ChevronRight className="size-3" />
          </button>
        ) : (
          <Link
            href="/health"
            className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            Connect
            <ChevronRight className="size-3" />
          </Link>
        )}
      </div>

      {/* Sync status line */}
      {connected && lastSyncedAt && (
        <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-600">
          {hasData
            ? `${activities.length} workout${activities.length !== 1 ? 's' : ''} today · synced ${formatSyncAge(lastSyncedAt)} via ${providerLabel(provider)}`
            : `No workouts today · last sync ${formatSyncAge(lastSyncedAt)}`}
        </p>
      )}
      {!connected && (
        <p className="mt-2 text-[10px] text-zinc-500">
          Connect Apple Health in{' '}
          <Link href="/health" className="text-emerald-500 hover:underline">Settings</Link>
          {' '}to see activity data here.
        </p>
      )}

      {/* ── Bottom sheet ─────────────────────────────────────────────────── */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-zinc-800 bg-zinc-950">

            {/* Sheet header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-5 py-4">
              <p className="text-sm font-bold text-white">Today&apos;s Activity</p>
              <button
                onClick={() => setOpen(false)}
                className="flex size-7 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">

              {/* 2×2 health stats grid */}
              <div className="grid grid-cols-2 gap-2">
                <StatTile
                  icon={Flame}
                  iconClass="text-orange-400"
                  label="Active"
                  value={allDayActiveKcal}
                  unit="kcal"
                />
                <StatTile
                  icon={Activity}
                  iconClass="text-violet-400"
                  label="Resting"
                  value={basalKcal}
                  unit="kcal"
                />
                <StatTile
                  icon={Zap}
                  iconClass="text-amber-400"
                  label="Total Burn"
                  value={totalBurnKcal}
                  unit="kcal"
                />
                <StatTile
                  icon={Footprints}
                  iconClass="text-sky-400"
                  label="Steps"
                  value={stepCount}
                  unit="today"
                />
              </div>

              {/* Activity list */}
              {hasData ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 px-0.5 pt-1">Workouts</p>
                  {activities.map(a => {
                    const Icon = ACTIVITY_ICONS[a.activityType] ?? Activity
                    const label = a.title ?? ACTIVITY_LABELS[a.activityType] ?? 'Workout'
                    return (
                      <div key={a.id} className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
                            <Icon className="size-4 text-emerald-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{label}</p>
                            <p className="text-xs text-zinc-500">{formatTime(a.startedAt)}</p>
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                              {a.durationSeconds != null && (
                                <span className="flex items-center gap-1 text-xs text-zinc-400">
                                  <Clock className="size-3 text-zinc-500 shrink-0" />
                                  {formatDuration(a.durationSeconds)}
                                </span>
                              )}
                              {a.activeEnergyKcal != null && (
                                <span className="flex items-center gap-1 text-xs text-zinc-400">
                                  <Flame className="size-3 text-orange-400 shrink-0" />
                                  {a.activeEnergyKcal.toLocaleString()} kcal
                                </span>
                              )}
                              {a.avgHeartRateBpm != null && (
                                <span className="flex items-center gap-1 text-xs text-zinc-400">
                                  <Heart className="size-3 text-rose-400 shrink-0" />
                                  {a.avgHeartRateBpm} bpm avg
                                </span>
                              )}
                              {a.distanceM != null && a.distanceM > 0 && (
                                <span className="text-xs text-zinc-400">
                                  {(a.distanceM / 1000).toFixed(2)} km
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-6 text-center">
                  <p className="text-sm text-zinc-400">No workouts synced today.</p>
                  <p className="mt-1 text-xs text-zinc-600">Workouts logged in Involved or synced from Apple Health will appear here.</p>
                </div>
              )}

            </div>

            {/* Sheet footer */}
            <div className="border-t border-zinc-800 px-5 pb-8 pt-3">
              <Link
                href="/health"
                className="flex items-center justify-between text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1"
              >
                Apple Health settings
                <ChevronRight className="size-3" />
              </Link>
            </div>

          </div>
        </>
      )}
    </>
  )
}
