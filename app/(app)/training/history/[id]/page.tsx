import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Clock, Dumbbell } from 'lucide-react'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById, getGifUrl } from '@/lib/exercises'

export const metadata: Metadata = { title: 'Workout' }

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function formatWeight(kg: number | null) {
  if (!kg) return null
  return `${kg}kg`
}

async function getWorkout(id: string, userId: string) {
  try {
    return prisma.workout.findFirst({
      where: { id, userId },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
          include: {
            sets: {
              where: { completed: true },
              orderBy: { setNumber: 'asc' },
            },
          },
        },
      },
    })
  } catch {
    return null
  }
}

export default async function WorkoutHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser()
  if (!user) redirect('/login')

  const { id } = await params
  const workout = await getWorkout(id, user.id)
  if (!workout) redirect('/training')

  const totalSets = workout.exercises.reduce((n, ex) => n + ex.sets.length, 0)
  const date = workout.completedAt
    ? new Date(workout.completedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : workout.startedAt
      ? new Date(workout.startedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : null

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {/* Header */}
      <div className="mb-6 flex items-start gap-3">
        <Link href="/training" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div>
          <h1 className="font-black text-xl text-zinc-900 dark:text-white">{workout.title}</h1>
          {date && <p className="text-sm text-zinc-400 mt-0.5">{date}</p>}
        </div>
      </div>

      {/* Stats strip */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          {
            icon: <CheckCircle2 className="size-4 text-emerald-500" />,
            value: `${totalSets}`,
            label: 'Sets',
          },
          {
            icon: <Dumbbell className="size-4 text-zinc-400" />,
            value: `${workout.exercises.length}`,
            label: 'Exercises',
          },
          {
            icon: <Clock className="size-4 text-zinc-400" />,
            value: workout.durationSeconds ? formatDuration(workout.durationSeconds) : '—',
            label: 'Duration',
          },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-center">
            <div className="flex justify-center mb-1">{stat.icon}</div>
            <p className="font-black text-xl text-zinc-900 dark:text-white">{stat.value}</p>
            <p className="text-xs text-zinc-400">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Exercises */}
      <div className="space-y-4">
        {workout.exercises.map(ex => {
          const meta = getExerciseById(ex.exerciseId)
          const completedSets = ex.sets

          return (
            <div key={ex.id} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-50 dark:border-zinc-800">
                <div className="size-10 shrink-0 rounded-xl bg-zinc-50 dark:bg-zinc-800 overflow-hidden flex items-center justify-center">
                  {meta && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={getGifUrl(ex.exerciseId)} alt={meta.name} className="h-full w-auto object-contain" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-zinc-900 dark:text-white truncate">
                    {meta?.name ?? ex.exerciseId}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {completedSets.length} set{completedSets.length !== 1 ? 's' : ''}
                    {meta && ` · ${meta.bodyPart}`}
                  </p>
                </div>
              </div>

              {completedSets.length > 0 && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 text-[10px] text-zinc-400 text-center">SET</span>
                    <span className="w-14 text-[10px] text-zinc-400 text-center">KG</span>
                    <span className="w-14 text-[10px] text-zinc-400 text-center">REPS</span>
                    {completedSets.some(s => s.rpe != null) && (
                      <span className="w-14 text-[10px] text-zinc-400 text-center">RPE</span>
                    )}
                  </div>
                  {completedSets.map(s => (
                    <div key={s.id} className="flex items-center gap-2 py-1.5 border-b border-zinc-50 dark:border-zinc-800 last:border-0">
                      <span className="w-6 text-xs text-zinc-400 text-center">{s.setNumber}</span>
                      <span className="w-14 text-xs font-medium text-zinc-700 dark:text-zinc-300 text-center">
                        {formatWeight(s.actualWeightKg ? Number(s.actualWeightKg) : null) ?? '—'}
                      </span>
                      <span className="w-14 text-xs font-medium text-zinc-700 dark:text-zinc-300 text-center">
                        {s.actualReps ?? (s.actualDurationSeconds ? `${s.actualDurationSeconds}s` : '—')}
                      </span>
                      {completedSets.some(ss => ss.rpe != null) && (
                        <span className="w-14 text-xs text-zinc-400 text-center">
                          {s.rpe ?? '—'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {workout.notes && (
        <div className="mt-6 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4">
          <p className="text-xs font-semibold text-zinc-400 mb-1">Notes</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{workout.notes}</p>
        </div>
      )}
    </div>
  )
}
