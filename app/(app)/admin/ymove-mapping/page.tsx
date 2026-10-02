'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, CheckCircle, XCircle, Minus, ChevronDown, ChevronUp,
  Play, RefreshCw, AlertTriangle, Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type MappingStatus = 'mapped' | 'no_match' | 'unmapped'
type FilterStatus = MappingStatus | 'all' | 'starter'

interface ExerciseRow {
  exerciseDbId: string
  displayName: string
  rawName: string
  equipment: string
  bodyPart: string
  target: string
  technicalPattern: string | null
  movementPatternLabel: string | null
  primaryMuscles: string[] | null
  suggestedSearchQuery: string
  ymoveExerciseId: string | null
  status: MappingStatus
  isStarterBatch: boolean
}

interface ScoredCandidate {
  ymoveId: string
  name: string
  score: number
  confidence: 'strong' | 'likely' | 'possible' | 'weak'
  matchReasons: string[]
  penaltyReasons: string[]
  alreadyMappedTo: string | null
  alreadyMappedDbId: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIDENCE_COLORS = {
  strong:   'bg-green-900/60 text-green-300 border-green-700',
  likely:   'bg-blue-900/60 text-blue-300 border-blue-700',
  possible: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  weak:     'bg-zinc-800 text-zinc-400 border-zinc-700',
}

const STATUS_ICON: Record<MappingStatus, React.ReactNode> = {
  mapped:   <CheckCircle className="size-4 text-green-500 shrink-0" />,
  no_match: <XCircle    className="size-4 text-zinc-500 shrink-0" />,
  unmapped: <Minus      className="size-4 text-amber-400 shrink-0" />,
}

const STATUS_LABEL: Record<MappingStatus, string> = {
  mapped:   'Mapped',
  no_match: 'No match',
  unmapped: 'Not checked',
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useExercises(filter: FilterStatus, nameSearch: string) {
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter === 'starter') {
        params.set('batch', 'starter')
      } else if (filter !== 'all') {
        params.set('status', filter)
      }
      params.set('limit', '200')

      const res = await fetch(`/api/admin/ymove-mapping?${params}`)
      if (!res.ok) {
        setError(res.status === 403 ? 'Access denied.' : 'Failed to load exercises.')
        return
      }
      const data = await res.json() as { exercises: ExerciseRow[]; total: number }
      setExercises(data.exercises)
      setTotal(data.total)
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { void load() }, [load])

  const filtered = nameSearch
    ? exercises.filter(ex =>
        ex.displayName.toLowerCase().includes(nameSearch.toLowerCase()) ||
        ex.exerciseDbId.includes(nameSearch),
      )
    : exercises

  return { exercises: filtered, total, loading, error, reload: load }
}

