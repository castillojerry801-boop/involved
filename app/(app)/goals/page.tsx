'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Trophy, Target, Check, X, Loader2, Calendar, Dumbbell, Heart, Repeat, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Goal {
  id: string
  type: 'event' | 'strength' | 'endurance' | 'body_comp' | 'habit' | 'custom'
  title: string
  description: string | null
  targetDate: string | null
  status: 'active' | 'completed' | 'paused'
  createdAt: string
}

const GOAL_TYPES = [
  { id: 'strength',  label: 'Strength',   icon: Dumbbell, color: 'text-sky-500',     bg: 'bg-sky-50 dark:bg-sky-950/30',         ring: 'border-sky-400' },
  { id: 'body_comp', label: 'Body comp',  icon: Target,   color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', ring: 'border-emerald-400' },
  { id: 'endurance', label: 'Endurance',  icon: Heart,    color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-950/30',         ring: 'border-red-400' },
  { id: 'habit',     label: 'Habit',      icon: Repeat,   color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-950/30',     ring: 'border-amber-400' },
  { id: 'custom',    label: 'Custom',     icon: Pencil,   color: 'text-zinc-500',    bg: 'bg-zinc-100 dark:bg-zinc-800',         ring: 'border-zinc-400' },
] as const

function typeInfo(type: Goal['type']) {
  if (type === 'event') return { icon: Trophy, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30' }
  return GOAL_TYPES.find(t => t.id === type) ?? GOAL_TYPES[GOAL_TYPES.length - 1]
}

function formatDate(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso + 'T12:00:00')
  const diffDays = Math.ceil((d.getTime() - Date.now()) / 86400000)
  if (diffDays < 0)  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays < 30)  return `${diffDays}d away`
  if (diffDays < 365) return `${Math.round(diffDays / 7)}w away`
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ─── Add Modal ────────────────────────────────────────────────────────────────

function AddModal({ mode, onSaved, onClose }: {
  mode: 'goal' | 'event'
  onSaved: () => void
  onClose: () => void
}) {
  const [type, setType]             = useState<Goal['type']>(mode === 'event' ? 'event' : 'strength')
  const [title, setTitle]           = useState('')
  const [description, setDesc]      = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  const save = async () => {
    if (!title.trim()) { setError('Give your goal a title'); return }
    if (mode === 'event' && !targetDate) { setError('Events need a date'); return }
    setSaving(true)
    const res = await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, description: description || undefined, targetDate: targetDate || undefined }),
    })
    if (!res.ok) { setError('Failed to save'); setSaving(false); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl shadow-2xl">

        {/* Sheet handle — mobile only */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <div className="flex items-center justify-between px-5 pt-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="font-black text-lg text-zinc-900 dark:text-white">
              {mode === 'event' ? 'Add event or race' : 'Add a goal'}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {mode === 'event' ? 'A race, competition, or anything you\'re training for' : 'Something you\'re working to achieve'}
            </p>
          </div>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Type picker */}
          {mode === 'goal' && (
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Type</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {GOAL_TYPES.map(({ id, label, icon: Icon, color, bg, ring }) => (
                  <button
                    key={id}
                    onClick={() => setType(id as Goal['type'])}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all',
                      type === id
                        ? `${bg} ${color} ${ring}`
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                    )}
                  >
                    <Icon className={cn('size-4', type === id ? color : 'text-zinc-400')} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5 block">
              {mode === 'event' ? 'Event name' : 'Goal'}
            </label>
            <input
              type="text"
              placeholder={mode === 'event' ? 'e.g. Denver Marathon' : 'e.g. Bench press 225 lbs'}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void save() }}
              autoFocus
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5 block">
              Details <span className="font-normal text-zinc-400 normal-case">(optional)</span>
            </label>
            <input
              type="text"
              placeholder={
                mode === 'event'          ? 'e.g. Half marathon, first time'
                : type === 'body_comp'    ? 'e.g. Currently 270 lbs, goal: 220'
                : type === 'strength'     ? 'e.g. Currently at 185 lbs'
                : 'Add context...'
              }
              value={description}
              onChange={e => setDesc(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
            />
          </div>

          {/* Date */}
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5 block">
              {mode === 'event' ? 'Event date' : 'Target date'}{mode === 'goal' && <span className="font-normal text-zinc-400 normal-case"> (optional)</span>}
            </label>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={save}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-3.5 text-sm font-black hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Goal card ────────────────────────────────────────────────────────────────

function GoalCard({ goal, onComplete, onDelete, completing, deleting }: {
  goal: Goal
  onComplete: (id: string) => void
  onDelete:   (id: string) => void
  completing: string | null
  deleting:   string | null
}) {
  const info = typeInfo(goal.type)
  const Icon = info.icon
  const dateStr = goal.targetDate ? formatDate(goal.targetDate.slice(0, 10)) : null
  const isPast = goal.targetDate ? new Date(goal.targetDate + 'T12:00:00') < new Date() : false

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3.5">
      <div className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl', info.bg)}>
        <Icon className={cn('size-4', info.color)} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-zinc-900 dark:text-white">{goal.title}</p>
        {goal.description && (
          <p className="text-xs text-zinc-500 mt-0.5 truncate">{goal.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {goal.type !== 'event' && (
            <span className={cn('text-[11px] font-semibold', info.color)}>
              {GOAL_TYPES.find(t => t.id === goal.type)?.label}
            </span>
          )}
          {dateStr && (
            <span className={cn('flex items-center gap-1 text-[11px]', isPast ? 'text-red-400' : 'text-zinc-400')}>
              <Calendar className="size-3" />
              {dateStr}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onComplete(goal.id)}
          disabled={completing === goal.id}
          title="Mark complete"
          className="flex size-7 items-center justify-center rounded-full text-zinc-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:text-emerald-500 transition-colors disabled:opacity-40"
        >
          {completing === goal.id
            ? <Loader2 className="size-3.5 animate-spin" />
            : <Check className="size-4" />}
        </button>
        <button
          onClick={() => onDelete(goal.id)}
          disabled={deleting === goal.id}
          className="flex size-7 items-center justify-center rounded-full text-zinc-300 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-400 transition-colors disabled:opacity-40"
        >
          {deleting === goal.id
            ? <Loader2 className="size-3.5 animate-spin" />
            : <Trash2 className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptySlot({ icon: Icon, headline, sub, onClick }: {
  icon: React.ElementType; headline: string; sub: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 py-8 text-center hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors group"
    >
      <Icon className="size-7 text-zinc-200 dark:text-zinc-700 mx-auto mb-2 group-hover:text-zinc-300 dark:group-hover:text-zinc-600 transition-colors" />
      <p className="text-sm font-semibold text-zinc-400">{headline}</p>
      <p className="text-xs text-zinc-300 dark:text-zinc-600 mt-0.5">{sub}</p>
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const [goals,      setGoals]     = useState<Goal[]>([])
  const [loading,    setLoading]   = useState(true)
  const [adding,     setAdding]    = useState<'goal' | 'event' | null>(null)
  const [deleting,   setDeleting]  = useState<string | null>(null)
  const [completing, setCompleting]= useState<string | null>(null)

  const fetchGoals = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/goals')
    if (res.ok) setGoals((await res.json() as { goals: Goal[] }).goals)
    setLoading(false)
  }, [])

  useEffect(() => { void fetchGoals() }, [fetchGoals])

  const deleteGoal = async (id: string) => {
    setDeleting(id)
    await fetch('/api/goals', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setGoals(g => g.filter(x => x.id !== id))
    setDeleting(null)
  }

  const markDone = async (id: string) => {
    setCompleting(id)
    await fetch('/api/goals', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'completed' }) })
    setGoals(g => g.filter(x => x.id !== id))
    setCompleting(null)
  }

  const events       = goals.filter(g => g.type === 'event')
  const regularGoals = goals.filter(g => g.type !== 'event')

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Goals</h1>
        <button
          onClick={() => setAdding('goal')}
          className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-2 text-xs font-bold hover:opacity-90 transition-opacity"
        >
          <Plus className="size-3.5" /> Add goal
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-zinc-300" />
        </div>
      ) : (
        <>
          {/* Events & races */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Trophy className="size-4 text-amber-500" />
                <h2 className="font-black text-sm text-zinc-900 dark:text-white">Events & races</h2>
              </div>
              <button
                onClick={() => setAdding('event')}
                className="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                <Plus className="size-3.5" /> Add event
              </button>
            </div>

            {events.length === 0 ? (
              <EmptySlot
                icon={Trophy}
                headline="Add an event or race"
                sub="Marathon, Spartan, competition — anything you're training for"
                onClick={() => setAdding('event')}
              />
            ) : (
              <div className="space-y-2">
                {events.map(g => (
                  <GoalCard key={g.id} goal={g} onComplete={markDone} onDelete={deleteGoal} completing={completing} deleting={deleting} />
                ))}
                <button
                  onClick={() => setAdding('event')}
                  className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 py-2.5 text-xs text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <Plus className="size-3.5" /> Add another event
                </button>
              </div>
            )}
          </section>

          {/* My goals */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-emerald-500" />
                <h2 className="font-black text-sm text-zinc-900 dark:text-white">My goals</h2>
              </div>
              <button
                onClick={() => setAdding('goal')}
                className="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                <Plus className="size-3.5" /> Add goal
              </button>
            </div>

            {regularGoals.length === 0 ? (
              <EmptySlot
                icon={Target}
                headline="Add your first goal"
                sub="Bench 225, lose 30 lbs, run a 5K — whatever you're working toward"
                onClick={() => setAdding('goal')}
              />
            ) : (
              <div className="space-y-2">
                {regularGoals.map(g => (
                  <GoalCard key={g.id} goal={g} onComplete={markDone} onDelete={deleteGoal} completing={completing} deleting={deleting} />
                ))}
                <button
                  onClick={() => setAdding('goal')}
                  className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 py-2.5 text-xs text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <Plus className="size-3.5" /> Add another goal
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {adding && (
        <AddModal mode={adding} onSaved={fetchGoals} onClose={() => setAdding(null)} />
      )}
    </div>
  )
}
