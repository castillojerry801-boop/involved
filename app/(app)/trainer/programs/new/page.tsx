'use client'

import { useState, useRef } from 'react'
import { useWeightUnit } from '@/lib/hooks/use-weight-unit'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Search, GripVertical, ChevronDown, ChevronUp, Loader2, Check, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Local types ──────────────────────────────────────────────────────────────

interface ExerciseResult {
  id:   string
  name: string
  bodyPart: string
  equipment: string
  target: string
}

interface SetDraft {
  setNumber:      number
  targetRepsMin?: number
  targetRepsMax?: number
  targetWeightKg?: number
  restSeconds?:   number
}

interface ExerciseDraft {
  id:           string   // local uuid
  exerciseId:   string
  exerciseName: string
  sortOrder:    number
  trackingType: 'reps' | 'time' | 'distance'
  restSeconds?: number
  notes?:       string
  sets:         SetDraft[]
  expanded:     boolean
}

interface DayDraft {
  id:        string   // local uuid
  name:      string
  exercises: ExerciseDraft[]
  expanded:  boolean
}

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const
const LBS_PER_KG = 2.20462

function kgToDisplay(kg: number | undefined, unit: 'kg' | 'lbs'): string {
  if (kg === undefined || kg === null) return ''
  return unit === 'lbs' ? String(Math.round(kg * LBS_PER_KG * 10) / 10) : String(kg)
}
function inputToKg(val: string, unit: 'kg' | 'lbs'): number | undefined {
  if (!val) return undefined
  const n = Number(val)
  if (isNaN(n)) return undefined
  return unit === 'lbs' ? Math.round((n / LBS_PER_KG) * 100) / 100 : n
}

let _uid = 0
function uid() { return `local_${++_uid}` }

function buildSets(
  numSets: number,
  repsMin: number,
  repsMax: number,
  weightKg: number | undefined,
  restSec: number,
  progressive: boolean,
  endWeightKg: number | undefined,
): SetDraft[] {
  return Array.from({ length: numSets }, (_, i) => {
    let w = weightKg
    if (progressive && weightKg !== undefined && endWeightKg !== undefined && numSets > 1) {
      const raw = weightKg + ((endWeightKg - weightKg) * i) / (numSets - 1)
      w = Math.round(raw * 100) / 100
    }
    return { setNumber: i + 1, targetRepsMin: repsMin, targetRepsMax: repsMax, targetWeightKg: w, restSeconds: restSec }
  })
}

function defaultExercise(result: ExerciseResult, sortOrder: number): ExerciseDraft {
  return {
    id:           uid(),
    exerciseId:   result.id,
    exerciseName: result.name,
    sortOrder,
    trackingType: 'reps',
    sets:         buildSets(3, 8, 12, undefined, 90, false, undefined),
    expanded:     true,
  }
}

// ─── ExerciseCard ─────────────────────────────────────────────────────────────

