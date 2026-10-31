'use client'

import { useState } from 'react'
import { X, Plus, Minus, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { YMoveRecipeSummary } from '@/lib/ymove/recipes'

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

const MEAL_TYPES: { id: MealType; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch',     label: 'Lunch' },
  { id: 'dinner',    label: 'Dinner' },
  { id: 'snack',     label: 'Snack' },
]

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDefaultMealType(): MealType {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

interface HealthyLogModalProps {
  recipe: Pick<YMoveRecipeSummary, 'id' | 'title' | 'imageUrl' | 'calories' | 'protein' | 'fat' | 'carbs' | 'servings'>
  onLogged: () => void
  onClose: () => void
}

export function HealthyLogModal({ recipe, onLogged, onClose }: HealthyLogModalProps) {
  const [quantity,  setQuantity]  = useState(1)
  const [mealType,  setMealType]  = useState<MealType>(getDefaultMealType())
  const [logDate,   setLogDate]   = useState(toDateString(new Date()))
  const [saving,    setSaving]    = useState(false)
  const [success,   setSuccess]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const cal  = Math.round(recipe.calories * quantity)
  const pro  = Math.round(recipe.protein  * quantity * 10) / 10
  const carb = Math.round(recipe.carbs    * quantity * 10) / 10
  const fat  = Math.round(recipe.fat      * quantity * 10) / 10

  async function handleLog() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/nutrition/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          foodName:          recipe.title,
          mealType,
          logDate,
          servingMultiplier: quantity,
          servingSize:       1,
          servingUnit:       'serving',
          calories:          Math.round(recipe.calories),
          proteinG:          Math.round(recipe.protein * 10) / 10,
          carbohydrateG:     Math.round(recipe.carbs   * 10) / 10,
          fatG:              Math.round(recipe.fat      * 10) / 10,
          sourceProvider:    'ymove',
          externalId:        recipe.id,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Failed to log recipe')
      }
      localStorage.setItem('v_meal_logged', logDate)
      setSuccess(true)
      setTimeout(() => {
        onLogged()
        onClose()
      }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-zinc-900 rounded-t-2xl md:rounded-2xl w-full md:max-w-sm p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-400 mb-0.5">Add to Food Log</p>
            <p className="font-semibold text-zinc-900 dark:text-white text-sm leading-snug line-clamp-2">
              {recipe.title}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Servings */}
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-2">Servings</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuantity((q) => Math.max(0.5, Math.round((q - 0.5) * 10) / 10))}
              className="flex size-8 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Minus className="size-3.5" />
            </button>
            <input
              type="number"
              min={0.5} max={10} step={0.5}
              value={quantity}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v) && v >= 0.5 && v <= 10) setQuantity(Math.round(v * 10) / 10)
              }}
              className="w-16 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1.5 text-center text-sm font-semibold text-zinc-900 dark:text-white focus:outline-none"
            />
            <button
              onClick={() => setQuantity((q) => Math.min(10, Math.round((q + 0.5) * 10) / 10))}
              className="flex size-8 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Plus className="size-3.5" />
            </button>
            <div className="ml-auto text-right">
              <p className="text-sm font-bold text-zinc-900 dark:text-white">{cal} cal</p>
              <p className="text-xs text-zinc-400">
                <span className="text-sky-500">P {pro}g</span>
                {' · '}
                <span className="text-amber-500">C {carb}g</span>
                {' · '}
                <span className="text-orange-500">F {fat}g</span>
              </p>
            </div>
          </div>
        </div>

        {/* Meal type */}
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-2">Meal</p>
          <div className="grid grid-cols-4 gap-1.5">
            {MEAL_TYPES.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setMealType(id)}
                className={cn(
                  'rounded-xl py-2 text-xs font-semibold transition-colors',
                  mealType === id
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Date */}
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-2">Date</p>
          <input
            type="date"
            value={logDate}
            max={toDateString(new Date())}
            onChange={(e) => e.target.value && setLogDate(e.target.value)}
            className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none w-full"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-500 text-center">{error}</p>
        )}

        {/* Action */}
        <button
          onClick={handleLog}
          disabled={saving || success}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition-colors',
            success
              ? 'bg-emerald-500 text-white'
              : 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50',
          )}
        >
          {success ? (
            <><Check className="size-4" /> Logged!</>
          ) : saving ? (
            <><Loader2 className="size-4 animate-spin" /> Adding...</>
          ) : (
            'Add to Log'
          )}
        </button>
      </div>
    </div>
  )
}
