'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, X, ChevronDown, ChevronUp, RotateCcw, Pencil, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getGifUrl } from '@/lib/exercises'
import { cn } from '@/lib/utils'
import type { ProgramPreview, GenerationConstraints } from '@/app/api/v/generate-program/route'
import type { ProgramDraft } from '@/lib/ai/tools/program'

interface GenerateProgramModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DAY_OPTIONS = [
  { label: '2 days', value: 2 },
  { label: '3 days', value: 3 },
  { label: '4 days', value: 4 },
  { label: '5 days', value: 5 },
  { label: '6 days', value: 6 },
]

const WEEK_OPTIONS = [
  { label: '4 weeks', value: 4 },
  { label: '8 weeks', value: 8 },
  { label: '12 weeks', value: 12 },
  { label: 'Open-ended', value: undefined as number | undefined },
]

const DURATION_OPTIONS = [
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
  { label: '75 min', value: 75 },
]

type ModalState = 'input' | 'generating' | 'preview' | 'modifying' | 'saving'

// ─── Chip selector ─────────────────────────────────────────────────────────────

function ChipGroup<T extends string | number | undefined>({
  options, value, onChange, disabled,
}: {
  options: Array<{ label: string; value: T }>
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={String(opt.value)}
          type="button"
          onClick={() => onChange(opt.value)}
          disabled={disabled}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            value === opt.value
              ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
              : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800',
            disabled && 'opacity-40 pointer-events-none',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ─── Preview card ─────────────────────────────────────────────────────────────

function PreviewCard({ preview }: { preview: ProgramPreview }) {
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set([0]))

  const toggle = (i: number) => {
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  const totalExercises = preview.days.reduce((n, d) => n + d.exercises.length, 0)

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-zinc-900 dark:text-white">{preview.program_name}</p>
            {preview.primary_goal && (
              <p className="text-xs text-zinc-500 mt-0.5">{preview.primary_goal}</p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            <span className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-xs text-zinc-500">
              {preview.days.length} days
            </span>
            {preview.weeks && (
              <span className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-xs text-zinc-500">
                {preview.weeks} wks
              </span>
            )}
          </div>
        </div>
        {preview.description && (
          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed line-clamp-3">{preview.description}</p>
        )}
        <p className="text-xs text-zinc-400 mt-1">{totalExercises} exercises total</p>
      </div>

      {/* Days */}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {preview.days.map((day, di) => (
          <div key={di}>
            <button
              type="button"
              onClick={() => toggle(di)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-3 text-left min-w-0">
                <span className="size-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-500 shrink-0">
                  {di + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{day.name}</p>
                  {day.focus && <p className="text-xs text-zinc-400 truncate">{day.focus}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className="text-xs text-zinc-400">~{day.estimated_duration_minutes} min</span>
                {expandedDays.has(di)
                  ? <ChevronUp className="size-4 text-zinc-400" />
                  : <ChevronDown className="size-4 text-zinc-400" />
                }
              </div>
            </button>

            {expandedDays.has(di) && (
              <div className="bg-zinc-50 dark:bg-zinc-800/30 border-t border-zinc-100 dark:border-zinc-800">
                {day.exercises.map((ex, ei) => (
                  <div key={ei} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 border-zinc-100 dark:border-zinc-700/50">
                    <div className="size-9 shrink-0 rounded-lg bg-white dark:bg-zinc-800 overflow-hidden flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={getGifUrl(ex.exercise_id)} alt={ex.exercise.name} className="h-full w-auto object-contain" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-900 dark:text-white truncate">{ex.exercise.name}</p>
                      <p className="text-[10px] text-zinc-500">
                        {ex.sets} sets
                        {' · '}
                        {ex.reps_min != null && ex.reps_max != null
                          ? ex.reps_min === ex.reps_max ? `${ex.reps_min} reps` : `${ex.reps_min}–${ex.reps_max} reps`
                          : ex.duration_seconds != null ? `${ex.duration_seconds}s` : '—'}
                        {' · '}{ex.rest_seconds}s rest
                        {ex.rpe != null && ` · RPE ${ex.rpe}`}
                      </p>
                      {ex.notes && <p className="text-[10px] text-zinc-400 italic truncate">{ex.notes}</p>}
                    </div>
                    <p className="text-[10px] text-zinc-400 shrink-0 text-right max-w-[64px] truncate">{ex.exercise.equipment}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function GenerateProgramModal({ open, onOpenChange }: GenerateProgramModalProps) {
  const router = useRouter()

  // Input form
  const [focus, setFocus]         = useState('')
  const [days, setDays]           = useState<number>(3)
  const [weeks, setWeeks]         = useState<number | undefined>(undefined)
  const [duration, setDuration]   = useState<number | undefined>(45)
  const [injuries, setInjuries]   = useState('')
  const [style, setStyle]         = useState('')
  const [constraints, setConstraints] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Preview state
  const [draft, setDraft]                     = useState<ProgramDraft | null>(null)
  const [preview, setPreview]                 = useState<ProgramPreview | null>(null)
  const [generationConstraints, setGenerationConstraints] = useState<GenerationConstraints | null>(null)

  // Modify state
  const [modifyText, setModifyText] = useState('')
  const [showModify, setShowModify] = useState(false)

  // UI state
  const [modalState, setModalState] = useState<ModalState>('input')
  const [error, setError]         = useState<string | null>(null)

  if (!open) return null

  const isWorking = modalState === 'generating' || modalState === 'modifying' || modalState === 'saving'

  const handleClose = () => {
    if (isWorking) return
    onOpenChange(false)
  }

  const handleGenerate = async () => {
    setError(null)
    setModalState('generating')
    try {
      const res = await fetch('/api/v/generate-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days,
          focus: focus.trim() || undefined,
          durationPerDayMinutes: duration,
          weeks: weeks ?? undefined,
          injuries: injuries.trim() || undefined,
          style: style.trim() || undefined,
          constraints: constraints.trim() || undefined,
        }),
      })

      const data = await res.json() as { draft?: ProgramDraft; preview?: ProgramPreview; constraints?: GenerationConstraints; error?: string; limit?: number }

      if (!res.ok) {
        if (res.status === 403) setError('Involved+ is required to generate programs with V.')
        else if (res.status === 429) setError("You've reached your monthly AI program limit.")
        else setError(data.error ?? 'Generation failed. Please try again.')
        setModalState('input')
        return
      }

      setDraft(data.draft!)
      setPreview(data.preview!)
      setGenerationConstraints(data.constraints ?? null)
      setShowModify(false)
      setModifyText('')
      setModalState('preview')
    } catch {
      setError('Something went wrong. Please try again.')
      setModalState('input')
    }
  }

  const handleModify = async () => {
    if (!draft || !modifyText.trim()) return
    setError(null)
    setModalState('modifying')
    try {
      const res = await fetch('/api/v/modify-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, modification: modifyText.trim(), constraints: generationConstraints ?? undefined }),
      })

      const data = await res.json() as { draft?: ProgramDraft; preview?: ProgramPreview; error?: string }

      if (!res.ok) {
        setError(data.error ?? 'Modification failed. Please try again.')
        setModalState('preview')
        return
      }

      setDraft(data.draft!)
      setPreview(data.preview!)
      setShowModify(false)
      setModifyText('')
      setModalState('preview')
    } catch {
      setError('Something went wrong. Please try again.')
      setModalState('preview')
    }
  }

  const handleSave = async () => {
    if (!draft) return
    setError(null)
    setModalState('saving')
    try {
      const res = await fetch('/api/v/generate-program/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
      })

      const data = await res.json() as { programId?: string; name?: string; error?: string }

      if (!res.ok || !data.programId) {
        setError(data.error ?? 'Failed to save program. Please try again.')
        setModalState('preview')
        return
      }

      onOpenChange(false)
      router.push(`/training/programs/${data.programId}`)
    } catch {
      setError('Something went wrong. Please try again.')
      setModalState('preview')
    }
  }

  const handleRegenerate = () => {
    setDraft(null)
    setPreview(null)
    setGenerationConstraints(null)
    setShowModify(false)
    setModifyText('')
    setError(null)
    setModalState('input')
  }

  // ── Input form ───────────────────────────────────────────────────────────────
  const renderInput = () => (
    <div className="p-5 space-y-5">
      <Input
        label="Focus (optional)"
        placeholder="e.g. strength, hypertrophy, athletic performance, fat loss"
        value={focus}
        onChange={e => setFocus(e.target.value)}
        disabled={isWorking}
      />

      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Days per week</p>
        <ChipGroup options={DAY_OPTIONS} value={days} onChange={setDays} disabled={isWorking} />
      </div>

      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Duration per session</p>
        <ChipGroup
          options={[...DURATION_OPTIONS, { label: 'Any', value: undefined as unknown as number }]}
          value={duration as number}
          onChange={v => setDuration(v as number | undefined)}
          disabled={isWorking}
        />
      </div>

      {/* Advanced options toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
      >
        {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {showAdvanced ? 'Hide' : 'More'} options
      </button>

      {showAdvanced && (
        <div className="space-y-4 pt-1">
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Program duration</p>
            <ChipGroup options={WEEK_OPTIONS} value={weeks} onChange={setWeeks} disabled={isWorking} />
          </div>
          <Input
            label="Training style (optional)"
            placeholder="e.g. powerlifting, bodybuilding, CrossFit, hybrid"
            value={style}
            onChange={e => setStyle(e.target.value)}
            disabled={isWorking}
          />
          <Input
            label="Injuries / limitations (optional)"
            placeholder="e.g. no overhead pressing, left knee tendinopathy"
            value={injuries}
            onChange={e => setInjuries(e.target.value)}
            disabled={isWorking}
          />
          <Input
            label="Other constraints (optional)"
            placeholder="e.g. home gym, no barbell, travel 1 week/month"
            value={constraints}
            onChange={e => setConstraints(e.target.value)}
            disabled={isWorking}
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Button onClick={handleGenerate} loading={isWorking} className="w-full">
        {isWorking ? 'V is building your program...' : (
          <><Sparkles className="size-4" />Generate Program</>
        )}
      </Button>
    </div>
  )

  // ── Generating state ─────────────────────────────────────────────────────────
  const renderGenerating = () => (
    <div className="flex flex-col items-center justify-center py-16 px-5 gap-4">
      <Loader2 className="size-8 text-zinc-400 animate-spin" />
      <div className="text-center">
        <p className="text-sm font-semibold text-zinc-900 dark:text-white">V is building your program...</p>
        <p className="text-xs text-zinc-400 mt-1">Selecting exercises, checking movement balance, planning progression</p>
      </div>
    </div>
  )

  const renderModifying = () => (
    <div className="flex flex-col items-center justify-center py-16 px-5 gap-4">
      <Loader2 className="size-8 text-zinc-400 animate-spin" />
      <div className="text-center">
        <p className="text-sm font-semibold text-zinc-900 dark:text-white">V is updating your program...</p>
        <p className="text-xs text-zinc-400 mt-1">Applying your modification</p>
      </div>
    </div>
  )

  // ── Preview state ────────────────────────────────────────────────────────────
  const renderPreview = () => (
    <div className="flex flex-col">
      <div className="p-4 overflow-y-auto max-h-[60vh]">
        {preview && <PreviewCard preview={preview} />}
      </div>

      {/* Modify with V */}
      <div className="px-4 pb-1">
        {showModify ? (
          <div className="space-y-2">
            <textarea
              value={modifyText}
              onChange={e => setModifyText(e.target.value)}
              placeholder='e.g. "Make day 2 more quad-focused" or "Add a 4th day for cardio"'
              rows={2}
              disabled={isWorking}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 resize-none disabled:opacity-40"
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setShowModify(false); setModifyText('') }}
                disabled={isWorking}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleModify}
                disabled={!modifyText.trim() || isWorking}
                loading={modalState === 'modifying'}
                className="flex-1"
              >
                <Sparkles className="size-3.5" />
                Apply
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowModify(true)}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors py-1"
          >
            <Pencil className="size-3.5" />
            Modify with V
          </button>
        )}
      </div>

      {error && <p className="mx-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Actions */}
      <div className="px-4 pb-4 pt-2 space-y-2 border-t border-zinc-100 dark:border-zinc-800">
        <Button
          onClick={handleSave}
          loading={modalState === 'saving'}
          disabled={isWorking}
          className="w-full"
        >
          <Check className="size-4" />
          {modalState === 'saving' ? 'Saving...' : 'Save to Programs'}
        </Button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={isWorking}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
        >
          <RotateCcw className="size-3.5" />
          Regenerate
        </button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[88vh]">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div>
            <h2 className="font-bold text-lg text-zinc-900 dark:text-white flex items-center gap-2">
              <Sparkles className="size-5 text-zinc-500" />
              {modalState === 'preview' ? 'Program Preview' : 'Build Program with V'}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {modalState === 'preview'
                ? 'Review your program, modify it, or save it to start training.'
                : 'V designs a personalized program from your goals, equipment, and history.'}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isWorking}
            className="flex size-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {modalState === 'input' && renderInput()}
          {modalState === 'generating' && renderGenerating()}
          {modalState === 'modifying' && renderModifying()}
          {(modalState === 'preview' || modalState === 'saving') && renderPreview()}
        </div>
      </div>
    </div>
  )
}
