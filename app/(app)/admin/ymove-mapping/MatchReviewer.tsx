'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, Play, X, RefreshCw,
  CheckCircle, XCircle, SkipForward, AlertTriangle, Eye, EyeOff,
  Search, VideoOff, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MatchSuggestion, ScoredCandidate } from '@/lib/ymove/pipeline'

// ── Types ─────────────────────────────────────────────────────────────────────

type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'overridden'
export type ReviewMode = 'pending' | 'approved' | 'verified'

export interface ReviewerSuggestion extends MatchSuggestion {
  reviewStatus:          ReviewStatus
  currentMappedId:       string | null
  verifiedAt:            string | null
  activeConflictDbId:    string | null
  activeConflictName:    string | null
  suggestedConflictDbIds: string[]
}

interface ConflictInfo {
  existingName:         string
  existingDbId:         string
  pendingYmoveId:       string
  requiresVideo:        boolean   // !videoPlayed — need to see the video first
  requiresConfirmation: boolean   // !ownerConfirmed — need explicit "I verified this"
}

interface DecisionResult {
  type:         'approved' | 'confirmed' | 'rejected' | 'skipped' | 'error'
  exerciseName: string
  verified?:    boolean
  errorMessage?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIDENCE_COLORS = {
  strong:   'bg-green-900/60 text-green-300 border-green-700',
  likely:   'bg-blue-900/60 text-blue-300 border-blue-700',
  possible: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  weak:     'bg-zinc-800 text-zinc-400 border-zinc-700',
}

// ── MatchReviewer ─────────────────────────────────────────────────────────────

interface MatchReviewerProps {
  suggestions: ReviewerSuggestion[]
  onDecision:  () => void
  reviewMode:  ReviewMode
}

export function MatchReviewer({ suggestions, onDecision, reviewMode }: MatchReviewerProps) {
  // Build queue based on the active review mode
  const queue = suggestions.filter(s => {
    if (reviewMode === 'pending') {
      return s.reviewStatus === 'pending' && (s.topMatch || s.otherCandidates.length > 0)
    }
    if (reviewMode === 'verified') {
      return s.verifiedAt !== null && s.currentMappedId !== null
    }
    // approved — any exercise with an active mapping
    return (s.reviewStatus === 'approved' || s.reviewStatus === 'overridden') && s.currentMappedId !== null
  }).sort((a, b) => {
    if (reviewMode === 'pending') {
      const order = { high_confidence: 0, needs_review: 1, unmatched: 2 }
      return order[a.status] - order[b.status]
    }
    return a.displayName.localeCompare(b.displayName)
  })

  const [queueIndex,     setQueueIndex]     = useState(0)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [saving,         setSaving]         = useState(false)
  // videoPlayed = URL loaded and playback started (does NOT mean the owner verified it)
  const [videoPlayed,    setVideoPlayed]    = useState(false)
  // ownerConfirmed = admin explicitly clicked "I verified this movement matches"
  const [ownerConfirmed, setOwnerConfirmed] = useState(false)
  const [conflictInfo,   setConflictInfo]   = useState<ConflictInfo | null>(null)
  const [lastResult,     setLastResult]     = useState<DecisionResult | null>(null)
  const [searchQuery,    setSearchQuery]    = useState('')
  const [searchResults,  setSearchResults]  = useState<ScoredCandidate[] | null>(null)
  const [searching,      setSearching]      = useState(false)
  const [videoSrc,       setVideoSrc]       = useState<string | null>(null)
  const [videoLoading,   setVideoLoading]   = useState(false)
  const [videoError,     setVideoError]     = useState(false)
  const [playing,        setPlaying]        = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const exercise    = queue[queueIndex] ?? null
  const allCandidates: ScoredCandidate[] = exercise
    ? searchResults ?? [
        ...(exercise.topMatch ? [exercise.topMatch] : []),
        ...exercise.otherCandidates,
      ]
    : []
  const candidate = allCandidates[candidateIndex] ?? null
  const total     = queue.length

  // isMappingChange: true when candidate differs from the current active mapping
  const isMappingChange = candidate && exercise?.currentMappedId
    ? candidate.ymoveId !== exercise.currentMappedId
    : false

  // Reset all per-exercise state when the exercise changes
  useEffect(() => {
    setCandidateIndex(0)
    setVideoPlayed(false)
    setOwnerConfirmed(false)
    setConflictInfo(null)
    setLastResult(null)
    setSearchQuery('')
    setSearchResults(null)
    setVideoSrc(null)
    setVideoLoading(false)
    setVideoError(false)
    setPlaying(false)
  }, [queueIndex])

  // Reset video/confirmation state when candidate changes
  useEffect(() => {
    setVideoPlayed(false)
    setOwnerConfirmed(false)
    setVideoSrc(null)
    setVideoLoading(false)
    setVideoError(false)
    setPlaying(false)
    setConflictInfo(null)
  }, [candidateIndex, searchResults])

  // Keyboard navigation (← → for candidates; skip when focused on an input)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setCandidateIndex(i => Math.max(0, i - 1))
      }
      if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setCandidateIndex(i => Math.min(allCandidates.length - 1, i + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allCandidates.length])