// ── Candidate card ─────────────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  exerciseDbId,
  onApprove,
  saving,
}: {
  candidate: ScoredCandidate
  exerciseDbId: string
  onApprove: (ymoveId: string) => void
  saving: boolean
}) {
  const [thumbVisible, setThumbVisible] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [playing, setPlaying] = useState(false)

  async function loadVideo() {
    if (videoUrl) { setPlaying(true); return }
    setVideoLoading(true)
    setVideoError(false)
    try {
      const res = await fetch(`/api/admin/ymove-mapping?preview=${encodeURIComponent(candidate.ymoveId)}`)
      if (res.ok) {
        const data = await res.json() as { videoUrl?: string }
        if (data.videoUrl) { setVideoUrl(data.videoUrl); setPlaying(true) }
        else setVideoError(true)
      } else {
        setVideoError(true)
      }
    } finally {
      setVideoLoading(false)
    }
  }

  return (
    <div className={cn(
      'rounded-lg border bg-zinc-800/50 p-3',
      candidate.alreadyMappedTo ? 'border-amber-700/50' : 'border-zinc-700/50',
    )}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Thumbnail */}
        <div className="shrink-0">
          {thumbVisible ? (
            playing && videoUrl ? (
              <div className="relative">
                <video
                  src={videoUrl}
                  autoPlay
                  loop
                  playsInline
                  muted
                  className="size-16 rounded object-cover"
                />
                <button
                  onClick={() => setPlaying(false)}
                  className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-zinc-900 text-[9px] text-zinc-300"
                >✕</button>
              </div>
            ) : (
              <div className="relative size-16">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/ymove/thumbnail/${candidate.ymoveId}?crop=square`}
                  alt={candidate.name}
                  className="size-16 rounded object-cover"
                />
                <button
                  onClick={loadVideo}
                  disabled={videoLoading}
                  className="absolute inset-0 flex items-center justify-center rounded bg-black/30 opacity-0 hover:opacity-100 transition-opacity"
                  title="Preview video (uses quota)"
                >
                  {videoLoading
                    ? <RefreshCw className="size-4 animate-spin text-white" />
                    : <Play className="size-4 text-white fill-white" />
                  }
                </button>
              </div>
            )
          ) : (
            <button
              onClick={() => setThumbVisible(true)}
              className="flex size-16 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
              title="Load thumbnail"
            >
              <Play className="size-4" />
            </button>
          )}
          {videoError && <p className="mt-0.5 text-center text-[10px] text-red-400">no video</p>}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn(
              'rounded border px-1.5 py-0.5 text-xs font-semibold',
              CONFIDENCE_COLORS[candidate.confidence],
            )}>
              {candidate.score} · {candidate.confidence}
            </span>
            {candidate.alreadyMappedTo && (
              <span className="flex items-center gap-1 rounded border border-amber-700/60 bg-amber-900/30 px-1.5 py-0.5 text-xs text-amber-300">
                <AlertTriangle className="size-3" />
                already mapped to: {candidate.alreadyMappedTo}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-zinc-100 leading-tight">{candidate.name}</p>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{candidate.ymoveId}</p>

          {/* Match reasons */}
          {(candidate.matchReasons.length > 0 || candidate.penaltyReasons.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {candidate.matchReasons.map(r => (
                <span key={r} className="rounded bg-green-900/30 px-1.5 py-0.5 text-[11px] text-green-400">✓ {r}</span>
              ))}
              {candidate.penaltyReasons.map(r => (
                <span key={r} className="rounded bg-red-900/30 px-1.5 py-0.5 text-[11px] text-red-400">✗ {r}</span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <button
          onClick={() => onApprove(candidate.ymoveId)}
          disabled={saving}
          className="shrink-0 rounded-md bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Use this'}
        </button>
      </div>
    </div>
  )
}

// ── Exercise row ───────────────────────────────────────────────────────────────

function ExerciseRow({
  ex,
  expanded,
  onToggle,
  onSave,
  onClear,
  saving,
}: {
  ex: ExerciseRow
  expanded: boolean
  onToggle: () => void
  onSave: (ymoveId: string | null, force?: boolean) => Promise<{ conflict?: boolean; existingName?: string } | null>
  onClear: () => void
  saving: boolean
}) {
  const [candidates, setCandidates] = useState<ScoredCandidate[]>([])
  const [searchQuery, setSearchQuery] = useState(ex.suggestedSearchQuery)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [conflictInfo, setConflictInfo] = useState<{ existingName: string; pendingYmoveId: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-search when expanded for the first time
  useEffect(() => {
    if (expanded && candidates.length === 0) {
      void runSearch(ex.suggestedSearchQuery)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  async function runSearch(q: string) {
    if (!q.trim()) return
    setSearching(true)
    setSearchError(null)
    try {
      const res = await fetch(
        `/api/admin/ymove-mapping?search=${encodeURIComponent(q)}&exerciseId=${ex.exerciseDbId}&limit=8`,
      )
      if (!res.ok) { setSearchError('Search failed.'); return }
      const data = await res.json() as { candidates: ScoredCandidate[] }
      setCandidates(data.candidates)
    } catch {
      setSearchError('Network error.')
    } finally {
      setSearching(false)
    }
  }

  async function handleApprove(ymoveId: string) {
    setConflictInfo(null)
    const result = await onSave(ymoveId)
    if (result?.conflict && result.existingName) {
      setConflictInfo({ existingName: result.existingName, pendingYmoveId: ymoveId })
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        {STATUS_ICON[ex.status]}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-zinc-100">{ex.displayName}</p>
            {ex.isStarterBatch && (
              <Star className="size-3 text-amber-400" aria-label="Starter batch" />
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>ID: {ex.exerciseDbId}</span>
            {ex.equipment !== 'body weight' && <span className="rounded bg-zinc-800 px-1">{ex.equipment}</span>}
            {ex.movementPatternLabel && <span>{ex.movementPatternLabel}</span>}
            {ex.target && ex.target !== ex.bodyPart && <span className="text-zinc-600">→ {ex.target}</span>}
          </div>
          {ex.ymoveExerciseId && (
            <p className="mt-0.5 font-mono text-[11px] text-green-500/80">
              ✓ {ex.ymoveExerciseId.slice(0, 8)}…
            </p>
          )}
        </div>
        {expanded
          ? <ChevronUp className="mt-0.5 size-4 text-zinc-500 shrink-0" />
          : <ChevronDown className="mt-0.5 size-4 text-zinc-500 shrink-0" />
        }
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 pb-4 pt-3 space-y-3">
          {/* Metadata row */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-zinc-300">
              {ex.equipment}
            </span>
            {ex.target && (
              <span className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-zinc-300">
                {ex.target}
              </span>
            )}
            {ex.movementPatternLabel && (
              <span className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-zinc-300">
                {ex.movementPatternLabel}
              </span>
            )}
            {ex.primaryMuscles?.slice(0, 3).map(m => (
              <span key={m} className="rounded border border-zinc-700/50 px-2 py-0.5 text-zinc-500">{m}</span>
            ))}
          </div>

          {/* Search */}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void runSearch(searchQuery) }}
              placeholder="Search ymove…"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
            <button
              onClick={() => void runSearch(searchQuery)}
              disabled={searching}
              className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-600 disabled:opacity-50 flex items-center gap-1.5"
            >
              {searching && <RefreshCw className="size-3 animate-spin" />}
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>

          {searchError && <p className="text-xs text-red-400">{searchError}</p>}

          {/* Conflict warning */}
          {conflictInfo && (
            <div className="rounded-lg border border-amber-700/60 bg-amber-900/20 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-amber-300">
                    This ymove UUID is already mapped to: <strong>{conflictInfo.existingName}</strong>
                  </p>
                  <p className="mt-1 text-xs text-amber-400/80">
                    Two different exercises would share the same ymove video. Map anyway?
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={async () => {
                        setConflictInfo(null)
                        await onSave(conflictInfo.pendingYmoveId, true)
                      }}
                      className="rounded bg-amber-700 px-2.5 py-1 text-xs text-white hover:bg-amber-600"
                    >
                      Map anyway
                    </button>
                    <button
                      onClick={() => setConflictInfo(null)}
                      className="rounded px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Candidate list */}
          {candidates.length === 0 && !searching && !searchError && (
            <p className="text-xs text-zinc-500">No ymove results. Try a different search term.</p>
          )}
          <div className="space-y-2">
            {candidates.map(c => (
              <CandidateCard
                key={c.ymoveId}
                candidate={c}
                exerciseDbId={ex.exerciseDbId}
                onApprove={ymoveId => void handleApprove(ymoveId)}
                saving={saving}
              />
            ))}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => void onSave(null)}
              disabled={saving}
              className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            >
              Mark as no ymove match
            </button>
            {ex.status !== 'unmapped' && (
              <button
                onClick={onClear}
                disabled={saving}
                className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
              >
                Clear mapping
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function YmoveMappingPage() {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('starter')
  const [nameSearch, setNameSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const { exercises, total, loading, error, reload } = useExercises(filterStatus, nameSearch)

  const counts = { mapped: 0, no_match: 0, unmapped: 0, total: exercises.length }
  exercises.forEach(ex => {
    if (ex.status in counts) counts[ex.status as MappingStatus]++
  })

  async function handleSave(
    exerciseDbId: string,
    ymoveExerciseId: string | null,
    force = false,
  ): Promise<{ conflict?: boolean; existingName?: string } | null> {
    setSaving(exerciseDbId)
    try {
      const res = await fetch('/api/admin/ymove-mapping', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseDbId, ymoveExerciseId, forceOverwrite: force }),
      })

      if (res.status === 409) {
        const data = await res.json() as { existingName?: string }
        return { conflict: true, existingName: data.existingName }
      }

      if (res.ok) {
        setExpanded(null)
        await reload()
      }
      return null
    } finally {
      setSaving(null)
    }
  }

  async function handleClear(exerciseDbId: string) {
    setSaving(exerciseDbId)
    try {
      await fetch('/api/admin/ymove-mapping', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseDbId }),
      })
      await reload()
    } finally {
      setSaving(null)
    }
  }

  const FILTER_TABS: { key: FilterStatus; label: string; count?: number }[] = [
    { key: 'starter',   label: 'Starter Batch', count: undefined },
    { key: 'unmapped',  label: 'Unmapped' },
    { key: 'mapped',    label: 'Mapped' },
    { key: 'no_match',  label: 'No Match' },
    { key: 'all',       label: 'All' },
  ]

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-100">ymove Exercise Mapping</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Build the verified ExerciseDB → ymove mapping. Approve entries individually — nothing auto-maps.
          Changes write to{' '}
          <code className="rounded bg-zinc-800 px-1 text-xs">data/ymove-exercise-mapping.json</code>
          {' '}— commit the file to deploy.
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-4 flex flex-wrap gap-1">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setFilterStatus(tab.key); setNameSearch('') }}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              filterStatus === tab.key
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60',
            )}
          >
            {tab.key === 'starter' && <Star className="size-3 text-amber-400" />}
            {tab.label}
            {tab.key !== 'starter' && tab.key !== 'all' && (
              <span className="text-xs opacity-60">({counts[tab.key as MappingStatus] ?? total})</span>
            )}
          </button>
        ))}
      </div>

      {/* Name search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
        <input
          value={nameSearch}
          onChange={e => setNameSearch(e.target.value)}
          placeholder="Filter by name or ID…"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 py-2 pl-9 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
      </div>

      {/* Body */}
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>
      ) : exercises.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          No exercises match the current filter.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-600">
            Showing {exercises.length}{total !== exercises.length ? ` of ${total}` : ''} exercises
          </p>
          <div className="space-y-1.5">
            {exercises.map(ex => (
              <ExerciseRow
                key={ex.exerciseDbId}
                ex={ex}
                expanded={expanded === ex.exerciseDbId}
                onToggle={() => setExpanded(prev => prev === ex.exerciseDbId ? null : ex.exerciseDbId)}
                onSave={(ymoveId, force) => handleSave(ex.exerciseDbId, ymoveId, force)}
                onClear={() => void handleClear(ex.exerciseDbId)}
                saving={saving === ex.exerciseDbId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
