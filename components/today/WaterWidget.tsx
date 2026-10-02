'use client'

import { useState, useRef, useEffect } from 'react'
import { Droplets, RotateCcw, Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const ML_PER_OZ = 29.5735

const QUICK_ADD: { label: string; oz: number }[] = [
  { label: '+4 oz', oz: 4 },
  { label: '+8 oz', oz: 8 },
  { label: '+16 oz', oz: 16 },
  { label: '+32 oz', oz: 32 },
]

function mlToOz(ml: number) {
  return Math.round((ml / ML_PER_OZ) * 10) / 10
}

export function WaterWidget({ initialTotalMl, goalOz }: { initialTotalMl: number; goalOz: number }) {
  const [totalMl, setTotalMl] = useState(initialTotalMl)
  const [goal, setGoal] = useState(goalOz)
  const [loading, setLoading] = useState(false)
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput, setGoalInput] = useState(String(goalOz))
  const goalInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingGoal) goalInputRef.current?.focus()
  }, [editingGoal])

  const totalOz = mlToOz(totalMl)
  const pct = Math.min(Math.round((totalOz / goal) * 100), 100)
  const remaining = Math.max(0, goal - totalOz)
  const done = totalOz >= goal

  async function add(oz: number) {
    if (loading) return
    setLoading(true)
    const addMl = oz * ML_PER_OZ
    setTotalMl(prev => prev + addMl)
    try {
      const res = await fetch('/api/health/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oz }),
      })
      if (!res.ok) setTotalMl(prev => prev - addMl)
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

  async function saveGoal() {
    const parsed = parseInt(goalInput, 10)
    if (isNaN(parsed) || parsed < 8 || parsed > 300) {
      setGoalInput(String(goal))
      setEditingGoal(false)
      return
    }
    setGoal(parsed)
    setEditingGoal(false)
    await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waterTargetOz: parsed }),
    })
  }

  function cancelGoalEdit() {
    setGoalInput(String(goal))
    setEditingGoal(false)
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets className={cn('size-4', done ? 'text-sky-400' : 'text-zinc-400')} />
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Water</span>
        </div>
        <button
          onClick={undo}
          disabled={loading || totalMl === 0}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors"
        >
          <RotateCcw className="size-3" />
          Undo
        </button>
      </div>

      {/* Amount + goal */}
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white">
          {totalOz % 1 === 0 ? totalOz : totalOz.toFixed(1)}
        </span>
        <span className="text-sm text-zinc-400">/</span>

        {/* Editable goal */}
        {editingGoal ? (
          <div className="flex items-center gap-1">
            <input
              ref={goalInputRef}
              type="number"
              value={goalInput}
              onChange={e => setGoalInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void saveGoal(); if (e.key === 'Escape') cancelGoalEdit() }}
              className="w-16 rounded border border-sky-500 bg-zinc-800 px-1.5 py-0.5 text-sm font-semibold text-zinc-100 focus:outline-none"
            />
            <span className="text-sm text-zinc-400">oz</span>
            <button onClick={() => void saveGoal()} className="text-sky-400 hover:text-sky-300"><Check className="size-3.5" /></button>
            <button onClick={cancelGoalEdit} className="text-zinc-500 hover:text-zinc-300"><X className="size-3.5" /></button>
          </div>
        ) : (
          <button
            onClick={() => { setGoalInput(String(goal)); setEditingGoal(true) }}
            className="group flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
          >
            {goal} oz
            <Pencil className="size-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
          </button>
        )}

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
