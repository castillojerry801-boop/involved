'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import ExercisePicker from '@/components/training/ExercisePicker'
import type { ExerciseMeta } from '@/lib/exercises'
import { useWeightUnit } from '@/lib/hooks/use-weight-unit'

interface TemplateSet {
  setNumber: number
  setType: 'warmup' | 'working' | 'amrap'
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetWeightKg: number | null
  restSeconds: number | null
}

interface TemplateExercise {
  key: string
  exerciseId: string
  exercise: ExerciseMeta | null
  trackingType: 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals'
  restSeconds: number | null
  sets: TemplateSet[]
}

interface EquipmentProfile {
  id: string
  name: string
}

function defaultSet(n: number): TemplateSet {
  return { setNumber: n, setType: 'working', targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: null, restSeconds: 90 }
}

function SetEditor({ sets, onChange, trackingType }: {
  sets: TemplateSet[]
  onChange: (sets: TemplateSet[]) => void
  trackingType: string
}) {
  const showWeight = ['strength', 'assisted', 'carry'].includes(trackingType)
  const showReps = ['strength', 'bodyweight', 'assisted'].includes(trackingType)
  const { unit, toDisplay, fromInput } = useWeightUnit()

  const update = (i: number, field: keyof TemplateSet, value: unknown) => {
    onChange(sets.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  return (
    <div className="mt-2 space-y-1">
      {/* Column headers */}
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase text-zinc-400 ${showWeight && showReps ? 'grid grid-cols-[20px_1fr_1fr_48px_20px]' : showWeight ? 'grid grid-cols-[20px_1fr_48px_20px]' : 'grid grid-cols-[20px_1fr_48px_20px]'}`}>
        <span className="text-center">#</span>
        {showWeight && <span className="text-center">{unit.toUpperCase()}</span>}
        {showReps && <span className="text-center">Reps</span>}
        <span className="text-center">Rest</span>
        <span />
      </div>
      {sets.map((s, i) => (
        <div key={i} className={`flex items-center gap-1.5 ${showWeight && showReps ? 'grid grid-cols-[20px_1fr_1fr_48px_20px]' : showWeight ? 'grid grid-cols-[20px_1fr_48px_20px]' : 'grid grid-cols-[20px_1fr_48px_20px]'}`}>
          <span className="text-xs text-zinc-400 text-center">{s.setNumber}</span>
          {showWeight && (
            <input type="number"
              value={toDisplay(s.targetWeightKg)}
              onChange={e => update(i, 'targetWeightKg', fromInput(e.target.value) ?? null)}
              placeholder={unit} className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none" />
          )}
          {showReps && (
            <div className="flex items-center gap-0.5">
              <input type="number" value={s.targetRepsMin ?? ''} onChange={e => update(i, 'targetRepsMin', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="lo" className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none" />
              <span className="text-zinc-300 text-[10px]">–</span>
              <input type="number" value={s.targetRepsMax ?? ''} onChange={e => update(i, 'targetRepsMax', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="hi" className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none" />
            </div>
          )}
          <input type="number" value={s.restSeconds ?? ''} onChange={e => update(i, 'restSeconds', e.target.value ? parseInt(e.target.value) : null)}
            placeholder="s" className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-center text-zinc-900 dark:text-white focus:outline-none" />
          <button onClick={() => onChange(sets.filter((_, idx) => idx !== i).map((s2, idx2) => ({ ...s2, setNumber: idx2 + 1 })))}
            className="flex items-center justify-center p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors">
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...sets, defaultSet(sets.length + 1)])}
        className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
        <Plus className="size-3" /> Add set
      </button>
    </div>
  )
}

export default function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [equipmentProfileId, setEquipmentProfileId] = useState<string>('')
  const [exercises, setExercises] = useState<TemplateExercise[]>([])
  const [profiles, setProfiles] = useState<EquipmentProfile[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch(`/api/templates/${id}`).then(r => r.json() as Promise<{ template: { name: string; description: string | null; equipmentProfileId: string | null; exercises: Array<{ id: string; exerciseId: string; trackingType: string; restSeconds: number | null; exercise: ExerciseMeta | null; sets: Array<{ setNumber: number; setType: string; targetRepsMin: number | null; targetRepsMax: number | null; targetWeightKg: number | null; restSeconds: number | null }> }> } }>),
      fetch('/api/training/equipment').then(r => r.json() as Promise<{ profiles: EquipmentProfile[] }>),
    ]).then(([td, ed]) => {
      const t = td.template
      setName(t.name)
      setDescription(t.description ?? '')
      setEquipmentProfileId(t.equipmentProfileId ?? '')
      setExercises(t.exercises.map(ex => ({
        key: ex.id,
        exerciseId: ex.exerciseId,
        exercise: ex.exercise,
        trackingType: ex.trackingType as TemplateExercise['trackingType'],
        restSeconds: ex.restSeconds,
        sets: ex.sets.length > 0
          ? ex.sets.map(s => ({ ...s, setType: s.setType as 'warmup' | 'working' | 'amrap' }))
          : [defaultSet(1), defaultSet(2), defaultSet(3)],
      })))
      setProfiles(ed.profiles ?? [])
    }).catch(() => setError('Failed to load template')).finally(() => setLoading(false))
  }, [id])

  const addExercise = (ex: ExerciseMeta) => {
    setShowPicker(false)
    const trackingType: TemplateExercise['trackingType'] =
      (ex.trackingType as TemplateExercise['trackingType']) ??
      (ex.bodyPart?.toLowerCase() === 'cardio' ? 'cardio' :
       ex.equipment?.toLowerCase().includes('body weight') ? 'bodyweight' : 'strength')
    setExercises(prev => [...prev, {
      key: `ex-${Date.now()}-${Math.random()}`,
      exerciseId: ex.id,
      exercise: ex,
      trackingType,
      restSeconds: 90,
      sets: [defaultSet(1), defaultSet(2), defaultSet(3)],
    }])
  }

  const removeExercise = (key: string) => setExercises(prev => prev.filter(e => e.key !== key))
  const updateSets = (key: string, sets: TemplateSet[]) => setExercises(prev => prev.map(e => e.key === key ? { ...e, sets } : e))

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        equipmentProfileId: equipmentProfileId || null,
        exercises: exercises.map((ex, ei) => ({
          exerciseId: ex.exerciseId,
          sortOrder: ei,
          trackingType: ex.trackingType,
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
      }
      const res = await fetch(`/api/templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Failed to save'); return
      }
      router.push('/training/templates')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-zinc-400" /></div>

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {showPicker && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setShowPicker(false)} />
          <ExercisePicker onSelect={addExercise} onClose={() => setShowPicker(false)} />
        </>
      )}

      <div className="mb-6 flex items-center gap-3">
        <Link href="/training/templates" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <h1 className="font-black text-xl text-zinc-900 dark:text-white">Edit template</h1>
      </div>

      <div className="mb-6 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Name *</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Description (optional)</label>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500" />
        </div>
        {profiles.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500">Equipment profile (optional)</label>
            <select value={equipmentProfileId} onChange={e => setEquipmentProfileId(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none">
              <option value="">None</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-50 dark:border-zinc-800">
          <p className="text-sm font-bold text-zinc-900 dark:text-white">Exercises</p>
        </div>
        <div className="px-4 py-3 space-y-4">
          {exercises.length === 0 && <p className="text-xs text-zinc-400 text-center py-2">No exercises</p>}
          {exercises.map(ex => (
            <div key={ex.key} className="border border-zinc-100 dark:border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">{ex.exercise?.name ?? ex.exerciseId}</p>
                    {ex.exercise?.isCustom && (
                      <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold">Mine</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">{ex.exercise?.bodyPart} · {ex.exercise?.equipment}</p>
                </div>
                <button onClick={() => removeExercise(ex.key)}
                  className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors shrink-0">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <SetEditor sets={ex.sets} trackingType={ex.trackingType} onChange={sets => updateSets(ex.key, sets)} />
            </div>
          ))}
          <button onClick={() => setShowPicker(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
            <Plus className="size-3.5" /> Add exercise
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <button onClick={handleSave} disabled={saving}
        className={cn('w-full flex items-center justify-center gap-2 rounded-2xl py-4 font-black text-base transition-opacity',
          'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50')}>
        {saving && <Loader2 className="size-5 animate-spin" />}
        Save changes
      </button>
    </div>
  )
}