  // ── Video loading ─────────────────────────────────────────────────────────
  // Video plays only on explicit Play click. ownerConfirmed is NOT set here —
  // that requires a separate explicit "I verified this" action from the admin.

  async function loadVideo() {
    if (!candidate) return
    if (videoSrc) { setPlaying(true); setVideoPlayed(true); return }
    setVideoLoading(true)
    setVideoError(false)
    try {
      const res = await fetch(`/api/admin/ymove-mapping?preview=${encodeURIComponent(candidate.ymoveId)}`)
      if (res.ok) {
        const data = await res.json() as { videoUrl?: string }
        if (data.videoUrl) {
          setVideoSrc(data.videoUrl)
          setPlaying(true)
          setVideoPlayed(true)
          // ownerConfirmed intentionally NOT set — requires explicit user action
          return
        }
      }
      setVideoError(true)
    } finally {
      setVideoLoading(false)
    }
  }

  // ── Candidate search ──────────────────────────────────────────────────────

  async function runSearch(q: string) {
    if (!q.trim() || !exercise) return
    setSearching(true)
    setSearchResults(null)
    setCandidateIndex(0)
    try {
      const res = await fetch(
        `/api/admin/ymove-mapping?search=${encodeURIComponent(q)}&exerciseId=${exercise.exerciseDbId}&limit=8`,
      )
      if (res.ok) {
        const data = await res.json() as { candidates: ScoredCandidate[] }
        setSearchResults(data.candidates)
      }
    } finally {
      setSearching(false)
    }
  }

  // ── Approval helpers ──────────────────────────────────────────────────────

