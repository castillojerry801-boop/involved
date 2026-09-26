'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  resolveExercisePrescriptionForWeek,
  phaseForWeek,
  type PersistedWeekProgression,
  type PersistedPhase,
  type ResolvedPrescription,
} from '@/lib/training/prescription'

export interface ViewSet {
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetRir: number | null
  targetWeightKg: number | null
  targetDurationSeconds: number | null
  targetDistanceM: number | null
  restSeconds: number | null
}
export interface ViewExercise {
  id: string
  exerciseId: string
  displayName: string
  bodyPart: string | null
  restSeconds: number | null
  startingLoad: number | null
  weekProgressions: PersistedWeekProgression[] | null
  sets: ViewSet[]
}
export interface ViewDay {
  id: string
  name: string
  weekday: number | null
  exercises: ViewExercise[]
}
export interface MultiWeekProgramData {
  durationWeeks: number | null
  phases: PersistedPhase[] | null
  days: ViewDay[]
  gifBase: string
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function formatPrescription(r: ResolvedPrescription): string {
  // Cardio/endurance
  if (r.durationSeconds != null) {
    const mins = Math.round(r.durationSeconds / 60)
    const dist = r.distanceM != null ? ` · ${(r.distanceM / 1000).toFixed(2)} km` : ''
    const rpe = r.targetRpe != null ? ` · RPE ${r.targetRpe}` : ''
    return `${mins} min${dist}${rpe}`
  }
  // Strength
  const reps =
    r.repsMin != null && r.repsMax != null
      ? r.repsMin === r.repsMax ? `${r.repsMin}` : `${r.repsMin}–${r.repsMax}`
      : r.repsMin != null ? `${r.repsMin}` : '—'
  const parts = [`${r.sets} × ${reps}`]
  if (r.targetRir != null) parts.push(`RIR ${r.targetRir}`)
  if (r.load != null) parts.push(`${r.load} kg`)
  return parts.join(' · ')
}

export function MultiWeekProgramView({ data }: { data: MultiWeekProgramData }) {
  const router = useRouter()
  const totalWeeks = Math.max(1, data.durationWeeks ?? 1)
  const isMultiWeek = totalWeeks > 1
  const [week, setWeek] = useState(1)

  const phase = useMemo(() => phaseForWeek(data.phases, week), [data.phases, week])

  // Resolve every exercise for the selected week, and detect deload/taper for the week.
  const resolvedDays = useMemo(
    () =>
      data.days.map(day => ({
        ...day,
        exercises: day.exercises.map(ex => ({
          ex,
          resolved: resolveExercisePrescriptionForWeek(
            {
              restSeconds: ex.restSeconds,
              startingLoad: ex.startingLoad,
              weekProgressions: ex.weekProgressions,
              sets: ex.sets,
            },
            week,
          ),
        })),
      })),
    [data.days, week],
  )

  const weekIsDeload = resolvedDays.some(d => d.exercises.some(e => e.resolved.deload))
  const weekIsTaper = resolvedDays.some(d => d.exercises.some(e => e.resolved.taper))
  const weekBadge = weekIsTaper ? 'Taper' : weekIsDeload ? 'Deload' : phase?.name ?? null

  return (
    <div className="space-y-4">
      {isMultiWeek && (
        <div className="sticky top-0 z-10 -mx-4 bg-white/90 px-4 py-2 backdrop-blur dark:bg-zinc-950/90">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-zinc-900 dark:text-white">
              Week {week}
              <span className="ml-1 text-xs font-normal text-zinc-400">of {totalWeeks}</span>
            </p>
            {weekBadge && (
              <span
                className={
                  'rounded-full px-2 py-0.5 text-xs font-semibold ' +
                  (weekIsTaper
                    ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                    : weekIsDeload
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300')
                }
              >
                {weekBadge}
              </span>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(w => (
              <button
                key={w}
                onClick={() => setWeek(w)}
                className={
                  'size-8 shrink-0 rounded-lg text-xs font-semibold transition-colors ' +
                  (w === week
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400')
                }
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      )}

      {resolvedDays.map(day => (
        <div key={day.id} className="overflow-hidden rounded-2xl border border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-50 px-4 py-3 dark:border-zinc-800">
            <div>
              {day.weekday != null && (
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{WEEKDAYS[day.weekday]}</p>
              )}
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white">{day.name}</h2>
              <p className="text-xs text-zinc-400">
                {day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => router.push(`/training/workout/new?programDayId=${day.id}${isMultiWeek ? `&week=${week}` : ''}`)}
            >
              <Play className="size-3.5" />
              Start{isMultiWeek ? ` Week ${week}` : ''}
            </Button>
          </div>

          {day.exercises.length === 0 ? (
            <p className="px-4 py-4 text-sm text-zinc-400">No exercises in this day.</p>
          ) : (
            <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
              {day.exercises.map(({ ex, resolved }) => (
                <div key={ex.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-50 dark:bg-zinc-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${data.gifBase}/${ex.exerciseId}.gif`} alt={ex.displayName} className="h-full w-auto object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">{ex.displayName}</p>
                    <p className="text-xs text-zinc-400">
                      {formatPrescription(resolved)}
                      {ex.bodyPart ? ` · ${ex.bodyPart}` : ''}
                    </p>
                  </div>
                  {(resolved.deload || resolved.taper) && (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      {resolved.taper ? 'taper' : 'deload'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
