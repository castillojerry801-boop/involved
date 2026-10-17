'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, UtensilsCrossed, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MealLogResolvedIngredient {
  name: string
  userDescription: string
  calories: number
  proteinG: number
  carbG: number
  fatG: number
  conversionNote?: string
}

export interface MealLogUnresolvedIngredient {
  name: string
  reason: string
}

export interface MealLogPendingData {
  calculationToken: string
  resolvedIngredients: MealLogResolvedIngredient[]
  unresolvedIngredients: MealLogUnresolvedIngredient[]
  totals: { calories: number; proteinG: number; carbG: number; fatG: number }
  completeness: 'complete' | 'estimated' | 'incomplete'
  mealType: string
  logDate: string
}

const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch:     'Lunch',
  dinner:    'Dinner',
  snack:     'Snack',
  other:     'Other',
}

export function MealLogConfirmCard({ data }: { data: MealLogPendingData }) {
  const [state, setState] = useState<'idle' | 'logging' | 'done' | 'error' | 'dismissed'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (state === 'dismissed') return null

  const isPartial = data.unresolvedIngredients.length > 0
  const mealLabel = MEAL_TYPE_LABELS[data.mealType] ?? data.mealType

  const handleLog = async () => {
    setState('logging')
    setErrorMsg(null)
    try {
      const res = await fetch('/api/coach/meal-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calculationToken: data.calculationToken,
          mealType:         data.mealType,
          logDate:          data.logDate,
        }),
      })
      const json = await res.json() as { ok?: boolean; isPartial?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setErrorMsg(json.error ?? 'Failed to log meal')
        setState('error')
        return
      }
      setState('done')
      // Signal other tabs/windows that a meal was logged so the Nutrition page can refetch.
      try { localStorage.setItem('v_meal_logged', data.logDate) } catch { /* private browsing */ }
    } catch {
      setErrorMsg('Something went wrong. Please try again.')
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-800/30 dark:bg-emerald-900/10 px-4 py-3 flex items-center gap-3">
        <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-400">
            {isPartial ? 'Partial meal' : 'Meal'} logged to {mealLabel}
          </p>
          <p className="text-xs text-emerald-700 dark:text-emerald-500">
            {data.totals.calories} cal · {data.totals.proteinG}g protein
            {isPartial && ` · ${data.unresolvedIngredients.length} item(s) not included`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="size-4 text-zinc-400" />
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">
            Log to {mealLabel}
          </p>
        </div>
        <button
          onClick={() => setState('dismissed')}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Incomplete nutrition warning */}
      {isPartial && (
        <div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/30 dark:bg-amber-900/10 px-3 py-2.5 flex gap-2.5">
          <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">Incomplete nutrition</p>
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">
              {data.unresolvedIngredients.length} item{data.unresolvedIngredients.length !== 1 ? 's were' : ' was'} not resolved and will not be included.
              This log will be marked as partial.
            </p>
          </div>
        </div>
      )}

      {/* Resolved ingredients */}
      <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50 mt-2">
        {data.resolvedIngredients.map((ing, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2.5 gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate">{ing.name}</p>
              <p className="text-xs text-zinc-400">{ing.userDescription}</p>
            </div>
            <p className="text-sm text-zinc-500 shrink-0">{ing.calories} cal</p>
          </div>
        ))}
      </div>

      {/* Unresolved items (if any) */}
      {isPartial && (
        <div className="mx-3 mb-2 mt-1 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 divide-y divide-zinc-100 dark:divide-zinc-700/50">
          {data.unresolvedIngredients.map((ing, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 gap-2">
              <p className="text-xs text-zinc-500 line-through truncate">{ing.name}</p>
              <p className="text-xs text-zinc-400 shrink-0">not resolved</p>
            </div>
          ))}
        </div>
      )}

      {/* Totals bar */}
      <div className="px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">
          {isPartial ? 'Partial total' : 'Total'}
        </p>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="font-semibold text-zinc-900 dark:text-white">{data.totals.calories} cal</span>
          <span>{data.totals.proteinG}g P</span>
          <span>{data.totals.carbG}g C</span>
          <span>{data.totals.fatG}g F</span>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 space-y-2">
        {state === 'error' && errorMsg && (
          <p className="text-xs text-red-500">{errorMsg}</p>
        )}
        <button
          onClick={handleLog}
          disabled={state === 'logging'}
          className={cn(
            'w-full rounded-xl py-2.5 text-sm font-bold transition-opacity flex items-center justify-center gap-2',
            'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50',
          )}
        >
          {state === 'logging'
            ? <><Loader2 className="size-4 animate-spin" /> Logging...</>
            : isPartial
              ? <><CheckCircle2 className="size-4" /> Log resolved items only</>
              : <><CheckCircle2 className="size-4" /> Log it</>
          }
        </button>
      </div>
    </div>
  )
}
