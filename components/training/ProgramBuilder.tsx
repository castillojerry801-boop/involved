'use client'

import { useState } from 'react'
import { useWeightUnit } from '@/lib/hooks/use-weight-unit'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Copy, Loader2, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import ExercisePicker from '@/components/training/ExercisePicker'
import type { ExerciseMeta } from '@/lib/exercises'
import {
  quickEntryToSets,
  defaultPrescription,
  prescriptionFromSets,
  WEEKDAY_FULL,
  type QuickPrescription,
  type ProgramSetInput,
} from '@/lib/training/program-scheduling'

export interface ProgramSet {
  setNumber: number
  setType: 'warmup' | 'working' | 'amrap'
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetWeightKg: number | null
  targetDurationSeconds: number | null
  targetDistanceM: number | null
  restSeconds: number | null
  notes: string | null
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
  weekday: number | null
  focus: string
  exercises: ProgramExercise[]
}

export function defaultSet(n: number): ProgramSet {
  return {
    setNumber: n,
    setType: 'working',
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetWeightKg: null,
    targetDurationSeconds: null,
    targetDistanceM: null,
    restSeconds: 90,
    notes: null,
  }
}

function inferTrackingType(ex: ExerciseMeta): ProgramExercise['trackingType'] {
  if (ex.trackingType) return ex.trackingType as ProgramExercise['trackingType']
  if (ex.bodyPart?.toLowerCase() === 'cardio') return 'cardio'
  if (ex.equipment?.toLowerCase().includes('body weight')) return 'bodyweight'
  return 'strength'
}

function toSetInput(s: ProgramSet): ProgramSetInput {
  return {
    setNumber: s.setNumber,
    setType: s.setType,
    targetRepsMin: s.targetRepsMin,
    targetRepsMax: s.targetRepsMax,
    targetWeightKg: s.targetWeightKg,
    targetDurationSeconds: s.targetDurationSeconds,
    targetDistanceM: s.targetDistanceM,
    restSeconds: s.restSeconds,
  }
}

function fromSetInput(s: ProgramSetInput): ProgramSet {
  return { ...s, notes: null }
}

// ─── PrescriptionEditor ────────────────────────────────────────────────────────

