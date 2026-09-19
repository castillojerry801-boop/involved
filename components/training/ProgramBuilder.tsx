'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, GripVertical, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import ExercisePicker from '@/components/training/ExercisePicker'
import type { ExerciseMeta } from '@/lib/exercises'

export interface ProgramSet {
  setNumber: number
  setType: 'warmup' | 'working' | 'amrap'
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetWeightKg: number | null
  restSeconds: number | null
}

export interface ProgramExercise {
  key: string
  exerciseId: string
  exercise: ExerciseMeta | null
  trackingType: 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals'
  notes: string
  restSeconds: number | null
  sets: ProgramSet[]
}

export interface ProgramDay {
  key: string
  name: string
  exercises: ProgramExercise[]
}

export function defaultSet(n: number): ProgramSet {
  return { setNumber: n, setType: 'working', targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: null, restSeconds: 90 }
}

function inferTrackingType(ex: ExerciseMeta): ProgramExercise['trackingType'] {
  if (ex.trackingType) return ex.trackingType as ProgramExercise['trackingType']
  if (ex.bodyPart?.toLowerCase() === 'cardio') return 'cardio'
  if (ex.equipment?.toLowerCase().includes('body weight')) return 'bodyweight'
  return 'strength'
}

function SetEditor({ sets, onChange, trackingType }: {
  sets: ProgramSet[]
  onChange: (sets: ProgramSet[]) => void
  trackingType: string
}) {
  const showWeight = ['strength', 'assisted', 'carry'].includes(trackingType)
  const showReps = ['strength', 'bodyweight', 'assisted'].includes(trackingType)

  const update = (i: number, field: keyof ProgramSet, value: unknown) => {
    onChange(sets.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  return (
    <div className="mt-2">
      <div className={cn('grid gap-1.5 mb-1', showWeight && showReps ? 'grid-cols-[24px_56px_1fr_1fr_44px_16px]' : 'grid-cols-[24px_56px_1fr_44px_16px]')}>
        <span className="text-[10px] text-zinc-400 text-center">#</span>
        <span className="text-[10px] text-zinc-400 text-center">TYPE</span>
        {showWeight && <span className="text-[10px] text-zinc-400 text-center">KG</span>}
        {showReps && <span className="text-[10px] text-zinc-400 text-center">REPS</span>}
        <span className="text-[10px] text-zinc-400 text-center">REST</span>
        <span />
      </div>
      {sets.map((s, i) => (
        <div key={i} className={cn('grid gap-1.5 mb-1.5 items-center', showWeight && showReps ? 'grid-cols-[24px_56px_1fr_1fr_44px_16px]' : 'grid-cols-[24px_56px_1fr_44px_16px]')}>
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
                placeholder="lo"
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
              />
              <span className="text-zinc-300 text-xs shrink-0">–</span>
              <input
                type="number"
                value={s.targetRepsMax ?? ''}
                onChange={e => update(i, 'targetRepsMax', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="hi"
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
              />
            </div>
          )}
          {!showReps && !showWeight && <span />}
          <input
            type="number"
            value={s.restSeconds ?? ''}
            onChange={e => update(i, 'restSeconds', e.target.value ? parseInt(e.target.value) : null)}
            placeholder="s"
            className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
          />
          <button
            onClick={() => onChange(sets.filter((_, idx) => idx !== i).map((s2, idx2) => ({ ...s2, setNumber: idx2 + 1 })))}
            className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...sets, defaultSet(sets.length + 1)])}
        className="mt-1 flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        <Plus className="size-3" /> Add set
      </button>
    </div>
  )
}

interface ProgramBuilderProps {
  title: string
  backHref: string
  initialName?: string
  initialDescription?: string
  initialDays?: ProgramDay[]
  saveLabel?: string
  onSave: (name: string, description: string, days: ProgramDay[]) => Promise<void>
}

export default function ProgramBuilder({
  title,
  backHref,
  initialName = '',
  initialDescription = '',
  initialDays,
  saveLabel = 'Save program',
  onSave,
}: ProgramBuilderProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  const [days, setDays] = useState<ProgramDay[]>(
    initialDays ?? [{ key: 'day-0', name: 'Monday', exercises: [] }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pickerDayKey, setPickerDayKey] = useState<string | null>(null)

  const addDay = () => {
    setDays(prev => [...prev, { key: `day-${Date.now()}`, name: WEEKDAYS[prev.length % 7], exercises: [] }])
  }

  const removeDay = (key: string) => setDays(prev => prev.filter(d => d.key !== key))
  const updateDayName = (key: string, val: string) => setDays(prev => prev.map(d => d.key === key ? { ...d, name: val } : d))

  const addExercise = (dayKey: string, ex: ExerciseMeta) => {
    setPickerDayKey(null)
    setDays(prev => prev.map(d => {
      if (d.key !== dayKey) return d
      const newEx: ProgramExercise = {
        key: `ex-${Date.now()}-${Math.random()}`,
        exerciseId: ex.id,
        exercise: ex,
        trackingType: inferTrackingType(ex),
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

  const updateSets = (dayKey: string, exKey: string, sets: ProgramSet[]) => {
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
      await onSave(name, description, days)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save program')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {pickerDayKey && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setPickerDayKey(null)} />
          <ExercisePicker
            onSelect={ex => addExercise(pickerDayKey, ex)}
            onClose={() => setPickerDayKey(null)}
          />
        </>
      )}

      <div className="mb-6 flex items-center gap-3">
        <Link href={backHref} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <h1 className="font-black text-xl text-zinc-900 dark:text-white">{title}</h1>
      </div>

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

      <div className="space-y-4 mb-6">
        {days.map(day => (
          <div key={day.key} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
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
            <div className="px-4 py-3 space-y-4">
              {day.exercises.length === 0 && (
                <p className="text-xs text-zinc-400 text-center py-2">No exercises yet</p>
              )}
              {day.exercises.map(ex => (
                <div key={ex.key} className="border border-zinc-100 dark:border-zinc-800 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                          {ex.exercise?.name ?? ex.exerciseId}
                        </p>
                        {ex.exercise?.isCustom && (
                          <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold">Mine</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400">
                        {ex.exercise?.bodyPart} · {ex.exercise?.equipment}
                      </p>
                    </div>
                    <button
                      onClick={() => removeExercise(day.key, ex.key)}
                      className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors shrink-0"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <SetEditor
                    sets={ex.sets}
                    trackingType={ex.trackingType}
                    onChange={sets => updateSets(day.key, ex.key, sets)}
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
        {saveLabel}
      </button>
    </div>
  )
}
