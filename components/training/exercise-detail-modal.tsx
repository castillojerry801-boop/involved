'use client'

import { X, Dumbbell } from 'lucide-react'
import { type Exercise, getGifUrl } from '@/lib/exercises'

interface Props {
  exercise: Exercise
  onClose: () => void
}

export function ExerciseDetailModal({ exercise, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* GIF header */}
        <div className="relative bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center" style={{ minHeight: 220 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getGifUrl(exercise.id)}
            alt={exercise.name}
            className="h-52 w-auto object-contain"
          />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          <h2 className="text-xl font-black text-zinc-900 dark:text-white capitalize mb-1">{exercise.name}</h2>

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 capitalize">
              {exercise.bodyPart}
            </span>
            <span className="rounded-full bg-sky-100 dark:bg-sky-900/40 px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-400 capitalize">
              {exercise.target}
            </span>
            <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400 capitalize">
              {exercise.equipment}
            </span>
          </div>

          {/* Secondary muscles */}
          {exercise.secondaryMuscles.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Secondary muscles</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 capitalize">
                {exercise.secondaryMuscles.join(', ')}
              </p>
            </div>
          )}

          {/* Instructions */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">Instructions</p>
            <ol className="flex flex-col gap-3">
              {exercise.instructions.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-black">
                    {i + 1}
                  </span>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed pt-0.5">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
