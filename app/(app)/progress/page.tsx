'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Dumbbell, TrendingUp, Scale, Trophy, Loader2, Flame, Target, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeekBucket { week: string; totalKg: number; sessions: number }
interface PREntry { exerciseId: string; exerciseName: string; metric: string; value: number; unit: string; achievedAt: string }
interface MuscleEntry { muscle: string; bodyPart: string; workingSets: number; totalVolumeKg: number; sessionCount: number; lastTrainedAt: string }

interface Summary {
  workoutsThisMonth:  number
  avgWeeklyWorkouts:  number
  avgDailyCalories:   number | null
  latestBodyWeightKg: number | null
  weeklyVolume:       WeekBucket[]
  topPRs:             PREntry[]
}

interface VolumeData { muscles: MuscleEntry[] }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMetric(metric: string): string {
  const m: Record<string, string> = {
    weight: 'Max weight', estimated_1rm: 'Est. 1RM', reps: 'Max reps',
    duration: 'Duration', distance: 'Distance',
  }
  return m[metric] ?? metric
}

function fmtValue(value: number, metric: string, unit: string): string {
  if (metric === 'duration') {
    const mins = Math.floor(value / 60)
    return mins > 0 ? `${mins}m` : `${value}s`
  }
  if (metric === 'distance') {
    const km = value / 1000
    return km >= 1 ? `${km.toFixed(1)} km` : `${value} m`
  }
  const display = value % 1 === 0 ? value.toString() : value.toFixed(1)
  return `${display} ${unit}`
}

