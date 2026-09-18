'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExerciseMeta } from '@/lib/exercises'

const TRACKING_TYPES = [
  { value: 'strength', label: 'Strength (weight × reps)' },
  { value: 'bodyweight', label: 'Bodyweight (reps only)' },
  { value: 'assisted', label: 'Assisted (assistance × reps)' },
  { value: 'cardio', label: 'Cardio (time + distance)' },
  { value: 'carry', label: 'Carry (weight + distance)' },
  { value: 'isometric', label: 'Isometric (time only)' },
  { value: 'intervals', label: 'Intervals' },
]

const BODY_PARTS = ['back', 'chest', 'shoulders', 'upper arms', 'lower arms', 'upper legs', 'lower legs', 'waist', 'neck', 'cardio', 'other']

interface FormState {
  name: string
  bodyPart: string
  targetMuscle: string
  equipment: string
  trackingType: string
  instructions: string
}

const EMPTY_FORM: FormState = {
  name: '',
  bodyPart: '',
  targetMuscle: '',
  equipment: '',
  trackingType: 'strength',
  instructions: '',
}

function ExerciseForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: FormState
  onSave: (f: FormState) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState(initial)
  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-3">
      <div>
        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="e.g. Keg press, Nordic curl..."
          className="mt-1 w-full h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Body part</label>
          <select
            value={form.bodyPart}
            onChange={e => set('bodyPart', e.target.value)}
            className="mt-1 w-full h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none capitalize"
          >
            <option value="">Select...</option>
            {BODY_PARTS.map(bp => <option key={bp} value={bp}>{bp}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Target muscle</label>
          <input
            type="text"
            value={form.targetMuscle}
            onChange={e => set('targetMuscle', e.target.value)}
            placeholder="e.g. glutes"
            className="mt-1 w-full h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Equipment</label>
          <input
            type="text"
            value={form.equipment}
            onChange={e => set('equipment', e.target.value)}
            placeholder="e.g. barbell, band"
            className="mt-1 w-full h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Tracking type</label>
          <select
            value={form.trackingType}
            onChange={e => set('trackingType', e.target.value)}
            className="mt-1 w-full h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none"
          >
            {TRACKING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Instructions (optional)</label>
        <textarea
          value={form.instructions}
          onChange={e => set('instructions', e.target.value)}
          placeholder="How to perform this exercise..."
          rows={3}
          className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white resize-none"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 h-10 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5"
        >
          <X className="size-3.5" /> Cancel
        </button>
        <button
          onClick={() => form.name.trim() && onSave(form)}
          disabled={!form.name.trim() || saving}
          className="flex-1 h-10 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-1.5"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Save
        </button>
      </div>
    </div>
  )
}

export default function CustomExercisesPage() {
  const [exercises, setExercises] = useState<ExerciseMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/custom-exercises')
      .then(r => r.json() as Promise<{ exercises: ExerciseMeta[] }>)
      .then(d => setExercises(d.exercises ?? []))
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = async (form: FormState) => {
    setSaving(true)
    try {
      const res = await fetch('/api/custom-exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json() as { exercise: ExerciseMeta }
      if (res.ok) {
        setExercises(prev => [data.exercise, ...prev])
        setCreating(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (id: string, form: FormState) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/custom-exercises/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json() as { exercise: ExerciseMeta }
      if (res.ok) {
        setExercises(prev => prev.map(e => e.id === id ? data.exercise : e))
        setEditingId(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/custom-exercises/${id}`, { method: 'DELETE' })
      setExercises(prev => prev.filter(e => e.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/training" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Custom exercises</h1>
          <p className="text-sm text-zinc-500">{exercises.length} exercise{exercises.length !== 1 ? 's' : ''}</p>
        </div>
        {!creating && (
          <button
            onClick={() => { setCreating(true); setEditingId(null) }}
            className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-2 text-sm font-bold hover:opacity-90"
          >
            <Plus className="size-3.5" /> New
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-zinc-400" /></div>
      ) : (
        <div className="space-y-3">
          {creating && (
            <ExerciseForm
              initial={EMPTY_FORM}
              onSave={handleCreate}
              onCancel={() => setCreating(false)}
              saving={saving}
            />
          )}

          {exercises.length === 0 && !creating && (
            <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-8 text-center">
              <p className="text-sm text-zinc-400 mb-3">No custom exercises yet</p>
              <button
                onClick={() => setCreating(true)}
                className="text-sm font-semibold text-zinc-900 dark:text-white underline"
              >
                Create your first one
              </button>
            </div>
          )}

          {exercises.map(ex => (
            <div key={ex.id} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              {editingId === ex.id ? (
                <div className="p-4">
                  <ExerciseForm
                    initial={{
                      name: ex.name,
                      bodyPart: ex.bodyPart ?? '',
                      targetMuscle: ex.target ?? '',
                      equipment: ex.equipment ?? '',
                      trackingType: ex.trackingType ?? 'strength',
                      instructions: ex.instructions?.[0] ?? '',
                    }}
                    onSave={form => handleUpdate(ex.id, form)}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                </div>
              ) : (
                <div className="p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-zinc-900 dark:text-white">{ex.name}</p>
                    <p className="text-xs text-zinc-400 mt-0.5 capitalize">
                      {[ex.bodyPart, ex.target, ex.equipment].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5 capitalize">{ex.trackingType?.replace('_', ' ')}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => { setEditingId(ex.id); setCreating(false) }}
                      className="flex size-7 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Pencil className="size-3.5 text-zinc-400" />
                    </button>
                    <button
                      onClick={() => handleDelete(ex.id)}
                      disabled={deletingId === ex.id}
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors',
                        deletingId === ex.id && 'opacity-50'
                      )}
                    >
                      {deletingId === ex.id
                        ? <Loader2 className="size-3.5 text-red-400 animate-spin" />
                        : <Trash2 className="size-3.5 text-red-400" />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
