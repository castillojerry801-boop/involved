import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Clock, Dumbbell } from 'lucide-react'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = { title: 'Workout History' }

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

async function getHistory(userId: string) {
  try {
    return prisma.workout.findMany({
      where: { userId, status: { in: ['completed', 'in_progress'] } },
      orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }],
      take: 50,
      include: {
        exercises: {
          select: { exerciseId: true },
          orderBy: { order: 'asc' },
        },
        _count: { select: { exercises: true } },
      },
    })
  } catch {
    return []
  }
}

export default async function HistoryPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const workouts = await getHistory(user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/training"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div>
          <h1 className="font-black text-xl text-zinc-900 dark:text-white">Workout History</h1>
          {workouts.length > 0 && (
            <p className="text-sm text-zinc-400">{workouts.length} session{workouts.length !== 1 ? 's' : ''}</p>
          )}
        </div>
      </div>

      {workouts.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Dumbbell className="size-10 text-zinc-200 dark:text-zinc-700 mb-3" />
          <p className="text-sm font-medium text-zinc-500">No completed workouts yet</p>
          <p className="text-xs text-zinc-400 mt-1">Start a workout to build your history</p>
          <Link
            href="/training/log"
            className="mt-4 rounded-xl bg-zinc-900 dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
          >
            Start a workout
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {workouts.map(w => {
            const date = w.completedAt ?? w.startedAt
            const isActive = w.status === 'in_progress'

            return (
              <Link
                key={w.id}
                href={isActive ? `/training/workout/${w.id}` : `/training/history/${w.id}`}
                className="flex items-center gap-4 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors"
              >
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${isActive ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-zinc-50 dark:bg-zinc-800'}`}>
                  {isActive
                    ? <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                    : <CheckCircle2 className="size-5 text-zinc-400 dark:text-zinc-500" />
                  }
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{w.title}</p>
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-400">
                    {date && <span>{formatDate(date)}</span>}
                    <span>·</span>
                    <span>{w._count.exercises} exercise{w._count.exercises !== 1 ? 's' : ''}</span>
                    {w.durationSeconds && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="size-3" />
                          {formatDuration(w.durationSeconds)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <ArrowLeft className="size-4 text-zinc-300 shrink-0 rotate-180" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
