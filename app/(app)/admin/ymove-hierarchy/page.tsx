'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, ChevronDown, ChevronRight, Play, AlertTriangle,
  CheckCircle, Shield, Layers, Eye, RefreshCw, VideoOff, Info,
  StopCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FamilyEntry {
  id:           string
  count:        number
  highPriority: number
  review:       number
}

interface ScoredMatch {
  ymoveId:          string
  name:             string
  score:            number
  tier:             string
  signals:          Record<string, number>
  hardBlock:        string | null
  matchReasons:     string[]
  penaltyReasons:   string[]
  thumbnailMediaId: string | null
}

interface ProtectedMapping {
  ymoveId:          string
  verifiedAt:       string | null
  source:           string
  sharedWithDbIds:  string[]
  thumbnailMediaId: string | null   // resolved from DB by API, not the top suggestion's thumbnail
}

interface HierarchyExercise {
  exerciseDbId:     string
  name:             string
  equipment:        string
  equipmentFamily:  string | null
  canonicalId:      string
  canonicalName:    string
  movementFamilyId: string
  technicalPattern: string | null
  movementClass:    string
  movementSubclass: string | null
  protected:        ProtectedMapping | null
  misclassified:    { reason: string; canonicalCorrectionSuggested: string | null } | null
  protectedConflict: { conflictingYmoveId: string; conflictingDbId: string } | null
  topSuggestion:    ScoredMatch | null
  otherSuggestions: ScoredMatch[]
  tier:             string
}

interface HierarchyL2Node {
  canonicalId:      string
  canonicalName:    string
  movementFamilyId: string
  equipmentFamily:  string | null
  exercises:        HierarchyExercise[]
  l2Tier:           string
}

interface HierarchyResponse {
  ready:        boolean
  message?:     string
  generatedAt?: string
  summary?:     Record<string, number>
  metadata?:    Record<string, number>
  families?:    FamilyEntry[]
  l2Nodes?:     HierarchyL2Node[]
  totalNodes?:  number
  page?:        number
  limit?:       number
}

interface VideoPreviewResponse {
  videoUrl?:          string | null
  videoHlsUrl?:       string | null
  videoDurationSecs?: number | null
  error?:             string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  high_priority: 'bg-green-900/60 text-green-300 border-green-700',
  review:        'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  weak:          'bg-zinc-800 text-zinc-400 border-zinc-600',
  unmatched:     'bg-zinc-900 text-zinc-600 border-zinc-800',
  protected:     'bg-emerald-900/60 text-emerald-300 border-emerald-700',
}

const TIER_LABELS: Record<string, string> = {
  high_priority: 'High priority',
  review:        'Review',
  weak:          'Weak',
  unmatched:     'Unmatched',
  protected:     'Protected',
}

function familyLabel(id: string): string {
  const MAP: Record<string, string> = {
    fam_arms: 'Arms', fam_chest: 'Chest', fam_back: 'Back',
    fam_shoulders: 'Shoulders', fam_legs: 'Legs', fam_core: 'Core',
    fam_cardio: 'Cardio', fam_mobility: 'Mobility', fam_squat: 'Squat',
    fam_hinge: 'Hinge', fam_press: 'Press', fam_pull: 'Pull',
    fam_full_body: 'Full Body',
  }
  return MAP[id] ?? id.replace(/^fam_/, '').replace(/_/g, ' ')
}

// ── MediaCell: idle → thumbnail → video (on demand, fresh per-play) ───────────

