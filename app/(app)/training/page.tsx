import type { Metadata } from 'next'
import Link from 'next/link'
import { Dumbbell, Plus, ChevronRight, BookOpen, ClipboardList } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { searchExercises, getGifUrl } from '@/lib/exercises'

export const metadata: Metadata = { title: 'Training' }

export default function TrainingPage() {
  const featured = searchExercises('', 'all', 6)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Training</h1>
          <p className="text-sm text-zinc-500">Exercises, workouts & progress</p>
        </div>
        <Button size="sm" disabled>
          <Plus className="size-4" />
          Log workout
        </Button>
      </div>

      {/* Exercise Library */}
      <Link href="/training/exercises">
        <div className="mb-6 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-zinc-900 dark:bg-white">
                <BookOpen className="size-5 text-white dark:text-zinc-900" />
              </div>
              <div>
                <p className="font-bold text-zinc-900 dark:text-white">Exercise Library</p>
                <p className="text-xs text-zinc-400">1,394 exercises with animated guides</p>
              </div>
            </div>
            <ChevronRight className="size-5 text-zinc-300 dark:text-zinc-600" />
          </div>
          <div className="flex gap-2">
            {featured.map(ex => (
              <div key={ex.id} className="flex-1 rounded-xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center overflow-hidden h-16">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={getGifUrl(ex.id)} alt={ex.name} className="h-full w-auto object-contain" />
              </div>
            ))}
          </div>
        </div>
      </Link>

      {/* Recent workouts — empty state */}
      <section className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-zinc-900 dark:text-white">Recent workouts</h2>
        </div>
        <Card className="flex flex-col items-center py-10 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <Dumbbell className="size-6 text-zinc-400" />
          </div>
          <p className="font-semibold text-zinc-900 dark:text-white mb-1">No workouts logged yet</p>
          <p className="text-sm text-zinc-400 max-w-xs">
            Workout logging is coming soon. Browse the exercise library to find movements for your routine.
          </p>
        </Card>
      </section>

      {/* Programs — empty state */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-zinc-900 dark:text-white">Programs</h2>
        </div>
        <Card className="flex flex-col items-center py-10 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <ClipboardList className="size-6 text-zinc-400" />
          </div>
          <p className="font-semibold text-zinc-900 dark:text-white mb-1">No programs yet</p>
          <p className="text-sm text-zinc-400 max-w-xs">
            Custom training programs are coming soon. You&apos;ll be able to build your own or follow a template.
          </p>
        </Card>
      </section>
    </div>
  )
}