function shortWeek(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const BODY_PART_COLORS: Record<string, string> = {
  back:       'bg-blue-500',
  chest:      'bg-red-500',
  legs:       'bg-emerald-500',
  shoulders:  'bg-amber-500',
  arms:       'bg-purple-500',
  core:       'bg-orange-500',
  cardio:     'bg-sky-400',
}

// ─── Chart: Volume Bars ───────────────────────────────────────────────────────

function VolumeBars({ weeks }: { weeks: WeekBucket[] }) {
  const maxKg = Math.max(...weeks.map(w => w.totalKg), 1)

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-1.5 h-28">
        {weeks.map((w, i) => {
          const pct = w.totalKg / maxKg
          const isLast = i === weeks.length - 1

          return (
            <div key={w.week} className="flex flex-1 flex-col items-center gap-1 h-full">
              <div className="flex-1 w-full flex items-end">
                {w.totalKg > 0 ? (
                  <div
                    className={cn(
                      'w-full rounded-t-md transition-all group relative',
                      isLast ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-700'
                    )}
                    style={{ height: `${Math.max(pct * 100, 4)}%` }}
                  >
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-zinc-500 dark:text-zinc-400 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                      {w.totalKg >= 1000 ? `${(w.totalKg / 1000).toFixed(1)}t` : `${w.totalKg}kg`}
                    </span>
                  </div>
                ) : (
                  <div className="w-full rounded-t-md bg-zinc-100 dark:bg-zinc-800" style={{ height: '4%' }} />
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-1.5">
        {weeks.map((w, i) => (
          <div key={w.week} className={cn('flex-1 text-center text-[9px] truncate', i === weeks.length - 1 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-zinc-400')}>
            {shortWeek(w.week)}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Muscle Frequency ────────────────────────────────────────────────────────

function MuscleFrequency({ muscles }: { muscles: MuscleEntry[] }) {
  const top = muscles.slice(0, 10)
  const maxSets = Math.max(...top.map(m => m.workingSets), 1)

  if (top.length === 0) return (
    <p className="text-sm text-zinc-400 py-4 text-center">No workout data yet.</p>
  )

  return (
    <div className="space-y-2.5">
      {top.map(m => {
        const colorClass = BODY_PART_COLORS[m.bodyPart.toLowerCase()] ?? 'bg-zinc-400'
        const pct = (m.workingSets / maxSets) * 100

        return (
          <div key={m.muscle} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="capitalize text-zinc-700 dark:text-zinc-300">{m.muscle}</span>
              <span className="text-zinc-400">{m.workingSets} sets · {m.sessionCount} sessions</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', colorClass)}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, highlight = false }: {
  icon: React.ElementType; label: string; value: string; sub?: string; highlight?: boolean
}) {
  return (
    <div className={cn(
      'rounded-2xl border p-4 flex flex-col gap-1',
      highlight
        ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/10'
        : 'border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900'
    )}>
      <Icon className={cn('size-4', highlight ? 'text-emerald-500' : 'text-zinc-400')} />
      <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
      <p className={cn('text-2xl font-black', highlight ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-900 dark:text-white')}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-400">{sub}</p>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProgressPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [volume, setVolume] = useState<VolumeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [volumeDays, setVolumeDays] = useState(28)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/analytics/summary').then(r => r.json() as Promise<Summary>),
      fetch(`/api/training/volume?days=${volumeDays}`).then(r => r.json() as Promise<VolumeData>),
    ]).then(([s, v]) => {
      setSummary(s)
      setVolume(v)
    }).finally(() => setLoading(false))
  }, [volumeDays])

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  )

  const hasAnyData = (summary?.workoutsThisMonth ?? 0) > 0 || (summary?.topPRs.length ?? 0) > 0

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Progress</h1>
        {!hasAnyData && (
          <p className="text-sm text-zinc-400 mt-0.5">Start logging workouts and food to see your stats.</p>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Dumbbell}
          label="Workouts this month"
          value={summary?.workoutsThisMonth != null ? String(summary.workoutsThisMonth) : '—'}
          highlight={(summary?.workoutsThisMonth ?? 0) > 0}
        />
        <StatCard
          icon={TrendingUp}
          label="Avg per week"
          value={summary?.avgWeeklyWorkouts != null ? `${summary.avgWeeklyWorkouts}` : '—'}
          sub="last 8 weeks"
        />
        <StatCard
          icon={Flame}
          label="Avg daily calories"
          value={summary?.avgDailyCalories != null ? `${summary.avgDailyCalories}` : '—'}
          sub="last 30 days"
        />
        <StatCard
          icon={Scale}
          label="Body weight"
          value={summary?.latestBodyWeightKg != null ? `${summary.latestBodyWeightKg} kg` : '—'}
        />
      </div>

      {/* Volume chart */}
      <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1.5">
            <BarChart3 className="size-3.5" /> Weekly volume
          </p>
          <span className="text-[11px] text-zinc-400">kg lifted</span>
        </div>
        {summary?.weeklyVolume ? (
          <VolumeBars weeks={summary.weeklyVolume} />
        ) : (
          <div className="h-28 flex items-center justify-center">
            <p className="text-sm text-zinc-400">No workout data yet</p>
          </div>
        )}
      </div>

      {/* Muscle frequency */}
      <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1.5">
            <Target className="size-3.5" /> Muscle frequency
          </p>
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-[11px]">
            {[7, 28, 90].map(d => (
              <button
                key={d}
                onClick={() => setVolumeDays(d)}
                className={cn(
                  'px-2 py-1 transition-colors',
                  volumeDays === d
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold'
                    : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                )}
              >
                {d === 7 ? '7d' : d === 28 ? '4w' : '3m'}
              </button>
            ))}
          </div>
        </div>
        <MuscleFrequency muscles={volume?.muscles ?? []} />
      </div>

      {/* Personal records */}
      <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1.5 mb-4">
          <Trophy className="size-3.5 text-amber-500" /> Personal records
        </p>

        {!summary?.topPRs.length ? (
          <p className="text-sm text-zinc-400 py-4 text-center">
            Complete workouts to set personal records.
          </p>
        ) : (
          <div className="space-y-1">
            {summary.topPRs.map((pr, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 border-b border-zinc-50 dark:border-zinc-800/50 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{pr.exerciseName}</p>
                  <p className="text-[11px] text-zinc-400">{fmtMetric(pr.metric)}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-sm font-black text-zinc-900 dark:text-white">{fmtValue(pr.value, pr.metric, pr.unit)}</p>
                  <p className="text-[11px] text-zinc-400">{pr.achievedAt.slice(0, 10)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Empty state CTA */}
      {!hasAnyData && (
        <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-center">
          <p className="font-bold text-zinc-900 dark:text-white mb-1">Build your history</p>
          <p className="text-sm text-zinc-500 mb-4">
            Log food in Nutrition and workouts in Training — your charts fill in automatically.
          </p>
          <div className="flex gap-2 justify-center">
            <Link href="/nutrition" className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              Log food
            </Link>
            <Link href="/training/exercises" className="rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 text-sm font-bold hover:opacity-90 transition-opacity">
              Browse exercises
            </Link>
          </div>
        </div>
      )}

    </div>
  )
}
