'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, CheckCircle2, Circle, Loader2, Trophy, ChevronDown, ChevronUp, Plus, Trash2, Dumbbell
} from 'lucide-react'
import { getGifUrl } from '@/lib/exercises'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SetData {
  id: string
  setNumber: number
  targetReps: number | null
  targetWeightKg: number | null
  targetDurationSeconds: number | null
  actualReps: number | null
  actualWeightKg: number | null
  actualDurationSeconds: number | null
  rpe: number | null
  completed: boolean
}

interface ExerciseData {
  id: string
  exerciseId: string
  order: number
  notes: string | null
  targetSets: number | null
  sets: SetData[]
  exercise: { id: string; name: string; bodyPart: string; equipment: string; target: string } | null
  previousBest: { reps: number | null; weightKg: number | null; setCount: number } | null
}

interface WorkoutData {
  id: string
  title: string
  status: 'planned' | 'in_progress' | 'completed' | 'skipped'
  scheduledDate: string | null
  startedAt: string | null
  completedAt: string | null
  durationSeconds: number | null
  notes: string | null
  exercises: ExerciseData[]
}

// ─── Set row ──────────────────────────────────────────────────────────────────

function SetRow({
  set, exerciseId, workoutId, onComplete, isBodyweight
}: {
  set: SetData
  exerciseId: string
  workoutId: string
  onComplete: (setId: string, updates: { actualReps?: number; actualWeightKg?: number; completed: boolean }) => void
  isBodyweight: boolean
}) {
  const [reps, setReps] = useState(String(set.actualReps ?? set.targetReps ?? ''))
  const [weight, setWeight] = useState(String(set.actualWeightKg ?? set.targetWeightKg ?? ''))
  const [saving, setSaving] = useState(false)
  const [newPR, setNewPR] = useState(false)
  const [done, setDone] = useState(set.completed)

  const handleComplete = async () => {
    if (done) return
    const parsedReps = parseInt(reps)
    const parsedWeight = parseFloat(weight)
    if (!parsedReps && !isBodyweight) return

    setSaving(true)
    try {
      const body: Record<string, unknown> = { completed: true }
      if (parsedReps > 0) body.actualReps = parsedReps
      if (!isBodyweight && parsedWeight > 0) body.actualWeightKg = parsedWeight

      if (set.id.startsWith('pending-')) {
        // New set — create via POST
        const res = await fetch(`/api/workouts/${workoutId}/sets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workoutExerciseId: exerciseId, setNumber: set.setNumber, ...body }),
        })
        const data = await res.json() as { set: SetData; newPR?: boolean }
        if (data.newPR) setNewPR(true)
      } else {
        // Existing set — update via PATCH
        const res = await fetch(`/api/workouts/${workoutId}/sets/${set.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json() as { set: SetData; newPR?: boolean }
        if (data.newPR) setNewPR(true)
      }

      setDone(true)
      onComplete(set.id, {
        actualReps: parsedReps || undefined,
        actualWeightKg: (!isBodyweight && parsedWeight > 0) ? parsedWeight : undefined,
        completed: true,
      })
    } catch {
      // swallow — user can retry
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn(
      'flex items-center gap-2 py-2.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0',
      done && 'opacity-60'
    )}>
      <span className="w-6 text-xs text-zinc-400 shrink-0 text-center">{set.setNumber}</span>

      {!isBodyweight && (
        <input
          type="number"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          disabled={done}
          placeholder={set.targetWeightKg ? String(set.targetWeightKg) : 'kg'}
          className="w-16 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-center text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 disabled:opacity-50"
        />
      )}

      <input
        type="number"
        value={reps}
        onChange={e => setReps(e.target.value)}
        disabled={done}
        placeholder={set.targetReps ? String(set.targetReps) : 'reps'}
        className="w-16 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-center text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 disabled:opacity-50"
      />

      <button
        onClick={handleComplete}
        disabled={done || saving}
        className={cn(
          'ml-auto flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
          done
            ? 'bg-emerald-500 text-white'
            : 'border-2 border-zinc-200 dark:border-zinc-600 text-zinc-300 hover:border-emerald-400 hover:text-emerald-400'
        )}
      >
        {saving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : done ? (
          <CheckCircle2 className="size-4" />
        ) : (
          <Circle className="size-4" />
        )}
      </button>

      {newPR && (
        <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-500">
          <Trophy className="size-3" /> PR
        </span>
      )}
    </div>
  )
}

// ─── Exercise card ────────────────────────────────────────────────────────────

function ExerciseCard({ ex, workoutId, onUpdate }: {
  ex: ExerciseData
  workoutId: string
  onUpdate: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [sets, setSets] = useState<SetData[]>(ex.sets.length > 0 ? ex.sets : [{
    id: `pending-1`,
    setNumber: 1,
    targetReps: null, targetWeightKg: null, targetDurationSeconds: null,
    actualReps: null, actualWeightKg: null, actualDurationSeconds: null,
    rpe: null, completed: false,
  }])

  const isBodyweight = ex.exercise?.equipment?.toLowerCase().includes('body weight') ?? false

  const addSet = () => {
    setSets(prev => [...prev, {
      id: `pending-${prev.length + 1}`,
      setNumber: prev.length + 1,
      targetReps: null, targetWeightKg: null, targetDurationSeconds: null,
      actualReps: null, actualWeightKg: null, actualDurationSeconds: null,
      rpe: null, completed: false,
    }])
  }

  const handleComplete = (setId: string, updates: { actualReps?: number; actualWeightKg?: number; completed: boolean }) => {
    setSets(prev => prev.map(s => s.id === setId ? { ...s, ...updates } : s))
    onUpdate()
  }

  const completedCount = sets.filter(s => s.completed).length

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Exercise header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-3 px-4 py-3"
      >
        <div className="size-12 shrink-0 rounded-xl bg-zinc-50 dark:bg-zinc-800 overflow-hidden">
          {ex.exercise && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getGifUrl(ex.exerciseId)} alt={ex.exercise.name} className="h-full w-auto object-contain" />
          )}
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="font-semibold text-sm text-zinc-900 dark:text-white truncate">
            {ex.exercise?.name ?? ex.exerciseId}
          </p>
          <p className="text-xs text-zinc-400">
            {ex.exercise?.bodyPart} · {ex.exercise?.equipment}
          </p>
          {ex.previousBest && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
              Last: {ex.previousBest.setCount}×
              {ex.previousBest.reps && `${ex.previousBest.reps} reps`}
              {ex.previousBest.weightKg && ` @ ${ex.previousBest.weightKg}kg`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-zinc-400">
            {completedCount}/{sets.length}
          </span>
          {collapsed ? <ChevronDown className="size-4 text-zinc-300" /> : <ChevronUp className="size-4 text-zinc-300" />}
        </div>
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 border-t border-zinc-50 dark:border-zinc-800">
          {/* Column headers */}
          <div className="flex items-center gap-2 py-2">
            <span className="w-6 text-[10px] text-zinc-400 text-center">SET</span>
            {!isBodyweight && <span className="w-16 text-[10px] text-zinc-400 text-center">KG</span>}
            <span className="w-16 text-[10px] text-zinc-400 text-center">REPS</span>
          </div>

          {sets.map(s => (
            <SetRow
              key={s.id}
              set={s}
              exerciseId={ex.id}
              workoutId={workoutId}
              onComplete={handleComplete}
              isBodyweight={isBodyweight}
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

// ─── Active workout session ───────────────────────────────────────────────────

export default function WorkoutPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [workout, setWorkout] = useState<WorkoutData | null>(null)
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [completedSets, setCompletedSets] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchWorkout = useCallback(async () => {
    const res = await fetch(`/api/workouts/${id}`)
    if (res.ok) {
      const data = await res.json() as { workout: WorkoutData }
      setWorkout(data.workout)
      if (data.workout.status === 'planned') {
        // Auto-start
        await fetch(`/api/workouts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'in_progress' }),
        })
        setWorkout(w => w ? { ...w, status: 'in_progress', startedAt: new Date().toISOString() } : w)
      }
    }
    setLoading(false)
  }, [id])

  useEffect(() => { fetchWorkout() }, [fetchWorkout])

  // Elapsed timer
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
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/training" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-black text-lg text-zinc-900 dark:text-white truncate">{workout.title}</h1>
            {workout.status === 'in_progress' && (
              <p className="text-xs text-zinc-400">
                In progress · {formatElapsed(elapsed)}
                {totalSets > 0 && ` · ${completedSets}/${totalSets} sets`}
              </p>
            )}
            {workout.status === 'completed' && (
              <p className="text-xs text-emerald-500 font-medium">Completed</p>
            )}
          </div>
        </div>

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

      {/* Exercises */}
      {workout.exercises.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <Dumbbell className="size-6 text-zinc-400" />
          </div>
          <p className="font-semibold text-zinc-900 dark:text-white mb-1">No exercises yet</p>
          <p className="text-sm text-zinc-400">This workout has no exercises. Add some from the exercise library.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {workout.exercises.map(ex => (
            <ExerciseCard
              key={ex.id}
              ex={ex}
              workoutId={workout.id}
              onUpdate={() => setCompletedSets(c => c + 1)}
            />
          ))}
        </div>
      )}

      {/* Finish button (bottom) */}
      {workout.status !== 'completed' && (
        <div className="mt-8">
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
        <div className="mt-8 rounded-2xl border border-emerald-200 dark:border-emerald-800/30 bg-emerald-50 dark:bg-emerald-900/10 p-6 text-center">
          <CheckCircle2 className="size-10 text-emerald-500 mx-auto mb-3" />
          <p className="font-black text-zinc-900 dark:text-white text-lg mb-1">Workout complete!</p>
          {workout.durationSeconds && (
            <p className="text-sm text-zinc-500">Duration: {formatElapsed(workout.durationSeconds)}</p>
          )}
          <div className="flex gap-2 mt-4">
            <Link href="/training" className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300 text-center hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              Training
            </Link>
            <Link href="/coach" className="flex-1 rounded-xl bg-zinc-900 dark:bg-white py-2.5 text-sm font-semibold text-white dark:text-zinc-900 text-center hover:opacity-90 transition-opacity">
              Ask Coach
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
