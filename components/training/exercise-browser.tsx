'use client'

import { useState, useTransition, useCallback, useOptimistic } from 'react'
import { Search, Loader2, Heart, SlidersHorizontal, X, Filter, ArrowLeft } from 'lucide-react'
import { type Exercise, type EquipmentOption, BODY_PARTS, getGifUrl } from '@/lib/exercises'
import { type CanonicalFamily, type CanonicalExercise, movementFamilies, getExercisesForFamily, getInvolvedDisplayName } from '@/lib/exercises/canonical'
import { ExerciseDetailModal } from './exercise-detail-modal'
import { CanonicalExerciseDetail } from './canonical-exercise-detail'
import { cn } from '@/lib/utils'

export type PreferenceState = 'favorite' | 'more_often' | 'normal' | 'less_often' | 'dont_recommend'

export interface BrowserFilterState {
  q: string
  bodyPart: string
  equipment: string | null
  target: string | null
  favoritesOnly: boolean
}

interface Props {
  initialExercises: Exercise[]
  equipmentOptions: EquipmentOption[]
  targetOptions: string[]
  initialPreferences?: Record<string, PreferenceState>
  activeEquipmentProfile?: { name: string; equipment: string[] } | null
  onSearch: (filters: BrowserFilterState) => Promise<Exercise[]>
  // If provided, renders a "select" button instead of opening detail modal
  onSelect?: (exercise: Exercise) => void
  showFavoriteToggle?: boolean
  compact?: boolean  // condensed layout for modal/picker use
}

const BODY_PART_LABELS: Record<string, string> = {
  all: 'All', back: 'Back', cardio: 'Cardio', chest: 'Chest',
  'lower arms': 'Forearms', 'lower legs': 'Calves', neck: 'Neck',
  shoulders: 'Shoulders', 'upper arms': 'Arms', 'upper legs': 'Legs', waist: 'Core',
}

// Equipment values with > 5 exercises get individual pills; the rest go under "Other"
const MIN_EQUIPMENT_COUNT = 5

function HeartButton({ exerciseId, state, onToggle }: {
  exerciseId: string
  state: PreferenceState
  onToggle: (id: string, next: PreferenceState) => void
}) {
  const isFav = state === 'favorite'
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(exerciseId, isFav ? 'normal' : 'favorite') }}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
        isFav
          ? 'text-red-500'
          : 'text-zinc-300 dark:text-zinc-600 hover:text-red-400'
      )}
      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Heart className={cn('size-4', isFav && 'fill-current')} />
    </button>
  )
}

function ExerciseCard({ exercise, preference, onToggleFav, onClick, compact }: {
  exercise: Exercise
  preference: PreferenceState
  onToggleFav: (id: string, next: PreferenceState) => void
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm overflow-hidden text-left transition-shadow hover:shadow-md"
    >
      <div className={cn(
        'bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center w-full',
        compact ? 'h-24' : 'h-32'
      )}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getGifUrl(exercise.id)}
          alt={exercise.name}
          className="h-full w-auto object-contain"
          loading="lazy"
        />
      </div>
      <div className="p-2.5">
        <p className="text-xs font-semibold text-zinc-900 dark:text-white line-clamp-2 leading-snug">
          {getInvolvedDisplayName(exercise.id, exercise.name)}
        </p>
        <p className="text-[11px] text-zinc-400 capitalize mt-0.5">{exercise.bodyPart}</p>
      </div>
      {/* Favorite heart — absolute top-right */}
      <div className="absolute top-1.5 right-1.5">
        <HeartButton exerciseId={exercise.id} state={preference} onToggle={onToggleFav} />
      </div>
    </button>
  )
}

