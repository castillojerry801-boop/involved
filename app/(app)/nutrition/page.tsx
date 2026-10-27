'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Plus, Trash2, Search, ChevronLeft, ChevronRight, Pencil, Minus, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
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
  isPartial?: boolean
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
  { id: 'lunch',     label: 'Lunch' },
  { id: 'dinner',    label: 'Dinner' },
  { id: 'snack',     label: 'Snacks' },
]

function pct(consumed: number, target: number) {
  return Math.min(Math.round((consumed / target) * 100), 100)
}

function toDateString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDisplayDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  const today     = toDateString(new Date())
  const yesterday = toDateString(new Date(Date.now() - 86400000))
  if (dateStr === today)     return `Today · ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
  if (dateStr === yesterday) return `Yesterday · ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// ─── Ring chart ───────────────────────────────────────────────────────────────

function CircleRing({ value, max, size, stroke, className, trackClassName }: {
  value: number; max: number; size: number; stroke: number
  className: string; trackClassName?: string
}) {
  const r            = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const filled        = Math.min(value / Math.max(max, 1), 1)
  const offset        = circumference * (1 - filled)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="currentColor" strokeWidth={stroke}
        className={cn('text-zinc-200 dark:text-zinc-700', trackClassName)} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="currentColor" strokeWidth={stroke}
        strokeLinecap="round" className={className}
        style={{ strokeDasharray: circumference, strokeDashoffset: offset, transition: 'stroke-dashoffset 0.6s ease' }} />
    </svg>
  )
}

// ─── Inline serving editor ────────────────────────────────────────────────────

function ServingEditor({ entry, onSaved, onCancel }: {
  entry: LogEntry
  onSaved: () => void
  onCancel: () => void
}) {
  const [servings, setServings] = useState(entry.servingMultiplier)
  const [saving, setSaving] = useState(false)

  const cal  = Math.round(entry.calories        / entry.servingMultiplier * servings)
  const pro  = Math.round(entry.proteinG        / entry.servingMultiplier * servings * 10) / 10
  const carb = Math.round(entry.carbohydrateG   / entry.servingMultiplier * servings * 10) / 10
  const fat  = Math.round(entry.fatG            / entry.servingMultiplier * servings * 10) / 10

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
    <div className="py-3 border-b border-zinc-50 dark:border-zinc-800/50 last:border-0">
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-3">{entry.foodName}</p>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-zinc-500 w-14 shrink-0">Servings</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setServings(s => Math.max(0.5, Math.round((s - 0.5) * 10) / 10))}
            className="flex size-7 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Minus className="size-3" />
          </button>
          <input
            type="number" min={0.5} max={20} step={0.5} value={servings}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setServings(Math.round(v * 10) / 10) }}
            className="w-14 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-center text-sm text-zinc-900 dark:text-white focus:outline-none"
          />
          <button
            onClick={() => setServings(s => Math.round((s + 0.5) * 10) / 10)}
            className="flex size-7 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus className="size-3" />
          </button>
        </div>
        <span className="text-xs text-zinc-400">{cal} cal</span>
      </div>
      <p className="text-xs text-zinc-400 mb-3">
        <span className="text-sky-500">P {pro}g</span>
        {' · '}
        <span className="text-amber-500">C {carb}g</span>
        {' · '}
        <span className="text-orange-500">F {fat}g</span>
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleSave} disabled={saving}
          className="flex items-center gap-1 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-1.5 text-xs font-bold hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="size-3 animate-spin" />}
          Save
        </button>
        <button onClick={onCancel} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function getDefaultMealType(): MealType {
  const hour = new Date().getHours()
  if (hour < 11) return 'breakfast'
  if (hour < 15) return 'lunch'
  if (hour < 21) return 'dinner'
  return 'snack'
}

