import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Pencil, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'
import { getInvolvedDisplayName } from '@/lib/exercises/canonical'
import type { PersistedWeekProgression, PersistedPhase } from '@/lib/training/prescription'
import { ProgramActions } from './program-actions'
import { MultiWeekProgramView, type MultiWeekProgramData } from './multi-week-view'

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

  // Build the client payload: resolve display names + metadata server-side (keeps
  // the large exercise library off the client bundle); the shared resolver runs
  // client-side for week selection.
  const viewData: MultiWeekProgramData = {
    durationWeeks: (program as unknown as { durationWeeks: number | null }).durationWeeks ?? null,
    phases: ((program as unknown as { phases: PersistedPhase[] | null }).phases) ?? null,
    gifBase: process.env.NEXT_PUBLIC_EXERCISE_GIF_BASE_URL ?? '',
    days: program.days.map(day => ({
      id: day.id,
      name: day.name,
      weekday: (day as unknown as { weekday: number | null }).weekday ?? null,
      exercises: day.exercises.map(ex => {
        const meta = getExerciseById(ex.exerciseId)
        const e = ex as unknown as {
          startingLoad: number | null
          weekProgressions: PersistedWeekProgression[] | null
        }
        return {
          id: ex.id,
          exerciseId: ex.exerciseId,
          displayName: getInvolvedDisplayName(ex.exerciseId, meta?.name ?? ex.exerciseId),
          bodyPart: meta?.bodyPart ?? null,
          restSeconds: ex.restSeconds ?? null,
          startingLoad: e.startingLoad ?? null,
          weekProgressions: e.weekProgressions ?? null,
          sets: ex.sets.map(s => ({
            targetRepsMin: s.targetRepsMin ?? null,
            targetRepsMax: s.targetRepsMax ?? null,
            targetRir: (s as unknown as { targetRir: number | null }).targetRir ?? null,
            targetWeightKg: s.targetWeightKg != null ? Number(s.targetWeightKg) : null,
            targetDurationSeconds: s.targetDurationSeconds ?? null,
            targetDistanceM: s.targetDistanceM != null ? Number(s.targetDistanceM) : null,
            restSeconds: s.restSeconds ?? null,
          })),
        }
      }),
    })),
  }

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

      {/* Days — multi-week aware (week selector + resolved prescription per week) */}
      {program.days.length > 0 && <MultiWeekProgramView data={viewData} />}

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
