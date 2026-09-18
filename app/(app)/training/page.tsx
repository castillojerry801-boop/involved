import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Dumbbell, Plus, ChevronRight, BookOpen, ClipboardList, Calendar, PlayCircle, CheckCircle2, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { searchExercises, getGifUrl } from '@/lib/exercises'

export const metadata: Metadata = { title: 'Training' }

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function WorkoutStatusBadge({ status }: { status: string }) {
  if (status === 'in_progress') return (
    <span className="flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
      Active
    </span>
  )
  if (status === 'planned') return (
    <span className="rounded-full bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400">
      Planned
    </span>
  )
  return null
}

async function getWorkouts(userId: string) {
  try {
    const [recent, planned] = await Promise.all([
      prisma.workout.findMany({
        where: { userId, status: { in: ['completed', 'in_progress'] } },
        orderBy: { completedAt: 'desc' },
        take: 5,
        include: {
          exercises: { select: { exerciseId: true }, take: 3 },
        },
      }),
      prisma.workout.findMany({
        where: { userId, status: 'planned' },
        orderBy: { scheduledDate: 'asc' },
        take: 3,
        include: {
          exercises: { select: { exerciseId: true }, take: 3 },
        },
      }),
    ])
    return { recent, planned }
  } catch {
    return { recent: [], planned: [] }
  }
}

export default async function TrainingPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const featured = searchExercises('', 'all', 6)
  const { recent, planned } = await getWorkouts(user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Training</h1>
          <p className="text-sm text-zinc-500">Exercises, workouts & progress</p>
        </div>
        <div className="flex gap-2">
          <Link href="/training/log?mode=plan">
            <Button size="sm" variant="secondary">
              <Calendar className="size-4" />
              Plan
            </Button>
          </Link>
          <Link href="/training/log">
            <Button size="sm">
              <Plus className="size-4" />
              Log workout
            </Button>
          </Link>
        </div>
      </div>

      {/* Planned workouts */}
      {planned.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-zinc-900 dark:text-white">Planned</h2>
          </div>
          <div className="flex flex-col gap-2">
            {planned.map(w => {
              const date = w.scheduledDate
                ? new Date(w.scheduledDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : null
              return (
                <Link key={w.id} href={`/training/workout/${w.id}`}>
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-900/30">
                      <Calendar className="size-4 text-sky-600 dark:text-sky-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{w.title}</p>
                      <p className="text-xs text-zinc-400">{w.exercises.length} exercise{w.exercises.length !== 1 ? 's' : ''}{date ? ` · ${date}` : ''}</p>
                    </div>
                    <PlayCircle className="size-5 text-zinc-300 dark:text-zinc-600" />
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

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

      {/* Recent workouts */}
      <section className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-zinc-900 dark:text-white">Recent workouts</h2>
        </div>

        {recent.length === 0 ? (
          <Card className="flex flex-col items-center py-10 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <Dumbbell className="size-6 text-zinc-400" />
            </div>
            <p className="font-semibold text-zinc-900 dark:text-white mb-1">No workouts logged yet</p>
            <p className="text-sm text-zinc-400 max-w-xs mb-4">
              Tap &quot;Log workout&quot; to record your first session.
            </p>
            <Link href="/training/log">
              <Button size="sm">
                <Plus className="size-4" />
                Log first workout
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {recent.map(w => {
              const isActive = w.status === 'in_progress'
              const date = (w.completedAt ?? w.startedAt ?? w.scheduledDate)
                ? new Date((w.completedAt ?? w.startedAt ?? w.scheduledDate)!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : null

              return (
                <Link key={w.id} href={`/training/workout/${w.id}`}>
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                    <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${isActive ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-zinc-50 dark:bg-zinc-800'}`}>
                      {isActive
                        ? <PlayCircle className="size-5 text-emerald-600 dark:text-emerald-400" />
                        : <CheckCircle2 className="size-5 text-zinc-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{w.title}</p>
                        <WorkoutStatusBadge status={w.status} />
                      </div>
                      <p className="text-xs text-zinc-400">
                        {w.exercises.length} exercise{w.exercises.length !== 1 ? 's' : ''}
                        {w.durationSeconds ? ` · ${formatDuration(w.durationSeconds)}` : ''}
                        {date ? ` · ${date}` : ''}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-zinc-300 dark:text-zinc-600 shrink-0" />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Programs — future */}
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
            Custom training programs are coming soon.
          </p>
        </Card>
      </section>
    </div>
  )
}
