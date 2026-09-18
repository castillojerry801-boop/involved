'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, GripVertical, Search, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ExerciseResult {
  id: string
  name: string
  bodyPart: string
  equipment: string
  target: string
}

interface ProgramSet {
  setNumber: number
  setType: 'warmup' | 'working' | 'amrap'
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetWeightKg: number | null
  restSeconds: number | null
}

interface ProgramExercise {
  key: string
  exerciseId: string
  exercise: ExerciseResult | null
  trackingType: 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals'
  notes: string
  restSeconds: number | null
  sets: ProgramSet[]
}

interface ProgramDay {
  key: string
  name: string
  exercises: ProgramExercise[]
}

function defaultSet(n: number): ProgramSet {
  return { setNumber: n, setType: 'working', targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: null, restSeconds: 90 }
}

function ExercisePickerModal({ onSelect, onClose }: { onSelect: (ex: ExerciseResult) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ExerciseResult[]>([])
  const [loading, setLoading] = useState(false)

  const search = async (q: string) => {
    setQuery(q)
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/exercises/search?q=${encodeURIComponent(q)}&limit=20`)
      const data = await res.json() as { exercises: ExerciseResult[] }
      setResults(data.exercises ?? [])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <Search className="size-4 text-zinc-400 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => search(e.target.value)}
            placeholder="Search exercises…"
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none"
          />
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="size-4 text-zinc-400" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-zinc-400" /></div>
          )}
          {!loading && results.length === 0 && query.length >= 2 && (
            <p className="py-8 text-center text-sm text-zinc-400">No exercises found</p>
          )}
          {!loading && query.length < 2 && (
            <p className="py-8 text-center text-sm text-zinc-400">Type to search exercises</p>
          )}
          {results.map(ex => (
            <button key={ex.id} onClick={() => onSelect(ex)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{ex.name}</p>
                <p className="text-xs text-zinc-400">{ex.bodyPart} · {ex.equipment}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function SetEditor({ sets, onChange, trackingType }: {
  sets: ProgramSet[]
  onChange: (sets: ProgramSet[]) => void
  trackingType: string
}) {
  const showWeight = trackingType === 'strength' || trackingType === 'assisted' || trackingType === 'carry'
  const showReps = trackingType === 'strength' || trackingType === 'bodyweight' || trackingType === 'assisted'

  const update = (i: number, field: keyof ProgramSet, value: unknown) => {
    onChange(sets.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  return (
    <div className="mt-2">
      <div className="grid grid-cols-[24px_60px_1fr_1fr_48px_16px] gap-1.5 mb-1">
        <span className="text-[10px] text-zinc-400 text-center">#</span>
        <span className="text-[10px] text-zinc-400 text-center">TYPE</span>
        {showWeight && <span className="text-[10px] text-zinc-400 text-center">TARGET KG</span>}
        {showReps && <span className="text-[10px] text-zinc-400 text-center col-span-{showWeight ? 1 : 2}">REPS</span>}
        <span className="text-[10px] text-zinc-400 text-center">REST</span>
        <span />
      </div>
      {sets.map((s, i) => (
        <div key={i} className="grid grid-cols-[24px_60px_1fr_1fr_48px_16px] gap-1.5 mb-1.5 items-center">
          <span className="text-xs text-zinc-400 text-center">{s.setNumber}</span>
          <select
            value={s.setType}
            onChange={e => update(i, 'setType', e.target.value as ProgramSet['setType'])}
            className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none"
          >
            <option value="working">Work</option>
            <option value="warmup">Warm</option>
            <option value="amrap">AMRAP</option>
          </select>
          {showWeight && (
            <input
              type="number"
              value={s.targetWeightKg ?? ''}
              onChange={e => update(i, 'targetWeightKg', e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="–"
              className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
            />
          )}
          {showReps && (
            <div className="flex items-center gap-0.5">
              <input
                type="number"
                value={s.targetRepsMin ?? ''}
                onChange={e => update(i, 'targetRepsMin', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="min"
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
              />
              <span className="text-zinc-300 text-xs">–</span>
              <input
                type="number"
                value={s.targetRepsMax ?? ''}
                onChange={e => update(i, 'targetRepsMax', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="max"
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
              />
            </div>
          )}
          {!showReps && !showWeight && <span className="col-span-2" />}
          <input
            type="number"
            value={s.restSeconds ?? ''}
            onChange={e => update(i, 'restSeconds', e.target.value ? parseInt(e.target.value) : null)}
            placeholder="s"
            className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
          />
          <button onClick={() => onChange(sets.filter((_, idx) => idx !== i).map((s2, idx2) => ({ ...s2, setNumber: idx2 + 1 })))}
            className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors">
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...sets, defaultSet(sets.length + 1)])}
        className="mt-1 flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
        <Plus className="size-3" /> Add set
      </button>
    </div>
  )
}

export default function NewProgramPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [days, setDays] = useState<ProgramDay[]>([{ key: 'day-0', name: 'Day 1', exercises: [] }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pickerDayKey, setPickerDayKey] = useState<string | null>(null)

  const addDay = () => {
    setDays(prev => [...prev, { key: `day-${Date.now()}`, name: `Day ${prev.length + 1}`, exercises: [] }])
  }

  const removeDay = (key: string) => {
    setDays(prev => prev.filter(d => d.key !== key))
  }

  const updateDayName = (key: string, val: string) => {
    setDays(prev => prev.map(d => d.key === key ? { ...d, name: val } : d))
  }

  const addExercise = (dayKey: string, ex: ExerciseResult) => {
    setPickerDayKey(null)
    const trackingType: ProgramExercise['trackingType'] =
      ex.bodyPart.toLowerCase() === 'cardio' ? 'cardio'
      : ex.equipment.toLowerCase().includes('body weight') ? 'bodyweight'
      : 'strength'

    setDays(prev => prev.map(d => {
      if (d.key !== dayKey) return d
      const newEx: ProgramExercise = {
        key: `ex-${Date.now()}`,
        exerciseId: ex.id,
        exercise: ex,
        trackingType,
        notes: '',
        restSeconds: 90,
        sets: [defaultSet(1), defaultSet(2), defaultSet(3)],
      }
      return { ...d, exercises: [...d.exercises, newEx] }
    }))
  }

  const removeExercise = (dayKey: string, exKey: string) => {
    setDays(prev => prev.map(d => d.key === dayKey ? { ...d, exercises: d.exercises.filter(e => e.key !== exKey) } : d))
  }

  const updateExerciseSets = (dayKey: string, exKey: string, sets: ProgramSet[]) => {
    setDays(prev => prev.map(d => d.key === dayKey ? {
      ...d,
      exercises: d.exercises.map(e => e.key === exKey ? { ...e, sets } : e),
    } : d))
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Give your program a name.'); return }
    setSaving(true)
    setError('')
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        days: days.map((d, di) => ({
          name: d.name.trim() || `Day ${di + 1}`,
          sortOrder: di,
          exercises: d.exercises.map((ex, ei) => ({
            exerciseId: ex.exerciseId,
            sortOrder: ei,
            trackingType: ex.trackingType,
            notes: ex.notes || undefined,
            restSeconds: ex.restSeconds ?? undefined,
            sets: ex.sets.map(s => ({
              setNumber: s.setNumber,
              setType: s.setType,
              targetRepsMin: s.targetRepsMin ?? undefined,
              targetRepsMax: s.targetRepsMax ?? undefined,
              targetWeightKg: s.targetWeightKg ?? undefined,
              restSeconds: s.restSeconds ?? undefined,
            })),
          })),
        })),
      }
      const res = await fetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Failed to save program')
        return
      }
      const data = await res.json() as { program: { id: string } }
      router.push(`/training/programs/${data.program.id}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {pickerDayKey && (
        <ExercisePickerModal
          onSelect={ex => addExercise(pickerDayKey, ex)}
          onClose={() => setPickerDayKey(null)}
        />
      )}

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/training/programs" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <h1 className="font-black text-xl text-zinc-900 dark:text-white">New program</h1>
      </div>

      {/* Program name + description */}
      <div className="mb-6 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Program name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Push / Pull / Legs"
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="6-day PPL with progressive overload"
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
          />
        </div>
      </div>

      {/* Days */}
      <div className="space-y-4 mb-6">
        {days.map(day => (
          <div key={day.key} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            {/* Day header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-50 dark:border-zinc-800">
              <GripVertical className="size-4 text-zinc-300 shrink-0" />
              <input
                type="text"
                value={day.name}
                onChange={e => updateDayName(day.key, e.target.value)}
                className="flex-1 bg-transparent text-sm font-bold text-zinc-900 dark:text-white focus:outline-none"
              />
              {days.length > 1 && (
                <button onClick={() => removeDay(day.key)} className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>

            {/* Exercises */}
            <div className="px-4 py-3 space-y-4">
              {day.exercises.length === 0 && (
                <p className="text-xs text-zinc-400 text-center py-2">No exercises yet</p>
              )}
              {day.exercises.map(ex => (
                <div key={ex.key} className="border border-zinc-100 dark:border-zinc-800 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                        {ex.exercise?.name ?? ex.exerciseId}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {ex.exercise?.bodyPart} · {ex.exercise?.equipment}
                      </p>
                    </div>
                    <button onClick={() => removeExercise(day.key, ex.key)}
                      className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors shrink-0">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <SetEditor
                    sets={ex.sets}
                    trackingType={ex.trackingType}
                    onChange={sets => updateExerciseSets(day.key, ex.key, sets)}
                  />
                </div>
              ))}
              <button
                onClick={() => setPickerDayKey(day.key)}
                className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
              >
                <Plus className="size-3.5" /> Add exercise
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={addDay}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 py-3.5 text-sm font-medium text-zinc-400 hover:border-zinc-300 hover:text-zinc-600 dark:hover:border-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <Plus className="size-4" /> Add day
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className={cn(
          'w-full flex items-center justify-center gap-2 rounded-2xl py-4 font-black text-base transition-opacity',
          'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50'
        )}
      >
        {saving && <Loader2 className="size-5 animate-spin" />}
        Save program
      </button>
    </div>
  )
}
