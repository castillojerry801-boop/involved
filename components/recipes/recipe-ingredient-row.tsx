'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Trash2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface IngredientDraft {
  key: string // client-side key only
  foodItemId: string | null
  name: string
  quantity: number
  unit: string
  notes: string
  snapshotCalories: number | null
  snapshotProteinG: number | null
  snapshotCarbG: number | null
  snapshotFatG: number | null
}

interface FoodResult {
  id: string
  name: string
  brand?: string | null
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  servingSize: number
  servingUnit: string
}

interface RecipeIngredientRowProps {
  ingredient: IngredientDraft
  onChange: (updated: IngredientDraft) => void
  onRemove: () => void
}

export function RecipeIngredientRow({ ingredient, onChange, onRemove }: RecipeIngredientRowProps) {
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<FoodResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleNameChange = useCallback(
    (name: string) => {
      // Clear matched food when name changes
      onChange({ ...ingredient, name, foodItemId: null, snapshotCalories: null, snapshotProteinG: null, snapshotCarbG: null, snapshotFatG: null })
      if (name.trim().length >= 2) {
        if (searchRef.current) clearTimeout(searchRef.current)
        searchRef.current = setTimeout(async () => {
          setSearching(true)
          try {
            const res = await fetch(`/api/nutrition/search?q=${encodeURIComponent(name.trim())}&limit=5`)
            if (res.ok) {
              const data = await res.json() as { results: FoodResult[] }
              setResults(data.results)
              setShowDropdown(data.results.length > 0)
            }
          } finally {
            setSearching(false)
          }
        }, 350)
      } else {
        setResults([])
        setShowDropdown(false)
      }
    },
    [ingredient, onChange],
  )

  const selectFood = useCallback(
    (food: FoodResult) => {
      // Compute ingredient nutrition: quantity/servingSize * per-serving macro
      const factor = ingredient.quantity > 0 && food.servingSize > 0
        ? ingredient.quantity / food.servingSize
        : 1

      onChange({
        ...ingredient,
        name: food.brand ? `${food.name} (${food.brand})` : food.name,
        foodItemId: food.id,
        unit: food.servingUnit,
        snapshotCalories: Math.round(food.calories * factor * 100) / 100,
        snapshotProteinG: Math.round(food.proteinG * factor * 1000) / 1000,
        snapshotCarbG: Math.round(food.carbohydrateG * factor * 1000) / 1000,
        snapshotFatG: Math.round(food.fatG * factor * 1000) / 1000,
      })
      setShowDropdown(false)
      setResults([])
    },
    [ingredient, onChange],
  )

  // Dismiss dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.closest('[data-ingredient-row]')?.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isMatched = ingredient.foodItemId !== null

  return (
    <div data-ingredient-row className="relative rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3">
      <div className="flex gap-2 items-start">
        {/* Quantity */}
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={ingredient.quantity || ''}
          onChange={(e) => {
            const q = parseFloat(e.target.value)
            onChange({ ...ingredient, quantity: isNaN(q) ? 0 : q })
          }}
          placeholder="Qty"
          className="w-16 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-zinc-400"
        />

        {/* Unit */}
        <input
          type="text"
          value={ingredient.unit}
          onChange={(e) => onChange({ ...ingredient, unit: e.target.value })}
          placeholder="Unit"
          className="w-16 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
        />

        {/* Name with inline search */}
        <div className="flex-1 relative">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={ingredient.name}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => results.length > 0 && setShowDropdown(true)}
              placeholder="Ingredient name"
              className={cn(
                'w-full rounded-lg border bg-white dark:bg-zinc-900 px-2 py-1.5 pr-7 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-400',
                isMatched
                  ? 'border-emerald-300 dark:border-emerald-700'
                  : 'border-zinc-200 dark:border-zinc-600',
              )}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {searching
                ? <Loader2 className="size-3.5 text-zinc-400 animate-spin" />
                : isMatched
                  ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                  : ingredient.name.length >= 2
                    ? <AlertCircle className="size-3.5 text-zinc-300" />
                    : null}
            </span>
          </div>

          {/* Dropdown results */}
          {showDropdown && (
            <div className="absolute z-20 mt-1 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
              {results.map((food) => (
                <button
                  key={food.id}
                  onMouseDown={(e) => { e.preventDefault(); selectFood(food) }}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm"
                >
                  <span className="font-medium text-zinc-900 dark:text-white truncate">
                    {food.name}{food.brand ? ` (${food.brand})` : ''}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {food.servingSize} {food.servingUnit} · {Math.round(food.calories)} cal
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Notes */}
      <input
        type="text"
        value={ingredient.notes}
        onChange={(e) => onChange({ ...ingredient, notes: e.target.value })}
        placeholder="Notes (optional)"
        className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 placeholder-zinc-300 focus:outline-none"
      />

      {/* Matched nutrition preview */}
      {isMatched && ingredient.snapshotCalories != null && (
        <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          ≈ {Math.round(ingredient.snapshotCalories)} cal · P {ingredient.snapshotProteinG?.toFixed(1)}g · C {ingredient.snapshotCarbG?.toFixed(1)}g · F {ingredient.snapshotFatG?.toFixed(1)}g
        </p>
      )}
    </div>
  )
}