function MediaCell({
  mediaId,
  ymoveId,
  name,
  size = 'md',
}: {
  mediaId: string | null
  ymoveId: string
  name:    string
  size?:   'sm' | 'md'
}) {
  const [phase,    setPhase]    = useState<'idle' | 'thumb' | 'loading-video' | 'playing' | 'no-video'>('idle')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const dim = size === 'sm' ? 'size-10' : 'size-14'

  async function loadVideo() {
    setPhase('loading-video')
    setVideoUrl(null)
    try {
      const res  = await fetch(`/api/admin/ymove-mapping?preview=${encodeURIComponent(ymoveId)}`)
      const data = await res.json() as VideoPreviewResponse
      if (data.videoUrl) {
        setVideoUrl(data.videoUrl)
        setPhase('playing')
      } else {
        setPhase('no-video')
      }
    } catch {
      setPhase('no-video')
    }
  }

  if (phase === 'idle') {
    if (!mediaId) {
      return (
        <div className={cn(
          'flex shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-700',
          dim,
        )}>
          <VideoOff className="size-3" />
        </div>
      )
    }
    return (
      <button
        onClick={() => setPhase('thumb')}
        title="Load thumbnail"
        className={cn(
          'flex shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300',
          dim,
        )}
      >
        <Play className="size-3" />
      </button>
    )
  }

  if (phase === 'thumb') {
    return (
      <div className={cn('relative shrink-0', dim)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/ymove/thumbnail/${mediaId}?crop=square`}
          alt={name}
          className="h-full w-full rounded object-cover"
        />
        <button
          onClick={() => void loadVideo()}
          className="absolute inset-0 flex items-center justify-center rounded bg-black/40 opacity-0 transition-opacity hover:opacity-100"
          title="Play video (uses YMove quota)"
        >
          <Play className="size-4 fill-white text-white" />
        </button>
      </div>
    )
  }

  if (phase === 'loading-video') {
    return (
      <div className={cn(
        'flex shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-800',
        dim,
      )}>
        <RefreshCw className="size-3 animate-spin text-zinc-500" />
      </div>
    )
  }

  if (phase === 'playing' && videoUrl) {
    return (
      <div className={cn('relative shrink-0', dim)}>
        <video
          src={videoUrl}
          autoPlay loop playsInline muted
          className="h-full w-full rounded object-cover"
        />
        <button
          onClick={() => setPhase('thumb')}
          className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-400"
          title="Stop"
        >
          <StopCircle className="size-2.5" />
        </button>
      </div>
    )
  }

  // no-video
  return (
    <div className={cn(
      'flex shrink-0 flex-col items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-700',
      dim,
    )}>
      <VideoOff className="size-3" />
      <span className="mt-0.5 text-[8px]">no video</span>
    </div>
  )
}

// ── Suggestion card ───────────────────────────────────────────────────────────

function SuggestionCard({ match, rank }: { match: ScoredMatch; rank: number }) {
  return (
    <div className={cn(
      'flex items-start gap-2.5 rounded-lg border px-2.5 py-2',
      rank === 1
        ? 'border-zinc-700/80 bg-zinc-800/60'
        : 'border-zinc-800/60 bg-zinc-900/40',
    )}>
      <MediaCell mediaId={match.thumbnailMediaId} ymoveId={match.ymoveId} name={match.name} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn(
            'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
            TIER_COLORS[match.tier] ?? TIER_COLORS.unmatched,
          )}>
            {match.score} · {TIER_LABELS[match.tier] ?? match.tier}
          </span>
          {rank === 1 && <span className="text-[10px] text-zinc-500">top candidate</span>}
          {rank > 1  && <span className="text-[10px] text-zinc-600">alt #{rank}</span>}
        </div>

        <p className="mt-0.5 text-sm leading-tight text-zinc-200">{match.name}</p>
        <p className="font-mono text-[10px] text-zinc-600">{match.ymoveId.slice(0, 8)}…</p>

        <div className="mt-1 text-[10px] text-zinc-600">
          eq:{match.signals.equipment ?? 0} mv:{match.signals.movement ?? 0} ms:{match.signals.muscle ?? 0} nm:{match.signals.name ?? 0} vr:{match.signals.variation ?? 0}
        </div>

        {(match.matchReasons.length > 0 || match.penaltyReasons.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {match.matchReasons.map(r => (
              <span key={r} className="rounded bg-green-900/30 px-1 py-0.5 text-[10px] text-green-400">✓ {r}</span>
            ))}
            {match.penaltyReasons.map(r => (
              <span key={r} className="rounded bg-red-900/30 px-1 py-0.5 text-[10px] text-red-400">✗ {r}</span>
            ))}
          </div>
        )}

        {match.hardBlock && (
          <p className="mt-1 text-[10px] text-red-400">Hard-blocked: {match.hardBlock}</p>
        )}
      </div>
    </div>
  )
}

// ── Exercise card ─────────────────────────────────────────────────────────────

function ExerciseCard({ ex }: { ex: HierarchyExercise }) {
  const [expanded, setExpanded] = useState(false)

  // Protected status is authoritative: show verified/mapped regardless of pipeline tier.
  const isProtected  = !!ex.protected
  const isVerified   = isProtected && !!ex.protected!.verifiedAt
  const isUnverified = isProtected && !ex.protected!.verifiedAt

  const top       = ex.topSuggestion
  const hasOthers = ex.otherSuggestions.length > 0

  const borderCls =
    ex.misclassified        ? 'border-purple-700/60 bg-purple-900/10'   :
    ex.protectedConflict    ? 'border-amber-700/50 bg-amber-900/10'     :
    isVerified              ? 'border-emerald-700/50 bg-emerald-900/10' :
    isUnverified            ? 'border-blue-700/40 bg-blue-900/5'        :
    ex.tier === 'high_priority' ? 'border-green-800/40 bg-green-900/10' :
    ex.tier === 'review'        ? 'border-yellow-800/30 bg-yellow-900/5' :
    'border-zinc-800 bg-zinc-900/20'

  // Use the catalog-resolved thumbnailMediaId for the protected mapping itself.
  // This is injected server-side from the YMove catalog DB, not from the top suggestion.
  const protectedMediaId = ex.protected?.thumbnailMediaId ?? null

  return (
    <div className={cn('rounded-lg border', borderCls)}>
      <button
        onClick={() => setExpanded(p => !p)}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <div className="mt-1 shrink-0">
          {expanded
            ? <ChevronDown className="size-3.5 text-zinc-500" />
            : <ChevronRight className="size-3.5 text-zinc-500" />
          }
        </div>

        {/* Collapsed inline media */}
        {!expanded && isProtected && ex.protected && (
          <MediaCell
            mediaId={protectedMediaId}
            ymoveId={ex.protected.ymoveId}
            name={ex.name}
            size="sm"
          />
        )}
        {!expanded && !isProtected && top && (
          <MediaCell mediaId={top.thumbnailMediaId} ymoveId={top.ymoveId} name={top.name} size="sm" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-zinc-100">{ex.name}</span>

            {/* Status badges — protected is always shown, overrides pipeline tier */}
            {isVerified && (
              <span className="flex items-center gap-0.5 rounded border border-emerald-700/60 bg-emerald-900/30 px-1.5 py-0.5 text-[10px] text-emerald-300">
                <Eye className="size-2.5" /> Verified
              </span>
            )}
            {isUnverified && (
              <span className="flex items-center gap-0.5 rounded border border-blue-700/60 bg-blue-900/30 px-1.5 py-0.5 text-[10px] text-blue-300">
                <CheckCircle className="size-2.5" /> Mapped
              </span>
            )}
            {!isProtected && ex.tier && ex.tier !== 'unmatched' && (
              <span className={cn(
                'rounded border px-1.5 py-0.5 text-[10px]',
                TIER_COLORS[ex.tier] ?? TIER_COLORS.unmatched,
              )}>
                {TIER_LABELS[ex.tier] ?? ex.tier}
              </span>
            )}
            {ex.misclassified && (
              <span className="rounded border border-purple-700/60 bg-purple-900/30 px-1.5 py-0.5 text-[10px] text-purple-300">
                Misclassified
              </span>
            )}
            {ex.protectedConflict && (
              <span className="flex items-center gap-0.5 rounded border border-amber-700/60 bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                <AlertTriangle className="size-2.5" /> Conflict
              </span>
            )}
          </div>

          <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-zinc-500">
            <span className="font-mono text-[10px]">{ex.exerciseDbId}</span>
            {ex.equipment && <span className="rounded bg-zinc-800 px-1">{ex.equipment}</span>}
            {ex.movementClass && ex.movementClass !== 'unknown' && (
              <span>{ex.movementClass.replace(/_/g, ' ')}</span>
            )}
          </div>

          {/* Collapsed summary */}
          {!expanded && isProtected && ex.protected && (
            <p className="mt-1 font-mono text-[11px] text-emerald-500/80">
              ↳ {ex.protected.ymoveId.slice(0, 8)}…
              {isVerified && ex.protected.verifiedAt && (
                <span className="ml-1 text-zinc-500">
                  {new Date(ex.protected.verifiedAt).toLocaleDateString()}
                </span>
              )}
              {isUnverified && <span className="ml-1 text-blue-400/70">pending verification</span>}
            </p>
          )}
          {!expanded && !isProtected && top && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className={cn(
                'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                TIER_COLORS[top.tier] ?? TIER_COLORS.unmatched,
              )}>
                {top.score}
              </span>
              <span className="truncate text-xs text-zinc-400">{top.name}</span>
              {hasOthers && (
                <span className="shrink-0 text-[10px] text-zinc-600">+{ex.otherSuggestions.length} alt</span>
              )}
            </div>
          )}
          {!expanded && !isProtected && !top && (
            <p className="mt-1 text-xs text-zinc-600">No candidates</p>
          )}
        </div>
      </button>

      {/* ── Expanded detail ───────────────────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-zinc-800/60 px-3 pb-3 pt-2.5 space-y-3">
          {/* Attribute chips */}
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-zinc-300">
              {ex.equipment}
            </span>
            {ex.technicalPattern && (
              <span className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-zinc-300">
                {ex.technicalPattern.replace(/_/g, ' ')}
              </span>
            )}
            <span className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-zinc-400">
              {ex.canonicalName}
            </span>
          </div>

          {/* Misclassification warning */}
          {ex.misclassified && (
            <div className="flex items-start gap-2 rounded border border-purple-700/50 bg-purple-900/20 px-2.5 py-2">
              <Info className="mt-0.5 size-3.5 shrink-0 text-purple-400" />
              <div className="text-xs">
                <p className="text-purple-300">{ex.misclassified.reason}</p>
                {ex.misclassified.canonicalCorrectionSuggested && (
                  <p className="mt-0.5 text-purple-400/80">
                    Suggestion: {ex.misclassified.canonicalCorrectionSuggested}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Protected conflict warning */}
          {ex.protectedConflict && (
            <div className="flex items-start gap-2 rounded border border-amber-700/50 bg-amber-900/20 px-2.5 py-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
              <p className="text-xs text-amber-300">
                Conflicts with mapping on #{ex.protectedConflict.conflictingDbId}
                {' '}(YMove: {ex.protectedConflict.conflictingYmoveId.slice(0, 8)}…)
              </p>
            </div>
          )}

          {/* Verified mapping panel */}
          {isVerified && ex.protected && (
            <div className="flex items-start gap-2.5 rounded border border-emerald-700/50 bg-emerald-900/20 px-2.5 py-2">
              <Eye className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-emerald-300">Verified mapping</p>
                <div className="mt-1.5 flex items-start gap-2">
                  <MediaCell
                    mediaId={protectedMediaId}
                    ymoveId={ex.protected.ymoveId}
                    name={ex.name}
                    size="md"
                  />
                  <div className="min-w-0 text-xs">
                    <p className="break-all font-mono text-emerald-400">{ex.protected.ymoveId}</p>
                    <p className="text-emerald-500/80">
                      Verified {new Date(ex.protected.verifiedAt!).toLocaleString()}
                    </p>
                    {ex.protected.sharedWithDbIds.length > 0 && (
                      <p className="text-emerald-600/80">
                        Shared: #{ex.protected.sharedWithDbIds.join(', #')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Unverified mapping panel */}
          {isUnverified && ex.protected && (
            <div className="flex items-start gap-2.5 rounded border border-blue-700/40 bg-blue-900/10 px-2.5 py-2">
              <CheckCircle className="mt-0.5 size-3.5 shrink-0 text-blue-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-blue-300">Mapped — pending verification</p>
                <div className="mt-1.5 flex items-start gap-2">
                  <MediaCell
                    mediaId={protectedMediaId}
                    ymoveId={ex.protected.ymoveId}
                    name={ex.name}
                    size="md"
                  />
                  <div className="min-w-0 text-xs">
                    <p className="break-all font-mono text-blue-400">{ex.protected.ymoveId}</p>
                    <p className="text-blue-500/70">source: {ex.protected.source}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Top candidate */}
          {top && <SuggestionCard match={top} rank={1} />}

          {/* Alternate candidates — collapsible */}
          {hasOthers && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                {ex.otherSuggestions.length} alternate candidate{ex.otherSuggestions.length !== 1 ? 's' : ''}
              </summary>
              <div className="mt-1.5 space-y-1.5">
                {ex.otherSuggestions.map((s, i) => (
                  <SuggestionCard key={s.ymoveId} match={s} rank={i + 2} />
                ))}
              </div>
            </details>
          )}

          {!top && !isProtected && (
            <p className="py-2 text-center text-xs text-zinc-600">No YMove candidates found.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── L2 node accordion ─────────────────────────────────────────────────────────

function L2NodeCard({ node }: { node: HierarchyL2Node }) {
  const [open, setOpen] = useState(false)

  const highCount     = node.exercises.filter(e => !e.protected && e.topSuggestion?.tier === 'high_priority').length
  const reviewCount   = node.exercises.filter(e => !e.protected && e.topSuggestion?.tier === 'review').length
  const verifiedCount = node.exercises.filter(e => e.protected?.verifiedAt).length
  const mappedCount   = node.exercises.filter(e => e.protected && !e.protected.verifiedAt).length
  const conflictCount = node.exercises.filter(e => e.protectedConflict).length

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <button
        onClick={() => setOpen(p => !p)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {open
          ? <ChevronDown className="size-4 shrink-0 text-zinc-500" />
          : <ChevronRight className="size-4 shrink-0 text-zinc-500" />
        }
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">{node.canonicalName}</span>
            {node.equipmentFamily && (
              <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">
                {node.equipmentFamily}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-zinc-500">
            <span className="font-mono text-[10px] text-zinc-600">{node.canonicalId}</span>
            <span>{node.exercises.length} ex</span>
            {highCount > 0    && <span className="text-green-400">{highCount} high-pri</span>}
            {reviewCount > 0  && <span className="text-yellow-400">{reviewCount} review</span>}
            {verifiedCount > 0 && <span className="text-emerald-400">✓ {verifiedCount} verified</span>}
            {mappedCount > 0  && <span className="text-blue-400">{mappedCount} mapped</span>}
            {conflictCount > 0 && <span className="text-amber-400">⚠ {conflictCount} conflict</span>}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-3 pb-3 pt-2 space-y-1.5">
          {node.exercises.map(ex => (
            <ExerciseCard key={ex.exerciseDbId} ex={ex} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Data hook ─────────────────────────────────────────────────────────────────

function useHierarchy(family: string, search: string, tier: string, page: number) {
  const [data,    setData]    = useState<HierarchyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ page: String(page), limit: '50' })
      if (family)         p.set('family', family)
      if (search)         p.set('search', search)
      if (tier !== 'all') p.set('tier', tier)
      const res = await fetch(`/api/admin/ymove-hierarchy?${p}`)
      if (!res.ok) {
        setError(res.status === 403 ? 'Access denied.' : 'Failed to load hierarchy data.')
        return
      }
      setData(await res.json() as HierarchyResponse)
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }, [family, search, tier, page])

  useEffect(() => { void load() }, [load])

  return { data, loading, error, reload: load }
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TIER_FILTERS = [
  { key: 'all',           label: 'All'          },
  { key: 'high_priority', label: 'High Priority' },
  { key: 'review',        label: 'Review'       },
  { key: 'weak',          label: 'Weak'         },
  { key: 'unmatched',     label: 'Unmatched'    },
  { key: 'protected',     label: 'Protected'    },
]

export default function YMoveHierarchyPage() {
  const [family,          setFamily]          = useState('')
  const [search,          setSearch]          = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [tier,            setTier]            = useState('all')
  const [page,            setPage]            = useState(1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data, loading, error, reload } = useHierarchy(family, debouncedSearch, tier, page)

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setPage(1)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedSearch(val), 350)
  }

  const selectFamily = (id: string) => { setFamily(id === family ? '' : id); setPage(1) }
  const selectTier   = (t: string)  => { setTier(t); setPage(1) }

  const families = data?.families  ?? []
  const nodes    = data?.l2Nodes   ?? []
  const total    = data?.totalNodes ?? 0
  const limit    = data?.limit ?? 50
  const hasMore  = page * limit < total

  return (
    <div className="mx-auto max-w-4xl px-3 py-6 space-y-5 sm:px-6 sm:py-8">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Layers className="mt-0.5 size-5 shrink-0 text-emerald-500" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-zinc-100">Hierarchy Review</h1>
          <p className="text-xs text-zinc-400">
            V3 pipeline
            {data?.summary && (
              <> · {data.summary.l2NodesTotal} nodes · {data.summary.exercisesInL2Nodes} exercises</>
            )}
            {data?.generatedAt && (
              <> · {new Date(data.generatedAt).toLocaleString()}</>
            )}
          </p>
        </div>
        <button
          onClick={() => void reload()}
          className="shrink-0 rounded-md border border-zinc-700 p-1.5 text-zinc-400 hover:text-zinc-200"
          title="Refresh"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Read-only notice */}
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2">
        <Shield className="size-3.5 shrink-0 text-zinc-600" />
        <p className="text-xs text-zinc-500">
          Read-only. No approval or rejection actions are available on this page.
        </p>
      </div>

      {/* Not-ready state */}
      {data && !data.ready && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-6 py-10 text-center">
          <Layers className="mx-auto mb-3 size-8 text-zinc-600" />
          <p className="text-sm font-medium text-zinc-300">Pipeline output not found</p>
          <code className="mt-2 block rounded bg-zinc-800 px-3 py-2 text-xs text-zinc-300">
            npx tsx scripts/ymove-hierarchy-pipeline.ts
          </code>
          {data.message && <p className="mt-3 text-xs text-zinc-600">{data.message}</p>}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {data?.ready && (
        <>
          {/* Summary stats */}
          {data.summary && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'High Priority', key: 'highPriority',          color: 'text-green-400'   },
                { label: 'Review',        key: 'review',                color: 'text-yellow-400'  },
                { label: 'Verified',      key: 'protected',             color: 'text-emerald-400' },
                { label: 'Conflicts',     key: 'conflictsWithProtected', color: 'text-amber-400'  },
              ].map(stat => (
                <div key={stat.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 py-2.5 text-center">
                  <p className={cn('text-xl font-semibold tabular-nums', stat.color)}>
                    {data.summary![stat.key] ?? 0}
                  </p>
                  <p className="text-[11px] text-zinc-500">{stat.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* L1 family nav */}
          {families.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Movement Family
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => selectFamily('')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs transition-colors',
                    !family
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
                  )}
                >
                  All
                </button>
                {families.map(f => (
                  <button
                    key={f.id}
                    onClick={() => selectFamily(f.id)}
                    className={cn(
                      'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
                      family === f.id
                        ? 'bg-zinc-700 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
                    )}
                  >
                    {familyLabel(f.id)}
                    {f.highPriority > 0 && (
                      <span className="rounded-full bg-green-900/60 px-1 text-[9px] text-green-300">
                        {f.highPriority}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5">
            <Search className="size-3.5 shrink-0 text-zinc-500" />
            <input
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search exercises or catalog entries…"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
          </div>

          {/* Tier filter */}
          <div className="flex flex-wrap gap-1">
            {TIER_FILTERS.map(t => (
              <button
                key={t.key}
                onClick={() => selectTier(t.key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs transition-colors',
                  tier === t.key
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Result count */}
          <p className="text-[11px] text-zinc-600">
            {total} L2 node{total !== 1 ? 's' : ''}
            {data.metadata && (
              <> · {data.metadata.exdbTotal} ExerciseDB · {data.metadata.catalogSize} YMove catalog</>
            )}
          </p>

          {/* Node list */}
          {loading ? (
            <p className="py-10 text-center text-sm text-zinc-500">Loading…</p>
          ) : nodes.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              No results for the current filters.
            </p>
          ) : (
            <div className="space-y-2">
              {nodes.map(node => <L2NodeCard key={node.canonicalId} node={node} />)}
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-30"
            >
              ← Previous
            </button>
            <span className="text-xs text-zinc-500">
              Page {page} · {nodes.length} / {total}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMore}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
