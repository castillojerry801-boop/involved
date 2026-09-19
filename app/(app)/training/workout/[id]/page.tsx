'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, CheckCircle2, Circle, Loader2, Trophy, ChevronDown, ChevronUp,
  Plus, Dumbbell, MessageSquare, Trash2, Timer, X, Scissors, Shuffle,
} from 'lucide-react'
import { getGifUrl, isCustomExerciseId } from '@/lib/exercises'
import { cn } from '@/lib/utils'
import { useWeightUnit } from '@/lib/hooks/use-weight-unit'
import { VoiceMic } from '@/components/v/VoiceMic'
import { ShortenModal } from '@/components/v/ShortenModal'
import RestTimer from '@/components/training/RestTimer'
import ExercisePicker from '@/components/training/ExercisePicker'
import type { ExerciseMeta } from '@/lib/exercises'

// Fire-and-forget behavioral signal — never blocks the workout UI
function recordBehaviorEvent(
  exerciseId: string,
  event: string,
  opts?: { workoutId?: string; programId?: string; replacedBy?: string }
) {
  void fetch(`/api/training/exercises/${encodeURIComponent(exerciseId)}/behavior`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, ...opts }),
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

type TrackingType = 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals'

interface SetData {
  id: string
  setNumber: number
  setType: string
  targetReps: number | null
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetWeightKg: number | null
  targetDurationSeconds: number | null
  actualReps: number | null
  actualWeightKg: number | null
  actualDurationSeconds: number | null
  rpe: number | null
  rir: number | null
  completed: boolean
}

interface PreviousSetSummary {
  setNumber: number
  setType: string
  actualReps: number | null
  actualWeightKg: number | null
  actualDurationSeconds: number | null
  actualDistanceM: number | null
  rpe: number | null
  rir: number | null
}

interface PreviousSession {
  completedAt: string
  notes: string | null
  sets: PreviousSetSummary[]
}

interface ExerciseData {
  id: string
  exerciseId: string
  order: number
  notes: string | null
  targetSets: number | null
  trackingType: TrackingType
  restSeconds: number | null
  sets: SetData[]
  exercise: { id: string; name: string; bodyPart: string; equipment: string; target: string } | null
  previousSession: PreviousSession | null
}

