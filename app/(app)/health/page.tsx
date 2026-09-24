'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Smartphone, Apple, Loader2, Plus, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HealthVSummary, HealthActivityType } from '@/lib/health/types'
import { isHealthKitAvailable } from '@/lib/native/healthkit'
import { connectHealthKit } from '@/lib/native/healthkit-sync'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthActivity {
  id:              string
  provider:        string
  activityType:    string
  title:           string | null
  startedAt:       string
  endedAt:         string | null
  durationSeconds: number | null
  activeEnergyKcal: number | null
  distanceM:       number | null
  avgHeartRateBpm: number | null
  stepCount:       number | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  apple_health:   'Apple Health',
  health_connect: 'Health Connect',
  garmin:         'Garmin',
  strava:         'Strava',
  polar:          'Polar',
  manual:         'Manual',
}

const ACTIVITY_TYPES: HealthActivityType[] = [
  'strength_training', 'running', 'cycling', 'walking',
  'swimming', 'hiking', 'yoga', 'hiit', 'rowing', 'other',
  'functional_strength', 'elliptical', 'stair_climbing', 'cross_training',
]

const ACTIVITY_LABELS: Record<HealthActivityType, string> = {
  strength_training:  'Strength',
  running:            'Running',
  cycling:            'Cycling',
  walking:            'Walking',
  swimming:           'Swimming',
  hiking:             'Hiking',
  yoga:               'Yoga',
  hiit:               'HIIT',
  rowing:             'Rowing',
  other:              'Other',
  functional_strength: 'Functional',
  elliptical:         'Elliptical',
  stair_climbing:     'Stairs',
  cross_training:     'Cross Training',
}

const ACTIVITY_EMOJI: Record<HealthActivityType, string> = {
  strength_training:  '🏋️',
  running:            '🏃',
  cycling:            '🚴',
  walking:            '🚶',
  swimming:           '🏊',
  hiking:             '🥾',
  yoga:               '🧘',
  hiit:               '⚡',
  rowing:             '🚣',
  other:              '💪',
  functional_strength: '🏋️',
  elliptical:         '🔄',
  stair_climbing:     '🪜',
  cross_training:     '🤸',
}

// ─── Step bar chart ───────────────────────────────────────────────────────────

