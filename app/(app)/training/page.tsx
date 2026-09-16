import type { Metadata } from 'next'
import { Dumbbell, Plus, ChevronRight } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'Training' }

const DEMO_PROGRAMS = [
  {
    name: 'Spartan Sprint Prep',
    weeks: 8,
    sessionsPerWeek: 4,
    level: 'Intermediate',
    tags: ['Obstacle Racing', 'Conditioning'],
  },
  {
    name: 'Strength Foundation',
    weeks: 12,
    sessionsPerWeek: 3,
    level: 'Beginner',
    tags: ['Strength', 'Powerlifting'],
  },
  {
    name: 'Hybrid Athlete',
    weeks: 10,
    sessionsPerWeek: 5,
    level: 'Advanced',
    tags: ['Strength', 'Cardio', 'Running'],
  },
]

const DEMO_RECENT = [
  { name: 'Upper Body Strength', date: 'Sep 12', duration: '48 min', volume: '12,450 lbs' },
  { name: 'Zone 2 Run', date: 'Sep 10', duration: '35 min', distance: '4.2 mi' },
  { name: 'Lower Body Power', date: 'Sep 9', duration: '52 min', volume: '18,200 lbs' },
]

export default function TrainingPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Training</h1>
          <p className="text-sm text-zinc-500">Programs, workouts, and history</p>
        </div>
        <Button size="sm">
          <Plus className="size-4" />
          Log activity
        </Button>
      </div>

      {/* Recent workouts */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-zinc-900 dark:text-white">Recent workouts</h2>
          <button className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">View all</button>
        </div>
        <div className="flex flex-col gap-3">
          {DEMO_RECENT.map((workout) => (
            <Card key={workout.name} className="cursor-pointer transition-shadow hover:shadow-md">
              <div className="flex items-center gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
                  <Dumbbell className="size-5 text-zinc-500 dark:text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-zinc-900 dark:text-white truncate">{workout.name}</p>
                  <p className="text-sm text-zinc-500">
                    {workout.date} · {workout.duration}
                    {'distance' in workout ? ` · ${workout.distance}` : ` · ${workout.volume}`}
                  </p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-zinc-300 dark:text-zinc-600" />
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Programs */}
      <section className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-zinc-900 dark:text-white">Programs</h2>
          <button className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">View all</button>
        </div>
        <div className="flex flex-col gap-3">
          {DEMO_PROGRAMS.map((program) => (
            <Card key={program.name} className="cursor-pointer transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {program.tags.map((tag) => (
                      <Badge key={tag} variant="default">{tag}</Badge>
                    ))}
                  </div>
                  <h3 className="font-bold text-zinc-900 dark:text-white">{program.name}</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    {program.weeks} weeks · {program.sessionsPerWeek}x/week · {program.level}
                  </p>
                </div>
                <ChevronRight className="ml-4 size-5 shrink-0 text-zinc-300 dark:text-zinc-600" />
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Coming soon */}
      <div className="mt-8 rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 inline-flex size-12 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
          <Dumbbell className="size-6 text-zinc-500" />
        </div>
        <p className="font-semibold text-zinc-900 dark:text-white">Workout builder coming soon</p>
        <p className="mt-1 text-sm text-zinc-500">
          Create custom workouts, track sets and reps, and build training blocks.
        </p>
      </div>
    </div>
  )
}