interface WorkoutData {
  id: string
  title: string
  status: 'planned' | 'in_progress' | 'completed' | 'skipped'
  scheduledDate: string | null
  startedAt: string | null
  completedAt: string | null
  durationSeconds: number | null
  durationTargetMinutes: number | null
  notes: string | null
  exercises: ExerciseData[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBlankSet(setNumber: number, id: string): SetData {
  return {
    id, setNumber, setType: 'working',
    targetReps: null, targetRepsMin: null, targetRepsMax: null,
    targetWeightKg: null, targetDurationSeconds: null,
    actualReps: null, actualWeightKg: null, actualDurationSeconds: null,
    rpe: null, rir: null, completed: false,
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
}

function formatSetSummary(s: PreviousSetSummary, tracking: TrackingType) {
  const parts: string[] = []
  if ((tracking === 'strength' || tracking === 'assisted' || tracking === 'carry') && s.actualWeightKg != null)
    parts.push(`${s.actualWeightKg}kg`)
  if ((tracking === 'strength' || tracking === 'bodyweight' || tracking === 'assisted') && s.actualReps != null)
    parts.push(`× ${s.actualReps}`)
  if ((tracking === 'cardio' || tracking === 'isometric' || tracking === 'intervals') && s.actualDurationSeconds != null)
    parts.push(`${s.actualDurationSeconds}s`)
  return parts.join(' ') || '—'
}

// ─── PR badges ────────────────────────────────────────────────────────────────

function PRBadges({ prs }: { prs: Record<string, boolean> }) {
  const labels: string[] = []
  if (prs.weight) labels.push('Weight PR')
  if (prs.estimated1rm) labels.push('1RM PR')
  if (prs.volume) labels.push('Volume PR')
  if (prs.reps) labels.push('Rep PR')
  if (!labels.length) return null
  return (
    <span className="ml-1 flex items-center gap-0.5 text-[10px] font-bold text-amber-500">
      <Trophy className="size-3" /> {labels[0]}
    </span>
  )
}

// ─── Set row ──────────────────────────────────────────────────────────────────

function SetRow({
  set, exerciseId, workoutId, onComplete, trackingType, exerciseName,
}: {
  set: SetData
  exerciseId: string
  workoutId: string
  onComplete: (setId: string, updates: Partial<SetData> & { completed: boolean }) => void
  trackingType: TrackingType
  exerciseName?: string
}) {
  const showWeight = trackingType === 'strength' || trackingType === 'assisted' || trackingType === 'carry'
  const showReps = trackingType === 'strength' || trackingType === 'bodyweight' || trackingType === 'assisted'
  const showDuration = trackingType === 'cardio' || trackingType === 'carry' || trackingType === 'isometric' || trackingType === 'intervals'

  const targetRepsDisplay = set.targetRepsMin
    ? set.targetRepsMax ? `${set.targetRepsMin}–${set.targetRepsMax}` : String(set.targetRepsMin)
    : set.targetReps ? String(set.targetReps) : ''

  const { unit, toDisplay, fromInput } = useWeightUnit()
  const [reps, setReps] = useState(String(set.actualReps ?? ''))
  const [weight, setWeight] = useState(() => toDisplay(set.actualWeightKg) || '')
  const [duration, setDuration] = useState(String(set.actualDurationSeconds ?? ''))
  const [rpe, setRpe] = useState(String(set.rpe ?? ''))
  const [rir, setRir] = useState(String(set.rir ?? ''))
  const [showEffort, setShowEffort] = useState(false)
  const [saving, setSaving] = useState(false)
  const [prs, setPrs] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState(set.completed)

  const handleComplete = async () => {
    if (done) return
    const parsedReps = parseInt(reps)
    const parsedWeight = parseFloat(weight)
    const parsedDuration = parseInt(duration)
    const hasValue = (showReps && parsedReps > 0) || (showDuration && parsedDuration > 0)
    if (!hasValue) return

    setSaving(true)
    try {
      const bodyData: Record<string, unknown> = {
        completed: true,
        setType: set.setType,
      }
      if (showReps && parsedReps > 0) bodyData.actualReps = parsedReps
      if (showWeight && parsedWeight > 0) bodyData.actualWeightKg = fromInput(String(parsedWeight)) ?? parsedWeight
      if (showDuration && parsedDuration > 0) bodyData.actualDurationSeconds = parsedDuration
      if (rpe && parseInt(rpe) > 0) bodyData.rpe = parseInt(rpe)
      if (rir && parseInt(rir) >= 0) bodyData.rir = parseInt(rir)

      let data: { set: SetData; newPR?: boolean; prs?: Record<string, boolean> }

      if (set.id.startsWith('pending-')) {
        const res = await fetch(`/api/workouts/${workoutId}/sets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workoutExerciseId: exerciseId, setNumber: set.setNumber, ...bodyData }),
        })
        data = await res.json()
      } else {
        const res = await fetch(`/api/workouts/${workoutId}/sets/${set.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyData),
        })
        data = await res.json()
      }

      if (data.prs && Object.keys(data.prs).length > 0) setPrs(data.prs)
      else if (data.newPR) setPrs({ weight: true })

      setDone(true)
      onComplete(set.id, {
        actualReps: (showReps && parsedReps > 0) ? parsedReps : undefined,
        actualWeightKg: (showWeight && parsedWeight > 0) ? parsedWeight : undefined,
        actualDurationSeconds: (showDuration && parsedDuration > 0) ? parsedDuration : undefined,
        completed: true,
      })
    } catch {
      // swallow
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className={cn('flex items-center gap-2 py-2.5', done && 'opacity-60')}>
        <span className="w-6 text-xs text-zinc-400 shrink-0 text-center">{set.setNumber}</span>

        {showWeight && (
          <input
            type="number"
            value={weight}
            onChange={e => setWeight(e.target.value)}
            disabled={done}
            placeholder={set.targetWeightKg ? toDisplay(set.targetWeightKg) : unit}
            className="w-16 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-center text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 disabled:opacity-50"
          />
        )}

        {showReps && (
          <input
            type="number"
            value={reps}
            onChange={e => setReps(e.target.value)}
            disabled={done}
            placeholder={targetRepsDisplay || 'reps'}
            className="w-16 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-center text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 disabled:opacity-50"
          />
        )}

        {showDuration && (
          <input
            type="number"
            value={duration}
            onChange={e => setDuration(e.target.value)}
            disabled={done}
            placeholder={set.targetDurationSeconds ? `${set.targetDurationSeconds}s` : 'sec'}
            className="w-16 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-center text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 disabled:opacity-50"
          />
        )}

        {/* Optional RPE/RIR toggle */}
        {!done && (trackingType === 'strength' || trackingType === 'bodyweight' || trackingType === 'assisted') && (
          <button
            onClick={() => setShowEffort(v => !v)}
            className={cn(
              'ml-auto flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors',
              showEffort
                ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-500'
            )}
            title="Rate of Perceived Exertion / Reps in Reserve"
          >
            RPE
          </button>
        )}

        {!done && !set.id.startsWith('pending-') && (
          <VoiceMic
            workoutId={workoutId}
            workoutExerciseId={exerciseId}
            setId={set.id}
            exerciseName={exerciseName}
            disabled={done || saving}
            onApplied={() => {
              setDone(true)
              onComplete(set.id, { completed: true })
            }}
          />
        )}

        <button
          onClick={handleComplete}
          disabled={done || saving}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
            !showEffort && !done && set.id.startsWith('pending-') ? 'ml-auto' : '',
            done
              ? 'bg-emerald-500 text-white'
              : 'border-2 border-zinc-200 dark:border-zinc-600 text-zinc-300 hover:border-emerald-400 hover:text-emerald-400'
          )}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : done ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
        </button>

        <PRBadges prs={prs} />
      </div>

      {/* Effort inputs — shown inline below the set row */}
      {showEffort && !done && (
        <div className="flex items-center gap-3 pb-2 pl-8 pr-2">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-zinc-400 w-8">RPE</label>
            <input
              type="number"
              min="1" max="10"
              value={rpe}
              onChange={e => setRpe(e.target.value)}
              placeholder="1–10"
              className="w-14 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-center text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-zinc-400 w-6">RIR</label>
            <input
              type="number"
              min="0" max="5"
              value={rir}
              onChange={e => setRir(e.target.value)}
              placeholder="0–5"
              className="w-14 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-center text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
            />
          </div>
          <span className="text-[10px] text-zinc-400">Optional</span>
        </div>
      )}
    </div>
  )
}

// ─── Exercise card ────────────────────────────────────────────────────────────

interface SubstituteOption {
  exerciseId: string
  name: string
  target: string
  equipment: string
  reason: string
}

function ExerciseCard({ ex, workoutId, onUpdate, onRemove, onRefresh }: {
  ex: ExerciseData
  workoutId: string
  onUpdate: (restSeconds?: number) => void
  onRemove: (id: string) => void
  onRefresh: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState(ex.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [substituting, setSubstituting] = useState(false)
  const [substituteOptions, setSubstituteOptions] = useState<SubstituteOption[] | null>(null)
  const [applyingSubId, setApplyingSubId] = useState<string | null>(null)
  const addCounterRef = useRef(0)

  const [sets, setSets] = useState<SetData[]>(() =>
    ex.sets.length > 0 ? ex.sets : [makeBlankSet(1, 'pending-0')]
  )

  const trackingType: TrackingType = ex.trackingType ?? (
    ex.exercise?.equipment?.toLowerCase().includes('body weight') ? 'bodyweight' : 'strength'
  )

  const showWeight = trackingType === 'strength' || trackingType === 'assisted' || trackingType === 'carry'
  const showReps = trackingType === 'strength' || trackingType === 'bodyweight' || trackingType === 'assisted'
  const showDuration = trackingType === 'cardio' || trackingType === 'carry' || trackingType === 'isometric' || trackingType === 'intervals'
  const { unit } = useWeightUnit()

  const addSet = () => {
    addCounterRef.current += 1
    setSets(prev => [...prev, makeBlankSet(prev.length + 1, `pending-add-${addCounterRef.current}`)])
  }

  const handleComplete = (setId: string, updates: Partial<SetData> & { completed: boolean }) => {
    setSets(prev => {
      const next = prev.map(s => s.id === setId ? { ...s, ...updates } : s)
      const allDone = next.every(s => s.completed)
      if (allDone) recordBehaviorEvent(ex.exerciseId, 'exercise_completed', { workoutId })
      return next
    })
    onUpdate(ex.restSeconds ?? 90)
  }

  const handleSubstitute = async () => {
    if (isCustomExerciseId(ex.exerciseId)) return
    setSubstituting(true)
    setSubstituteOptions(null)
    try {
      const res = await fetch('/api/v/substitute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseId: ex.exerciseId }),
      })
      const data = await res.json() as { substitutes?: SubstituteOption[]; error?: string }
      if (res.ok && data.substitutes) setSubstituteOptions(data.substitutes)
    } finally {
      setSubstituting(false)
    }
  }

  const applySubstitute = async (newExerciseId: string) => {
    setApplyingSubId(newExerciseId)
    try {
      const res = await fetch(`/api/workouts/${workoutId}/exercises/${ex.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newExerciseId }),
      })
      if (res.ok) {
        recordBehaviorEvent(ex.exerciseId, 'exercise_replaced', { workoutId, replacedBy: newExerciseId })
        setSubstituteOptions(null)
        onRefresh()
      }
    } finally {
      setApplyingSubId(null)
    }
  }

  const handleSaveNotes = async () => {
    setSavingNotes(true)
    try {
      await fetch(`/api/workouts/${workoutId}/exercises/${ex.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      setShowNotes(false)
    } finally {
      setSavingNotes(false)
    }
  }

  const handleRemove = async () => {
    if (!confirm(`Remove "${ex.exercise?.name ?? ex.exerciseId}" from this workout?`)) return
    setRemoving(true)
    try {
      const res = await fetch(`/api/workouts/${workoutId}/exercises/${ex.id}`, { method: 'DELETE' })
      if (res.ok) {
        recordBehaviorEvent(ex.exerciseId, 'exercise_removed', { workoutId })
        onRemove(ex.id)
      }
    } finally {
      setRemoving(false)
    }
  }

  const completedCount = sets.filter(s => s.completed).length

  const prev = ex.previousSession

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Exercise header */}
      <div className="flex items-center gap-0 px-4 py-3">
        <button onClick={() => setCollapsed(c => !c)} className="flex items-center gap-3 flex-1 text-left min-w-0">
          <div className="size-12 shrink-0 rounded-xl bg-zinc-50 dark:bg-zinc-800 overflow-hidden flex items-center justify-center">
            {ex.exercise && !isCustomExerciseId(ex.exerciseId) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getGifUrl(ex.exerciseId)} alt={ex.exercise.name} className="h-full w-auto object-contain" />
            ) : (
              <Dumbbell className="size-5 text-zinc-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-zinc-900 dark:text-white truncate">
              {ex.exercise?.name ?? ex.exerciseId}
            </p>
            <p className="text-xs text-zinc-400">
              {ex.exercise?.bodyPart} · {ex.exercise?.equipment}
            </p>
            {prev && (
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Last {formatDate(prev.completedAt)} · {prev.sets.length} set{prev.sets.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-zinc-400">{completedCount}/{sets.length}</span>
            {collapsed ? <ChevronDown className="size-4 text-zinc-300" /> : <ChevronUp className="size-4 text-zinc-300" />}
          </div>
        </button>
        {/* Action buttons */}
        <div className="flex items-center gap-0 ml-2 shrink-0">
          <button
            onClick={() => setShowNotes(v => !v)}
            className={cn(
              'flex size-7 items-center justify-center rounded-full transition-colors',
              notes ? 'text-sky-400' : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-500'
            )}
            title="Exercise notes"
          >
            <MessageSquare className="size-3.5" />
          </button>
          {!isCustomExerciseId(ex.exerciseId) && (
            <button
              onClick={handleSubstitute}
              disabled={substituting}
              className="flex size-7 items-center justify-center rounded-full text-zinc-300 dark:text-zinc-600 hover:text-indigo-400 transition-colors"
              title="Find substitute"
            >
              {substituting ? <Loader2 className="size-3.5 animate-spin" /> : <Shuffle className="size-3.5" />}
            </button>
          )}
          <button
            onClick={handleRemove}
            disabled={removing}
            className="flex size-7 items-center justify-center rounded-full text-zinc-200 dark:text-zinc-700 hover:text-red-400 transition-colors"
            title="Remove exercise"
          >
            {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Notes editor */}
      {showNotes && (
        <div className="px-4 pb-3 border-t border-zinc-50 dark:border-zinc-800">
          <p className="text-[10px] font-semibold text-zinc-400 mt-2 mb-1">EXERCISE NOTES</p>
          {prev?.notes && (
            <p className="text-xs text-zinc-400 italic mb-1">Last session: {prev.notes}</p>
          )}
          <div className="flex gap-2">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Keep elbows tucked, felt strong today"
              rows={2}
              className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 resize-none"
            />
            <div className="flex flex-col gap-1">
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50"
              >
                {savingNotes ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              </button>
              <button
                onClick={() => { setShowNotes(false); setNotes(ex.notes ?? '') }}
                className="flex size-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Substitute options panel */}
      {substituteOptions && substituteOptions.length > 0 && (
        <div className="px-4 pb-3 border-t border-zinc-50 dark:border-zinc-800">
          <div className="mt-2 flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Substitutes</p>
            <button onClick={() => setSubstituteOptions(null)} className="text-zinc-300 hover:text-zinc-500">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            {substituteOptions.map(opt => (
              <button
                key={opt.exerciseId}
                onClick={() => applySubstitute(opt.exerciseId)}
                disabled={applyingSubId !== null}
                className="w-full text-left rounded-xl border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-zinc-900 dark:text-white">{opt.name}</p>
                  {applyingSubId === opt.exerciseId && <Loader2 className="size-3.5 animate-spin text-indigo-400 shrink-0" />}
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5 capitalize">{opt.target} · {opt.equipment}</p>
                <p className="text-[11px] text-zinc-400 mt-0.5 italic">{opt.reason}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="px-4 pb-3 border-t border-zinc-50 dark:border-zinc-800">
          {/* Previous session per-set data */}
          {prev && prev.sets.length > 0 && (
            <div className="mt-2 mb-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2">
              <p className="text-[10px] font-semibold text-zinc-400 mb-1.5">LAST — {formatDate(prev.completedAt)}</p>
              <div className="space-y-0.5">
                {prev.sets.map(s => (
                  <div key={s.setNumber} className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="w-4 text-center text-zinc-300 shrink-0">{s.setNumber}</span>
                    <span>{formatSetSummary(s, trackingType)}</span>
                    {s.rpe != null && <span className="text-zinc-300">RPE {s.rpe}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Today's sets headers */}
          <div className="flex items-center gap-2 py-2">
            <span className="w-6 text-[10px] text-zinc-400 text-center">SET</span>
            {showWeight && <span className="w-16 text-[10px] text-zinc-400 text-center">{unit.toUpperCase()}</span>}
            {showReps && <span className="w-16 text-[10px] text-zinc-400 text-center">REPS</span>}
            {showDuration && <span className="w-16 text-[10px] text-zinc-400 text-center">SEC</span>}
          </div>

          {sets.map(s => (
            <SetRow
              key={s.id}
              set={s}
              exerciseId={ex.id}
              workoutId={workoutId}
              onComplete={handleComplete}
              trackingType={trackingType}
              exerciseName={ex.exercise?.name}
            />
          ))}

          <button
            onClick={addSet}
            className="mt-2 flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            <Plus className="size-3.5" />
            Add set
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Duration target picker ───────────────────────────────────────────────────

const DURATION_PRESETS = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '45m', value: 45 },
  { label: '60m', value: 60 },
  { label: '∞', value: null },
]

function DurationTarget({ current, workoutId, onChange }: {
  current: number | null
  workoutId: string
  onChange: (v: number | null) => void
}) {
  const [saving, setSaving] = useState(false)

  const handleSelect = async (val: number | null) => {
    if (val === current) return
    setSaving(true)
    try {
      await fetch(`/api/workouts/${workoutId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationTargetMinutes: val }),
      })
      onChange(val)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Timer className="size-3.5 text-zinc-400 shrink-0" />
      <div className="flex gap-1">
        {DURATION_PRESETS.map(p => (
          <button
            key={String(p.value)}
            onClick={() => handleSelect(p.value)}
            disabled={saving}
            className={cn(
              'rounded-lg px-2 py-0.5 text-xs font-medium transition-colors',
              current === p.value
                ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-300'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Workout notes ────────────────────────────────────────────────────────────

function WorkoutNotes({ workoutId, initial }: { workoutId: string; initial: string | null }) {
  const [open, setOpen] = useState(!!initial)
  const [text, setText] = useState(initial ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`/api/workouts/${workoutId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: text }),
      })
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        <MessageSquare className="size-4" />
        Add workout notes
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Workout notes</p>
        <button onClick={() => setOpen(false)} className="text-zinc-300 hover:text-zinc-500">
          <X className="size-4" />
        </button>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={handleSave}
        placeholder="How did it feel? Anything to remember next time?"
        rows={3}
        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 resize-none"
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-50"
      >
        {saving && <Loader2 className="size-3 animate-spin" />}
        Save notes
      </button>
    </div>
  )
}

// ─── Completed workout card ───────────────────────────────────────────────────

function CompletedCard({ workout }: { workout: WorkoutData }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const formatElapsedLocal = (s: number) => {
    const m = Math.floor(s / 60); const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  const handleSaveAsTemplate = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/workouts/${workout.id}/save-as-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workout.title }),
      })
      if (res.ok) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-emerald-200 dark:border-emerald-800/30 bg-emerald-50 dark:bg-emerald-900/10 p-6 text-center">
      <CheckCircle2 className="size-10 text-emerald-500 mx-auto mb-3" />
      <p className="font-black text-zinc-900 dark:text-white text-lg mb-1">Workout complete!</p>
      {workout.durationSeconds && (
        <p className="text-sm text-zinc-500">Duration: {formatElapsedLocal(workout.durationSeconds)}</p>
      )}
      <div className="flex gap-2 mt-4">
        <Link href="/training" className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300 text-center hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
          Training
        </Link>
        <Link href="/coach" className="flex-1 rounded-xl bg-zinc-900 dark:bg-white py-2.5 text-sm font-semibold text-white dark:text-zinc-900 text-center hover:opacity-90 transition-opacity">
          Ask Coach
        </Link>
      </div>
      <button
        onClick={handleSaveAsTemplate}
        disabled={saving || saved}
        className="mt-3 flex items-center gap-1.5 mx-auto text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-50 transition-colors"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {saved ? '✓ Saved as template' : 'Save as template'}
      </button>
    </div>
  )
}

// ─── Active workout session ───────────────────────────────────────────────────

export default function WorkoutPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { unit, setUnit } = useWeightUnit()
  const [workout, setWorkout] = useState<WorkoutData | null>(null)
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [completedSets, setCompletedSets] = useState(0)
  const [showShortenModal, setShowShortenModal] = useState(false)
  const [restTimer, setRestTimer] = useState<{ seconds: number } | null>(null)
  const [showAddExercise, setShowAddExercise] = useState(false)
  const [addingExercise, setAddingExercise] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchWorkout = useCallback(() => {
    fetch(`/api/workouts/${id}`)
      .then(res => res.ok ? res.json() as Promise<{ workout: WorkoutData }> : null)
      .then(async data => {
        if (!data) return
        setWorkout(data.workout)
        if (data.workout.status === 'planned') {
          await fetch(`/api/workouts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'in_progress' }),
          })
          setWorkout(w => w ? { ...w, status: 'in_progress', startedAt: new Date().toISOString() } : w)
        }
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { fetchWorkout() }, [fetchWorkout])

  useEffect(() => {
    if (!workout?.startedAt || workout.status === 'completed') return
    const start = new Date(workout.startedAt).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [workout?.startedAt, workout?.status])

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  const handleFinish = async () => {
    if (!workout) return
    setCompleting(true)
    try {
      await fetch(`/api/workouts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (intervalRef.current) clearInterval(intervalRef.current)
      router.push('/training')
    } finally {
      setCompleting(false)
    }
  }

  const handleRemoveExercise = (exerciseId: string) => {
    setWorkout(w => w ? { ...w, exercises: w.exercises.filter(e => e.id !== exerciseId) } : w)
  }

  const handleAddExercise = async (ex: ExerciseMeta) => {
    if (!workout) return
    setShowAddExercise(false)
    setAddingExercise(true)
    try {
      const res = await fetch(`/api/workouts/${id}/exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseId: ex.id }),
      })
      if (res.ok) {
        recordBehaviorEvent(ex.id, 'exercise_added', { workoutId: id })
        fetchWorkout()
      }
    } finally {
      setAddingExercise(false)
    }
  }

  const handleSetCompleted = (restSeconds?: number) => {
    setCompletedSets(c => c + 1)
    if (restSeconds && workout?.status === 'in_progress') {
      setRestTimer({ seconds: restSeconds })
    }
  }

  const targetMinutes = workout?.durationTargetMinutes
  const elapsedMinutes = Math.floor(elapsed / 60)
  const targetProgress = targetMinutes ? Math.min(elapsedMinutes / targetMinutes, 1) : null
  const minutesLeft = targetMinutes ? Math.max(targetMinutes - elapsedMinutes, 0) : null

  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  )

  if (!workout) return (
    <div className="mx-auto max-w-2xl px-4 py-8 text-center">
      <p className="text-zinc-500">Workout not found.</p>
      <Link href="/training" className="mt-4 inline-block text-sm text-zinc-400 underline">Back to Training</Link>
    </div>
  )

  const totalSets = workout.exercises.reduce((n, ex) => n + Math.max(ex.sets.length, ex.targetSets ?? 1), 0)

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">

      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/training" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
          </Link>
          <div className="flex shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-[10px] font-semibold">
            {(['lbs', 'kg'] as const).map(u => (
              <button key={u} onClick={() => setUnit(u)} className={cn('w-8 py-1 uppercase transition-colors', unit === u ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300')}>
                {u}
              </button>
            ))}
          </div>
          <div className="min-w-0">
            <h1 className="font-black text-lg text-zinc-900 dark:text-white truncate">{workout.title}</h1>
            {workout.status === 'in_progress' && (
              <p className="text-xs text-zinc-400">
                {formatElapsed(elapsed)}
                {targetMinutes && minutesLeft != null && (
                  <span className={cn('ml-1.5', minutesLeft <= 5 ? 'text-amber-500' : '')}>
                    · {minutesLeft}m left
                  </span>
                )}
                {totalSets > 0 && ` · ${completedSets}/${totalSets} sets`}
              </p>
            )}
            {workout.status === 'completed' && (
              <p className="text-xs text-emerald-500 font-medium">Completed</p>
            )}
          </div>
        </div>

        {workout.status === 'in_progress' && workout.exercises.length > 1 && (
          <button
            onClick={() => setShowShortenModal(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            title="Shorten with V"
          >
            <Scissors className="size-3.5" />
            <span className="hidden sm:inline">Shorten</span>
          </button>
        )}
        {workout.status !== 'completed' && (
          <button
            onClick={handleFinish}
            disabled={completing}
            className="shrink-0 flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {completing ? <Loader2 className="size-4 animate-spin" /> : null}
            Finish
          </button>
        )}
      </div>

      {/* Duration target progress bar */}
      {targetProgress !== null && workout.status === 'in_progress' && (
        <div className="mb-4 h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-1000',
              targetProgress >= 1 ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-500'
            )}
            style={{ width: `${targetProgress * 100}%` }}
          />
        </div>
      )}

      {/* Duration target selector */}
      {workout.status === 'in_progress' && (
        <div className="mb-5">
          <DurationTarget
            current={workout.durationTargetMinutes}
            workoutId={workout.id}
            onChange={val => setWorkout(w => w ? { ...w, durationTargetMinutes: val } : w)}
          />
        </div>
      )}

      {/* Exercises */}
      {workout.exercises.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <Dumbbell className="size-6 text-zinc-400" />
          </div>
          <p className="font-semibold text-zinc-900 dark:text-white mb-1">No exercises yet</p>
          <p className="text-sm text-zinc-400">This workout has no exercises.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {workout.exercises.map(ex => (
            <ExerciseCard
              key={ex.id}
              ex={ex}
              workoutId={workout.id}
              onUpdate={handleSetCompleted}
              onRemove={handleRemoveExercise}
              onRefresh={fetchWorkout}
            />
          ))}
        </div>
      )}

      {/* Workout notes + finish */}
      {workout.status === 'in_progress' && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setShowAddExercise(true)}
            disabled={addingExercise}
            className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:hover:border-zinc-500 dark:hover:text-zinc-300 transition-colors"
          >
            {addingExercise ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add exercise
          </button>
        </div>
      )}

      {workout.status !== 'completed' && (
        <div className="mt-6 space-y-4">
          <WorkoutNotes workoutId={workout.id} initial={workout.notes} />

          <button
            onClick={handleFinish}
            disabled={completing}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {completing ? <Loader2 className="size-5 animate-spin" /> : <CheckCircle2 className="size-5" />}
            Finish Workout
          </button>
        </div>
      )}

      {workout.status === 'completed' && (
        <CompletedCard workout={workout} />
      )}

      {restTimer && (
        <RestTimer
          seconds={restTimer.seconds}
          onDone={() => setRestTimer(null)}
          onDismiss={() => setRestTimer(null)}
        />
      )}

      {showAddExercise && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setShowAddExercise(false)} />
          <ExercisePicker
            title="Add exercise"
            onSelect={handleAddExercise}
            onClose={() => setShowAddExercise(false)}
            selectedIds={new Set(workout.exercises.map(e => e.exerciseId))}
          />
        </>
      )}

      <ShortenModal
        open={showShortenModal}
        onOpenChange={setShowShortenModal}
        workoutId={workout.id}
        onShortened={fetchWorkout}
      />
    </div>
  )
}
