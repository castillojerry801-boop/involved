'use client'

import { useState } from 'react'
import { Scissors, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ShortenModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workoutId: string
  onShortened?: () => void
}

const DURATION_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '20 min', value: 20 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
]

export function ShortenModal({ open, onOpenChange, workoutId, onShortened }: ShortenModalProps) {
  const [target, setTarget] = useState(30)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ removed: string[]; reasoning: string } | null>(null)

  if (!open) return null

  const handleShorten = async () => {
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/v/shorten-workout/${workoutId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetMinutes: target }),
      })
      const data = await res.json() as {
        removed?: string[]
        reasoning?: string
        error?: string
      }

      if (!res.ok) {
        if (res.status === 403) {
          setError('Involved+ is required to shorten workouts with V.')
        } else if (res.status === 429) {
          setError("You've reached your monthly limit for this feature.")
        } else {
          setError(data.error ?? 'Could not shorten workout. Please try again.')
        }
        return
      }

      setResult({ removed: data.removed ?? [], reasoning: data.reasoning ?? '' })
      onShortened?.()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const close = () => {
    if (loading) return
    onOpenChange(false)
    setResult(null)
    setError(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full sm:max-w-sm bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="font-bold text-lg text-zinc-900 dark:text-white flex items-center gap-2">
            <Scissors className="size-4 text-zinc-500" />
            Shorten with V
          </h2>
          <button onClick={close} className="flex size-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {result ? (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{result.reasoning}</p>
              {result.removed.length > 0 && (
                <p className="text-sm text-zinc-900 dark:text-white">
                  Removed {result.removed.length} exercise{result.removed.length !== 1 ? 's' : ''}.
                </p>
              )}
              <Button className="w-full" onClick={close}>Done</Button>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                V will restructure your remaining workout to fit the target duration.
              </p>
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Target duration</p>
                <div className="flex gap-2 flex-wrap">
                  {DURATION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTarget(opt.value)}
                      disabled={loading}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                        target === opt.value
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                          : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <Button onClick={handleShorten} loading={loading} className="w-full">
                {loading ? 'V is restructuring...' : `Shorten to ${target} min`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
