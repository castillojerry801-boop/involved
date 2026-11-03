'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Image from 'next/image'
import { Search, X, Plus, Loader2, Dumbbell, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExerciseMeta } from '@/lib/exercises'
import { normalizeExdbEquipment } from '@/lib/ymove/hierarchy-scorer'
import { ExerciseDetailModal } from './exercise-detail-modal'

// ── ExerciseDB mode ───────────────────────────────────────────────────────────

const BODY_PARTS = ['all', 'back', 'chest', 'shoulders', 'upper arms', 'lower arms', 'upper legs', 'lower legs', 'waist', 'neck', 'cardio']

const PRIMARY_EQUIPMENT = [
  'body weight', 'dumbbell', 'cable', 'barbell', 'leverage machine',
  'band', 'smith machine', 'weighted', 'kettlebell', 'stability ball',
  'ez barbell', 'medicine ball', 'sled machine', 'resistance band',
]

// ── YMove mode ────────────────────────────────────────────────────────────────

const MOVEMENT_FAMILIES: { id: string; label: string }[] = [
  { id: 'all',                 label: 'All' },
  { id: 'fam_squat',           label: 'Squat' },
  { id: 'fam_lunge',           label: 'Lunge' },
  { id: 'fam_hip_hinge',       label: 'Hip Hinge' },
  { id: 'fam_chest_press',     label: 'Chest Press' },
  { id: 'fam_chest',           label: 'Chest' },
  { id: 'fam_overhead_press',  label: 'Overhead' },
  { id: 'fam_row',             label: 'Row' },
  { id: 'fam_pulldown_pullup', label: 'Pull-up' },
  { id: 'fam_back',            label: 'Back' },
  { id: 'fam_shoulders',       label: 'Shoulders' },
  { id: 'fam_arms',            label: 'Arms' },
  { id: 'fam_core',            label: 'Core' },
  { id: 'fam_legs',            label: 'Legs' },
  { id: 'fam_leg_accessories', label: 'Leg Accessories' },
  { id: 'fam_cardio',          label: 'Cardio' },
  { id: 'fam_mobility',        label: 'Mobility' },
  { id: 'fam_power',           label: 'Power' },
  { id: 'fam_plyometrics',     label: 'Plyometrics' },
  { id: 'fam_carries',         label: 'Carries' },
  { id: 'fam_neck',            label: 'Neck' },
]

const YMOVE_EQUIPMENT: { id: string; label: string }[] = [
  { id: 'barbell',    label: 'Barbell' },
  { id: 'dumbbell',   label: 'Dumbbell' },
  { id: 'cable',      label: 'Cable' },
  { id: 'machine',    label: 'Machine' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'bodyweight', label: 'Bodyweight' },
  { id: 'band',       label: 'Band' },
  { id: 'smith',      label: 'Smith' },
  { id: 'weighted',   label: 'Weighted' },
  { id: 'trap_bar',   label: 'Trap Bar' },
]

// Re-export normalizeExdbEquipment under the picker's public name so callers
// (including tests) have a stable import point.  The canonical implementation
// lives in lib/ymove/hierarchy-scorer which has zero server-only dependencies
// and is safe to import from client components.
export { normalizeExdbEquipment as exdbToEqFamily }

const YMOVE_PAGE_SIZE = 20

interface YmoveItem extends ExerciseMeta {
  source: 'ymove'
  ymoveId: string
  thumbnailMediaId: string | null
  hasVideo: boolean
  movementFamilyId: string | null
  eqFamily: string | null
}

interface Props {
  onSelect: (exercise: ExerciseMeta) => void
  onClose: () => void
  selectedIds?: Set<string>
  title?: string
  /**
   * Raw ExerciseDB equipment strings from the user's active equipment profile
   * (e.g. ['barbell', 'dumbbell', 'cable']).  When provided the picker starts in
   * "Your gym" filtered mode — only exercises whose eqFamily maps to a profile
   * equipment are shown.  A "Browse all" toggle lets the user see everything.
   * YMove mode only; ignored in ExerciseDB mode.
   *
   * Unknown equipment strings that do not map to a known EqFamily are silently
   * excluded from the allowed set — they are never treated as "allow all".
   */
  activeEquipmentStrings?: string[]
}

