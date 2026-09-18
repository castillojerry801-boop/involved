import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Play, Pencil, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'
import { ProgramActions } from './program-actions'

export const metadata: Metadata = { title: 'Program' }

async function getProgram(id: string, userId: string) {
  try {
    return prisma.program.findFirst({
      where: { id, userId },
      include: {
        days: {
          orderBy: { sortOrder: 'asc' },
          include: {
            exercises: {
              orderBy: { sortOrder: 'asc' },
              include: {
                sets: { orderBy: { setNumber: 'asc' } },
              },
            },
          },
        },
      },
    })
  } catch {
    return null
  }
}

export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser()
  if (!user) redirect('/login')

  const { id } = await params
  const program = await getProgram(id, user.id)
  if (!program) redirect('/training/programs')

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Link href="/training/programs" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-black text-xl text-zinc-900 dark:text-white">{program.name}</h1>
              {program.isActive && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <Zap className="size-3" /> Active
                </span>
              )}
            </div>
            {program.description && (
              <p className="mt-0.5 text-sm text-zinc-400">{program.description}</p>
            )}
            <p className="text-xs text-zinc-400 mt-0.5">{program.days.length} day{program.days.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <ProgramActions programId={program.id} isActive={program.isActive} />
      </div>

      {/* Days */}
      <div className="space-y-4">
        {program.days.map(day => (
          <div key={day.id} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-50 dark:border-zinc-800">
              <div>
                <h2 className="font-bold text-sm text-zinc-900 dark:text-white">{day.name}</h2>
                <p className="text-xs text-zinc-400">{day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}</p>
              </div>
              <Link href={`/training/workout/new?programDayId=${day.id}`}>
                <Button size="sm" variant="secondary">
                  <Play className="size-3.5" />
                  Start
                </Button>
              </Link>
            </div>

            {day.exercises.length === 0 ? (
              <p className="px-4 py-4 text-sm text-zinc-400">No exercises in this day.</p>
            ) : (
              <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
                {day.exercises.map(ex => {
                  const meta = getExerciseById(ex.exerciseId)
                  const repRange = ex.sets[0]
                    ? ex.sets[0].targetRepsMin
                      ? ex.sets[0].targetRepsMax
                        ? `${ex.sets[0].targetRepsMin}–${ex.sets[0].targetRepsMax} reps`
                        : `${ex.sets[0].targetRepsMin} reps`
                      : null
                    : null

                  return (
                    <div key={ex.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="size-10 shrink-0 rounded-xl bg-zinc-50 dark:bg-zinc-800 overflow-hidden flex items-center justify-center">
                        {meta && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${process.env.NEXT_PUBLIC_EXERCISE_GIF_BASE_URL ?? ''}/${ex.exerciseId}.gif`}
                            alt={meta.name}
                            className="h-full w-auto object-contain"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                          {meta?.name ?? ex.exerciseId}
                        </p>
                        <p className="text-xs text-zinc-400">
                          {ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''}
                          {repRange ? ` · ${repRange}` : ''}
                          {meta && ` · ${meta.bodyPart}`}
                        </p>
                      </div>
                      {ex.sets.filter(s => s.setType === 'working').length > 0 && (
                        <span className="shrink-0 text-xs font-semibold text-zinc-400">
                          {ex.sets.filter(s => s.setType === 'working').length}×
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {program.days.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center">
          <p className="text-zinc-500 mb-4">This program has no days yet.</p>
          <Link href={`/training/programs/${program.id}/edit`}>
            <Button size="sm" variant="secondary">
              <Pencil className="size-3.5" />
              Edit program
            </Button>
          </Link>
        </div>
      )}

    </div>
  )
}
