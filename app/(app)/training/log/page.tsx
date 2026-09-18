'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Search, Plus, X, Loader2, Calendar, Dumbbell } from 'lucide-react'
import { getGifUrl } from '@/lib/exercises'

interface Exercise {
  id: string
  name: string
  bodyPart: string
  equipment: string
  target: string
}

interface SelectedExercise {
  exerciseId: string
  name: string
  equipment: string
  bodyPart: string
  targetSets: number
  targetReps: number | null
}

function LogWorkoutForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isPlanMode = searchParams.get('mode') === 'plan'

  const [title, setTitle] = useState('')
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  })
  const [selected, setSelected] = useState<SelectedExercise[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Exercise[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  // Load exercises from static library
  useEffect(() => {
    if (!showSearch) return
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const params = new URLSearchParams({ q: query, limit: '20' })
        const res = await fetch(`/api/training/exercises?${params}`)
        if (res.ok) setResults(await res.json() as Exercise[])
      } catch { /* ignore */ } finally {
        setSearching(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query, showSearch])

  const addExercise = (ex: Exercise) => {
    if (selected.some(s => s.exerciseId === ex.id)) return
    setSelected(prev => [...prev, {
      exerciseId: ex.id,
      name: ex.name,
      equipment: ex.equipment,
      bodyPart: ex.bodyPart,
      targetSets: 3,
      targetReps: ex.equipment.toLowerCase().includes('body weight') ? null : 10,
    }])
    setShowSearch(false)
    setQuery('')
  }

  const removeExercise = (id: string) => setSelected(prev => prev.filter(e => e.exerciseId !== id))
  const updateSets = (id: string, val: number) => setSelected(prev => prev.map(e => e.exerciseId === id ? { ...e, targetSets: val } : e))
  const updateReps = (id: string, val: number | null) => setSelected(prev => prev.map(e => e.exerciseId === id ? { ...e, targetReps: val } : e))

  const handleSave = async () => {
    const workoutTitle = title.trim() || (selected.length > 0
      ? selected.slice(0, 2).map(e => e.name.split(' ')[0]).join(' + ')
      : 'My Workout')

    setSaving(true)
    try {
      const res = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: workoutTitle,
          scheduledDate,
          startNow: !isPlanMode,
          source: 'manual',
          exercises: selected.map((ex, idx) => ({
            exerciseId: ex.exerciseId,
            order: idx,
            targetSets: ex.targetSets,
            sets: Array.from({ length: ex.targetSets }, (_, i) => ({
              setNumber: i + 1,
              targetReps: ex.targetReps ?? undefined,
            })),
          })),
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json() as { workout: { id: string } }
      router.push(isPlanMode ? '/training' : `/training/workout/${data.workout.id}`)
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/training" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <h1 className="font-black text-xl text-zinc-900 dark:text-white">
          {isPlanMode ? 'Plan a Workout' : 'Log a Workout'}
        </h1>
      </div>

      {/* Workout title */}
      <div className="mb-4">
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Workout name (optional)"
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
        />
      </div>

      {/* Date picker */}
      <div className="mb-6 flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3">
        <Calendar className="size-4 text-zinc-400 shrink-0" />
        <input
          type="date"
          value={scheduledDate}
          onChange={e => setScheduledDate(e.target.value)}
          className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-white focus:outline-none"
        />
      </div>

      {/* Selected exercises */}
      {selected.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {selected.map((ex, idx) => (
            <div key={ex.exerciseId} className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="flex items-center gap-3">
                <div className="size-10 shrink-0 rounded-lg bg-zinc-50 dark:bg-zinc-800 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={getGifUrl(ex.exerciseId)} alt={ex.name} className="h-full w-auto object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{ex.name}</p>
                  <p className="text-xs text-zinc-400">{ex.bodyPart} · {ex.equipment}</p>
                </div>
                <button onClick={() => removeExercise(ex.exerciseId)} className="size-6 flex items-center justify-center text-zinc-300 hover:text-red-400 transition-colors">
                  <X className="size-4" />
                </button>
              </div>

              {/* Set/rep targets */}
              <div className="mt-2 flex items-center gap-3 pl-[52px]">
                <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                  Sets
                  <input
                    type="number"
                    min={1} max={10}
                    value={ex.targetSets}
                    onChange={e => updateSets(ex.exerciseId, parseInt(e.target.value) || 1)}
                    className="w-12 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-center text-sm text-zinc-900 dark:text-white focus:outline-none"
                  />
                </label>
                {!ex.equipment.toLowerCase().includes('body weight') && (
                  <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                    Reps
                    <input
                      type="number"
                      min={1} max={100}
                      value={ex.targetReps ?? ''}
                      placeholder="—"
                      onChange={e => updateReps(ex.exerciseId, parseInt(e.target.value) || null)}
                      className="w-12 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-center text-sm text-zinc-900 dark:text-white focus:outline-none"
                    />
                  </label>
                )}
                {idx < selected.length - 1 && (
                  <span className="ml-auto text-xs text-zinc-300">{idx + 1}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add exercise */}
      {!showSearch ? (
        <button
          onClick={() => setShowSearch(true)}
          className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 py-4 text-sm font-medium text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <Plus className="size-4" />
          Add exercise
        </button>
      ) : (
        <div className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
            <Search className="size-4 text-zinc-400 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search exercises..."
              className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none"
            />
            {searching && <Loader2 className="size-4 animate-spin text-zinc-400 shrink-0" />}
            <button onClick={() => { setShowSearch(false); setQuery('') }} className="text-zinc-400 hover:text-zinc-600">
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {results.map(ex => (
              <button
                key={ex.id}
                onClick={() => addExercise(ex)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
              >
                <div className="size-8 shrink-0 rounded-lg bg-zinc-50 dark:bg-zinc-800 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={getGifUrl(ex.id)} alt={ex.name} className="h-full w-auto object-contain" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{ex.name}</p>
                  <p className="text-xs text-zinc-400">{ex.bodyPart} · {ex.equipment}</p>
                </div>
                {selected.some(s => s.exerciseId === ex.id) && (
                  <span className="ml-auto text-xs text-emerald-500 shrink-0">Added</span>
                )}
              </button>
            ))}
            {!searching && results.length === 0 && query && (
              <p className="px-3 py-4 text-center text-sm text-zinc-400">No exercises found for &quot;{query}&quot;</p>
            )}
            {!query && results.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-zinc-400">Type to search 1,394 exercises</p>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {selected.length === 0 && !showSearch && (
        <div className="mb-6 flex flex-col items-center py-8 text-center">
          <Dumbbell className="size-8 text-zinc-200 dark:text-zinc-700 mb-2" />
          <p className="text-sm text-zinc-400">Add exercises to build your workout</p>
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {saving && <Loader2 className="size-5 animate-spin" />}
        {isPlanMode ? 'Save Workout Plan' : selected.length > 0 ? 'Start Workout' : 'Start Empty Workout'}
      </button>
    </div>
  )
}

export default function LogPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="size-6 animate-spin text-zinc-400" /></div>}>
      <LogWorkoutForm />
    </Suspense>
  )
}
