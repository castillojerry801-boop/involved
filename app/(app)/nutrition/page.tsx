'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Search } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FoodSearchModal } from '@/components/nutrition/food-search-modal'
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

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function NutritionPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [totals, setTotals] = useState<DailyTotals>({ calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 })
  const [target, setTarget] = useState<Target>({ calories: 2000, proteinG: 150, carbohydrateG: 250, fatG: 65 })
  const [loading, setLoading] = useState(true)
  const [addingTo, setAddingTo] = useState<MealType | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const logDate = today()

  const fetchDaily = useCallback(async () => {
    const res = await fetch(`/api/nutrition/daily?date=${logDate}`)
    if (!res.ok) return
    const data = await res.json() as { entries: LogEntry[]; totals: DailyTotals; target: Target }
    setEntries(data.entries)
    setTotals(data.totals)
    setTarget(data.target)
    setLoading(false)
  }, [logDate])

  useEffect(() => { fetchDaily() }, [fetchDaily])

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
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Nutrition</h1>
          <p className="text-sm text-zinc-500">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Button size="sm" onClick={() => setAddingTo('breakfast')}>
          <Plus className="size-4" />
          Add food
        </Button>
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
            { label: 'Carbs',    consumed: totals.carbohydrateG,  target: target.carbohydrateG, color: 'bg-amber-400',  text: 'text-amber-500' },
            { label: 'Fat',      consumed: totals.fatG,           target: target.fatG,          color: 'bg-orange-400', text: 'text-orange-500' },
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

      {/* Quick add search bar */}
      <button
        onClick={() => setAddingTo('breakfast')}
        className="mb-6 flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-900/80 px-4 py-3 text-left text-sm text-zinc-400 shadow-sm transition-colors hover:border-zinc-300 backdrop-blur-sm"
      >
        <Search className="size-4 shrink-0" />
        Search foods, scan barcode, or snap a photo...
      </button>

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
                    <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                      {mealCals} cal
                    </span>
                  )}
                  <button
                    onClick={() => setAddingTo(id)}
                    className="flex size-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </div>

              {mealEntries.length > 0 ? (
                <div className="px-5 py-1">
                  {mealEntries.map(entry => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between py-2.5 border-b border-zinc-50 dark:border-zinc-800/50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{entry.foodName}</p>
                        <p className="text-xs text-zinc-400">
                          {entry.calories} cal · P {entry.proteinG}g · C {entry.carbohydrateG}g · F {entry.fatG}g
                        </p>
                      </div>
                      <button
                        onClick={() => deleteEntry(entry.id)}
                        disabled={deleting === entry.id}
                        className="ml-3 flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-300 hover:bg-red-50 hover:text-red-400 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-4">
                  <p className="text-sm text-zinc-400">No foods logged yet</p>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Add food modal */}
      {addingTo && (
        <FoodSearchModal
          mealType={addingTo}
          logDate={logDate}
          onLogged={() => { fetchDaily() }}
          onClose={() => setAddingTo(null)}
        />
      )}
    </div>
  )
}
