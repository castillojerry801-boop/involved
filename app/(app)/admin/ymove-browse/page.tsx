'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, ChevronLeft, ChevronRight, X, RefreshCw,
  CheckCircle, Play, EyeOff, Eye,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface YmoveItem {
  ymoveId: string
  name: string
  mappedTo: string | null
}

interface ExerciseResult {
  exerciseDbId: string
  displayName: string
  equipment: string
  target: string
  movementPatternLabel: string | null
  alreadyMapped: boolean
  ymoveExerciseId: string | null
}

// ── Exercise search panel ─────────────────────────────────────────────────────

function ExerciseSearch({
  ymoveId,
  ymoveName,
  currentMappedTo,
  onMapped,
  onNoMatch,
}: {
  ymoveId: string
  ymoveName: string
  currentMappedTo: string | null
  onMapped: (displayName: string) => void
  onNoMatch: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ExerciseResult[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(currentMappedTo)
  const inputRef = useRef<HTMLInputElement>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    setSaved(currentMappedTo)
  }, [currentMappedTo])

  function handleInput(val: string) {
    setQuery(val)
    if (timeout.current) clearTimeout(timeout.current)
    if (!val.trim()) { setResults([]); return }
    timeout.current = setTimeout(() => void search(val), 200)
  }

  async function search(q: string) {
    setSearching(true)
    try {
      const res = await fetch(`/api/admin/ymove-browse?exerciseSearch=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json() as { results: ExerciseResult[] }
        setResults(data.results)
      }
    } finally {
      setSearching(false)
    }
  }

  async function assign(ex: ExerciseResult, force = false) {
    setSaving(ex.exerciseDbId)
    try {
      const res = await fetch('/api/admin/ymove-mapping', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseDbId: ex.exerciseDbId,
          ymoveExerciseId: ymoveId,
          forceOverwrite: force,
        }),
      })
      if (res.status === 409) {
        const data = await res.json() as { existingName?: string }
        const confirm = window.confirm(
          `"${ex.displayName}" already maps to a different ymove video.\n${data.existingName ? `Currently: ${data.existingName}` : ''}\n\nOverwrite?`
        )
        if (confirm) await assign(ex, true)
        return
      }
      if (res.ok) {
        setSaved(ex.displayName)
        onMapped(ex.displayName)
      }
    } finally {
      setSaving(null)
    }
  }

  async function markNoMatch() {
    // No-match is stored on the exercise side (null ymoveExerciseId on our canonical).
    // Here we just dismiss — the ymove video may match something else.
    onNoMatch()
  }

  return (
    <div className="p-4 border-t border-zinc-800">
      {saved ? (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle className="size-4 shrink-0" />
          <span>Mapped → <strong>{saved}</strong></span>
          <button
            onClick={() => { setSaved(null); setQuery(''); setResults([]) }}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs font-medium text-zinc-400">
            Which ExerciseDB exercise is this?
          </p>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500" />
            {searching && <RefreshCw className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-zinc-500" />}
            <input
              ref={inputRef}
              value={query}
              onChange={e => handleInput(e.target.value)}
              placeholder="Search: bench press, squat, curl…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-8 pr-8 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>

          {results.length > 0 && (
            <div className="mt-2 space-y-1 max-h-56 overflow-y-auto">
              {results.map(ex => (
                <button
                  key={ex.exerciseDbId}
                  onClick={() => void assign(ex)}
                  disabled={saving === ex.exerciseDbId}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    ex.alreadyMapped
                      ? 'bg-zinc-800/40 hover:bg-zinc-700/60'
                      : 'bg-zinc-800 hover:bg-zinc-700',
                    saving === ex.exerciseDbId && 'opacity-50',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-zinc-100">{ex.displayName}</p>
                    <p className="text-xs text-zinc-500">
                      {ex.equipment}
                      {ex.movementPatternLabel && <> · {ex.movementPatternLabel}</>}
                      {ex.alreadyMapped && <span className="ml-1.5 text-amber-500">already mapped</span>}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-400 font-mono">{ex.exerciseDbId}</span>
                </button>
              ))}
            </div>
          )}

          {query && results.length === 0 && !searching && (
            <p className="mt-2 text-xs text-zinc-500">No exercises found.</p>
          )}

          <button
            onClick={markNoMatch}
            className="mt-3 text-xs text-zinc-600 hover:text-zinc-400"
          >
            Skip — not a match for anything in our library
          </button>
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function YmoveBrowsePage() {
  const [items, setItems] = useState<YmoveItem[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [totalItems, setTotalItems] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [pendingSearch, setPendingSearch] = useState('')
  const [hideMapped, setHideMapped] = useState(false)

  // Lightbox
  const [activeItem, setActiveItem] = useState<YmoveItem | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoError, setVideoError] = useState(false)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchPage = useCallback(async (p: number, q: string, replace: boolean) => {
    if (replace) setLoading(true)
    else setLoadingMore(true)
    setError(null)

    try {
      const params = new URLSearchParams({ page: String(p), pageSize: '48' })
      if (q) params.set('search', q)
      const res = await fetch(`/api/admin/ymove-browse?${params}`)
      if (!res.ok) { setError('Failed to load ymove exercises.'); return }
      const data = await res.json() as {
        items: YmoveItem[]
        hasMore: boolean
        totalItems: number | null
      }
      setItems(prev => replace ? data.items : [...prev, ...data.items])
      setHasMore(data.hasMore)
      setTotalItems(data.totalItems)
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  // Initial load + search changes reset to page 1
  useEffect(() => {
    setPage(1)
    void fetchPage(1, search, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  function handleSearchInput(val: string) {
    setPendingSearch(val)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => setSearch(val), 400)
  }

  function loadMore() {
    const next = page + 1
    setPage(next)
    void fetchPage(next, search, false)
  }

  async function openLightbox(item: YmoveItem) {
    setActiveItem(item)
    setVideoUrl(null)
    setVideoError(false)
    setVideoLoading(true)
    try {
      const res = await fetch(`/api/admin/ymove-browse?video=${encodeURIComponent(item.ymoveId)}`)
      if (res.ok) {
        const data = await res.json() as { videoUrl: string | null }
        setVideoUrl(data.videoUrl)
      } else {
        setVideoError(true)
      }
    } catch {
      setVideoError(true)
    } finally {
      setVideoLoading(false)
    }
  }

  function closeLightbox() {
    setActiveItem(null)
    setVideoUrl(null)
  }

  function handleMapped(ymoveId: string, displayName: string) {
    // Update the item in place so the card shows the badge immediately
    setItems(prev =>
      prev.map(it => it.ymoveId === ymoveId ? { ...it, mappedTo: displayName } : it)
    )
    if (activeItem?.ymoveId === ymoveId) {
      setActiveItem(prev => prev ? { ...prev, mappedTo: displayName } : prev)
    }
  }

  const displayed = hideMapped ? items.filter(it => !it.mappedTo) : items
  const mappedCount = items.filter(it => it.mappedTo).length

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-zinc-100">ymove Browser</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Click a video, find the matching exercise in the search, tag it. Thumbnails are free — each video play uses 1 quota slot.
          </p>
        </div>

        {/* Controls */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
            <input
              value={pendingSearch}
              onChange={e => handleSearchInput(e.target.value)}
              placeholder="Search ymove by name…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 py-2 pl-9 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            />
          </div>

          <button
            onClick={() => setHideMapped(h => !h)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors',
              hideMapped
                ? 'border-zinc-500 bg-zinc-700 text-zinc-100'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-200',
            )}
          >
            {hideMapped ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            {hideMapped ? 'Show mapped' : 'Hide mapped'}
          </button>

          {totalItems !== null && (
            <p className="text-sm text-zinc-500">
              {totalItems.toLocaleString()} ymove exercises
              {mappedCount > 0 && <span className="ml-2 text-green-500">{mappedCount} tagged</span>}
            </p>
          )}
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 48 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl bg-zinc-800/50 aspect-square" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {displayed.map(item => (
                <button
                  key={item.ymoveId}
                  onClick={() => void openLightbox(item)}
                  className={cn(
                    'group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all',
                    'hover:border-zinc-500 hover:shadow-lg hover:shadow-black/40',
                    item.mappedTo ? 'border-green-800/40' : 'border-zinc-800',
                  )}
                >
                  <div className="relative aspect-square w-full bg-zinc-800 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/ymove/thumbnail/${item.ymoveId}?crop=square`}
                      alt={item.name}
                      className="size-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/35 transition-colors">
                      <Play className="size-6 text-white fill-white opacity-0 group-hover:opacity-90 transition-opacity drop-shadow" />
                    </div>
                    {item.mappedTo && (
                      <div className="absolute bottom-1 left-1 right-1">
                        <div className="flex items-center gap-1 rounded-md bg-green-900/90 px-1.5 py-0.5">
                          <CheckCircle className="size-2.5 text-green-400 shrink-0" />
                          <span className="truncate text-[9px] text-green-300 font-medium">{item.mappedTo}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="px-1.5 py-1.5">
                    <p className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{item.name}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-2.5 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                >
                  {loadingMore && <RefreshCw className="size-4 animate-spin" />}
                  {loadingMore ? 'Loading…' : `Load more${totalItems ? ` (${displayed.length} of ${totalItems})` : ''}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Lightbox */}
      {activeItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={closeLightbox}
        >
          <div
            className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={closeLightbox}
              className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-full bg-zinc-800/80 text-zinc-300 hover:text-white"
            >
              <X className="size-4" />
            </button>

            {/* Video */}
            <div className="relative aspect-[9/16] w-full bg-zinc-800 max-h-[55vh]">
              {videoLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <RefreshCw className="size-8 animate-spin text-zinc-500" />
                </div>
              )}
              {videoError && !videoLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  {/* Still show thumbnail */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/ymove/thumbnail/${activeItem.ymoveId}?crop=portrait`}
                    alt={activeItem.name}
                    className="size-full object-cover opacity-60"
                  />
                  <p className="absolute text-xs text-zinc-400">No video available</p>
                </div>
              )}
              {videoUrl && (
                <video
                  src={videoUrl}
                  autoPlay
                  loop
                  playsInline
                  controls
                  className="size-full object-contain"
                />
              )}
              {!videoLoading && !videoUrl && !videoError && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/ymove/thumbnail/${activeItem.ymoveId}?crop=portrait`}
                  alt={activeItem.name}
                  className="size-full object-cover"
                />
              )}
            </div>

            {/* Exercise name + UUID */}
            <div className="px-4 pt-3 pb-1">
              <p className="font-semibold text-zinc-100 leading-snug">{activeItem.name}</p>
              <p className="mt-0.5 font-mono text-[10px] text-zinc-600 break-all select-all">{activeItem.ymoveId}</p>
            </div>

            {/* Assignment UI */}
            <ExerciseSearch
              ymoveId={activeItem.ymoveId}
              ymoveName={activeItem.name}
              currentMappedTo={activeItem.mappedTo}
              onMapped={(displayName) => handleMapped(activeItem.ymoveId, displayName)}
              onNoMatch={closeLightbox}
            />
          </div>
        </div>
      )}
    </div>
  )
}