function ExerciseCard({
  ex,
  unit,
  onChange,
  onRemove,
}: {
  ex: ExerciseDraft
  unit: 'kg' | 'lbs'
  onChange: (patch: Partial<ExerciseDraft>) => void
  onRemove: () => void
}) {
  const [numSets, setNumSets]         = useState(Math.max(ex.sets.length, 1))
  const [repsMin, setRepsMin]         = useState(ex.sets[0]?.targetRepsMin ?? 8)
  const [repsMax, setRepsMax]         = useState(ex.sets[0]?.targetRepsMax ?? 12)
  const [weightKg, setWeightKg]       = useState<number | undefined>(ex.sets[0]?.targetWeightKg)
  const [restSec, setRestSec]         = useState(ex.sets[0]?.restSeconds ?? 90)
  const [progressive, setProgressive] = useState(false)
  const [endWeightKg, setEndWeightKg] = useState<number | undefined>()
  const [advanced, setAdvanced]       = useState(false)

  function push(patch: {
    n?: number; rMin?: number; rMax?: number
    wKg?: number | undefined; rest?: number
    prog?: boolean; eKg?: number | undefined
  }) {
    const n    = patch.n    !== undefined ? patch.n    : numSets
    const rMin = patch.rMin !== undefined ? patch.rMin : repsMin
    const rMax = patch.rMax !== undefined ? patch.rMax : repsMax
    const wKg  = 'wKg' in patch ? patch.wKg : weightKg
    const rest = patch.rest !== undefined ? patch.rest : restSec
    const prog = patch.prog !== undefined ? patch.prog : progressive
    const eKg  = 'eKg' in patch ? patch.eKg : endWeightKg
    onChange({ sets: buildSets(n, rMin, rMax, wKg, rest, prog, eKg) })
  }

  function removeSetAt(i: number) {
    const sets = ex.sets.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, setNumber: idx + 1 }))
    onChange({ sets })
    setNumSets(sets.length)
  }

  return (
    <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800/60">
        <GripVertical className="size-4 text-zinc-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{ex.exerciseName}</p>
        </div>
        <button
          onClick={() => onChange({ expanded: !ex.expanded })}
          className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          {ex.expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        <button onClick={onRemove} className="shrink-0 text-zinc-300 hover:text-red-500 transition-colors">
          <Trash2 className="size-4" />
        </button>
      </div>

      {ex.expanded && (
        <div className="p-3 space-y-3">
          {/* Quick entry row */}
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-zinc-400 uppercase block mb-1">Sets</label>
              <input
                type="number"
                min={1}
                value={numSets}
                onChange={e => {
                  const n = Math.max(1, Number(e.target.value) || 1)
                  setNumSets(n)
                  push({ n })
                }}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-2 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:border-zinc-400"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-zinc-400 uppercase block mb-1">Reps</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  value={repsMin}
                  onChange={e => {
                    const v = Math.max(1, Number(e.target.value) || 1)
                    setRepsMin(v)
                    push({ rMin: v })
                  }}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-1 py-2 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:border-zinc-400"
                />
                <span className="text-zinc-300 text-xs shrink-0">–</span>
                <input
                  type="number"
                  min={1}
                  value={repsMax}
                  onChange={e => {
                    const v = Math.max(1, Number(e.target.value) || 1)
                    setRepsMax(v)
                    push({ rMax: v })
                  }}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-1 py-2 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:border-zinc-400"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-zinc-400 uppercase block mb-1">Wt ({unit})</label>
              <input
                type="number"
                placeholder={unit}
                value={kgToDisplay(weightKg, unit)}
                onChange={e => {
                  const kg = inputToKg(e.target.value, unit)
                  setWeightKg(kg)
                  push({ wKg: kg })
                }}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-2 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:border-zinc-400"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-zinc-400 uppercase block mb-1">Rest (s)</label>
              <input
                type="number"
                value={restSec}
                onChange={e => {
                  const v = Number(e.target.value) || 60
                  setRestSec(v)
                  push({ rest: v })
                }}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-2 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:border-zinc-400"
              />
            </div>
          </div>

          {/* Progressive loading toggle */}
          <div>
            <button
              type="button"
              onClick={() => {
                const p = !progressive
                setProgressive(p)
                push({ prog: p })
              }}
              className={cn(
                'flex items-center gap-2 text-xs font-semibold transition-colors',
                progressive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              )}
            >
              <div className={cn(
                'flex size-4 items-center justify-center rounded border transition-colors',
                progressive ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-300 dark:border-zinc-600'
              )}>
                {progressive && <Check className="size-3 text-white" />}
              </div>
              Progressive loading
            </button>

            {progressive && (
              <div className="mt-2.5 flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase block mb-1">Start ({unit})</label>
                  <input
                    type="number"
                    placeholder={unit}
                    value={kgToDisplay(weightKg, unit)}
                    onChange={e => {
                      const kg = inputToKg(e.target.value, unit)
                      setWeightKg(kg)
                      push({ wKg: kg })
                    }}
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-2 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:border-zinc-400"
                  />
                </div>
                <div className="flex items-center pb-2.5">
                  <ChevronsRight className="size-4 text-zinc-300" />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase block mb-1">End ({unit})</label>
                  <input
                    type="number"
                    placeholder={unit}
                    value={kgToDisplay(endWeightKg, unit)}
                    onChange={e => {
                      const kg = inputToKg(e.target.value, unit)
                      setEndWeightKg(kg)
                      push({ eKg: kg })
                    }}
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-2 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:border-zinc-400"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sets: compact preview or advanced per-set editing */}
          {ex.sets.length > 0 && (
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Sets</p>
                <button
                  type="button"
                  onClick={() => setAdvanced(a => !a)}
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wide transition-colors',
                    advanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                  )}
                >
                  {advanced ? 'Simple' : 'Advanced'}
                </button>
              </div>

              {advanced ? (
                // Editable per-set rows
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[20px_1fr_1fr_1fr_20px] gap-1.5 text-[10px] font-semibold uppercase text-zinc-400">
                    <span className="text-center">#</span>
                    <span className="text-center">Reps</span>
                    <span className="text-center">Wt ({unit})</span>
                    <span className="text-center">Rest</span>
                    <span />
                  </div>
                  {ex.sets.map((s, i) => (
                    <div key={i} className="grid grid-cols-[20px_1fr_1fr_1fr_20px] gap-1.5 items-center">
                      <span className="text-center text-xs font-semibold text-zinc-400">{s.setNumber}</span>
                      <div className="flex items-center gap-0.5">
                        <input
                          type="number"
                          value={s.targetRepsMin ?? ''}
                          onChange={e => {
                            const sets = ex.sets.map((s2, idx) => idx === i ? { ...s2, targetRepsMin: e.target.value ? Number(e.target.value) : undefined } : s2)
                            onChange({ sets })
                          }}
                          className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1 py-1.5 text-xs text-zinc-900 dark:text-white text-center focus:outline-none"
                        />
                        <span className="text-zinc-300 text-[10px] shrink-0">–</span>
                        <input
                          type="number"
                          value={s.targetRepsMax ?? ''}
                          onChange={e => {
                            const sets = ex.sets.map((s2, idx) => idx === i ? { ...s2, targetRepsMax: e.target.value ? Number(e.target.value) : undefined } : s2)
                            onChange({ sets })
                          }}
                          className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1 py-1.5 text-xs text-zinc-900 dark:text-white text-center focus:outline-none"
                        />
                      </div>
                      <input
                        type="number"
                        placeholder={unit}
                        value={kgToDisplay(s.targetWeightKg, unit)}
                        onChange={e => {
                          const sets = ex.sets.map((s2, idx) => idx === i ? { ...s2, targetWeightKg: inputToKg(e.target.value, unit) } : s2)
                          onChange({ sets })
                        }}
                        className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1 py-1.5 text-xs text-zinc-900 dark:text-white text-center focus:outline-none"
                      />
                      <input
                        type="number"
                        value={s.restSeconds ?? ''}
                        onChange={e => {
                          const sets = ex.sets.map((s2, idx) => idx === i ? { ...s2, restSeconds: e.target.value ? Number(e.target.value) : undefined } : s2)
                          onChange({ sets })
                        }}
                        className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1 py-1.5 text-xs text-zinc-900 dark:text-white text-center focus:outline-none"
                      />
                      <button
                        onClick={() => removeSetAt(i)}
                        className="flex items-center justify-center text-zinc-300 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const last = ex.sets[ex.sets.length - 1]
                      const newSet: SetDraft = { setNumber: ex.sets.length + 1, targetRepsMin: last?.targetRepsMin, targetRepsMax: last?.targetRepsMax, targetWeightKg: last?.targetWeightKg, restSeconds: last?.restSeconds }
                      onChange({ sets: [...ex.sets, newSet] })
                      setNumSets(ex.sets.length + 1)
                    }}
                    className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  >
                    <Plus className="size-3" /> Add set
                  </button>
                </div>
              ) : (
                // Compact read-only summary
                ex.sets.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-4 text-center font-semibold text-zinc-400 shrink-0">{s.setNumber}</span>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {s.targetRepsMin ?? '?'}
                      {s.targetRepsMax && s.targetRepsMax !== s.targetRepsMin ? `–${s.targetRepsMax}` : ''} reps
                    </span>
                    {s.targetWeightKg !== undefined && (
                      <span className="text-zinc-500">
                        · {kgToDisplay(s.targetWeightKg, unit)} {unit}
                      </span>
                    )}
                    {s.restSeconds != null && (
                      <span className="text-zinc-400">· {s.restSeconds}s rest</span>
                    )}
                    <button
                      onClick={() => removeSetAt(i)}
                      className="ml-auto shrink-0 text-zinc-300 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Coaching note */}
          <div>
            <label className="text-[10px] font-semibold text-zinc-400 uppercase block mb-1">Coaching note</label>
            <input
              type="text"
              value={ex.notes ?? ''}
              onChange={e => onChange({ notes: e.target.value || undefined })}
              placeholder="Optional tip for the client"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── ExercisePicker ───────────────────────────────────────────────────────────

function ExercisePicker({ onSelect }: { onSelect: (ex: ExerciseResult) => void }) {
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<ExerciseResult[]>([])
  const [searching, setSearching]   = useState(false)
  const [open, setOpen]             = useState(false)
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleQuery(val: string) {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val.trim()) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const r = await fetch(`/api/training/exercises?q=${encodeURIComponent(val)}&limit=20`)
      if (r.ok) {
        const d = await r.json() as { exercises: ExerciseResult[] }
        setResults(d.exercises ?? [])
        setOpen(true)
      }
      setSearching(false)
    }, 300)
  }

  function select(ex: ExerciseResult) {
    onSelect(ex)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-600 px-3 py-2 focus-within:border-zinc-500">
        <Search className="size-4 text-zinc-400 shrink-0" />
        {searching && <Loader2 className="size-4 animate-spin text-zinc-400 shrink-0" />}
        <input
          type="text"
          value={query}
          onChange={e => handleQuery(e.target.value)}
          placeholder="Search exercises to add…"
          className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
          {results.map(ex => (
            <button
              key={ex.id}
              onClick={() => select(ex)}
              className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors border-b border-zinc-50 dark:border-zinc-800 last:border-0"
            >
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-white">{ex.name}</p>
                <p className="text-xs text-zinc-400 capitalize">{ex.bodyPart} · {ex.equipment}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NewTrainerProgramPage() {
  const router = useRouter()

  const [name, setName]                   = useState('')
  const [description, setDescription]     = useState('')
  const [level, setLevel]                 = useState<typeof LEVELS[number] | ''>('')
  const [durationWeeks, setDurationWeeks] = useState('')
  const [sessionsPerWeek, setSessionsPerWeek] = useState('')
  const [days, setDays]                   = useState<DayDraft[]>([])
  const { unit }                          = useWeightUnit()
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  function addDay() {
    setDays(prev => [...prev, {
      id:        uid(),
      name:      WEEKDAYS[prev.length % 7],
      exercises: [],
      expanded:  true,
    }])
  }

  function patchDay(id: string, patch: Partial<DayDraft>) {
    setDays(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
  }

  function removeDay(id: string) {
    setDays(prev => prev.filter(d => d.id !== id))
  }

  function addExercise(dayId: string, ex: ExerciseResult) {
    setDays(prev => prev.map(d => {
      if (d.id !== dayId) return d
      return {
        ...d,
        exercises: [...d.exercises, defaultExercise(ex, d.exercises.length)],
      }
    }))
  }

  function patchExercise(dayId: string, exLocalId: string, patch: Partial<ExerciseDraft>) {
    setDays(prev => prev.map(d => {
      if (d.id !== dayId) return d
      return {
        ...d,
        exercises: d.exercises.map(e => e.id === exLocalId ? { ...e, ...patch } : e),
      }
    }))
  }

  function removeExercise(dayId: string, exLocalId: string) {
    setDays(prev => prev.map(d => {
      if (d.id !== dayId) return d
      return { ...d, exercises: d.exercises.filter(e => e.id !== exLocalId).map((e, i) => ({ ...e, sortOrder: i })) }
    }))
  }

  async function handleSave() {
    if (!name.trim()) { setError('Program name is required.'); return }
    setSaving(true)
    setError(null)

    const body = {
      name:            name.trim(),
      description:     description.trim() || undefined,
      level:           level || undefined,
      durationWeeks:   durationWeeks ? Number(durationWeeks) : undefined,
      sessionsPerWeek: sessionsPerWeek ? Number(sessionsPerWeek) : undefined,
      days: days.map((day, di) => ({
        name:      day.name,
        sortOrder: di,
        exercises: day.exercises.map((ex, ei) => ({
          exerciseId:   ex.exerciseId,
          sortOrder:    ei,
          trackingType: ex.trackingType,
          restSeconds:  ex.restSeconds,
          notes:        ex.notes,
          sets:         ex.sets.map(s => ({
            setNumber:       s.setNumber,
            targetRepsMin:   s.targetRepsMin,
            targetRepsMax:   s.targetRepsMax,
            targetWeightKg:  s.targetWeightKg,
            restSeconds:     s.restSeconds,
          })),
        })),
      })),
    }

    const r = await fetch('/api/trainer/programs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const d = await r.json() as { program?: { id: string }; error?: string }
    if (!r.ok || !d.program) {
      setError(d.error ?? 'Failed to save program.')
      setSaving(false)
      return
    }
    router.push(`/trainer/programs/${d.program.id}`)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 pb-32">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/trainer/programs"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <h1 className="text-xl font-black text-zinc-900 dark:text-white">New Program</h1>
      </div>

      {/* Details */}
      <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 mb-5 space-y-4">
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Program name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. 12-Week Strength Builder"
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What's this program for? Who is it best suited for?"
            rows={2}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 resize-none"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Level</label>
            <select
              value={level}
              onChange={e => setLevel(e.target.value as typeof LEVELS[number] | '')}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none"
            >
              <option value="">Any</option>
              {LEVELS.map(l => <option key={l} value={l} className="capitalize">{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Duration (weeks)</label>
            <input
              type="number"
              value={durationWeeks}
              onChange={e => setDurationWeeks(e.target.value)}
              placeholder="e.g. 12"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-500 block mb-1.5">Days / week</label>
            <input
              type="number"
              value={sessionsPerWeek}
              onChange={e => setSessionsPerWeek(e.target.value)}
              placeholder="e.g. 4"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Days */}
      <div className="space-y-4 mb-4">
        {days.map(day => (
          <div key={day.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-700">
            {/* Day header */}
            <div className="flex items-center gap-2 px-4 py-3 bg-zinc-50 dark:bg-zinc-800 rounded-t-2xl">
              <input
                type="text"
                value={day.name}
                onChange={e => patchDay(day.id, { name: e.target.value })}
                className="flex-1 bg-transparent text-sm font-bold text-zinc-900 dark:text-white focus:outline-none"
              />
              <button
                onClick={() => patchDay(day.id, { expanded: !day.expanded })}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {day.expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
              <button onClick={() => removeDay(day.id)} className="text-zinc-300 hover:text-red-500 transition-colors">
                <Trash2 className="size-4" />
              </button>
            </div>

            {day.expanded && (
              <div className="p-4 space-y-3">
                {day.exercises.map(ex => (
                  <ExerciseCard
                    key={ex.id}
                    ex={ex}
                    unit={unit}
                    onChange={patch => patchExercise(day.id, ex.id, patch)}
                    onRemove={() => removeExercise(day.id, ex.id)}
                  />
                ))}
                <ExercisePicker onSelect={ex => addExercise(day.id, ex)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={addDay}
        className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 w-full py-3 text-sm font-medium text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors justify-center mb-8"
      >
        <Plus className="size-4" />
        Add Day
      </button>

      {/* Save */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
      )}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 px-4 py-4 flex gap-3">
        <Link
          href="/trainer/programs"
          className="flex-1 text-center rounded-xl border border-zinc-200 dark:border-zinc-700 py-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </Link>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-colors',
            'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-40'
          )}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save Program'}
        </button>
      </div>
    </div>
  )
}