export default function ExercisePicker({
  onSelect,
  onClose,
  selectedIds,
  title = 'Add exercise',
  activeEquipmentStrings,
}: Props) {
  const [ymoveMode, setYmoveMode] = useState<boolean | null>(null)
  const [q, setQ] = useState('')

  // ExerciseDB mode filters
  const [bodyPart, setBodyPart] = useState('all')
  const [equipment, setEquipment] = useState<string | null>(null)
  const [showEquipment, setShowEquipment] = useState(false)

  // YMove mode filters
  const [movement, setMovement] = useState('all')
  const [eqFamily, setEqFamily] = useState<string | null>(null)
  const [showEqFamily, setShowEqFamily] = useState(false)

  // Pagination state (YMove mode only)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)

  // Equipment profile filter (YMove mode only).
  // Defaults to active when a profile is provided so the user sees their gym first.
  const [profileFilterActive, setProfileFilterActive] = useState(
    () => (activeEquipmentStrings?.length ?? 0) > 0,
  )

  // Derive the set of allowed EqFamily values from the profile strings.
  // Bodyweight is always included as a baseline.
  // Strings that don't map to a known EqFamily are dropped — not treated as
  // "compatible with everything".
  const allowedFamilies = useMemo<Set<string>>(() => {
    if (!activeEquipmentStrings || activeEquipmentStrings.length === 0) return new Set()
    const result = new Set<string>(['bodyweight'])
    for (const eq of activeEquipmentStrings) {
      const fam = normalizeExdbEquipment(eq.toLowerCase())
      if (fam) result.add(fam)
    }
    return result
  }, [activeEquipmentStrings])

  const [exercises, setExercises] = useState<ExerciseMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [previewExercise, setPreviewExercise] = useState<ExerciseMeta | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const savedScrollRef = useRef<number>(0)

  const openPreview = useCallback((ex: ExerciseMeta) => {
    savedScrollRef.current = scrollRef.current?.scrollTop ?? 0
    setPreviewExercise(ex)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewExercise(null)
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = savedScrollRef.current
    })
  }, [])

  // Probe the feature flag once — server reads the env var, client never needs NEXT_PUBLIC_
  useEffect(() => {
    fetch('/api/training/exercises/config')
      .then(r => r.json())
      .then((d: { ymove: boolean }) => setYmoveMode(d.ymove === true))
      .catch(() => setYmoveMode(false))
  }, [])

  /**
   * Fetch YMove exercises for the given filters/page.
   *
   * - pg=1: replaces the results list (+ custom exercises fetched in parallel)
   * - pg>1: appends to the existing list (Load More)
   * - profileActive: when true and allowedFamilies is non-empty, sends
   *   ?eqFamilies= to the API so every page has good density for the profile.
   *   The explicit ?eqFamily= pill overrides the multi-family filter when set.
   */
  const searchYmove = useCallback(async (
    query: string,
    mov: string,
    eq: string | null,
    pg: number,
    profileActive: boolean,
  ) => {
    const isFirstPage = pg === 1
    if (isFirstPage) {
      setLoading(true)
      setPage(1)
    } else {
      setLoadingMore(true)
    }

    try {
      const params = new URLSearchParams({ q: query, limit: String(YMOVE_PAGE_SIZE), page: String(pg) })
      if (mov !== 'all') params.set('movement', mov)
      if (eq) {
        // Explicit pill selection — single-family filter takes precedence
        params.set('eqFamily', eq)
      } else if (profileActive && allowedFamilies.size > 0) {
        // Multi-family profile filter — server-side for consistent page density
        params.set('eqFamilies', [...allowedFamilies].join(','))
      }

      if (isFirstPage) {
        // On first page: fetch catalog + custom exercises in parallel
        const [ymoveRes, customRes] = await Promise.all([
          fetch(`/api/training/exercises/ymove?${params}`),
          fetch(`/api/training/exercises?includeCustom=true&q=${encodeURIComponent(query)}&limit=20`),
        ])

        const ymoveData = await ymoveRes.json() as { items: YmoveItem[]; total: number; pages: number }
        const customData = await customRes.json() as { exercises: ExerciseMeta[] }

        const ymoveItems = ymoveData.items ?? []
        const customItems = (customData.exercises ?? []).filter(e => e.isCustom)

        setTotalPages(ymoveData.pages ?? 1)
        setExercises([...customItems, ...ymoveItems])
      } else {
        // Load More: only fetch the next catalog page, append to existing list
        const ymoveRes = await fetch(`/api/training/exercises/ymove?${params}`)
        const ymoveData = await ymoveRes.json() as { items: YmoveItem[]; total: number; pages: number }

        setTotalPages(ymoveData.pages ?? 1)
        setPage(pg)
        setExercises(prev => [...prev, ...(ymoveData.items ?? [])])
      }
    } catch {
      if (isFirstPage) setExercises([])
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [allowedFamilies])

  const searchExdb = useCallback(async (query: string, bp: string, eq: string | null) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, includeCustom: 'true', limit: '60' })
      if (bp !== 'all') params.set('bodyPart', bp)
      if (eq) params.set('equipment', eq)
      const res = await fetch(`/api/training/exercises?${params}`)
      const data = await res.json() as { exercises: ExerciseMeta[] }
      setExercises(data.exercises ?? [])
    } catch {
      setExercises([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Kick off initial search once the mode is known
  useEffect(() => {
    if (ymoveMode === null) return
    inputRef.current?.focus()
    if (ymoveMode) {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      searchYmove('', 'all', null, 1, profileFilterActive)
    } else {
      searchExdb('', 'all', null)
    }
    // profileFilterActive intentionally excluded — only the initial value matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ymoveMode, searchYmove, searchExdb])

  const handleQueryChange = (val: string) => {
    setQ(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (ymoveMode) {
      debounceRef.current = setTimeout(() => searchYmove(val, movement, eqFamily, 1, profileFilterActive), 250)
    } else {
      debounceRef.current = setTimeout(() => searchExdb(val, bodyPart, equipment), 250)
    }
  }

  // ExerciseDB handlers
  const handleBodyPart = (bp: string) => {
    setBodyPart(bp)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    searchExdb(q, bp, equipment)
  }
  const handleEquipment = (eq: string | null) => {
    setEquipment(eq)
    searchExdb(q, bodyPart, eq)
  }

  // YMove handlers
  const handleMovement = (mov: string) => {
    setMovement(mov)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    searchYmove(q, mov, eqFamily, 1, profileFilterActive)
  }
  const handleEqFamily = (eq: string | null) => {
    setEqFamily(eq)
    searchYmove(q, movement, eq, 1, profileFilterActive)
  }
  // Profile filter toggle — re-fetches page 1 with the new filter state
  const handleProfileToggle = (active: boolean) => {
    setProfileFilterActive(active)
    searchYmove(q, movement, eqFamily, 1, active)
  }
  // Load More — appends the next catalog page
  const handleLoadMore = () => {
    searchYmove(q, movement, eqFamily, page + 1, profileFilterActive)
  }

  const hasMore = ymoveMode === true && page < totalPages && !loading

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[560px] md:max-h-[80vh] md:rounded-2xl md:border md:border-zinc-200 md:dark:border-zinc-800 md:shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
        <div className="flex-1">
          <h2 className="font-black text-base text-zinc-900 dark:text-white">{title}</h2>
        </div>
        <button
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <X className="size-4 text-zinc-600 dark:text-zinc-400" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Search exercises..."
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
          />
        </div>
      </div>

      {/* Filters — rendered once mode is known */}
      {ymoveMode === false && (
        <>
          {/* Body part pills */}
          <div className="px-4 pb-1 shrink-0 overflow-x-auto scrollbar-none">
            <div className="flex gap-1.5 w-max">
              {BODY_PARTS.map(bp => (
                <button
                  key={bp}
                  onClick={() => handleBodyPart(bp)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors capitalize',
                    bodyPart === bp
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                  )}
                >
                  {bp}
                </button>
              ))}
            </div>
          </div>

          {/* Equipment filter */}
          <div className="px-4 pb-2 shrink-0">
            <button
              onClick={() => setShowEquipment(v => !v)}
              className={cn(
                'flex items-center gap-1 text-xs font-medium transition-colors mb-1',
                equipment
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300',
              )}
            >
              <ChevronDown className={cn('size-3 transition-transform', showEquipment && 'rotate-180')} />
              {equipment ? `Equipment: ${equipment}` : 'Filter by equipment'}
              {equipment && (
                <button
                  onClick={e => { e.stopPropagation(); handleEquipment(null) }}
                  className="ml-1 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="size-3" />
                </button>
              )}
            </button>
            {showEquipment && (
              <div className="overflow-x-auto scrollbar-none">
                <div className="flex gap-1.5 w-max">
                  <button
                    onClick={() => { handleEquipment(null); setShowEquipment(false) }}
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors',
                      !equipment
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                    )}
                  >
                    All
                  </button>
                  {PRIMARY_EQUIPMENT.map(eq => (
                    <button
                      key={eq}
                      onClick={() => { handleEquipment(equipment === eq ? null : eq); setShowEquipment(false) }}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors capitalize',
                        equipment === eq
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                      )}
                    >
                      {eq}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {ymoveMode === true && (
        <>
          {/* Equipment profile toggle — only shown when a profile is provided */}
          {allowedFamilies.size > 0 && (
            <div className="px-4 pb-1 shrink-0 flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">Show:</span>
              <button
                onClick={() => handleProfileToggle(true)}
                className={cn(
                  'px-4 min-h-[44px] rounded-full text-xs font-semibold transition-colors',
                  profileFilterActive
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                )}
              >
                Your gym
              </button>
              <button
                onClick={() => handleProfileToggle(false)}
                className={cn(
                  'px-4 min-h-[44px] rounded-full text-xs font-semibold transition-colors',
                  !profileFilterActive
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                )}
              >
                Browse all
              </button>
            </div>
          )}

          {/* Movement family pills */}
          <div className="px-4 pb-1 shrink-0 overflow-x-auto scrollbar-none">
            <div className="flex gap-1.5 w-max">
              {MOVEMENT_FAMILIES.map(fam => (
                <button
                  key={fam.id}
                  onClick={() => handleMovement(fam.id)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors',
                    movement === fam.id
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                  )}
                >
                  {fam.label}
                </button>
              ))}
            </div>
          </div>

          {/* Equipment family filter */}
          <div className="px-4 pb-2 shrink-0">
            <button
              onClick={() => setShowEqFamily(v => !v)}
              className={cn(
                'flex items-center gap-1 text-xs font-medium transition-colors mb-1',
                eqFamily
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300',
              )}
            >
              <ChevronDown className={cn('size-3 transition-transform', showEqFamily && 'rotate-180')} />
              {eqFamily
                ? `Equipment: ${YMOVE_EQUIPMENT.find(e => e.id === eqFamily)?.label ?? eqFamily}`
                : 'Filter by equipment'}
              {eqFamily && (
                <button
                  onClick={e => { e.stopPropagation(); handleEqFamily(null) }}
                  className="ml-1 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="size-3" />
                </button>
              )}
            </button>
            {showEqFamily && (
              <div className="overflow-x-auto scrollbar-none">
                <div className="flex gap-1.5 w-max">
                  <button
                    onClick={() => { handleEqFamily(null); setShowEqFamily(false) }}
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors',
                      !eqFamily
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                    )}
                  >
                    All
                  </button>
                  {YMOVE_EQUIPMENT.map(eq => (
                    <button
                      key={eq.id}
                      onClick={() => { handleEqFamily(eqFamily === eq.id ? null : eq.id); setShowEqFamily(false) }}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors',
                        eqFamily === eq.id
                          ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                      )}
                    >
                      {eq.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Results */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {loading || ymoveMode === null ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-5 animate-spin text-zinc-400" />
          </div>
        ) : exercises.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 px-4 text-center">
            <div className="size-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <Dumbbell className="size-5 text-zinc-400" />
            </div>
            <p className="text-sm text-zinc-400">
              {ymoveMode && profileFilterActive && allowedFamilies.size > 0
                ? 'No exercises found for your gym equipment. Try Browse all.'
                : 'No exercises found'}
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-zinc-50 dark:divide-zinc-900">
              {exercises.map(ex => {
                const already = selectedIds?.has(ex.id)
                const ymvItem = ymoveMode && 'thumbnailMediaId' in ex ? ex as YmoveItem : null
                return (
                  <li key={ex.id}>
                    <div className={cn(
                      'flex items-center gap-3 px-4 py-3',
                      already && 'opacity-40',
                    )}>
                      {/* Preview trigger — thumbnail + name opens detail without adding */}
                      <button
                        onClick={() => openPreview(ex)}
                        className="flex-1 flex items-center gap-3 text-left min-w-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 active:bg-zinc-100 dark:active:bg-zinc-900 -mx-1 px-1 py-0.5 rounded-xl transition-colors"
                        aria-label={`Preview ${ex.name}`}
                      >
                        {/* Thumbnail — YMove exercises only */}
                        {ymvItem ? (
                          ymvItem.thumbnailMediaId ? (
                            <Image
                              src={`/api/ymove/thumbnail/${ymvItem.thumbnailMediaId}?crop=square`}
                              alt=""
                              width={40}
                              height={40}
                              unoptimized
                              loading="lazy"
                              className="size-10 rounded-lg object-cover shrink-0 bg-zinc-100 dark:bg-zinc-800"
                            />
                          ) : (
                            <div className="size-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                              <Dumbbell className="size-4 text-zinc-400" />
                            </div>
                          )
                        ) : null}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                              {ex.name}
                            </span>
                            {ex.isCustom && (
                              <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-wide shrink-0">
                                Mine
                              </span>
                            )}
                            {ymvItem?.hasVideo && !ex.isCustom && (
                              <span className="px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-[10px] font-medium shrink-0">
                                Video
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400 capitalize mt-0.5">
                            {ex.bodyPart}
                            {ex.equipment && ex.equipment !== 'bodyweight' && ex.equipment !== 'unknown'
                              ? ` · ${ex.equipment}`
                              : ''}
                          </p>
                        </div>
                      </button>

                      {/* Add button — direct add without preview */}
                      {already ? (
                        <span className="text-xs text-zinc-400 shrink-0">Added</span>
                      ) : (
                        <button
                          onClick={() => onSelect(ex)}
                          aria-label={`Add ${ex.name} to workout`}
                          className="shrink-0 flex size-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        >
                          <Plus className="size-4 text-zinc-600 dark:text-zinc-400" />
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* Load More — YMove pagination */}
            {hasMore && (
              <div className="py-4 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-5 min-h-[44px] rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                >
                  {loadingMore
                    ? <><Loader2 className="size-3 animate-spin" /> Loading…</>
                    : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Custom exercise shortcut */}
      <div className="shrink-0 border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
        <a
          href="/training/exercises/custom"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Can&apos;t find it? Create a custom exercise →
        </a>
      </div>

      {/* Exercise preview — opens on row tap; add button inside commits to workout */}
      {previewExercise && (
        <ExerciseDetailModal
          exercise={previewExercise}
          onClose={closePreview}
          onAdd={selectedIds?.has(previewExercise.id) ? undefined : () => {
            onSelect(previewExercise)
            closePreview()
          }}
        />
      )}
    </div>
  )
}