  async function patchMapping(
    exerciseDbId: string,
    ymoveExerciseId: string | null,
    opts: { forceOverwrite?: boolean; verified?: boolean } = {},
  ): Promise<{ ok: boolean; conflict?: boolean; existingName?: string; existingDbId?: string }> {
    const res = await fetch('/api/admin/ymove-mapping', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        exerciseDbId,
        ymoveExerciseId,
        forceOverwrite: opts.forceOverwrite ?? false,
        verified:       opts.verified ?? false,
      }),
    })
    if (res.status === 409) {
      const data = await res.json() as { existingName?: string; existingDbId?: string }
      return { ok: false, conflict: true, existingName: data.existingName, existingDbId: data.existingDbId }
    }
    return { ok: res.ok }
  }

  function advanceQueue() {
    if (reviewMode === 'pending') {
      // Pending mode: reload parent data after each decision so the item leaves the queue
      if (queueIndex >= total - 1) {
        onDecision()
      } else {
        setQueueIndex(i => Math.min(i, total - 2))
        onDecision()
      }
    } else {
      // Approved/verified mode: advance through the static list; reload at the end
      if (queueIndex < total - 1) {
        setQueueIndex(i => i + 1)
      } else {
        onDecision() // reached end — refresh
      }
    }
  }

  async function handleApprove() {
    if (!exercise || !candidate) return
    setSaving(true)
    setConflictInfo(null)
    try {
      // Only set verified=true when the owner explicitly confirmed the movement
      const result = await patchMapping(exercise.exerciseDbId, candidate.ymoveId, {
        verified: ownerConfirmed,
      })
      if (result.conflict) {
        setConflictInfo({
          existingName:         result.existingName ?? result.existingDbId ?? 'another exercise',
          existingDbId:         result.existingDbId ?? '',
          pendingYmoveId:       candidate.ymoveId,
          requiresVideo:        !videoPlayed,
          requiresConfirmation: !ownerConfirmed,
        })
        return
      }
      if (result.ok) {
        const type = reviewMode === 'pending' ? 'approved' : 'confirmed'
        setLastResult({ type, exerciseName: exercise.displayName, verified: ownerConfirmed })
        advanceQueue()
      } else {
        setLastResult({ type: 'error', exerciseName: exercise.displayName, errorMessage: 'Save failed' })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleForceApprove() {
    if (!exercise || !conflictInfo) return
    // Both video preview AND explicit confirmation required before overriding a duplicate UUID
    if (conflictInfo.requiresVideo || conflictInfo.requiresConfirmation) return
    setSaving(true)
    try {
      const result = await patchMapping(exercise.exerciseDbId, conflictInfo.pendingYmoveId, {
        forceOverwrite: true,
        verified:       ownerConfirmed,
      })
      if (result.ok) {
        setConflictInfo(null)
        setLastResult({
          type:         reviewMode === 'pending' ? 'approved' : 'confirmed',
          exerciseName: exercise.displayName,
          verified:     ownerConfirmed,
        })
        advanceQueue()
      } else {
        setLastResult({ type: 'error', exerciseName: exercise.displayName, errorMessage: 'Save failed' })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleReject() {
    if (!exercise) return
    setSaving(true)
    setConflictInfo(null)
    try {
      const result = await patchMapping(exercise.exerciseDbId, null)
      if (result.ok) {
        setLastResult({ type: 'rejected', exerciseName: exercise.displayName })
        advanceQueue()
      } else {
        setLastResult({ type: 'error', exerciseName: exercise.displayName, errorMessage: 'Save failed' })
      }
    } finally {
      setSaving(false)
    }
  }

  function handleSkip() {
    if (!exercise) return
    setLastResult({ type: 'skipped', exerciseName: exercise.displayName })
    setQueueIndex(i => (i + 1) % Math.max(1, queue.length))
  }

  // ── Empty / done state ────────────────────────────────────────────────────

  if (total === 0) {
    const messages: Record<ReviewMode, { heading: string; sub: string }> = {
      pending:  { heading: 'All pending matches reviewed', sub: 'Switch to "Approved" to inspect existing mappings.' },
      approved: { heading: 'No approved mappings found', sub: 'Run the pipeline and approve some suggestions first.' },
      verified: { heading: 'No visually verified mappings yet', sub: 'Use this mode after confirming movements in the "Approved" queue.' },
    }
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckCircle className="mx-auto mb-3 size-10 text-green-500/60" />
        <p className="text-sm font-medium text-zinc-300">{messages[reviewMode].heading}</p>
        <p className="mt-1 text-xs text-zinc-500">{messages[reviewMode].sub}</p>
      </div>
    )
  }

  const exerciseGifSrc = exercise
    ? `https://cthozkricqchjgciwztx.supabase.co/storage/v1/object/public/exercise-gifs/${exercise.exerciseDbId}.gif`
    : null
  const thumbSrc = candidate
    ? `/api/ymove/thumbnail/${candidate.ymoveId}?crop=square`
    : null

  // Action button label adapts to context
  const approveLabel =
    reviewMode === 'pending'
      ? 'Approve'
      : isMappingChange
        ? 'Replace mapping'
        : 'Confirm mapping'

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-300">
            Exercise <span className="text-zinc-100">{queueIndex + 1}</span>
            <span className="text-zinc-500"> / {total}</span>
          </p>
          {reviewMode === 'pending' && exercise?.status === 'high_confidence' && (
            <span className="rounded border border-green-700 bg-green-900/40 px-1.5 py-0.5 text-[10px] text-green-300">
              High confidence
            </span>
          )}
          {reviewMode === 'pending' && exercise?.status === 'needs_review' && (
            <span className="rounded border border-yellow-700 bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-300">
              Needs review
            </span>
          )}
          {reviewMode !== 'pending' && exercise?.verifiedAt && (
            <span className="flex items-center gap-1 rounded border border-green-700/50 bg-green-900/30 px-1.5 py-0.5 text-[10px] text-green-300">
              <ShieldCheck className="size-3" /> Verified
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setQueueIndex(i => Math.max(0, i - 1))}
            disabled={queueIndex === 0}
            className="flex size-7 items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
            aria-label="Previous exercise"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => setQueueIndex(i => Math.min(total - 1, i + 1))}
            disabled={queueIndex === total - 1}
            className="flex size-7 items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
            aria-label="Next exercise"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Toast feedback */}
      {lastResult && (
        <div className={cn(
          'rounded-lg border px-3 py-2 text-sm flex items-center gap-2',
          lastResult.type === 'approved' || lastResult.type === 'confirmed'
            ? 'border-green-700/50 bg-green-900/20 text-green-300'
            : lastResult.type === 'rejected'  ? 'border-zinc-700 bg-zinc-800/50 text-zinc-400'
            : lastResult.type === 'skipped'   ? 'border-zinc-700 bg-zinc-800/50 text-zinc-500'
            : 'border-red-700/50 bg-red-900/20 text-red-300',
        )}>
          {(lastResult.type === 'approved' || lastResult.type === 'confirmed') && <CheckCircle className="size-4 shrink-0" />}
          {lastResult.type === 'rejected' && <XCircle className="size-4 shrink-0" />}
          {lastResult.type === 'error'    && <AlertTriangle className="size-4 shrink-0" />}
          <span>
            {(lastResult.type === 'approved' || lastResult.type === 'confirmed') && (
              <>
                <strong>{lastResult.exerciseName}</strong>{' '}
                {lastResult.type === 'confirmed' ? 'confirmed' : 'approved'}
                {lastResult.verified
                  ? <span className="ml-1 text-[11px] text-green-400/80">· visually verified</span>
                  : <span className="ml-1 text-[11px] text-zinc-500">· not visually verified</span>
                }
              </>
            )}
            {lastResult.type === 'rejected' && <><strong>{lastResult.exerciseName}</strong> marked no match</>}
            {lastResult.type === 'skipped'  && <><strong>{lastResult.exerciseName}</strong> skipped</>}
            {lastResult.type === 'error'    && <>{lastResult.errorMessage ?? 'Save failed'}</>}
          </span>
          <button onClick={() => setLastResult(null)} className="ml-auto shrink-0 text-current opacity-50 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Main panels — equal-size side-by-side on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">

        {/* ── LEFT: ExerciseDB ───────────────────────────────────────────── */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            ExerciseDB
          </p>

          {/* GIF — fills the panel, capped to keep actions in view */}
          <div className="flex aspect-square w-full max-w-[420px] mx-auto items-center justify-center overflow-hidden rounded-md bg-zinc-800">
            {exerciseGifSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={exerciseGifSrc}
                alt={exercise?.displayName ?? ''}
                className="h-full w-full object-contain"
                loading="lazy"
              />
            ) : (
              <div className="text-zinc-600 text-xs">No GIF</div>
            )}
          </div>

          {/* Metadata */}
          <div className="mt-3 space-y-1">
            <p className="text-base font-semibold text-zinc-100 leading-tight">{exercise?.displayName}</p>
            <p className="font-mono text-xs text-zinc-500">#{exercise?.exerciseDbId}</p>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {exercise?.equipment && exercise.equipment !== 'body weight' && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{exercise.equipment}</span>
              )}
              {exercise?.bodyPart && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{exercise.bodyPart}</span>
              )}
              {exercise?.target && exercise.target !== exercise.bodyPart && (
                <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400">→ {exercise.target}</span>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: YMove Candidate carousel ───────────────────────────── */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              {reviewMode === 'pending' ? 'YMove candidate' : 'YMove mapping'}
            </p>
            <div className="flex items-center gap-2">
              {reviewMode !== 'pending' && candidate && exercise?.currentMappedId && (
                <span className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  isMappingChange
                    ? 'bg-amber-900/40 text-amber-300'
                    : 'bg-zinc-800 text-zinc-500',
                )}>
                  {isMappingChange ? 'replacing current' : 'current mapping'}
                </span>
              )}
              {allCandidates.length > 1 && (
                <span className="text-[11px] text-zinc-500">
                  {candidateIndex + 1} <span className="text-zinc-700">of</span> {allCandidates.length}
                </span>
              )}
            </div>
          </div>

          {candidate ? (
            <>
              {/* Thumbnail / Video — same size as left panel */}
              <div className="relative flex aspect-square w-full max-w-[420px] mx-auto items-center justify-center overflow-hidden rounded-md bg-zinc-800">
                {playing && videoSrc ? (
                  <>
                    <video
                      src={videoSrc}
                      autoPlay
                      loop
                      playsInline
                      controls
                      className="h-full w-full object-contain"
                      aria-label={`${candidate.name} demonstration`}
                    />
                    <button
                      onClick={() => setPlaying(false)}
                      className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-black/60 text-white"
                      aria-label="Close video"
                    >
                      <X className="size-3" />
                    </button>
                  </>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      key={candidate.ymoveId}
                      src={thumbSrc ?? ''}
                      alt={candidate.name}
                      className="h-full w-full object-contain"
                    />
                    {/* Play overlay — hover on desktop, always visible on touch */}
                    <button
                      onClick={loadVideo}
                      disabled={videoLoading}
                      className={cn(
                        'absolute inset-0 flex items-center justify-center',
                        'bg-black/0 hover:bg-black/30 transition-colors group',
                        '[@media(hover:none)]:bg-black/10',
                      )}
                      aria-label={`Play ${candidate.name} video`}
                    >
                      {videoError ? (
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex size-10 items-center justify-center rounded-full bg-black/70">
                            <VideoOff className="size-4 text-white/60" />
                          </div>
                          <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/60">No video</span>
                        </div>
                      ) : (
                        <div className={cn(
                          'flex size-12 items-center justify-center rounded-full bg-white/90 shadow-lg',
                          'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity',
                          videoLoading && 'opacity-100 animate-pulse',
                        )}>
                          {videoLoading
                            ? <RefreshCw className="size-5 text-zinc-700 animate-spin" />
                            : <Play className="size-5 text-zinc-900 fill-zinc-900 ml-0.5" />
                          }
                        </div>
                      )}
                    </button>
                    {/* Video-played indicator (not the same as "verified") */}
                    {videoPlayed && (
                      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-zinc-900/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        <Eye className="size-3" /> Video loaded
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Explicit movement confirmation — only shown after video plays */}
              {videoPlayed && !videoError && (
                <div className="mt-2">
                  <button
                    onClick={() => setOwnerConfirmed(c => !c)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors',
                      ownerConfirmed
                        ? 'border-green-700 bg-green-900/30 text-green-300'
                        : 'border-zinc-600 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
                    )}
                  >
                    {ownerConfirmed
                      ? <ShieldCheck className="size-3.5 shrink-0 text-green-400" />
                      : <div className="size-3.5 shrink-0 rounded border border-zinc-500" />
                    }
                    {ownerConfirmed
                      ? 'Movement verified — I confirmed this matches the exercise'
                      : 'I verified this movement matches the exercise'}
                    {ownerConfirmed && (
                      <span className="ml-auto text-[10px] text-green-500/70">click to undo</span>
                    )}
                  </button>
                </div>
              )}

              {/* Nav arrows */}
              {allCandidates.length > 1 && (
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={() => setCandidateIndex(i => Math.max(0, i - 1))}
                    disabled={candidateIndex === 0}
                    className="flex size-8 items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                    aria-label="Previous candidate"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <div className="flex gap-1">
                    {allCandidates.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCandidateIndex(i)}
                        className={cn(
                          'size-1.5 rounded-full transition-colors',
                          i === candidateIndex ? 'bg-zinc-200' : 'bg-zinc-700 hover:bg-zinc-500',
                        )}
                        aria-label={`Candidate ${i + 1}`}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => setCandidateIndex(i => Math.min(allCandidates.length - 1, i + 1))}
                    disabled={candidateIndex === allCandidates.length - 1}
                    className="flex size-8 items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                    aria-label="Next candidate"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              )}

              {/* Candidate metadata */}
              <div className="mt-3 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {reviewMode === 'pending' && (
                    <span className={cn(
                      'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                      CONFIDENCE_COLORS[candidate.confidence],
                    )}>
                      {candidate.score} · {candidate.confidence}
                    </span>
                  )}
                </div>
                <p className="text-base font-semibold text-zinc-100 leading-tight">{candidate.name}</p>
                <p className="font-mono text-[10px] text-zinc-600">{candidate.ymoveId}</p>
                {reviewMode === 'pending' && (candidate.matchReasons.length > 0 || candidate.penaltyReasons.length > 0) && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {candidate.matchReasons.map(r => (
                      <span key={r} className="rounded bg-green-900/30 px-1 py-0.5 text-[10px] text-green-400">✓ {r}</span>
                    ))}
                    {candidate.penaltyReasons.map(r => (
                      <span key={r} className="rounded bg-red-900/30 px-1 py-0.5 text-[10px] text-red-400">✗ {r}</span>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex aspect-square w-full max-w-[420px] mx-auto items-center justify-center rounded-md bg-zinc-800">
              <p className="text-xs text-zinc-500">No candidates</p>
            </div>
          )}

          {/* Search for alternative candidates */}
          <div className="mt-3 flex gap-1.5">
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void runSearch(searchQuery) }}
              placeholder="Search YMove…"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
            <button
              onClick={() => void runSearch(searchQuery)}
              disabled={searching || !searchQuery.trim()}
              className="flex items-center gap-1 rounded-md bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
            >
              {searching ? <RefreshCw className="size-3 animate-spin" /> : <Search className="size-3" />}
            </button>
            {searchResults && (
              <button
                onClick={() => { setSearchResults(null); setSearchQuery(''); setCandidateIndex(0) }}
                className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                title="Clear search"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Conflict resolution banner */}
      {conflictInfo && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-900/20 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-amber-300">
                This YMove video is already mapped to: <strong>{conflictInfo.existingName}</strong>
              </p>
              <p className="mt-0.5 text-xs text-amber-400/80">
                Both exercises would share the same YMove video demonstration.
              </p>
              <div className="mt-1.5 flex flex-col gap-1">
                {conflictInfo.requiresVideo && (
                  <p className="flex items-center gap-1 text-xs text-amber-500">
                    <EyeOff className="size-3 shrink-0" />
                    Step 1: Play the video above to preview it first.
                  </p>
                )}
                {!conflictInfo.requiresVideo && conflictInfo.requiresConfirmation && (
                  <p className="flex items-center gap-1 text-xs text-amber-500">
                    <ShieldCheck className="size-3 shrink-0" />
                    Step 2: Confirm the movement matches using the button above.
                  </p>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleForceApprove}
                  disabled={saving || conflictInfo.requiresVideo || conflictInfo.requiresConfirmation}
                  className="rounded bg-amber-700 px-2.5 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    conflictInfo.requiresVideo
                      ? 'Watch the video first'
                      : conflictInfo.requiresConfirmation
                        ? 'Confirm the movement match above first'
                        : undefined
                  }
                >
                  Override and map anyway
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

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <button
          onClick={handleApprove}
          disabled={saving || !candidate}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white',
            'bg-green-700 hover:bg-green-600 disabled:opacity-50',
          )}
        >
          <CheckCircle className="size-4" />
          {saving ? 'Saving…' : approveLabel}
          {ownerConfirmed && !saving && (
            <span className="ml-1 rounded bg-green-600/50 px-1 py-0.5 text-[10px]">verified</span>
          )}
        </button>

        <button
          onClick={handleReject}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
        >
          <XCircle className="size-4" />
          {reviewMode === 'pending' ? 'No match' : 'Reject mapping'}
        </button>

        <button
          onClick={handleSkip}
          disabled={saving || total <= 1}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
        >
          <SkipForward className="size-4" />
          Skip
        </button>

        {/* Verification status indicator */}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-zinc-600">
          {ownerConfirmed
            ? <>
                <ShieldCheck className="size-3 text-green-500/70" />
                <span className="text-green-500/70">Confirmed · will save as verified</span>
              </>
            : videoPlayed
              ? <>
                  <Eye className="size-3 text-zinc-500" />
                  <span>Video loaded · confirm movement above to verify</span>
                </>
              : <>
                  <EyeOff className="size-3" />
                  <span>No video yet</span>
                </>
          }
        </div>
      </div>

      {/* Keyboard hint */}
      {allCandidates.length > 1 && (
        <p className="text-center text-[10px] text-zinc-700">
          ← → to navigate candidates · no shortcut hijack when typing
        </p>
      )}
    </div>
  )
}
