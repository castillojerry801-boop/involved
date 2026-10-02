'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, CheckCircle, XCircle, Minus, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

type MappingStatus = 'mapped' | 'no_match' | 'unmapped'

interface ExerciseRow {
  exerciseDbId: string
  displayName: string
  rawName: string
  ymoveExerciseId: string | null
  status: MappingStatus
}

interface Candidate {
  ymoveId: string
  name: string
  thumbnailUrl: string
}

const STATUS_ICON: Record<MappingStatus, React.ReactNode> = {
  mapped:   <CheckCircle className="size-4 text-green-500 shrink-0" />,
  no_match: <XCircle    className="size-4 text-zinc-400 shrink-0" />,
  unmapped: <Minus      className="size-4 text-amber-400 shrink-0" />,
}

const STATUS_LABEL: Record<MappingStatus, string> = {
  mapped:   'Mapped',
  no_match: 'No match',
  unmapped: 'Not checked',
}

export default function YmoveMappingPage() {
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filterStatus, setFilterStatus] = useState<MappingStatus | 'all'>('unmapped')
  const [searchTerm, setSearchTerm] = useState('')

  const [expanded, setExpanded] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({})
  const [searching, setSearching] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [thumbPreview, setThumbPreview] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ymove-mapping')
      if (!res.ok) { setError(res.status === 403 ? 'Access denied.' : 'Failed to load.'); return }
      const data = await res.json() as { exercises: ExerciseRow[] }
      setExercises(data.exercises)
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const searchYmove = useCallback(async (exerciseDbId: string, query: string) => {
    setSearching(exerciseDbId)
    try {
      const res = await fetch(`/api/admin/ymove-mapping?search=${encodeURIComponent(query)}&limit=5`)
      if (!res.ok) return
      const data = await res.json() as { candidates: Candidate[] }
      setCandidates(prev => ({ ...prev, [exerciseDbId]: data.candidates }))
    } finally {
      setSearching(null)
    }
  }, [])

  const saveMapping = useCallback(async (exerciseDbId: string, ymoveExerciseId: string | null) => {
    setSaving(exerciseDbId)
    try {
      const res = await fetch('/api/admin/ymove-mapping', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseDbId, ymoveExerciseId }),
      })
      if (!res.ok) return
      setExercises(prev => prev.map(ex =>
        ex.exerciseDbId === exerciseDbId
          ? { ...ex, ymoveExerciseId, status: ymoveExerciseId ? 'mapped' : 'no_match' }
          : ex,
      ))
      setExpanded(null)
      setCandidates(prev => { const n = { ...prev }; delete n[exerciseDbId]; return n })
    } finally {
      setSaving(null)
    }
  }, [])

  const filtered = exercises.filter(ex => {
    if (filterStatus !== 'all' && ex.status !== filterStatus) return false
    if (searchTerm && !ex.displayName.toLowerCase().includes(searchTerm.toLowerCase())) return false
    return true
  })

  const counts: Record<MappingStatus, number> = { mapped: 0, no_match: 0, unmapped: 0 }
  exercises.forEach(ex => counts[ex.status]++)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-100">ymove Exercise Mapping</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Build the verified ExerciseDB → ymove mapping. Changes are written to{' '}
          <code className="rounded bg-zinc-800 px-1 text-xs text-zinc-300">data/ymove-exercise-mapping.json</code>.
          Commit the file to deploy.
        </p>
      </div>

      {/* Counters */}
      <div className="mb-5 flex gap-4 text-sm">
        {(['unmapped', 'mapped', 'no_match'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(prev => prev === s ? 'all' : s)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors',
              filterStatus === s ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200',
            )}
          >
            {STATUS_ICON[s]}
            <span>{STATUS_LABEL[s]}</span>
            <span className="ml-0.5 text-xs opacity-60">({counts[s]})</span>
          </button>
        ))}
        <button
          onClick={() => setFilterStatus('all')}
          className={cn('rounded-md px-2.5 py-1.5 text-sm transition-colors', filterStatus === 'all' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')}
        >
          All ({exercises.length})
        </button>
      </div>

      {/* Search filter */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
        <input
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Filter by exercise name…"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 py-2 pl-9 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="space-y-1">
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-500">No exercises match the current filter.</p>
          )}
          {filtered.map(ex => {
            const isOpen = expanded === ex.exerciseDbId
            const cands = candidates[ex.exerciseDbId] ?? []

            return (
              <div key={ex.exerciseDbId} className="rounded-lg border border-zinc-800 bg-zinc-900/60">
                <button
                  onClick={() => {
                    if (isOpen) { setExpanded(null); return }
                    setExpanded(ex.exerciseDbId)
                    if (!candidates[ex.exerciseDbId]) {
                      void searchYmove(ex.exerciseDbId, ex.displayName)
                    }
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {STATUS_ICON[ex.status]}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100">{ex.displayName}</p>
                    <p className="text-xs text-zinc-500">
                      ID: {ex.exerciseDbId}
                      {ex.ymoveExerciseId && (
                        <span className="ml-2 font-mono text-green-500/80">{ex.ymoveExerciseId.slice(0, 8)}…</span>
                      )}
                    </p>
                  </div>
                  {isOpen ? <ChevronUp className="size-4 text-zinc-500 shrink-0" /> : <ChevronDown className="size-4 text-zinc-500 shrink-0" />}
                </button>

                {isOpen && (
                  <div className="border-t border-zinc-800 px-4 pb-4 pt-3">
                    {/* Search bar */}
                    <div className="mb-3 flex gap-2">
                      <input
                        defaultValue={ex.displayName}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            void searchYmove(ex.exerciseDbId, (e.target as HTMLInputElement).value)
                          }
                        }}
                        placeholder="Search ymove…"
                        className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                      />
                      <button
                        onClick={e => {
                          const input = (e.currentTarget.previousElementSibling as HTMLInputElement)
                          void searchYmove(ex.exerciseDbId, input.value)
                        }}
                        disabled={searching === ex.exerciseDbId}
                        className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
                      >
                        {searching === ex.exerciseDbId ? 'Searching…' : 'Search'}
                      </button>
                    </div>

                    {/* Candidates */}
                    {cands.length === 0 && searching !== ex.exerciseDbId && (
                      <p className="text-xs text-zinc-500">No results. Try a different search term.</p>
                    )}
                    <div className="space-y-2">
                      {cands.map(c => (
                        <div key={c.ymoveId} className="flex items-center gap-3 rounded-md border border-zinc-700/60 bg-zinc-800/40 px-3 py-2">
                          {/* Thumbnail on-demand preview */}
                          <button
                            onClick={() => setThumbPreview(prev => prev === c.ymoveId ? null : c.ymoveId)}
                            className="flex size-10 shrink-0 items-center justify-center rounded bg-zinc-700 text-xs text-zinc-400 hover:bg-zinc-600"
                            title="Preview thumbnail"
                          >
                            {thumbPreview === c.ymoveId
                              ? <img src={`/api/ymove/thumbnail/${c.ymoveId}?crop=square`} alt={c.name} className="size-10 rounded object-cover" />
                              : <ExternalLink className="size-3.5" />
                            }
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-zinc-100">{c.name}</p>
                            <p className="font-mono text-xs text-zinc-500">{c.ymoveId}</p>
                          </div>
                          <button
                            onClick={() => void saveMapping(ex.exerciseDbId, c.ymoveId)}
                            disabled={saving === ex.exerciseDbId}
                            className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
                          >
                            {saving === ex.exerciseDbId ? 'Saving…' : 'Use this'}
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Mark as no-match */}
                    <div className="mt-3 flex items-center justify-between">
                      <button
                        onClick={() => void saveMapping(ex.exerciseDbId, null)}
                        disabled={saving === ex.exerciseDbId}
                        className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                      >
                        Mark as no ymove match
                      </button>
                      {ex.status !== 'unmapped' && (
                        <button
                          onClick={async () => {
                            setSaving(ex.exerciseDbId)
                            await fetch('/api/admin/ymove-mapping', {
                              method: 'DELETE',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ exerciseDbId: ex.exerciseDbId }),
                            })
                            await load()
                            setSaving(null)
                          }}
                          disabled={saving === ex.exerciseDbId}
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
          })}
        </div>
      )}
    </div>
  )
}