function StepChart({ data }: { data: Array<{ date: string; steps: number }> }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => d.steps), 1)

  return (
    <div className="flex items-end gap-1 h-24 mt-2">
      {data.map(d => {
        const pct = d.steps / max
        const isToday = d.date === new Date().toISOString().slice(0, 10)
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="relative w-full flex items-end justify-center h-20">
              <div
                className={cn(
                  'w-full rounded-t-sm transition-all',
                  isToday
                    ? 'bg-emerald-500'
                    : 'bg-zinc-200 dark:bg-zinc-700 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-600'
                )}
                style={{ height: `${Math.max(pct * 100, 4)}%` }}
                title={`${d.date}: ${d.steps.toLocaleString()} steps`}
              />
            </div>
            <span className="text-[9px] text-zinc-400 hidden sm:block">
              {d.date.slice(5).replace('-', '/')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Activity row ─────────────────────────────────────────────────────────────

function ActivityRow({ a }: { a: HealthActivity }) {
  const type = a.activityType as HealthActivityType
  const mins = a.durationSeconds ? Math.round(a.durationSeconds / 60) : null
  const date = new Date(a.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="flex items-start gap-3 py-3 border-b border-zinc-50 dark:border-zinc-800 last:border-0">
      <span className="text-xl mt-0.5 shrink-0">{ACTIVITY_EMOJI[type] ?? '💪'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
            {a.title ?? ACTIVITY_LABELS[type] ?? a.activityType.replace(/_/g, ' ')}
          </p>
          <span className="text-xs text-zinc-400 shrink-0">{date}</span>
        </div>
        <div className="flex gap-3 mt-0.5 text-xs text-zinc-500 flex-wrap">
          {mins            && <span>{mins} min</span>}
          {a.avgHeartRateBpm && <span>avg {a.avgHeartRateBpm} bpm</span>}
          {a.activeEnergyKcal && <span>{Math.round(a.activeEnergyKcal)} kcal</span>}
          {a.distanceM     && <span>{(a.distanceM / 1000).toFixed(2)} km</span>}
          {a.stepCount     && <span>{a.stepCount.toLocaleString()} steps</span>}
          <span className="text-zinc-300 dark:text-zinc-600">{PROVIDER_LABELS[a.provider] ?? a.provider}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Log activity form ────────────────────────────────────────────────────────

function LogActivityForm({ onSaved }: { onSaved: () => void }) {
  const [type, setType]         = useState<HealthActivityType>('strength_training')
  const [title, setTitle]       = useState('')
  const [date, setDate]         = useState(new Date().toISOString().slice(0, 10))
  const [duration, setDuration] = useState('')
  const [energy, setEnergy]     = useState('')
  const [bpm, setBpm]           = useState('')
  const [distKm, setDistKm]     = useState('')
  const [steps, setSteps]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!duration && !energy) { setError('Add at least duration or active energy.'); return }
    setSaving(true)
    setError(null)

    const startedAt = new Date(`${date}T09:00:00`).toISOString()
    const durationSeconds = duration ? parseInt(duration) * 60 : undefined
    const endedAt = durationSeconds
      ? new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString()
      : undefined

    const r = await fetch('/api/health/sync', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider:   'manual',
        activities: [{
          externalId:       null,
          activityType:     type,
          title:            title.trim() || undefined,
          startedAt,
          endedAt,
          durationSeconds,
          activeEnergyKcal: energy   ? parseFloat(energy)   : undefined,
          avgHeartRateBpm:  bpm      ? parseInt(bpm)        : undefined,
          distanceM:        distKm   ? parseFloat(distKm) * 1000 : undefined,
          stepCount:        steps    ? parseInt(steps)      : undefined,
        }],
      }),
    })

    if (r.ok) {
      setSaved(true)
      setTimeout(() => { setSaved(false); onSaved() }, 1200)
      setTitle(''); setDuration(''); setEnergy(''); setBpm(''); setDistKm(''); setSteps('')
    } else {
      setError('Failed to save. Try again.')
    }
    setSaving(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Type + date */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Activity type</label>
          <select
            value={type}
            onChange={e => setType(e.target.value as HealthActivityType)}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none"
          >
            {ACTIVITY_TYPES.map(t => (
              <option key={t} value={t}>{ACTIVITY_EMOJI[t]} {ACTIVITY_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none"
          />
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Name (optional)</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={`e.g. Morning ${ACTIVITY_LABELS[type]}`}
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
        />
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Duration (min)</label>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 45"
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-400" />
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Active energy (kcal)</label>
          <input type="number" value={energy} onChange={e => setEnergy(e.target.value)} placeholder="e.g. 350"
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-400" />
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Avg heart rate (bpm)</label>
          <input type="number" value={bpm} onChange={e => setBpm(e.target.value)} placeholder="e.g. 145"
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-400" />
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Distance (km)</label>
          <input type="number" step="0.01" value={distKm} onChange={e => setDistKm(e.target.value)} placeholder="e.g. 5.0"
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-400" />
        </div>
      </div>

      {['walking', 'running', 'hiking'].includes(type) && (
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Steps</label>
          <input type="number" value={steps} onChange={e => setSteps(e.target.value)} placeholder="e.g. 8500"
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm focus:outline-none focus:border-zinc-400" />
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={saving || saved}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-3 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {saved  && <Check className="size-4 text-emerald-400" />}
        {saved ? 'Saved!' : saving ? 'Saving…' : 'Log Activity'}
      </button>
    </form>
  )
}

// ─── Connect section ──────────────────────────────────────────────────────────

type AppleStatus = 'checking' | 'unavailable' | 'not_connected' | 'connected' | 'connecting'

function ConnectSection() {
  const [appleStatus, setAppleStatus] = useState<AppleStatus>('checking')
  const [connectError, setConnectError] = useState<string | null>(null)

  useEffect(() => {
    isHealthKitAvailable().then((available) => {
      if (!available) {
        setAppleStatus('unavailable')
        return
      }
      fetch('/api/healthkit/status')
        .then(r => r.ok ? r.json() : { connected: false })
        .then((data: { connected: boolean }) => {
          setAppleStatus(data.connected ? 'connected' : 'not_connected')
        })
        .catch(() => setAppleStatus('not_connected'))
    })
  }, [])

  async function handleAppleConnect() {
    setConnectError(null)
    setAppleStatus('connecting')
    const result = await connectHealthKit()
    if (result.success) {
      setAppleStatus('connected')
    } else {
      setConnectError(result.error ?? 'Could not connect to Apple Health')
      setAppleStatus('not_connected')
    }
  }

  const isNativeIOS = appleStatus !== 'unavailable' && appleStatus !== 'checking'

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        {isNativeIOS
          ? 'Connect Apple Health to automatically import workouts, heart rate, and body weight.'
          : 'Automatic sync with health platforms requires the native iOS or Android app. Manual logging is available now from the Log tab.'
        }
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Apple className="size-5 text-zinc-600 dark:text-zinc-300" />
            <span className="font-semibold text-sm">Apple Health</span>
          </div>
          <p className="text-xs text-zinc-500 mb-2">
            Syncs workouts, steps, heart rate, sleep, and more via HealthKit.
          </p>
          {appleStatus === 'checking' && (
            <div className="h-5 w-28 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          )}
          {appleStatus === 'unavailable' && (
            <Badge variant="warning" className="text-xs">Requires native iOS app</Badge>
          )}
          {appleStatus === 'not_connected' && (
            <div className="space-y-1.5">
              <button
                onClick={handleAppleConnect}
                className="rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 text-xs font-semibold hover:bg-zinc-700 dark:hover:bg-zinc-100 transition-colors"
              >
                Connect
              </button>
              {connectError && <p className="text-xs text-red-500">{connectError}</p>}
            </div>
          )}
          {appleStatus === 'connecting' && (
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-zinc-400" />
              <span className="text-xs text-zinc-400">Connecting…</span>
            </div>
          )}
          {appleStatus === 'connected' && (
            <div className="flex items-center gap-1.5">
              <Check className="size-3.5 text-emerald-500" />
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Connected</span>
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Smartphone className="size-5 text-zinc-600 dark:text-zinc-300" />
            <span className="font-semibold text-sm">Health Connect</span>
          </div>
          <p className="text-xs text-zinc-500 mb-2">
            Android platform integration — syncs activity, heart rate, and body metrics.
          </p>
          <Badge variant="warning" className="text-xs">Requires native Android app</Badge>
        </div>
      </div>
      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 p-4">
        <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wide">Privacy</p>
        <ul className="space-y-1.5 text-xs text-zinc-500">
          <li>• Opt-in only — nothing syncs until you authorize it in the native app</li>
          <li>• Minimum necessary data — Involved only requests what it displays</li>
          <li>• Revocable at any time through iOS Settings or Android Health Connect</li>
          <li>• Your health history is never shared with trainers without your explicit permission</li>
        </ul>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'activities' | 'log' | 'connect'

export default function HealthPage() {
  const [tab, setTab]               = useState<Tab>('overview')
  const [summary, setSummary]       = useState<HealthVSummary | null>(null)
  const [activities, setActivities] = useState<HealthActivity[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [activitiesLoaded, setActivitiesLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/health/summary?days=14')
      .then(r => r.json())
      .then(d => setSummary((d as { summary: HealthVSummary | null }).summary ?? null))
      .finally(() => setSummaryLoading(false))
  }, [])

  const loadActivities = useCallback(async (cursor?: string) => {
    setActivitiesLoading(true)
    const url = cursor
      ? `/api/health/activities?limit=20&cursor=${cursor}`
      : '/api/health/activities?limit=20'
    const r = await fetch(url)
    if (r.ok) {
      const d = await r.json() as { activities: HealthActivity[]; nextCursor: string | null }
      setActivities(prev => cursor ? [...prev, ...d.activities] : d.activities)
      setNextCursor(d.nextCursor)
    }
    setActivitiesLoading(false)
    setActivitiesLoaded(true)
  }, [])

  useEffect(() => {
    if (tab === 'activities' && !activitiesLoaded) {
      void loadActivities()
    }
  }, [tab, activitiesLoaded, loadActivities])

  function handleLogSaved() {
    setSummaryLoading(true)
    fetch('/api/health/summary?days=14')
      .then(r => r.json())
      .then(d => setSummary((d as { summary: HealthVSummary | null }).summary ?? null))
      .finally(() => setSummaryLoading(false))
    // Refresh activities list if it's been loaded
    if (activitiesLoaded) {
      setActivitiesLoaded(false)
      void loadActivities()
    }
  }

  const hasAnyData = summary && (
    summary.recentActivities.length > 0 ||
    summary.dailySteps.length > 0 ||
    summary.latestWeightKg !== undefined
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',    label: 'Overview'    },
    { id: 'activities',  label: 'Activities'  },
    { id: 'log',         label: 'Log Activity' },
    { id: 'connect',     label: 'Connect'     },
  ]

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {/* Header */}
      <div className="mb-1">
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Health & Activity</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {hasAnyData
            ? `${summary!.periodStart} — ${summary!.periodEnd}`
            : 'Log manually or connect a health platform'}
        </p>
      </div>

      {/* Summary stats row */}
      {!summaryLoading && hasAnyData && (
        <div className="grid grid-cols-3 gap-3 my-5">
          {summary!.today?.steps !== undefined && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-center">
              <p className="text-xl font-black text-zinc-900 dark:text-white">
                {summary!.today.steps.toLocaleString()}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">steps today</p>
            </div>
          )}
          {summary!.today?.activeEnergyKcal !== undefined && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-center">
              <p className="text-xl font-black text-zinc-900 dark:text-white">
                {Math.round(summary!.today.activeEnergyKcal)}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">kcal active</p>
            </div>
          )}
          {summary!.latestWeightKg !== undefined && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-center">
              <p className="text-xl font-black text-zinc-900 dark:text-white">
                {summary!.latestWeightKg}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">kg body wt</p>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700 mb-6">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-5">
          {summaryLoading && <p className="text-sm text-zinc-400">Loading…</p>}

          {!summaryLoading && !hasAnyData && (
            <div className="text-center py-10 space-y-4">
              <p className="text-zinc-400 text-sm">No health data yet.</p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setTab('log')}
                  className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity"
                >
                  <Plus className="size-4" /> Log an activity
                </button>
                <button
                  onClick={() => setTab('connect')}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Connect a platform
                </button>
              </div>
            </div>
          )}

          {!summaryLoading && summary && summary.dailySteps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Daily Steps</CardTitle>
              </CardHeader>
              <StepChart data={summary.dailySteps.slice(-14)} />
            </Card>
          )}

          {!summaryLoading && summary && summary.recentActivities.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <CardTitle>Recent Activities</CardTitle>
                  <button
                    onClick={() => setTab('activities')}
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  >
                    See all →
                  </button>
                </div>
              </CardHeader>
              <div>
                {summary.recentActivities.slice(0, 5).map((a, i) => (
                  <div key={i} className="flex items-start gap-3 py-2.5 border-b border-zinc-50 dark:border-zinc-800 last:border-0">
                    <span className="text-lg shrink-0">
                      {ACTIVITY_EMOJI[a.activityType as HealthActivityType] ?? '💪'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                          {a.title ?? ACTIVITY_LABELS[a.activityType as HealthActivityType] ?? a.activityType.replace(/_/g, ' ')}
                        </p>
                        <span className="text-xs text-zinc-400 shrink-0">{a.date}</span>
                      </div>
                      <div className="flex gap-3 text-xs text-zinc-500 flex-wrap mt-0.5">
                        {a.durationMinutes   && <span>{a.durationMinutes} min</span>}
                        {a.avgHeartRateBpm   && <span>avg {a.avgHeartRateBpm} bpm</span>}
                        {a.activeEnergyKcal  && <span>{Math.round(a.activeEnergyKcal)} kcal</span>}
                        {a.distanceM         && <span>{(a.distanceM / 1000).toFixed(2)} km</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {!summaryLoading && summary && summary.latestWeightKg !== undefined && (
            <Card>
              <CardHeader><CardTitle>Body Weight</CardTitle></CardHeader>
              <div>
                <p className="text-2xl font-black text-zinc-900 dark:text-white">
                  {summary.latestWeightKg} kg
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Recorded {summary.latestWeightDate}
                </p>
              </div>
            </Card>
          )}

          {!summaryLoading && summary?.provider && (
            <p className="text-xs text-zinc-400 text-center">
              Synced from {PROVIDER_LABELS[summary.provider] ?? summary.provider}
            </p>
          )}
        </div>
      )}

      {/* Activities */}
      {tab === 'activities' && (
        <div>
          {activitiesLoading && !activitiesLoaded && (
            <div className="flex items-center justify-center py-10 gap-2 text-zinc-400">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}
          {activitiesLoaded && activities.length === 0 && (
            <div className="text-center py-10">
              <p className="text-sm text-zinc-400 mb-4">No activities yet.</p>
              <button
                onClick={() => setTab('log')}
                className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity mx-auto"
              >
                <Plus className="size-4" /> Log your first activity
              </button>
            </div>
          )}
          {activities.length > 0 && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 divide-y divide-zinc-50 dark:divide-zinc-800">
              {activities.map(a => <ActivityRow key={a.id} a={a} />)}
            </div>
          )}
          {nextCursor && (
            <div className="flex justify-center mt-4">
              <button
                onClick={() => {
                  setLoadingMore(true)
                  loadActivities(nextCursor).finally(() => setLoadingMore(false))
                }}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                {loadingMore && <Loader2 className="size-4 animate-spin" />}
                Load more
              </button>
            </div>
          )}
        </div>
      )}

      {/* Log */}
      {tab === 'log' && (
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <LogActivityForm onSaved={handleLogSaved} />
        </div>
      )}

      {/* Connect */}
      {tab === 'connect' && <ConnectSection />}
    </div>
  )
}
