'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Plus, Trash2, Loader2, Trophy, Dumbbell,
  FileText, Target, Lock, Unlock, ChevronRight, Send, CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'overview' | 'workouts' | 'programs' | 'notes'

interface TrainerNote { id: string; content: string; createdAt: string; isPrivate: boolean }
interface TrainerTarget { id: string; targetType: string; targetValue: number; unit: string; effectiveDate: string }
interface Goal { type: string; title: string; targetDate: string | null }
interface Workout { id: string; title: string; status: string; scheduledDate: string | null; completedAt: string | null; totalSets: number; assignedById: string | null; source: string }
interface PR { exerciseId: string; metric: string; value: number; unit: string; achievedAt: string }
interface AssignedProgram { id: string; name: string; isActive: boolean }
interface Compliance { total: number; completed: number }

interface TrainerProgramDay { id: string; name: string }
interface TrainerProgramBrief { id: string; name: string; days: TrainerProgramDay[] }

interface ClientDetail {
  profile:          { displayName: string | null; fitnessLevel: string | null; heightCm: number | null; weightKg: number | null } | null
  goals:            Goal[]
  recentWorkouts:   Workout[]
  personalRecords:  PR[]
  assignedPrograms: AssignedProgram[]
  trainerTargets:   TrainerTarget[]
  trainerNotes:     TrainerNote[]
  pendingDrafts:    number
  compliance:       Compliance
}

const TARGET_OPTIONS: { type: string; label: string; unit: string; placeholder: string }[] = [
  { type: 'daily_calories',       label: 'Daily calories',       unit: 'kcal', placeholder: '2400' },
  { type: 'daily_protein_g',      label: 'Daily protein',        unit: 'g',    placeholder: '180' },
  { type: 'daily_carbs_g',        label: 'Daily carbs',          unit: 'g',    placeholder: '250' },
  { type: 'daily_fat_g',          label: 'Daily fat',            unit: 'g',    placeholder: '70' },
  { type: 'weekly_workouts',      label: 'Weekly workouts',      unit: 'sessions', placeholder: '4' },
  { type: 'weekly_cardio_minutes',label: 'Weekly cardio',        unit: 'min',  placeholder: '150' },
  { type: 'body_weight_kg',       label: 'Body weight target',   unit: 'kg',   placeholder: '80' },
  { type: 'body_fat_pct',         label: 'Body fat target',      unit: '%',    placeholder: '15' },
]

// ─── Subcomponents ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
    skipped:   'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    in_progress: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400',
    planned:   'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize', styles[status] ?? styles.planned)}>
      {status.replace('_', ' ')}
    </span>
  )
}

function NoteComposer({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const [text, setText] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!text.trim()) return
    setSaving(true)
    await fetch(`/api/trainer/clients/${clientId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.trim(), isPrivate }),
    })
    setText('')
    onSaved()
    setSaving(false)
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-3">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Session notes, cues, observations..."
        rows={3}
        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400 resize-none"
      />
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsPrivate(v => !v)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          {isPrivate ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
          {isPrivate ? 'Private (trainer only)' : 'Visible to client'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !text.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 text-xs font-bold hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {saving && <Loader2 className="size-3 animate-spin" />}
          Save note
        </button>
      </div>
    </div>
  )
}

function TargetSetter({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const [type, setType] = useState(TARGET_OPTIONS[0].type)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const selected = TARGET_OPTIONS.find(o => o.type === type) ?? TARGET_OPTIONS[0]

  const handleSave = async () => {
    const v = parseFloat(value)
    if (isNaN(v) || v <= 0) return
    setSaving(true)
    await fetch(`/api/trainer/clients/${clientId}/targets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType: type, targetValue: v, unit: selected.unit }),
    })
    setValue('')
    setOpen(false)
    onSaved()
    setSaving(false)
  }

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
    >
      <Plus className="size-3.5" /> Set target
    </button>
  )

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 space-y-2">
      <div className="flex gap-2">
        <select
          value={type}
          onChange={e => { setType(e.target.value); setValue('') }}
          className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
        >
          {TARGET_OPTIONS.map(o => (
            <option key={o.type} value={o.type}>{o.label}</option>
          ))}
        </select>
        <input
          type="number"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={selected.placeholder}
          className="w-24 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none text-center"
        />
        <span className="flex items-center text-xs text-zinc-400">{selected.unit}</span>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors">Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving || !value}
          className="flex items-center gap-1 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-1 text-xs font-bold hover:opacity-90 disabled:opacity-40"
        >
          {saving && <Loader2 className="size-3 animate-spin" />}
          Set
        </button>
      </div>
    </div>
  )
}

