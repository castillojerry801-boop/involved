'use client'

import { useState, useTransition } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { type Exercise, BODY_PARTS, getGifUrl } from '@/lib/exercises'
import { ExerciseDetailModal } from './exercise-detail-modal'
import { cn } from '@/lib/utils'

interface Props {
  initialExercises: Exercise[]
  onSearch: (query: string, bodyPart: string) => Promise<Exercise[]>
}

const BODY_PART_LABELS: Record<string, string> = {
  all: 'All',
  back: 'Back',
  cardio: 'Cardio',
  chest: 'Chest',
  'lower arms': 'Forearms',
  'lower legs': 'Calves',
  neck: 'Neck',
  shoulders: 'Shoulders',
  'upper arms': 'Arms',
  'upper legs': 'Legs',
  waist: 'Core',
}

export function ExerciseBrowser({ initialExercises, onSearch }: Props) {
  const [exercises, setExercises] = useState<Exercise[]>(initialExercises)
  const [query, setQuery] = useState('')
  const [bodyPart, setBodyPart] = useState('all')
  const [selected, setSelected] = useState<Exercise | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleFilter = (q: string, bp: string) => {
    setQuery(q)
    setBodyPart(bp)
    startTransition(async () => {
      const results = await onSearch(q, bp)
      setExercises(results)
    })
  }

  return (
    <div>
      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={e => handleFilter(e.target.value, bodyPart)}
          placeholder="Search exercises, muscles, equipment..."
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm pl-9 pr-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        {isPending && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400 animate-spin" />}
      </div>

      {/* Body part filter */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 scrollbar-hide">
        {BODY_PARTS.map(bp => (
          <button
            key={bp}
            onClick={() => handleFilter(query, bp)}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
              bodyPart === bp
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
            )}
          >
            {BODY_PART_LABELS[bp] ?? bp}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="text-xs text-zinc-400 mb-3">{exercises.length} exercises</p>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {exercises.map(exercise => (
          <button
            key={exercise.id}
            onClick={() => setSelected(exercise)}
            className="group flex flex-col rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm overflow-hidden text-left transition-shadow hover:shadow-md"
          >
            <div className="bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center p-3 h-32">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getGifUrl(exercise.id)}
                alt={exercise.name}
                className="h-full w-auto object-contain"
                loading="lazy"
              />
            </div>
            <div className="p-3">
              <p className="text-xs font-semibold text-zinc-900 dark:text-white capitalize line-clamp-2 leading-snug">
                {exercise.name}
              </p>
              <p className="text-xs text-zinc-400 capitalize mt-0.5">{exercise.bodyPart}</p>
            </div>
          </button>
        ))}
      </div>

      {exercises.length === 0 && (
        <p className="text-center text-sm text-zinc-400 py-12">No exercises found. Try a different search.</p>
      )}

      {selected && (
        <ExerciseDetailModal exercise={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
