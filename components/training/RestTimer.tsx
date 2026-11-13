'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  seconds: number
  onDone: () => void
  onDismiss: () => void
}

export default function RestTimer({ seconds, onDone, onDismiss }: Props) {
  const [remaining, setRemaining] = useState(seconds)

  const done = useCallback(() => {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start()
      osc.stop(ctx.currentTime + 0.4)
    } catch {}
    onDone()
  }, [onDone])

  useEffect(() => {
    if (remaining <= 0) { done(); return }
    const id = setTimeout(() => setRemaining(r => r - 1), 1000)
    return () => clearTimeout(id)
  }, [remaining, done])

  const pct = Math.max(0, remaining / seconds)
  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-xs">
      <div className="rounded-2xl bg-zinc-900 dark:bg-zinc-800 text-white shadow-2xl p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Timer className="size-3.5 text-zinc-400" />
            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Rest</span>
          </div>
          <button
            onClick={onDismiss}
            className="flex size-6 items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 transition-colors"
          >
            <X className="size-3" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-3xl font-black tabular-nums w-16 shrink-0">
            {mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : secs}
          </span>
          <div className="flex-1">
            <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-1000', remaining <= 5 ? 'bg-red-400' : 'bg-emerald-400')}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 mt-2">
          {[30, 60, 90].map(s => (
            <button
              key={s}
              onClick={() => setRemaining(s)}
              className="flex-1 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs font-semibold transition-colors"
            >
              {s}s
            </button>
          ))}
          <button
            onClick={onDismiss}
            className="flex-1 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
