'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MuscleEntry {
  muscle: string
  bodyPart: string
  workingSets: number
  totalReps: number
  totalVolumeKg: number
  lastTrainedAt: string
  sessionCount: number
}

const PERIOD_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '28 days', value: 28 },
]

const BODY_PART_COLORS: Record<string, string> = {
  chest: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  back: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  shoulders: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  'upper arms': 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  'lower arms': 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  'upper legs': 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  'lower legs': 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400',
  waist: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
  cardio: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400',
}

function bodyPartColor(bp: string) {
  return BODY_PART_COLORS[bp.toLowerCase()] ?? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
}

function formatLastTrained(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function MusclevolumePage() {
  const [days, setDays] = useState(7)
  const [muscles, setMuscles] = useState<MuscleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<{ from: string; days: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/training/volume?days=${days}`)
      .then(r => r.json() as Promise<{ muscles: MuscleEntry[]; period: { from: string; days: number } }>)
      .then(data => {
        setMuscles(data.muscles)
        setPeriod(data.period)
      })
      .finally(() => setLoading(false))
  }, [days])

  const maxSets = muscles.length > 0 ? Math.max(...muscles.map(m => m.workingSets)) : 1

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/training" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Muscle volume</h1>
          <p className="text-sm text-zinc-500">Working sets per muscle group</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-zinc-200 dark:border-zinc-700 p-1">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                days === opt.value
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-zinc-400" />
        </div>
      ) : muscles.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="font-semibold text-zinc-900 dark:text-white mb-1">No training data</p>
          <p className="text-sm text-zinc-400">
            Complete some workouts in the last {days} days to see muscle volume.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {period && (
            <p className="text-xs text-zinc-400 mb-4">
              {new Date(period.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          )}
          {muscles.map(m => (
            <div
              key={m.muscle}
              className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-zinc-900 dark:text-white capitalize">{m.muscle}</p>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize', bodyPartColor(m.bodyPart))}>
                      {m.bodyPart}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Last: {formatLastTrained(m.lastTrainedAt)}
                    {m.sessionCount > 1 && ` · ${m.sessionCount} sessions`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-black text-zinc-900 dark:text-white">{m.workingSets}</p>
                  <p className="text-[10px] text-zinc-400">sets</p>
                </div>
              </div>
              {/* Volume bar */}
              <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
                  style={{ width: `${(m.workingSets / maxSets) * 100}%` }}
                />
              </div>
              {m.totalVolumeKg > 0 && (
                <p className="text-[10px] text-zinc-400 mt-1">
                  {m.totalVolumeKg.toLocaleString()}kg total volume · {m.totalReps} reps
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