function WorkoutSender({ clientId, programs, onSent }: {
  clientId: string
  programs: TrainerProgramBrief[]
  onSent: () => void
}) {
  const [programId, setProgramId] = useState('')
  const [dayId, setDayId] = useState('')
  const [date, setDate] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [open, setOpen] = useState(false)

  const selectedProgram = programs.find(p => p.id === programId)

  const handleProgramChange = (id: string) => {
    setProgramId(id)
    setDayId('')
  }

  const handleSend = async () => {
    if (!programId || !dayId) return
    setSending(true)
    const r = await fetch(`/api/trainer/clients/${clientId}/workouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trainerProgramId: programId, dayId, scheduledDate: date || undefined }),
    })
    setSending(false)
    if (r.ok) {
      setSent(true)
      setProgramId('')
      setDayId('')
      setDate('')
      setTimeout(() => { setSent(false); setOpen(false) }, 1500)
      onSent()
    }
  }

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="flex items-center gap-1.5 w-full rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-400 hover:border-emerald-300 hover:text-emerald-600 dark:hover:border-emerald-700 dark:hover:text-emerald-400 transition-colors"
    >
      <Send className="size-4" /> Send a workout
    </button>
  )

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-3">
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Send a workout</p>

      {programs.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No programs in your library yet.{' '}
          <Link href="/trainer/programs/new" className="text-emerald-600 hover:underline">Build one</Link>
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <select
              value={programId}
              onChange={e => handleProgramChange(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none"
            >
              <option value="">Select program...</option>
              {programs.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {selectedProgram && (
              <select
                value={dayId}
                onChange={e => setDayId(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none"
              >
                <option value="">Select day...</option>
                {selectedProgram.days.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}

            <div>
              <label className="block text-xs text-zinc-400 mb-1">Schedule for (optional)</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setOpen(false); setProgramId(''); setDayId(''); setDate('') }}
              className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 py-2 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!programId || !dayId || sending || sent}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-white py-2 text-xs font-bold hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              {sent ? (
                <><CheckCircle2 className="size-3.5" /> Sent!</>
              ) : sending ? (
                <><Loader2 className="size-3.5 animate-spin" /> Sending...</>
              ) : (
                <><Send className="size-3.5" /> Send workout</>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params)
  const router = useRouter()
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [deletingNote, setDeletingNote] = useState<string | null>(null)
  const [trainerPrograms, setTrainerPrograms] = useState<TrainerProgramBrief[] | null>(null)

  const fetchDetail = useCallback(async () => {
    const r = await fetch(`/api/trainer/clients/${clientId}`)
    if (r.ok) setDetail(await r.json() as ClientDetail)
    setLoading(false)
  }, [clientId])

  useEffect(() => { void fetchDetail() }, [fetchDetail])

  // Load trainer programs lazily when programs tab is first opened
  useEffect(() => {
    if (tab === 'programs' && trainerPrograms === null) {
      fetch('/api/trainer/programs')
        .then(r => r.json())
        .then((d: { programs: TrainerProgramBrief[] }) => setTrainerPrograms(d.programs ?? []))
        .catch(() => setTrainerPrograms([]))
    }
  }, [tab, trainerPrograms])

  const handleRemove = async () => {
    const r = await fetch(`/api/trainer/clients/${clientId}/remove`, { method: 'POST' })
    if (r.ok) router.push('/trainer')
  }

  const deleteNote = async (noteId: string) => {
    setDeletingNote(noteId)
    await fetch(`/api/trainer/clients/${clientId}/notes`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: noteId }),
    })
    await fetchDetail()
    setDeletingNote(null)
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  )

  if (!detail) return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p className="text-sm text-zinc-500">Client not found or access denied.</p>
    </div>
  )

  const { profile, goals, recentWorkouts, personalRecords, assignedPrograms, trainerTargets, trainerNotes, pendingDrafts, compliance } = detail

  const compliancePct = compliance.total > 0 ? Math.round((compliance.completed / compliance.total) * 100) : null

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/trainer" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white truncate">
            {profile?.displayName ?? 'Client'}
          </h1>
          {profile?.fitnessLevel && (
            <p className="text-xs text-zinc-400 capitalize">{profile.fitnessLevel}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pendingDrafts > 0 && (
            <Link href="/trainer/drafts" className="flex items-center gap-1.5 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:opacity-90 transition-opacity">
              <FileText className="size-3.5" />
              {pendingDrafts} draft{pendingDrafts !== 1 ? 's' : ''}
            </Link>
          )}
          {confirmRemove ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600 dark:text-red-400">Remove?</span>
              <button onClick={handleRemove} className="rounded-lg bg-red-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-red-700">Confirm</button>
              <button onClick={() => setConfirmRemove(false)} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmRemove(true)} className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-100 dark:border-zinc-800 mb-5">
        {(['overview', 'workouts', 'programs', 'notes'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
            )}
          >
            {t}
            {t === 'notes' && trainerNotes.length > 0 && (
              <span className="ml-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{trainerNotes.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="space-y-4">

          {/* Goals */}
          {goals.length > 0 && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">Goals</p>
              <div className="space-y-2">
                {goals.map((g, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 capitalize">{g.type.replace('_', ' ')}</span>
                    <span className="text-sm text-zinc-700 dark:text-zinc-300 flex-1">{g.title}</span>
                    {g.targetDate && <span className="text-xs text-zinc-400">{g.targetDate.slice(0, 10)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trainer targets */}
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1.5">
                <Target className="size-3.5" /> Targets you set
              </p>
              <TargetSetter clientId={clientId} onSaved={fetchDetail} />
            </div>
            {trainerTargets.length === 0 ? (
              <p className="text-sm text-zinc-400">No targets set yet.</p>
            ) : (
              <div className="space-y-1.5">
                {trainerTargets.map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500 capitalize">{t.targetType.replace(/_/g, ' ')}</span>
                    <span className="font-semibold text-zinc-900 dark:text-white">{t.targetValue} {t.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* PRs */}
          {personalRecords.length > 0 && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Trophy className="size-3.5 text-amber-500" /> Recent PRs
              </p>
              <div className="space-y-1.5">
                {personalRecords.map((pr, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">{pr.exerciseId} · {pr.metric}</span>
                    <span className="font-semibold text-zinc-900 dark:text-white">{pr.value} {pr.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Workouts tab */}
      {tab === 'workouts' && (
        <div className="space-y-2">
          {/* 30-day compliance for trainer-assigned workouts */}
          {compliance.total > 0 && (
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 mb-1">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">30-day compliance</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      compliancePct != null && compliancePct >= 80 ? 'bg-emerald-500' :
                      compliancePct != null && compliancePct >= 50 ? 'bg-amber-400' : 'bg-red-400'
                    )}
                    style={{ width: `${compliancePct ?? 0}%` }}
                  />
                </div>
                <span className={cn(
                  'text-sm font-bold shrink-0',
                  compliancePct != null && compliancePct >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
                  compliancePct != null && compliancePct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'
                )}>
                  {compliance.completed}/{compliance.total}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                trainer-assigned workouts completed in the last 30 days
              </p>
            </div>
          )}

          {recentWorkouts.length === 0 ? (
            <p className="text-sm text-zinc-400 py-6 text-center">No workouts recorded yet.</p>
          ) : recentWorkouts.map(w => (
            <div
              key={w.id}
              className={cn(
                'flex items-center justify-between rounded-2xl border px-4 py-3 bg-white dark:bg-zinc-900',
                w.assignedById ? 'border-emerald-100 dark:border-emerald-900/30' : 'border-zinc-100 dark:border-zinc-800'
              )}
            >
              <div>
                <div className="flex items-center gap-1.5">
                  {w.assignedById && <Send className="size-3 text-emerald-500 shrink-0" />}
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">{w.title}</p>
                </div>
                <p className="text-xs text-zinc-400">
                  {(w.completedAt ?? w.scheduledDate ?? '').slice(0, 10)} · {w.totalSets} sets
                </p>
              </div>
              <StatusBadge status={w.status} />
            </div>
          ))}
        </div>
      )}

      {/* Programs tab */}
      {tab === 'programs' && (
        <div className="space-y-3">
          {/* Send a workout */}
          {trainerPrograms === null ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-4 animate-spin text-zinc-400" />
            </div>
          ) : (
            <WorkoutSender clientId={clientId} programs={trainerPrograms} onSent={fetchDetail} />
          )}

          {/* Assigned programs */}
          {assignedPrograms.length === 0 ? (
            <p className="text-sm text-zinc-400 py-2">No programs assigned yet.</p>
          ) : assignedPrograms.map(p => (
            <div key={p.id} className="flex items-center justify-between rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
              <div className="flex items-center gap-2">
                <Dumbbell className="size-4 text-zinc-400" />
                <p className="text-sm font-medium text-zinc-900 dark:text-white">{p.name}</p>
              </div>
              {p.isActive && (
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Active</span>
              )}
            </div>
          ))}
          <Link href="/trainer/programs" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors mt-1">
            Assign a full program <ChevronRight className="size-4" />
          </Link>
        </div>
      )}

      {/* Notes tab */}
      {tab === 'notes' && (
        <div className="space-y-3">
          <NoteComposer clientId={clientId} onSaved={fetchDetail} />

          {trainerNotes.length === 0 ? (
            <p className="text-sm text-zinc-400 py-4 text-center">No notes yet.</p>
          ) : trainerNotes.map(n => (
            <div key={n.id} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-zinc-700 dark:text-zinc-300 flex-1">{n.content}</p>
                <button
                  onClick={() => deleteNote(n.id)}
                  disabled={deletingNote === n.id}
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-zinc-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  {deletingNote === n.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3" />}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-zinc-400">{n.createdAt.slice(0, 10)}</span>
                {n.isPrivate
                  ? <span className="flex items-center gap-1 text-[10px] text-zinc-400"><Lock className="size-3" /> Private</span>
                  : <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"><Unlock className="size-3" /> Visible to client</span>
                }
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
