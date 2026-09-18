'use client'

import { X, Heart, Info } from 'lucide-react'
import { type Exercise, getGifUrl } from '@/lib/exercises'
import { type PreferenceState } from './exercise-browser'
import { cn } from '@/lib/utils'

interface Props {
  exercise: Exercise
  preference?: PreferenceState
  onToggleFav?: (exerciseId: string, next: PreferenceState) => void
  onClose: () => void
}

export function ExerciseDetailModal({ exercise, preference = 'normal', onToggleFav, onClose }: Props) {
  const isFav = preference === 'favorite'

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
          {onToggleFav && (
            <button
              onClick={() => onToggleFav(exercise.id, isFav ? 'normal' : 'favorite')}
              className={cn(
                'absolute top-3 left-3 flex size-8 items-center justify-center rounded-full transition-colors',
                isFav
                  ? 'bg-red-500 text-white'
                  : 'bg-black/40 text-white hover:bg-red-500/80'
              )}
              aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart className={cn('size-4', isFav && 'fill-current')} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h2 className="text-xl font-black text-zinc-900 dark:text-white capitalize leading-tight">
              {exercise.name}
            </h2>
            {preference !== 'normal' && preference !== 'favorite' && (
              <span className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                preference === 'more_often' && 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
                preference === 'less_often' && 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800',
                preference === 'dont_recommend' && 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
              )}>
                {preference === 'more_often' ? 'More Often' : preference === 'less_often' ? 'Less Often' : "Don't Recommend"}
              </span>
            )}
          </div>

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

          {/* Preference picker */}
          {onToggleFav && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Preference</p>
                <span title="'Don't Recommend' keeps the exercise searchable and selectable, but signals future smart features to avoid automatically suggesting it.">
                  <Info className="size-3 text-zinc-300 dark:text-zinc-600" />
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {([
                  ['favorite', '♥ Favorite'],
                  ['more_often', 'More Often'],
                  ['normal', 'Normal'],
                  ['less_often', 'Less Often'],
                  ['dont_recommend', "Don't Recommend"],
                ] as [PreferenceState, string][]).map(([state, label]) => (
                  <button
                    key={state}
                    onClick={() => onToggleFav(exercise.id, state)}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                      preference === state
                        ? state === 'dont_recommend'
                          ? 'bg-red-500 text-white'
                          : state === 'favorite'
                            ? 'bg-red-500 text-white'
                            : 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                        : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {preference === 'dont_recommend' && (
                <p className="text-[11px] text-zinc-400 mt-2">
                  Still searchable and selectable — not automatically suggested by smart features.
                </p>
              )}
            </div>
          )}

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
