'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TargetEntry {
  targetType: string
  targetValue: number
  progress: number
}

interface TargetConfig {
  type: string
  label: string
  description: string
  min: number
  max: number
  unit: string
}

const TARGETS: TargetConfig[] = [
  {
    type: 'workouts_per_week',
    label: 'Workouts per week',
    description: 'Completed training sessions',
    min: 1, max: 14, unit: 'workouts',
  },
  {
    type: 'training_days',
    label: 'Training days',
    description: 'Days with at least one workout',
    min: 1, max: 7, unit: 'days',
  },
  {
    type: 'nutrition_log_days',
    label: 'Nutrition log days',
    description: 'Days with at least one food entry',
    min: 1, max: 7, unit: 'days',
  },
  {
    type: 'protein_target_days',
    label: 'Protein target days',
    description: 'Days where protein goal is met',
    min: 1, max: 7, unit: 'days',
  },
]

function ProgressBar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(value / target, 1) : 0
  const done = value >= target
  return (
    <div className="mt-2">
      <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', done ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-500')}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <p className="text-xs text-zinc-400 mt-1">
        {value} / {target} {done && <span className="text-emerald-500 font-medium">✓</span>}
      </p>
    </div>
  )
}

export default function WeeklyTargetsPage() {
  const [targets, setTargets] = useState<Record<string, number>>({})
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    fetch('/api/weekly-targets')
      .then(r => r.json() as Promise<{ targets: TargetEntry[] }>)
      .then(data => {
        const t: Record<string, number> = {}
        const p: Record<string, number> = {}
        for (const entry of data.targets) {
          t[entry.targetType] = entry.targetValue
          p[entry.targetType] = entry.progress
        }
        // Defaults for unset targets
        for (const cfg of TARGETS) {
          if (!(cfg.type in t)) t[cfg.type] = 0
          if (!(cfg.type in p)) p[cfg.type] = 0
        }
        setTargets(t)
        setProgress(p)
      })
      .finally(() => setLoading(false))
  }, [])

  const setTarget = (type: string, value: number) => {
    setTargets(prev => ({ ...prev, [type]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    const payload = Object.entries(targets)
      .filter(([, v]) => v > 0)
      .map(([targetType, targetValue]) => ({ targetType, targetValue }))
    try {
      await fetch('/api/weekly-targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: payload }),
      })
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/training" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Weekly targets</h1>
          <p className="text-sm text-zinc-500">This week&apos;s progress</p>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-2 text-sm font-bold hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-zinc-400" />
        </div>
      ) : (
        <div className="space-y-3">
          {TARGETS.map(cfg => {
            const val = targets[cfg.type] ?? 0
            const prog = progress[cfg.type] ?? 0
            return (
              <div key={cfg.type} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-zinc-900 dark:text-white">{cfg.label}</p>
                    <p className="text-xs text-zinc-400">{cfg.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setTarget(cfg.type, Math.max(0, val - 1))}
                      className="flex size-7 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-lg font-bold transition-colors"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-lg font-black text-zinc-900 dark:text-white">
                      {val === 0 ? '—' : val}
                    </span>
                    <button
                      onClick={() => setTarget(cfg.type, Math.min(cfg.max, val + 1))}
                      className="flex size-7 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-lg font-bold transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
                {val > 0 && <ProgressBar value={prog} target={val} />}
              </div>
            )
          })}
          <p className="text-xs text-zinc-400 text-center pt-2">
            Set target to 0 to disable. Progress resets each Monday.
          </p>
        </div>
      )}
    </div>
  )
}
