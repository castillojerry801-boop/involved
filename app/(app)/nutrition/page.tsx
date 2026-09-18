'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Search, ChevronLeft, ChevronRight, Pencil, Minus, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FoodSearchModal } from '@/components/nutrition/food-search-modal'
import { GoalsEditor } from '@/components/nutrition/goals-editor'
import { cn } from '@/lib/utils'

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

interface LogEntry {
  id: string
  mealType: MealType
  foodName: string
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  servingSize: number
  servingUnit: string
  servingMultiplier: number
}

interface DailyTotals {
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
}

interface Target {
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
}

const MEAL_TYPES: { id: MealType; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snacks' },
]

function pct(consumed: number, target: number) {
  return Math.min(Math.round((consumed / target) * 100), 100)
}

function toDateString(d: Date) {
  return d.toISOString().slice(0, 10)
}

function formatDisplayDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  const today = toDateString(new Date())
  const yesterday = toDateString(new Date(Date.now() - 86400000))
  if (dateStr === today) return `Today · ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
  if (dateStr === yesterday) return `Yesterday · ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// ─── Inline serving editor ────────────────────────────────────────────────────

function ServingEditor({ entry, onSaved, onCancel }: {
  entry: LogEntry
  onSaved: () => void
  onCancel: () => void
}) {
  const [servings, setServings] = useState(entry.servingMultiplier)
  const [saving, setSaving] = useState(false)

  const cal = Math.round(entry.calories / entry.servingMultiplier * servings)
  const pro = Math.round(entry.proteinG / entry.servingMultiplier * servings * 10) / 10
  const carb = Math.round(entry.carbohydrateG / entry.servingMultiplier * servings * 10) / 10
  const fat = Math.round(entry.fatG / entry.servingMultiplier * servings * 10) / 10

  const handleSave = async () => {
    setSaving(true)
    await fetch('/api/nutrition/log', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, servingMultiplier: servings }),
    })
    onSaved()
  }

  return (
    <div className="py-2.5 border-b border-zinc-50 dark:border-zinc-800/50">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{entry.foodName}</p>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-zinc-500">Servings</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setServings(s => Math.max(0.5, Math.round((s - 0.5) * 10) / 10))}
            className="flex size-6 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Minus className="size-3" />
          </button>
          <input
            type="number"
            min={0.5} max={20} step={0.5}
            value={servings}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setServings(Math.round(v * 10) / 10) }}
            className="w-12 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-center text-sm text-zinc-900 dark:text-white focus:outline-none"
          />
          <button
            onClick={() => setServings(s => Math.round((s + 0.5) * 10) / 10)}
            className="flex size-6 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus className="size-3" />
          </button>
        </div>
        <span className="text-xs text-zinc-400">{cal} cal · P {pro}g · C {carb}g · F {fat}g</span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-1 text-xs font-bold hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="size-3 animate-spin" />}
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NutritionPage() {
  const [logDate, setLogDate] = useState(toDateString(new Date()))
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [totals, setTotals] = useState<DailyTotals>({ calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 })
  const [target, setTarget] = useState<Target>({ calories: 2000, proteinG: 150, carbohydrateG: 250, fatG: 65 })
  const [loading, setLoading] = useState(true)
  const [addingTo, setAddingTo] = useState<MealType | null>(null)
  const [editingGoals, setEditingGoals] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingEntry, setEditingEntry] = useState<string | null>(null)

  const isToday = logDate === toDateString(new Date())
  // Allow editing up to 7 days back
  const daysDiff = Math.floor((Date.now() - new Date(logDate + 'T12:00:00').getTime()) / 86400000)
  const canEdit = daysDiff <= 7

  const fetchDaily = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/nutrition/daily?date=${logDate}`)
    if (!res.ok) { setLoading(false); return }
    const data = await res.json() as { entries: LogEntry[]; totals: DailyTotals; target: Target }
    setEntries(data.entries)
    setTotals(data.totals)
    setTarget(data.target)
    setLoading(false)
  }, [logDate])

  useEffect(() => { fetchDaily() }, [fetchDaily])

  const goBack = () => {
    const d = new Date(logDate + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    setLogDate(toDateString(d))
  }

  const goForward = () => {
    if (isToday) return
    const d = new Date(logDate + 'T12:00:00')
    d.setDate(d.getDate() + 1)
    setLogDate(toDateString(d))
  }

  const deleteEntry = async (id: string) => {
    setDeleting(id)
    await fetch('/api/nutrition/log', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await fetchDaily()
    setDeleting(null)
  }

  const remaining = target.calories - totals.calories

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Nutrition</h1>
        {canEdit && (
          <Button size="sm" onClick={() => setAddingTo('breakfast')}>
            <Plus className="size-4" />
            Add food
          </Button>
        )}
      </div>

      {/* Date navigation */}
      <div className="mb-5 flex items-center justify-between rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm px-2 py-1">
        <button
          onClick={goBack}
          className="flex size-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <ChevronLeft className="size-5" />
        </button>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={logDate}
            max={toDateString(new Date())}
            onChange={e => e.target.value && setLogDate(e.target.value)}
            className="absolute opacity-0 w-0 h-0"
            id="date-picker"
          />
          <label
            htmlFor="date-picker"
            className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer"
          >
            {formatDisplayDate(logDate)}
          </label>
        </div>

        <button
          onClick={goForward}
          disabled={isToday}
          className="flex size-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* Daily summary */}
      <Card className="mb-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-1">Daily total</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-zinc-900 dark:text-white">
                {loading ? '—' : totals.calories.toLocaleString()}
              </span>
              <span className="text-sm text-zinc-400">/ {target.calories.toLocaleString()} cal</span>
            </div>
            <p className="text-sm text-zinc-500 mt-0.5">
              {loading ? '' : remaining > 0 ? `${remaining.toLocaleString()} remaining` : 'Goal reached!'}
            </p>
          </div>
          <button
            onClick={() => setEditingGoals(true)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <Pencil className="size-3" />
            Edit goals
          </button>
        </div>

        {/* Calorie bar */}
        <div className="mb-5 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={cn('h-full rounded-full transition-all duration-500', remaining < 0 ? 'bg-red-500' : 'bg-emerald-500')}
            style={{ width: `${pct(totals.calories, target.calories)}%` }}
          />
        </div>

        {/* Macros */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Protein',  consumed: totals.proteinG,      target: target.proteinG,      color: 'bg-sky-400',    text: 'text-sky-500' },
            { label: 'Carbs',    consumed: totals.carbohydrateG, target: target.carbohydrateG, color: 'bg-amber-400',  text: 'text-amber-500' },
            { label: 'Fat',      consumed: totals.fatG,          target: target.fatG,          color: 'bg-orange-400', text: 'text-orange-500' },
          ].map(({ label, consumed, target: t, color, text }) => (
            <div key={label} className="flex flex-col gap-1.5">
              <p className="text-xs text-zinc-400">{label}</p>
              <p className={`text-base font-black ${text}`}>{loading ? '—' : `${consumed}g`}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct(consumed, t)}%` }} />
              </div>
              <p className="text-xs text-zinc-400">of {t}g</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Quick add */}
      {canEdit && (
        <button
          onClick={() => setAddingTo('breakfast')}
          className="mb-6 flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-900/80 px-4 py-3 text-left text-sm text-zinc-400 shadow-sm transition-colors hover:border-zinc-300 backdrop-blur-sm"
        >
          <Search className="size-4 shrink-0" />
          Search foods, scan barcode, or snap a photo...
        </button>
      )}

      {/* Meal cards */}
      <div className="flex flex-col gap-3">
        {MEAL_TYPES.map(({ id, label }) => {
          const mealEntries = entries.filter(e => e.mealType === id)
          const mealCals = mealEntries.reduce((s, e) => s + e.calories, 0)

          return (
            <Card key={id} className="p-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm text-zinc-900 dark:text-white">{label}</p>
                </div>
                <div className="flex items-center gap-2">
                  {mealCals > 0 && (
                    <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">{mealCals} cal</span>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => setAddingTo(id)}
                      className="flex size-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Plus className="size-4" />
                    </button>
                  )}
                </div>
              </div>

              {mealEntries.length > 0 ? (
                <div className="px-5 py-1">
                  {mealEntries.map(entry => (
                    editingEntry === entry.id ? (
                      <ServingEditor
                        key={entry.id}
                        entry={entry}
                        onSaved={async () => { setEditingEntry(null); await fetchDaily() }}
                        onCancel={() => setEditingEntry(null)}
                      />
                    ) : (
                      <div key={entry.id} className="flex items-center justify-between py-2.5 border-b border-zinc-50 dark:border-zinc-800/50 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{entry.foodName}</p>
                          <p className="text-xs text-zinc-400">
                            {entry.calories} cal · P {entry.proteinG}g · C {entry.carbohydrateG}g · F {entry.fatG}g
                            {entry.servingMultiplier !== 1 && (
                              <span className="text-zinc-300 dark:text-zinc-600"> · {entry.servingMultiplier}×</span>
                            )}
                          </p>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-0.5 ml-3 shrink-0">
                            <button
                              onClick={() => setEditingEntry(entry.id)}
                              className="flex size-7 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 dark:hover:bg-zinc-800 transition-colors"
                            >
                              <Pencil className="size-3" />
                            </button>
                            <button
                              onClick={() => deleteEntry(entry.id)}
                              disabled={deleting === entry.id}
                              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-300 hover:bg-red-50 hover:text-red-400 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
                            >
                              {deleting === entry.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  ))}
                </div>
              ) : (
                <div className="px-5 py-4">
                  <p className="text-sm text-zinc-400">{canEdit ? 'No foods logged yet' : 'Nothing logged'}</p>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Modals */}
      {addingTo && (
        <FoodSearchModal
          mealType={addingTo}
          logDate={logDate}
          onLogged={fetchDaily}
          onClose={() => setAddingTo(null)}
        />
      )}

      {editingGoals && (
        <GoalsEditor
          current={target}
          onSaved={setTarget}
          onClose={() => setEditingGoals(false)}
        />
      )}
    </div>
  )
}
