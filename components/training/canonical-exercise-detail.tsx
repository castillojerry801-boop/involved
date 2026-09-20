'use client'

import { ArrowLeft, AlertTriangle, ImageIcon, Link2, Clock, Lightbulb } from 'lucide-react'
import { type Exercise, getExerciseById, getGifUrl } from '@/lib/exercises'
import {
  type CanonicalExercise,
  type CanonicalImplementation,
  getCanonicalFamily,
} from '@/lib/exercises/canonical'
import { cn } from '@/lib/utils'

interface Props {
  exercise: CanonicalExercise
  onBack: () => void
  onSelectImpl?: (exercise: Exercise) => void
}

const DIFFICULTY_STYLES: Record<string, string> = {
  beginner:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  advanced:     'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
}

function MuscleTag({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 capitalize">
      {label}
    </span>
  )
}

function OriginalVisualPlaceholder({ name, imagePath }: { name: string; imagePath?: string }) {
  if (imagePath) {
    return (
      <div className="rounded-2xl overflow-hidden mb-4 bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imagePath}
          alt={name}
          className="w-full object-cover"
        />
      </div>
    )
  }
  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 h-52 flex flex-col items-center justify-center gap-3 mb-4">
      <ImageIcon className="size-8 text-zinc-700" />
      <div className="text-center px-4">
        <p className="text-sm font-semibold text-zinc-400">{name}</p>
        <p className="text-xs text-zinc-600 mt-0.5">Visual coming soon</p>
      </div>
    </div>
  )
}

function ImplementationCard({ impl, onSelect }: {
  impl: CanonicalImplementation
  onSelect?: (exercise: Exercise) => void
}) {
  const exerciseId = impl.source?.exerciseId
  const linkedExercise = exerciseId ? getExerciseById(exerciseId) : null

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="bg-zinc-50 dark:bg-zinc-800 h-40 flex items-center justify-center">
        {exerciseId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getGifUrl(exerciseId)}
            alt={impl.displayLabel}
            className="h-full w-auto object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-300 dark:text-zinc-600">
            <AlertTriangle className="size-5" />
            <span className="text-[11px]">No GIF</span>
          </div>
        )}
      </div>

      <div className="p-3">
        <p className="text-sm font-semibold text-zinc-900 dark:text-white leading-snug">
          {impl.displayLabel}
        </p>
        <span className="inline-block mt-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 capitalize">
          {impl.equipment}
        </span>
        {impl.notes && (
          <p className="mt-1.5 text-[11px] text-zinc-400 italic">{impl.notes}</p>
        )}

        {onSelect && (
          <button
            onClick={() => linkedExercise && onSelect(linkedExercise)}
            disabled={!linkedExercise}
            className={cn(
              'mt-3 w-full rounded-xl py-2 text-xs font-semibold transition-colors',
              linkedExercise
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100'
                : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 cursor-not-allowed'
            )}
          >
            {linkedExercise ? 'Select' : 'Not in library'}
          </button>
        )}
      </div>
    </div>
  )
}

