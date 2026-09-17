'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Trophy, Target, Check, X, Loader2, Calendar, Dumbbell, Heart, Repeat, Pencil } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
  { id: 'strength',  label: 'Strength',    icon: Dumbbell,  color: 'text-sky-500',     bg: 'bg-sky-50 dark:bg-sky-950/30',    desc: 'Lifting milestones' },
  { id: 'body_comp', label: 'Body comp',   icon: Target,    color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', desc: 'Weight & body goals' },
  { id: 'endurance', label: 'Endurance',   icon: Heart,     color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-950/30',    desc: 'Running & cardio' },
  { id: 'habit',     label: 'Habit',       icon: Repeat,    color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-950/30', desc: 'Consistency targets' },
  { id: 'custom',    label: 'Custom',      icon: Pencil,    color: 'text-zinc-500',    bg: 'bg-zinc-100 dark:bg-zinc-800',    desc: 'Anything else' },
] as const

function typeIcon(type: Goal['type']) {
  if (type === 'event') return <Trophy className="size-4 text-amber-500" />
  const t = GOAL_TYPES.find(t => t.id === type)
  if (!t) return <Target className="size-4 text-zinc-400" />
  const Icon = t.icon
  return <Icon className={`size-4 ${t.color}`} />
}

function formatDate(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso + 'T12:00:00')
  const today = new Date()
  const diffMs = d.getTime() - today.getTime()
  const diffDays = Math.ceil(diffMs / 86400000)
  if (diffDays < 0) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays < 30) return `${diffDays} days away`
  if (diffDays < 365) return `${Math.round(diffDays / 7)} weeks away`
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ─── Add Modal ───────────────────────────────────────────────────────────────

function AddModal({ mode, onSaved, onClose }: {
  mode: 'goal' | 'event'
  onSaved: () => void
  onClose: () => void
}) {
  const [type, setType] = useState<Goal['type']>(mode === 'event' ? 'event' : 'strength')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
      <div className="relative w-full sm:max-w-md bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="font-bold text-lg text-zinc-900 dark:text-white">
              {mode === 'event' ? 'Add event or race' : 'Add a goal'}
            </h2>
            <p className="text-xs text-zinc-400">
              {mode === 'event' ? 'A race, competition, or event you\'re working toward' : 'Something you\'re training to achieve'}
            </p>
          </div>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Type picker — only for goals, not events */}
          {mode === 'goal' && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">Type</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {GOAL_TYPES.map(({ id, label, icon: Icon, color, bg }) => (
                  <button
                    key={id}
                    onClick={() => setType(id as Goal['type'])}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all',
                      type === id
                        ? `border-transparent ${bg} ${color}`
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300'
                    )}
                  >
                    <Icon className={`size-4 ${type === id ? color : 'text-zinc-400'}`} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-xs font-semibold text-zinc-500 mb-1.5 block">
              {mode === 'event' ? 'Event name' : 'Goal'}
            </label>
            <input
              type="text"
              placeholder={mode === 'event' ? 'e.g. Denver Marathon' : 'e.g. Bench press 225 lbs'}
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-zinc-500 mb-1.5 block">
              Details <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <input
              type="text"
              placeholder={
                mode === 'event' ? 'e.g. Half marathon, first time doing one'
                : type === 'body_comp' ? 'e.g. Currently 270 lbs, goal: 220 lbs'
                : type === 'strength' ? 'e.g. Currently at 150 lbs'
                : 'Add details...'
              }
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Date */}
          <div>
            <label className="text-xs font-semibold text-zinc-500 mb-1.5 block">
              {mode === 'event' ? 'Event date' : 'Target date'}{mode === 'goal' && <span className="font-normal text-zinc-400"> (optional)</span>}
            </label>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <Button onClick={save} disabled={saving} className="w-full mt-1">
            {saving ? <><Loader2 className="size-4 animate-spin" /> Saving...</> : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<'goal' | 'event' | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [completing, setCompleting] = useState<string | null>(null)

  const fetchGoals = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/goals')
    if (res.ok) {
      const data = await res.json() as { goals: Goal[] }
      setGoals(data.goals)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchGoals() }, [fetchGoals])

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

  const events = goals.filter(g => g.type === 'event')
  const regularGoals = goals.filter(g => g.type !== 'event')

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Goals</h1>
      </div>

      {/* ── EVENTS & RACES ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="size-4 text-amber-500" />
            <h2 className="font-bold text-zinc-900 dark:text-white">Events & races</h2>
          </div>
          <button
            onClick={() => setAdding('event')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <Plus className="size-3.5" /> Add event
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-zinc-300" /></div>
        ) : events.length === 0 ? (
          <button
            onClick={() => setAdding('event')}
            className="w-full rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 py-8 text-center hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors group"
          >
            <Trophy className="size-8 text-zinc-200 dark:text-zinc-700 mx-auto mb-2 group-hover:text-amber-400 transition-colors" />
            <p className="text-sm font-medium text-zinc-400">Add an event or race</p>
            <p className="text-xs text-zinc-300 dark:text-zinc-600 mt-0.5">Marathon, Spartan, competition — anything you&apos;re training for</p>
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            {events.map(event => (
              <Card key={event.id} className="flex items-start gap-3">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/30">
                  <Trophy className="size-4 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-zinc-900 dark:text-white">{event.title}</p>
                  {event.description && <p className="text-sm text-zinc-500 mt-0.5">{event.description}</p>}
                  {event.targetDate && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Calendar className="size-3 text-zinc-400" />
                      <p className="text-xs font-medium text-zinc-400">{formatDate(event.targetDate.slice(0, 10))}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => markDone(event.id)}
                    disabled={completing === event.id}
                    className="flex size-7 items-center justify-center rounded-lg text-zinc-300 hover:bg-emerald-50 hover:text-emerald-500 dark:hover:bg-emerald-950/30 transition-colors"
                    title="Mark complete"
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    onClick={() => deleteGoal(event.id)}
                    disabled={deleting === event.id}
                    className="flex size-7 items-center justify-center rounded-lg text-zinc-300 hover:bg-red-50 hover:text-red-400 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </Card>
            ))}
            <button
              onClick={() => setAdding('event')}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-700 py-3 text-sm text-zinc-400 hover:border-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <Plus className="size-4" /> Add another event
            </button>
          </div>
        )}
      </section>

      {/* ── MY GOALS ───────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-emerald-500" />
            <h2 className="font-bold text-zinc-900 dark:text-white">My goals</h2>
          </div>
          <button
            onClick={() => setAdding('goal')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <Plus className="size-3.5" /> Add goal
          </button>
        </div>

        {loading ? null : regularGoals.length === 0 ? (
          <button
            onClick={() => setAdding('goal')}
            className="w-full rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 py-8 text-center hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors group"
          >
            <Target className="size-8 text-zinc-200 dark:text-zinc-700 mx-auto mb-2 group-hover:text-emerald-400 transition-colors" />
            <p className="text-sm font-medium text-zinc-400">Add your first goal</p>
            <p className="text-xs text-zinc-300 dark:text-zinc-600 mt-0.5">Bench 225, lose 50 lbs, run a 5K — whatever you&apos;re working toward</p>
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            {regularGoals.map(goal => {
              const typeInfo = GOAL_TYPES.find(t => t.id === goal.type)
              return (
                <Card key={goal.id} className="flex items-start gap-3">
                  <div className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl', typeInfo?.bg ?? 'bg-zinc-100 dark:bg-zinc-800')}>
                    {typeIcon(goal.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 dark:text-white">{goal.title}</p>
                    {goal.description && <p className="text-sm text-zinc-500 mt-0.5">{goal.description}</p>}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {typeInfo && (
                        <span className={cn('text-xs font-medium', typeInfo.color)}>{typeInfo.label}</span>
                      )}
                      {goal.targetDate && (
                        <div className="flex items-center gap-1">
                          <Calendar className="size-3 text-zinc-400" />
                          <span className="text-xs text-zinc-400">{formatDate(goal.targetDate.slice(0, 10))}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => markDone(goal.id)}
                      disabled={completing === goal.id}
                      className="flex size-7 items-center justify-center rounded-lg text-zinc-300 hover:bg-emerald-50 hover:text-emerald-500 dark:hover:bg-emerald-950/30 transition-colors"
                      title="Mark complete"
                    >
                      <Check className="size-4" />
                    </button>
                    <button
                      onClick={() => deleteGoal(goal.id)}
                      disabled={deleting === goal.id}
                      className="flex size-7 items-center justify-center rounded-lg text-zinc-300 hover:bg-red-50 hover:text-red-400 dark:hover:bg-red-950/30 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </Card>
              )
            })}
            <button
              onClick={() => setAdding('goal')}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-700 py-3 text-sm text-zinc-400 hover:border-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <Plus className="size-4" /> Add another goal
            </button>
          </div>
        )}
      </section>

      {adding && (
        <AddModal mode={adding} onSaved={fetchGoals} onClose={() => setAdding(null)} />
      )}
    </div>
  )
}
