'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface GenerateWorkoutModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DURATION_OPTIONS = [
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
]

export function GenerateWorkoutModal({ open, onOpenChange }: GenerateWorkoutModalProps) {
  const router = useRouter()
  const [focus, setFocus] = useState('')
  const [duration, setDuration] = useState<number | undefined>(45)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleGenerate = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/v/generate-workout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          focus: focus.trim() || undefined,
          durationMinutes: duration,
        }),
      })

      const data = await res.json() as { workoutId?: string; title?: string; error?: string }

      if (!res.ok) {
        if (res.status === 403) {
          setError('Involved+ is required to generate workouts with V.')
        } else if (res.status === 429) {
          setError("You've reached your monthly AI workout limit.")
        } else {
          setError(data.error ?? 'Generation failed. Please try again.')
        }
        return
      }

      onOpenChange(false)
      router.push(`/training/workout/${data.workoutId}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !loading && onOpenChange(false)} />
      <div className="relative w-full sm:max-w-md bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="font-bold text-lg text-zinc-900 dark:text-white flex items-center gap-2">
              <Sparkles className="size-5 text-zinc-500" />
              Generate Workout with V
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              V builds a personalized workout based on your goals, equipment, and recent training.
            </p>
          </div>
          <button
            onClick={() => !loading && onOpenChange(false)}
            className="flex size-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Input
            label="Focus (optional)"
            placeholder="e.g. chest and triceps, legs, full body"
            value={focus}
            onChange={e => setFocus(e.target.value)}
            disabled={loading}
          />

          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Duration</p>
            <div className="flex gap-2 flex-wrap">
              {DURATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDuration(opt.value)}
                  disabled={loading}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    duration === opt.value
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                      : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  )}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setDuration(undefined)}
                disabled={loading}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  duration === undefined
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                    : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                )}
              >
                Any
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <Button
            onClick={handleGenerate}
            loading={loading}
            className="w-full"
          >
            {loading ? 'V is building your workout...' : (
              <><Sparkles className="size-4" />Generate Workout</>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