function NutritionContent() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [logDate,      setLogDate]      = useState(toDateString(new Date()))
  const [entries,      setEntries]      = useState<LogEntry[]>([])
  const [totals,       setTotals]       = useState<DailyTotals>({ calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 })
  const [target,       setTarget]       = useState<Target>({ calories: 2000, proteinG: 150, carbohydrateG: 250, fatG: 65 })
  const [loading,      setLoading]      = useState(true)
  const [addingTo,     setAddingTo]     = useState<MealType | null>(null)
  const [editingGoals, setEditingGoals] = useState(false)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const [editingEntry, setEditingEntry] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get('add') === 'true') {
      setAddingTo(getDefaultMealType())
      const params = new URLSearchParams(searchParams.toString())
      params.delete('add')
      router.replace(params.size ? `${pathname}?${params.toString()}` : pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isToday  = logDate === toDateString(new Date())
  const daysDiff = Math.floor((Date.now() - new Date(logDate + 'T12:00:00').getTime()) / 86400000)
  const canEdit  = daysDiff <= 7

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

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'v_meal_logged' && e.newValue === logDate) fetchDaily()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [fetchDaily, logDate])

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

  const macros = [
    { label: 'Protein', consumed: totals.proteinG,      target: target.proteinG,      ring: 'text-sky-400',    text: 'text-sky-500' },
    { label: 'Carbs',   consumed: totals.carbohydrateG, target: target.carbohydrateG, ring: 'text-amber-400',  text: 'text-amber-500' },
    { label: 'Fat',     consumed: totals.fatG,          target: target.fatG,          ring: 'text-orange-400', text: 'text-orange-500' },
  ]

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">

      <PageHeader title="Nutrition">
        {canEdit && (
          <Button size="sm" onClick={() => setAddingTo(getDefaultMealType())}>
            <Plus className="size-4" />
            Add food
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-col md:flex-row gap-6">

        {/* ── Left panel: date nav + summary ─────────────────────────────── */}
        <div className="md:w-72 shrink-0 md:sticky md:top-6 md:self-start space-y-4">

          {/* Date navigation */}
          <div className="flex items-center justify-between rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1">
            <button
              onClick={goBack}
              className="flex size-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="flex items-center">
              <input
                type="date" value={logDate} max={toDateString(new Date())}
                onChange={e => e.target.value && setLogDate(e.target.value)}
                className="absolute opacity-0 w-0 h-0" id="date-picker"
              />
              <label htmlFor="date-picker" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer">
                {formatDisplayDate(logDate)}
              </label>
            </div>
            <button
              onClick={goForward} disabled={isToday}
              className="flex size-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>

          {/* Summary card */}
          <Card>
            <div className="flex items-center justify-between mb-5">
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Daily total</p>
              <button
                onClick={() => setEditingGoals(true)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                <Pencil className="size-3" />
                Edit goals
              </button>
            </div>

            {/* Calorie ring */}
            <div className="flex flex-col items-center mb-4">
              <div className="relative">
                <CircleRing
                  value={loading ? 0 : totals.calories}
                  max={target.calories}
                  size={140} stroke={12}
                  className={remaining < 0 ? 'text-red-500' : 'text-emerald-500'}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-black text-zinc-900 dark:text-white leading-none">
                    {loading ? '—' : totals.calories.toLocaleString()}
                  </span>
                  <span className="text-xs text-zinc-400 mt-1">
                    of {target.calories.toLocaleString()} cal
                  </span>
                </div>
              </div>
              <p className={cn('text-sm font-medium mt-3', remaining < 0 ? 'text-red-500' : 'text-zinc-500')}>
                {loading ? ' ' : remaining > 0
                  ? `${remaining.toLocaleString()} remaining`
                  : remaining === 0
                    ? 'Goal reached!'
                    : `${Math.abs(remaining).toLocaleString()} over goal`}
              </p>
            </div>

            {/* Macro rings */}
            <div className="grid grid-cols-3 gap-2">
              {macros.map(({ label, consumed, target: t, ring, text }) => {
                const isOver = !loading && t > 0 && consumed > t
                const excess = isOver ? Math.round((consumed - t) * 10) / 10 : 0
                return (
                  <div key={label} className="flex flex-col items-center gap-1">
                    <div className="relative">
                      <CircleRing
                        value={loading ? 0 : consumed} max={t}
                        size={60} stroke={5} className={ring}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className={cn('text-[10px] font-bold', text)}>
                          {loading ? '—' : isOver ? '↑' : `${pct(consumed, t)}%`}
                        </span>
                      </div>
                    </div>
                    <p className={cn('text-sm font-bold leading-none', text)}>
                      {loading ? '—' : `${consumed}g`}
                    </p>
                    <p className="text-[10px] text-zinc-400">{label}</p>
                    {isOver
                      ? <p className="text-[10px] text-red-400">{excess}g over</p>
                      : <p className="text-[10px] text-zinc-400">/ {t}g</p>}
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        {/* ── Right panel: quick add + meal diary ──────────────────────── */}
        <div className="flex-1 min-w-0 space-y-3">

          {/* Quick add */}
          {canEdit && (
            <button
              onClick={() => setAddingTo(getDefaultMealType())}
              className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-left text-sm text-zinc-400 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
            >
              <Search className="size-4 shrink-0" />
              Search foods, scan barcode, or snap a photo...
            </button>
          )}

          {/* Meal cards */}
          {MEAL_TYPES.map(({ id, label }) => {
            const mealEntries = entries.filter(e => e.mealType === id)
            const mealCals    = mealEntries.reduce((s, e) => s + e.calories, 0)

            return (
              <Card key={id} className="p-0 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-zinc-900 dark:text-white">{label}</p>
                    {mealCals > 0 && (
                      <span className="text-xs font-medium text-zinc-400">{mealCals} cal</span>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => setAddingTo(id)}
                      className="flex size-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
                    >
                      <Plus className="size-4" />
                    </button>
                  )}
                </div>

                {mealEntries.length > 0 ? (
                  <div className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
                    {mealEntries.map(entry => (
                      editingEntry === entry.id ? (
                        <div key={entry.id} className="px-4">
                          <ServingEditor
                            entry={entry}
                            onSaved={async () => { setEditingEntry(null); await fetchDaily() }}
                            onCancel={() => setEditingEntry(null)}
                          />
                        </div>
                      ) : (
                        <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                              {entry.foodName}
                            </p>
                            <p className="text-xs text-zinc-400 mt-0.5">
                              {entry.calories} cal
                              <span className="mx-1 text-zinc-300 dark:text-zinc-600">·</span>
                              <span className="text-sky-500">P {entry.proteinG}g</span>
                              <span className="mx-1 text-zinc-300 dark:text-zinc-600">·</span>
                              <span className="text-amber-500">C {entry.carbohydrateG}g</span>
                              <span className="mx-1 text-zinc-300 dark:text-zinc-600">·</span>
                              <span className="text-orange-500">F {entry.fatG}g</span>
                              {entry.servingMultiplier !== 1 && (
                                <span className="ml-1 text-zinc-400">{entry.servingMultiplier}×</span>
                              )}
                              {entry.isPartial && (
                                <span className="ml-1 text-amber-500">Partial</span>
                              )}
                            </p>
                          </div>
                          {canEdit && (
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                onClick={() => setEditingEntry(entry.id)}
                                className="flex size-7 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
                              >
                                <Pencil className="size-3" />
                              </button>
                              <button
                                onClick={() => deleteEntry(entry.id)}
                                disabled={deleting === entry.id}
                                className="flex size-7 items-center justify-center rounded-lg text-zinc-300 hover:bg-red-50 hover:text-red-400 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
                              >
                                {deleting === entry.id
                                  ? <Loader2 className="size-3.5 animate-spin" />
                                  : <Trash2 className="size-3.5" />}
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-4">
                    <p className="text-sm text-zinc-400">{canEdit ? 'Nothing logged yet' : 'Nothing logged'}</p>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
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

export default function NutritionPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
      </div>
    }>
      <NutritionContent />
    </Suspense>
  )
}