export function CanonicalExerciseDetail({ exercise, onBack, onSelectImpl }: Props) {
  const family = getCanonicalFamily(exercise.movementFamilyId)
  const { muscleCard, description, coachingCues, commonMistakes, implementations, browseTags, sourceGap } = exercise

  const isOriginalCard = implementations.length === 0 && !!description.steps?.length

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white mb-4 -ml-1 transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>

      {/* Header chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        {family && (
          <span className="rounded-full bg-emerald-600 text-white px-3 py-1 text-xs font-semibold">
            {family.displayName}
          </span>
        )}
        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold capitalize', DIFFICULTY_STYLES[exercise.difficulty] ?? DIFFICULTY_STYLES.beginner)}>
          {exercise.difficulty}
        </span>
      </div>

      {/* Title + summary */}
      <h2 className="text-2xl font-black text-zinc-900 dark:text-white mb-1.5">{exercise.name}</h2>
      {description.summary && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{description.summary}</p>
      )}

      {/* Browse tags */}
      {browseTags && browseTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {browseTags.map(tag => (
            <span key={tag} className="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 capitalize">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ── ORIGINAL CARD LAYOUT ─────────────────────────────────────────── */}
      {isOriginalCard && (
        <>
          {/* Visual placeholder — shows reference image if available, text card otherwise */}
          <OriginalVisualPlaceholder name={exercise.name} imagePath={exercise.originalVisualPath} />

          {/* Muscles */}
          {(muscleCard.primary.length > 0 || muscleCard.secondary.length > 0) && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-3">Muscles Targeted</p>
              <div className="space-y-2.5">
                {muscleCard.primary.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Primary</p>
                    <div className="flex flex-wrap gap-1.5">
                      {muscleCard.primary.map(m => <MuscleTag key={m} label={m} />)}
                    </div>
                  </div>
                )}
                {muscleCard.secondary.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Secondary</p>
                    <div className="flex flex-wrap gap-1.5">
                      {muscleCard.secondary.map(m => <MuscleTag key={m} label={m} />)}
                    </div>
                  </div>
                )}
                {muscleCard.stabilizers.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Stabilizers</p>
                    <div className="flex flex-wrap gap-1.5">
                      {muscleCard.stabilizers.map(m => <MuscleTag key={m} label={m} />)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Feel It In + Hold/Reps row */}
          {(description.feelItIn?.length || description.hold || description.reps) && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {description.feelItIn && description.feelItIn.length > 0 && (
                <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Link2 className="size-3.5 text-zinc-400" />
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Feel It In</p>
                  </div>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 capitalize">
                    {description.feelItIn.join(', ')}
                  </p>
                </div>
              )}
              {(description.hold || description.reps) && (
                <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Clock className="size-3.5 text-zinc-400" />
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Hold / Reps</p>
                  </div>
                  {description.hold && <p className="text-sm text-zinc-700 dark:text-zinc-300">{description.hold}</p>}
                  {description.reps && <p className="text-sm text-zinc-700 dark:text-zinc-300">{description.reps}</p>}
                </div>
              )}
            </div>
          )}

          {/* How to get into it — numbered steps */}
          {description.steps && description.steps.length > 0 && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-3">
                How to Get Into It
              </p>
              <ol className="flex flex-col gap-3">
                {description.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white text-[11px] font-black">
                      {i + 1}
                    </span>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed pt-0.5">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Why Use It */}
          {description.whyUseIt && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Lightbulb className="size-3.5 text-zinc-400" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Why Use It</p>
              </div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{description.whyUseIt}</p>
            </div>
          )}

          {/* Coaching cues — green tint */}
          {coachingCues.length > 0 && (
            <div className="rounded-2xl border border-emerald-800/40 bg-emerald-950/30 p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-500 mb-3">Key Cues</p>
              <ul className="flex flex-col gap-2">
                {coachingCues.map((cue, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-zinc-300">
                    <span className="text-emerald-500 shrink-0 mt-0.5">•</span>
                    {cue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Common mistakes — red tint */}
          {commonMistakes.length > 0 && (
            <div className="rounded-2xl border border-red-800/40 bg-red-950/30 p-4 mb-6">
              <p className="text-[11px] font-bold uppercase tracking-wider text-red-400 mb-3">Common Mistakes</p>
              <ul className="flex flex-col gap-2">
                {commonMistakes.map((m, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-zinc-300">
                    <span className="text-red-400 shrink-0 mt-0.5">•</span>
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ── EXERCISEDB-BACKED LAYOUT ─────────────────────────────────────── */}
      {!isOriginalCard && (
        <>
          {/* About this movement */}
          {(description.whatItTrains || description.whyUseIt) && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-3">About this movement</p>
              <div className="space-y-3">
                {description.whatItTrains && (
                  <div>
                    <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">What it trains</p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">{description.whatItTrains}</p>
                  </div>
                )}
                {description.whyUseIt && (
                  <div>
                    <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">Why use it</p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">{description.whyUseIt}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Muscles */}
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-3">Muscles</p>
            <div className="space-y-2.5">
              {muscleCard.primary.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Primary</p>
                  <div className="flex flex-wrap gap-1.5">
                    {muscleCard.primary.map(m => <MuscleTag key={m} label={m} />)}
                  </div>
                </div>
              )}
              {muscleCard.secondary.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Secondary</p>
                  <div className="flex flex-wrap gap-1.5">
                    {muscleCard.secondary.map(m => <MuscleTag key={m} label={m} />)}
                  </div>
                </div>
              )}
              {muscleCard.stabilizers.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Stabilizers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {muscleCard.stabilizers.map(m => <MuscleTag key={m} label={m} />)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Coaching cues */}
          {coachingCues.length > 0 && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-3">Coaching cues</p>
              <ol className="flex flex-col gap-2.5">
                {coachingCues.map((cue, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[11px] font-black">
                      {i + 1}
                    </span>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed pt-0.5">{cue}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Common mistakes */}
          {commonMistakes.length > 0 && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-3">Common mistakes</p>
              <ul className="flex flex-col gap-2">
                {commonMistakes.map((m, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                    <span className="text-zinc-300 dark:text-zinc-600 shrink-0 mt-0.5">•</span>
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Implementations */}
          <div className="mb-6">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-3">
              {onSelectImpl ? 'Choose an implementation' : 'Implementations'}
            </p>
            {implementations.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {implementations.map(impl => (
                  <ImplementationCard
                    key={impl.implementationId}
                    impl={impl}
                    onSelect={onSelectImpl}
                  />
                ))}
              </div>
            ) : sourceGap ? (
              <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-1">Implementation coming soon</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500">{sourceGap.reason}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">No implementations mapped yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
