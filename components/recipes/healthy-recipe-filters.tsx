'use client'

import { useState } from 'react'
import { Search, SlidersHorizontal, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

const MEAL_TYPE_OPTIONS = [
  { value: '',            label: 'All' },
  { value: 'breakfast',   label: 'Breakfast' },
  { value: 'lunch',       label: 'Lunch' },
  { value: 'dinner',      label: 'Dinner' },
  { value: 'snack',       label: 'Snack' },
  { value: 'post_workout', label: 'Post-Workout' },
]

const DIET_OPTIONS = [
  { value: '',            label: 'All' },
  { value: 'high_protein', label: 'High Protein' },
  { value: 'vegetarian',  label: 'Vegetarian' },
  { value: 'vegan',       label: 'Vegan' },
  { value: 'keto',        label: 'Keto' },
  { value: 'low_carb',    label: 'Low Carb' },
  { value: 'mediterranean', label: 'Mediterranean' },
]

interface Filters {
  q: string
  mealType: string
  diet: string
  maxCalories: string
  minProtein: string
}

interface HealthyRecipeFiltersProps {
  filters: Filters
  onChange: (key: string, value: string) => void
  goalsCalories?: number | null
  goalsProtein?: number | null
}

export function HealthyRecipeFilters({
  filters,
  onChange,
  goalsCalories,
  goalsProtein,
}: HealthyRecipeFiltersProps) {
  const [showMore, setShowMore] = useState(false)

  const goalsActive = goalsCalories != null && goalsCalories > 0

  const goalMaxCal   = goalsCalories ? String(Math.round(goalsCalories * 0.35)) : ''
  const goalMinPro   = goalsProtein  ? String(Math.round(goalsProtein  * 0.25)) : ''
  const fitsGoalsOn  = filters.maxCalories === goalMaxCal && filters.minProtein === goalMinPro && goalsActive

  function toggleFitsGoals() {
    if (fitsGoalsOn) {
      onChange('maxCalories', '')
      onChange('minProtein',  '')
    } else {
      onChange('maxCalories', goalMaxCal)
      onChange('minProtein',  goalMinPro)
    }
  }

  const activeCount = [
    filters.mealType, filters.diet, filters.maxCalories, filters.minProtein,
  ].filter(Boolean).length

  return (
    <div className="space-y-3 mb-5">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        <input
          type="search"
          placeholder="Search recipes..."
          value={filters.q}
          onChange={(e) => onChange('q', e.target.value)}
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-9 pr-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-500 transition-colors"
        />
      </div>

      {/* Meal type pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        {MEAL_TYPE_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onChange('mealType', value)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              filters.mealType === value
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Diet pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        {DIET_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onChange('diet', value)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              filters.diet === value
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Row: Fits my goals + More filters toggle */}
      <div className="flex items-center gap-2">
        {goalsActive && (
          <button
            onClick={toggleFitsGoals}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors',
              fitsGoalsOn
                ? 'bg-emerald-500 text-white border-emerald-500'
                : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10',
            )}
          >
            <Target className="size-3" />
            Fits my goals
          </button>
        )}

        <button
          onClick={() => setShowMore((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border border-zinc-200 dark:border-zinc-700 transition-colors',
            showMore
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800',
          )}
        >
          <SlidersHorizontal className="size-3" />
          More filters
          {activeCount > 0 && !fitsGoalsOn && (
            <span className="ml-0.5 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] text-white font-bold">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* Expanded more-filters */}
      {showMore && (
        <div className="flex gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-zinc-500 mb-1">Max Calories</label>
            <input
              type="number"
              min={0}
              placeholder="e.g. 500"
              value={filters.maxCalories}
              onChange={(e) => onChange('maxCalories', e.target.value)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-zinc-500 mb-1">Min Protein (g)</label>
            <input
              type="number"
              min={0}
              placeholder="e.g. 25"
              value={filters.minProtein}
              onChange={(e) => onChange('minProtein', e.target.value)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      )}
    </div>
  )
}