export function ExerciseBrowser({
  initialExercises,
  equipmentOptions,
  targetOptions,
  initialPreferences = {},
  activeEquipmentProfile,
  onSearch,
  onSelect,
  showFavoriteToggle = true,
  compact = false,
}: Props) {
  const [exercises, setExercises] = useState<Exercise[]>(initialExercises)
  const [filters, setFilters] = useState<BrowserFilterState>({
    q: '',
    bodyPart: 'all',
    equipment: null,
    target: null,
    favoritesOnly: false,
  })
  const [selected, setSelected] = useState<Exercise | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [mode, setMode] = useState<'search' | 'browse'>('browse')
  const [browseFamily, setBrowseFamily] = useState<CanonicalFamily | null>(null)
  const [browseCanonical, setBrowseCanonical] = useState<CanonicalExercise | null>(null)

  // Optimistic preferences — toggling heart is instant, synced to API in background
  const [preferences, updatePreferences] = useOptimistic(
    initialPreferences,
    (state, { exerciseId, next }: { exerciseId: string; next: PreferenceState }) => ({
      ...state,
      [exerciseId]: next,
    })
  )

  const applyFilters = useCallback((next: BrowserFilterState) => {
    setFilters(next)
    startTransition(async () => {
      const results = await onSearch(next)
      setExercises(results)
    })
  }, [onSearch])

  const setQ = (q: string) => applyFilters({ ...filters, q })
  const setBodyPart = (bp: string) => applyFilters({ ...filters, bodyPart: bp })
  const setEquipment = (eq: string | null) => applyFilters({ ...filters, equipment: eq })
  const setTarget = (t: string | null) => applyFilters({ ...filters, target: t })
  const toggleFavoritesOnly = () => applyFilters({ ...filters, favoritesOnly: !filters.favoritesOnly })

  const handleToggleFav = async (exerciseId: string, next: PreferenceState) => {
    updatePreferences({ exerciseId, next })
    try {
      await fetch(`/api/training/exercises/${exerciseId}/preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: next }),
      })
      // If favoritesOnly is on and we un-favorited, re-search to remove from list
      if (filters.favoritesOnly && next !== 'favorite') {
        applyFilters(filters)
      }
    } catch {
      // optimistic update already applied
    }
  }

  const primaryEquipment = equipmentOptions.filter(e => e.count >= MIN_EQUIPMENT_COUNT)
  const activeFiltersCount = [
    filters.equipment,
    filters.target && filters.target !== 'all' ? filters.target : null,
    filters.bodyPart !== 'all' ? filters.bodyPart : null,
    filters.favoritesOnly ? 'fav' : null,
  ].filter(Boolean).length

  return (
    <div>
      {/* Active equipment profile banner */}
      {activeEquipmentProfile && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40 px-3 py-2">
          <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            {activeEquipmentProfile.name} · {activeEquipmentProfile.equipment.length} equipment types
          </p>
          <button
            onClick={() => applyFilters({ ...filters, equipment: null })}
            className="ml-auto text-[11px] text-emerald-600 dark:text-emerald-500 hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Mode switcher */}
      <div className="flex p-1 mb-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80">
        <button
          onClick={() => setMode('browse')}
          className={cn(
            'flex-1 py-2 rounded-xl text-sm font-semibold transition-colors',
            mode === 'browse'
              ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          )}
        >
          Browse
        </button>
        <button
          onClick={() => { setMode('search'); setSelected(null) }}
          className={cn(
            'flex-1 py-2 rounded-xl text-sm font-semibold transition-colors',
            mode === 'search'
              ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          )}
        >
          Search
        </button>
      </div>

      {mode === 'search' && (<>
      {/* Search + filter toggle */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input
            type="text"
            value={filters.q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search exercises, muscles, equipment…"
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/80 pl-9 pr-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {isPending && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400 animate-spin" />}
        </div>
        <button
          onClick={() => setShowFilters(v => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
            activeFiltersCount > 0
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
          )}
        >
          <SlidersHorizontal className="size-4" />
          {activeFiltersCount > 0 && (
            <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
              {activeFiltersCount}
            </span>
          )}
        </button>
        {showFavoriteToggle && (
          <button
            onClick={toggleFavoritesOnly}
            className={cn(
              'flex items-center justify-center size-10 rounded-xl border transition-colors',
              filters.favoritesOnly
                ? 'border-red-300 bg-red-50 text-red-500 dark:border-red-800 dark:bg-red-900/30'
                : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-400 hover:text-red-400'
            )}
            aria-label="Show favorites only"
          >
            <Heart className={cn('size-4', filters.favoritesOnly && 'fill-current')} />
          </button>
        )}
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="mb-4 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
          {/* Body part */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Body Part</p>
            <div className="flex gap-1.5 flex-wrap">
              {BODY_PARTS.map(bp => (
                <button
                  key={bp}
                  onClick={() => setBodyPart(bp)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    filters.bodyPart === bp
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                  )}
                >
                  {BODY_PART_LABELS[bp] ?? bp}
                </button>
              ))}
            </div>
          </div>

          {/* Target muscle */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Target Muscle</p>
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setTarget(null)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors',
                  !filters.target
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                )}
              >
                All
              </button>
              {targetOptions.map(t => (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors',
                    filters.target === t
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Clear all */}
          {activeFiltersCount > 0 && (
            <button
              onClick={() => {
                setShowFilters(false)
                applyFilters({ q: filters.q, bodyPart: 'all', equipment: null, target: null, favoritesOnly: false })
              }}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <X className="size-3" /> Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Equipment pills — always visible */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-hide">
        <button
          onClick={() => setEquipment(null)}
          className={cn(
            'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
            !filters.equipment
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
          )}
        >
          All equipment
        </button>
        {primaryEquipment.map(eq => (
          <button
            key={eq.value}
            onClick={() => setEquipment(filters.equipment === eq.value ? null : eq.value)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
              filters.equipment === eq.value
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
            )}
          >
            {eq.value}
          </button>
        ))}
      </div>

      {/* Active filter chips */}
      {activeFiltersCount > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {filters.bodyPart !== 'all' && (
            <span className="flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {BODY_PART_LABELS[filters.bodyPart] ?? filters.bodyPart}
              <button onClick={() => setBodyPart('all')}><X className="size-3" /></button>
            </span>
          )}
          {filters.target && (
            <span className="flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 capitalize">
              {filters.target}
              <button onClick={() => setTarget(null)}><X className="size-3" /></button>
            </span>
          )}
          {filters.favoritesOnly && (
            <span className="flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-900/20 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400">
              <Heart className="size-3 fill-current" /> Favorites
              <button onClick={toggleFavoritesOnly}><X className="size-3" /></button>
            </span>
          )}
        </div>
      )}

      {/* Results count */}
      <p className="text-xs text-zinc-400 mb-3">
        {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
        {filters.equipment ? ` · ${filters.equipment}` : ''}
      </p>

      {/* Grid */}
      <div className={cn('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
        {exercises.map(exercise => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            preference={preferences[exercise.id] ?? 'normal'}
            onToggleFav={handleToggleFav}
            compact={compact}
            onClick={() => onSelect ? onSelect(exercise) : setSelected(exercise)}
          />
        ))}
      </div>

      {exercises.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center">
          <Filter className="size-8 text-zinc-300 dark:text-zinc-700 mb-3" />
          <p className="text-sm text-zinc-400">No exercises match these filters.</p>
          <button
            onClick={() => applyFilters({ q: '', bodyPart: 'all', equipment: null, target: null, favoritesOnly: false })}
            className="mt-3 text-xs text-zinc-400 underline"
          >
            Clear filters
          </button>
        </div>
      )}

      </>)}

      {mode === 'browse' && (
        <div>
          {!browseFamily && (
            <>
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">Movement patterns</p>
              <div className="grid grid-cols-2 gap-3">
                {movementFamilies.map(family => (
                  <button
                    key={family.id}
                    onClick={() => setBrowseFamily(family)}
                    className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-left hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                  >
                    <p className="font-bold text-zinc-900 dark:text-white text-sm mb-1">{family.displayName}</p>
                    <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-500 mt-1">
                      {getExercisesForFamily(family.id).length} {getExercisesForFamily(family.id).length === 1 ? 'exercise' : 'exercises'}
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}

          {browseFamily && !browseCanonical && (
            <>
              <button
                onClick={() => setBrowseFamily(null)}
                className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white mb-4 -ml-1 transition-colors"
              >
                <ArrowLeft className="size-4" /> Movements
              </button>
              <h3 className="text-lg font-black text-zinc-900 dark:text-white mb-4">{browseFamily.displayName}</h3>
              <div className="flex flex-col gap-2">
                {getExercisesForFamily(browseFamily.id).map(ex => (
                  <button
                    key={ex.id}
                    onClick={() => setBrowseCanonical(ex)}
                    className="flex items-center justify-between rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3.5 text-left hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-zinc-900 dark:text-white text-sm">{ex.name}</p>
                      <p className="text-xs text-zinc-400 capitalize mt-0.5">
                        {ex.muscleCard.primary.slice(0, 2).join(', ')}
                        {ex.implementations.length > 0
                          ? ` · ${ex.implementations.length} ${ex.implementations.length === 1 ? 'option' : 'options'}`
                          : ''}
                        {ex.sourceGap ? ' · coming soon' : ''}
                      </p>
                    </div>
                    <span className={cn(
                      'ml-3 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize',
                      ex.difficulty === 'beginner'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                        : ex.difficulty === 'intermediate'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                    )}>
                      {ex.difficulty}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {browseCanonical && (
            <CanonicalExerciseDetail
              exercise={browseCanonical}
              onBack={() => setBrowseCanonical(null)}
              onSelectImpl={onSelect}
            />
          )}
        </div>
      )}

      {selected && !onSelect && (
        <ExerciseDetailModal
          exercise={selected}
          preference={preferences[selected.id] ?? 'normal'}
          onToggleFav={handleToggleFav}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
