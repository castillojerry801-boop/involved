'use client'

import { useState } from 'react'
import { Droplets, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

const ML_PER_OZ = 29.5735
const GOAL_OZ = 64 // 8 × 8 fl oz glasses

const QUICK_ADD: { label: string; oz: number }[] = [
  { label: '+4 oz', oz: 4 },
  { label: '+8 oz', oz: 8 },
  { label: '+16 oz', oz: 16 },
  { label: '+32 oz', oz: 32 },
]

function mlToOz(ml: number) {
  return Math.round((ml / ML_PER_OZ) * 10) / 10
}

export function WaterWidget({ initialTotalMl }: { initialTotalMl: number }) {
  const [totalMl, setTotalMl] = useState(initialTotalMl)
  const [loading, setLoading] = useState(false)

  const totalOz = mlToOz(totalMl)
  const pct = Math.min(Math.round((totalOz / GOAL_OZ) * 100), 100)
  const remaining = Math.max(0, GOAL_OZ - totalOz)
  const done = totalOz >= GOAL_OZ

  async function add(oz: number) {
    if (loading) return
    setLoading(true)
    // Optimistic
    const addMl = oz * ML_PER_OZ
    setTotalMl(prev => prev + addMl)
    try {
      const res = await fetch('/api/health/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oz }),
      })
      if (!res.ok) setTotalMl(prev => prev - addMl) // rollback
    } catch {
      setTotalMl(prev => prev - addMl)
    } finally {
      setLoading(false)
    }
  }

  async function undo() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/health/water', { method: 'DELETE' })
      if (res.ok) {
        const data = await res.json() as { removed: boolean }
        if (data.removed) {
          // Refresh from server — simplest correctness path
          const fresh = await fetch('/api/health/water/today')
          if (fresh.ok) {
            const { totalMl: freshMl } = await fresh.json() as { totalMl: number }
            setTotalMl(freshMl)
          }
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets className={cn('size-4', done ? 'text-sky-400' : 'text-zinc-400')} />
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Water</span>
        </div>
        <button
          onClick={undo}
          disabled={loading || totalMl === 0}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors"
          title="Undo last entry"
        >
          <RotateCcw className="size-3" />
          Undo
        </button>
      </div>

      {/* Amount display */}
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white">
          {totalOz % 1 === 0 ? totalOz : totalOz.toFixed(1)}
        </span>
        <span className="text-sm text-zinc-400">/ {GOAL_OZ} oz</span>
        {done && <span className="text-xs font-semibold text-sky-400">Goal met!</span>}
      </div>

      <p className="mb-3 text-sm text-zinc-500">
        {done
          ? 'Great job staying hydrated today.'
          : <><span className="font-semibold text-zinc-700 dark:text-zinc-300">{remaining % 1 === 0 ? remaining : remaining.toFixed(1)} oz</span> to go</>
        }
      </p>

      {/* Progress bar */}
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={cn('h-full rounded-full transition-all', done ? 'bg-sky-400' : 'bg-sky-500')}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Quick-add buttons */}
      <div className="grid grid-cols-4 gap-2">
        {QUICK_ADD.map(({ label, oz }) => (
          <button
            key={oz}
            onClick={() => void add(oz)}
            disabled={loading}
            className="rounded-lg border border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-700 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-sky-900/30 dark:hover:border-sky-700 dark:hover:text-sky-300 disabled:opacity-50 transition-colors"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
