'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// Bridges program-day "Start" → active workout session.
// Reads ?programDayId=XXX, fetches the program day to resolve programId,
// calls the start API, then redirects to /training/workout/:id.
// Falls back to /training/log for a quick/empty workout.

function StartWorkout() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const programDayId = searchParams.get('programDayId')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!programDayId) {
      router.replace('/training/log')
      return
    }

    async function start() {
      try {
        // Resolve programId from the day
        const dayRes = await fetch(`/api/programs/days/${programDayId}`)
        if (!dayRes.ok) throw new Error('Program day not found')
        const { programId } = await dayRes.json() as { programId: string }

        // Create snapshot workout from the program day
        const startRes = await fetch(`/api/programs/${programId}/days/${programDayId}/start`, {
          method: 'POST',
        })
        if (!startRes.ok) {
          const data = await startRes.json() as { error?: string }
          throw new Error(data.error ?? 'Failed to start workout')
        }
        const { workoutId } = await startRes.json() as { workoutId: string }
        router.replace(`/training/workout/${workoutId}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    }

    void start()
  }, [programDayId, router])

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={() => router.back()}
          className="text-sm text-zinc-500 underline underline-offset-2"
        >
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500">Starting workout…</p>
      </div>
    </div>
  )
}

export default function NewWorkoutPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
      </div>
    }>
      <StartWorkout />
    </Suspense>
  )
}
