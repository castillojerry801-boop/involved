import type { Metadata } from 'next'
import { TrendingUp, Dumbbell, Scale } from 'lucide-react'
import { Card } from '@/components/ui/card'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Progress' }

export default function ProgressPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Progress</h1>
        <p className="text-sm text-zinc-500">Your stats will appear here as you log data</p>
      </div>

      {/* Metrics grid — empty */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {[
          { label: 'Workouts this month', icon: Dumbbell },
          { label: 'Avg. daily calories', icon: TrendingUp },
          { label: 'Body weight', icon: Scale },
          { label: 'Avg. weekly workouts', icon: TrendingUp },
        ].map(({ label, icon: Icon }) => (
          <Card key={label} className="py-4 flex flex-col gap-2">
            <Icon className="size-4 text-zinc-300 dark:text-zinc-600" />
            <p className="text-xs text-zinc-400">{label}</p>
            <p className="text-2xl font-black text-zinc-300 dark:text-zinc-700">—</p>
          </Card>
        ))}
      </div>

      {/* Chart placeholder */}
      <Card className="mb-4">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-4">Workout volume</p>
        <div className="flex items-end gap-2 h-24">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full flex items-end justify-center" style={{ height: 80 }}>
                <div className="w-full rounded-t-md bg-zinc-100 dark:bg-zinc-800" style={{ height: 16 }} />
              </div>
              <p className="text-[10px] text-zinc-300 dark:text-zinc-700">—</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-400 text-center mt-3">Log workouts to see your volume over time</p>
      </Card>

      {/* Personal bests placeholder */}
      <Card className="mb-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Personal bests</p>
          <Dumbbell className="size-4 text-zinc-300 dark:text-zinc-700" />
        </div>
        <div className="flex flex-col items-center py-6 text-center">
          <p className="text-sm text-zinc-400">Your personal records will appear here as you log exercises.</p>
        </div>
      </Card>

      {/* Start tracking CTA */}
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex justify-center">
          <TrendingUp className="size-6 text-zinc-300" />
        </div>
        <p className="font-semibold text-zinc-900 dark:text-white mb-1">Start building your history</p>
        <p className="text-sm text-zinc-500 mb-4">
          Log food in Nutrition and workouts in Training — your progress chart fills in automatically.
        </p>
        <div className="flex gap-2 justify-center">
          <Link href="/nutrition">
            <Button size="sm" variant="secondary">Log food</Button>
          </Link>
          <Link href="/training/exercises">
            <Button size="sm" variant="secondary">Browse exercises</Button>
          </Link>
        </div>
      </div>

    </div>
  )
}