function PrescriptionEditor({
  prescription,
  onChange,
  trackingType,
}: {
  prescription: QuickPrescription
  onChange: (p: QuickPrescription) => void
  trackingType: string
}) {
  const showWeight = ['strength', 'assisted', 'carry'].includes(trackingType)
  const showReps = !['cardio', 'isometric'].includes(trackingType)
  const showDuration = ['cardio', 'isometric', 'intervals'].includes(trackingType)

  const u = <K extends keyof QuickPrescription>(field: K, value: QuickPrescription[K]) =>
    onChange({ ...prescription, [field]: value })
  const { unit, toDisplay, fromInput } = useWeightUnit()

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            max={20}
            value={prescription.sets}
            onChange={e => u('sets', Math.max(1, parseInt(e.target.value) || 1))}
            onFocus={e => e.currentTarget.select()}
            className="w-12 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
          />
          <span className="text-xs text-zinc-400">sets</span>
        </div>
        {showReps && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={prescription.repsMin ?? ''}
              onChange={e => u('repsMin', e.target.value ? parseInt(e.target.value) : null)}
              onFocus={e => e.currentTarget.select()}
              placeholder="8"
              className="w-10 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1.5 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
            />
            <span className="text-xs text-zinc-300">–</span>
            <input
              type="number"
              min={1}
              value={prescription.repsMax ?? ''}
              onChange={e => u('repsMax', e.target.value ? parseInt(e.target.value) : null)}
              onFocus={e => e.currentTarget.select()}
              placeholder="12"
              className="w-10 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1.5 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
            />
            <span className="text-xs text-zinc-400">reps</span>
          </div>
        )}
        {showDuration && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={prescription.duration ?? ''}
              onChange={e => u('duration', e.target.value ? parseInt(e.target.value) : null)}
              onFocus={e => e.currentTarget.select()}
              placeholder="sec"
              className="w-14 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
            />
            <span className="text-xs text-zinc-400">sec</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            value={prescription.rest}
            onChange={e => u('rest', parseInt(e.target.value) || 0)}
            onFocus={e => e.currentTarget.select()}
            className="w-14 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
          />
          <span className="text-xs text-zinc-400">s rest</span>
        </div>
      </div>
      {showWeight && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step={0.5}
              value={toDisplay(prescription.baseWeightKg)}
              onChange={e => u('baseWeightKg', fromInput(e.target.value) ?? null)}
              onFocus={e => e.currentTarget.select()}
              placeholder={`base ${unit}`}
              className="w-20 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
            />
            <span className="text-xs text-zinc-400">{unit}</span>
          </div>
          <select
            value={prescription.progressionMode}
            onChange={e => u('progressionMode', e.target.value as QuickPrescription['progressionMode'])}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none"
          >
            <option value="same">Same weight</option>
            <option value="increase">Increase each set</option>
            <option value="decrease">Decrease each set</option>
            <option value="custom">Custom</option>
          </select>
          {(prescription.progressionMode === 'increase' || prescription.progressionMode === 'decrease') && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                step={0.5}
                value={toDisplay(prescription.progressionStep)}
                onChange={e => u('progressionStep', fromInput(e.target.value) ?? null)}
                onFocus={e => e.currentTarget.select()}
                placeholder="step"
                className="w-14 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
              />
              <span className="text-xs text-zinc-400">{unit}/set</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── AdvancedSetEditor ─────────────────────────────────────────────────────────

function AdvancedSetEditor({
  sets,
  onChange,
  trackingType,
}: {
  sets: ProgramSet[]
  onChange: (sets: ProgramSet[]) => void
  trackingType: string
}) {
  const showWeight = ['strength', 'assisted', 'carry'].includes(trackingType)
  const showReps = !['cardio', 'isometric'].includes(trackingType)
  const colClass = showWeight && showReps
    ? 'grid-cols-[20px_52px_1fr_1fr_40px_16px]'
    : 'grid-cols-[20px_52px_1fr_40px_16px]'

  const update = (i: number, field: keyof ProgramSet, value: unknown) =>
    onChange(sets.map((s, idx) => idx === i ? { ...s, [field]: value } : s))

  return (
    <div className="mt-2">
      <div className={cn('grid gap-1.5 mb-1', colClass)}>
        <span className="text-[10px] text-zinc-400">#</span>
        <span className="text-[10px] text-zinc-400">TYPE</span>
        {showWeight && <span className="text-[10px] text-zinc-400 text-center">KG</span>}
        {showReps && <span className="text-[10px] text-zinc-400 text-center">REPS</span>}
        <span className="text-[10px] text-zinc-400 text-center">REST</span>
        <span />
      </div>
      {sets.map((s, i) => (
        <div key={i} className={cn('grid gap-1.5 mb-1.5 items-center', colClass)}>
          <span className="text-xs text-zinc-400">{s.setNumber}</span>
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
              onFocus={e => e.currentTarget.select()}
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
                onFocus={e => e.currentTarget.select()}
                placeholder="lo"
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
              />
              <span className="text-zinc-300 text-xs shrink-0">–</span>
              <input
                type="number"
                value={s.targetRepsMax ?? ''}
                onChange={e => update(i, 'targetRepsMax', e.target.value ? parseInt(e.target.value) : null)}
                onFocus={e => e.currentTarget.select()}
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
            onFocus={e => e.currentTarget.select()}
            placeholder="s"
            className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none"
          />
          <button
            onClick={() => onChange(
              sets.filter((_, idx) => idx !== i).map((s2, idx2) => ({ ...s2, setNumber: idx2 + 1 }))
            )}
            className="p-0.5 text-zinc-300 hover:text-red-500 transition-colors"
          >
            <span className="text-sm leading-none">×</span>
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

// ─── ExerciseCard ──────────────────────────────────────────────────────────────

function ExerciseCard({
  ex,
  prescription,
  isAdvanced,
  onRemove,
  onPrescriptionChange,
  onSetsChange,
  onToggleAdvanced,
}: {
  ex: ProgramExercise
  prescription: QuickPrescription
  isAdvanced: boolean
  onRemove: () => void
  onPrescriptionChange: (p: QuickPrescription) => void
  onSetsChange: (sets: ProgramSet[]) => void
  onToggleAdvanced: () => void
}) {
  return (
    <div className="border border-zinc-100 dark:border-zinc-800 rounded-xl p-3">
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
            {ex.exercise?.bodyPart}{ex.exercise?.equipment ? ` · ${ex.exercise.equipment}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onToggleAdvanced}
            className="px-2 py-1 rounded-lg text-[10px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
          >
            {isAdvanced ? 'Quick' : 'Advanced'}
          </button>
          <button
            onClick={onRemove}
            className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {isAdvanced ? (
        <AdvancedSetEditor
          sets={ex.sets}
          trackingType={ex.trackingType}
          onChange={onSetsChange}
        />
      ) : (
        <PrescriptionEditor
          prescription={prescription}
          onChange={onPrescriptionChange}
          trackingType={ex.trackingType}
        />
      )}
    </div>
  )
}

// ─── ProgramBuilder ────────────────────────────────────────────────────────────

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
  const [days, setDays] = useState<ProgramDay[]>(
    initialDays ?? [{ key: 'day-0', name: 'Day 1', weekday: null, focus: '', exercises: [] }]
  )
  const [weekdayMode, setWeekdayMode] = useState(() => {
    if (!initialDays) return true  // new programs default to weekly schedule
    return initialDays.some(d => d.weekday != null)
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pickerDayKey, setPickerDayKey] = useState<string | null>(null)

  // Quick-entry prescriptions keyed by exercise key
  const [prescriptions, setPrescriptions] = useState<Record<string, QuickPrescription>>(() => {
    const map: Record<string, QuickPrescription> = {}
    for (const day of initialDays ?? []) {
      for (const ex of day.exercises) {
        const { prescription } = prescriptionFromSets(ex.sets.map(s => ({
          setNumber: s.setNumber,
          setType: s.setType,
          targetRepsMin: s.targetRepsMin,
          targetRepsMax: s.targetRepsMax,
          targetWeightKg: s.targetWeightKg,
          targetDurationSeconds: s.targetDurationSeconds,
          targetDistanceM: s.targetDistanceM,
          restSeconds: s.restSeconds,
        })))
        map[ex.key] = prescription
      }
    }
    return map
  })

  // Which exercises are in advanced (per-set) mode
  const [advancedMode, setAdvancedMode] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const day of initialDays ?? []) {
      for (const ex of day.exercises) {
        const { mode } = prescriptionFromSets(ex.sets.map(s2 => ({
          setNumber: s2.setNumber,
          setType: s2.setType,
          targetRepsMin: s2.targetRepsMin,
          targetRepsMax: s2.targetRepsMax,
          targetWeightKg: s2.targetWeightKg,
          targetDurationSeconds: s2.targetDurationSeconds,
          targetDistanceM: s2.targetDistanceM,
          restSeconds: s2.restSeconds,
        })))
        if (mode === 'advanced') s.add(ex.key)
      }
    }
    return s
  })

  // ─── Day operations ──────────────────────────────────────────────────────────

  const addDay = () => {
    setDays(prev => [
      ...prev,
      { key: `day-${Date.now()}`, name: `Day ${prev.length + 1}`, weekday: null, focus: '', exercises: [] },
    ])
  }

  const duplicateDay = (key: string) => {
    setDays(prev => {
      const idx = prev.findIndex(d => d.key === key)
      if (idx === -1) return prev
      const src = prev[idx]
      const newKey = `day-${Date.now()}`
      const newExercises = src.exercises.map(ex => {
        const newExKey = `ex-${Date.now()}-${Math.random()}`
        setPrescriptions(p => ({ ...p, [newExKey]: prescriptions[ex.key] ?? defaultPrescription(ex.trackingType) }))
        if (advancedMode.has(ex.key)) {
          setAdvancedMode(s => new Set([...s, newExKey]))
        }
        return { ...ex, key: newExKey }
      })
      const newDay: ProgramDay = { ...src, key: newKey, name: `${src.name} (copy)`, weekday: null, exercises: newExercises }
      return [...prev.slice(0, idx + 1), newDay, ...prev.slice(idx + 1)]
    })
  }

  const removeDay = (key: string) => setDays(prev => prev.filter(d => d.key !== key))

  const updateDay = (key: string, patch: Partial<ProgramDay>) =>
    setDays(prev => prev.map(d => d.key === key ? { ...d, ...patch } : d))

  // ─── Exercise operations ─────────────────────────────────────────────────────

  const addExercise = (dayKey: string, ex: ExerciseMeta) => {
    setPickerDayKey(null)
    const exKey = `ex-${Date.now()}-${Math.random()}`
    const trackingType = inferTrackingType(ex)
    const prescription = defaultPrescription(trackingType)
    const sets = quickEntryToSets(prescription).map(fromSetInput)
    setPrescriptions(prev => ({ ...prev, [exKey]: prescription }))
    setDays(prev => prev.map(d => {
      if (d.key !== dayKey) return d
      const newEx: ProgramExercise = { key: exKey, exerciseId: ex.id, exercise: ex, trackingType, notes: '', restSeconds: 90, sets }
      return { ...d, exercises: [...d.exercises, newEx] }
    }))
  }

  const removeExercise = (dayKey: string, exKey: string) => {
    setDays(prev => prev.map(d =>
      d.key === dayKey ? { ...d, exercises: d.exercises.filter(e => e.key !== exKey) } : d
    ))
    setPrescriptions(prev => { const n = { ...prev }; delete n[exKey]; return n })
    setAdvancedMode(prev => { const n = new Set(prev); n.delete(exKey); return n })
  }

  const updatePrescription = (dayKey: string, exKey: string, p: QuickPrescription) => {
    setPrescriptions(prev => ({ ...prev, [exKey]: p }))
    if (!advancedMode.has(exKey)) {
      const newSets = quickEntryToSets(p).map(fromSetInput)
      setDays(prev => prev.map(d =>
        d.key === dayKey ? {
          ...d,
          exercises: d.exercises.map(e => e.key === exKey ? { ...e, sets: newSets } : e),
        } : d
      ))
    }
  }

  const updateSets = (dayKey: string, exKey: string, sets: ProgramSet[]) => {
    setDays(prev => prev.map(d =>
      d.key === dayKey ? {
        ...d,
        exercises: d.exercises.map(e => e.key === exKey ? { ...e, sets } : e),
      } : d
    ))
  }

  const toggleAdvanced = (dayKey: string, exKey: string) => {
    if (advancedMode.has(exKey)) {
      // switching back to quick — re-derive prescription from current sets
      const day = days.find(d => d.key === dayKey)
      const ex = day?.exercises.find(e => e.key === exKey)
      if (ex) {
        const { prescription } = prescriptionFromSets(ex.sets.map(toSetInput))
        setPrescriptions(prev => ({ ...prev, [exKey]: prescription }))
      }
      setAdvancedMode(prev => { const n = new Set(prev); n.delete(exKey); return n })
    } else {
      setAdvancedMode(prev => new Set([...prev, exKey]))
    }
  }

  // ─── Save ────────────────────────────────────────────────────────────────────

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
        <h1 className="font-black text-xl text-zinc-900 dark:text-white flex-1">{title}</h1>
        <button
          onClick={() => setWeekdayMode(m => !m)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
            weekdayMode
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          )}
        >
          <Calendar className="size-3.5" />
          Week schedule
        </button>
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
            {/* Day header */}
            <div className="px-4 pt-3 pb-2 border-b border-zinc-50 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={day.name}
                  onChange={e => updateDay(day.key, { name: e.target.value })}
                  className="flex-1 bg-transparent text-sm font-bold text-zinc-900 dark:text-white focus:outline-none min-w-0"
                />
                <button
                  onClick={() => duplicateDay(day.key)}
                  className="p-1 rounded-lg text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  title="Duplicate day"
                >
                  <Copy className="size-3.5" />
                </button>
                {days.length > 1 && (
                  <button
                    onClick={() => removeDay(day.key)}
                    className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>

              {weekdayMode && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-zinc-400 shrink-0">Day:</span>
                  <select
                    value={day.weekday ?? ''}
                    onChange={e => updateDay(day.key, { weekday: e.target.value !== '' ? parseInt(e.target.value) : null })}
                    className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none"
                  >
                    <option value="">Unscheduled</option>
                    {WEEKDAY_FULL.map((label, i) => (
                      <option key={i} value={i}>{label}</option>
                    ))}
                  </select>
                </div>
              )}

              <input
                type="text"
                value={day.focus}
                onChange={e => updateDay(day.key, { focus: e.target.value })}
                placeholder="Focus (e.g. Chest & Triceps)"
                className="mt-2 w-full bg-transparent text-xs text-zinc-500 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none"
              />
            </div>

            {/* Exercises */}
            <div className="px-4 py-3 space-y-3">
              {day.exercises.length === 0 && (
                <p className="text-xs text-zinc-400 text-center py-2">No exercises yet</p>
              )}
              {day.exercises.map(ex => (
                <ExerciseCard
                  key={ex.key}
                  ex={ex}
                  prescription={prescriptions[ex.key] ?? defaultPrescription(ex.trackingType)}
                  isAdvanced={advancedMode.has(ex.key)}
                  onRemove={() => removeExercise(day.key, ex.key)}
                  onPrescriptionChange={p => updatePrescription(day.key, ex.key, p)}
                  onSetsChange={sets => updateSets(day.key, ex.key, sets)}
                  onToggleAdvanced={() => toggleAdvanced(day.key, ex.key)}
                />
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
