'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Trash2, CheckCircle2, AlertCircle, Link2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExternalFoodResult } from '@/lib/nutrition/providers/types'
import { computeIngredientFactor } from '@/lib/recipes/nutrition'

// Shape returned by /api/nutrition/search.
// Library results: externalId = original provider ID (for dedup); internalId = DB UUID (for recipe FK).
// External results: externalId = provider's own ID, no internalId.
type FoodSearchResult = ExternalFoodResult & {
  source: 'library' | 'external'
}

// Per-ingredient reference data kept client-side for live recalculation.
// Not persisted — stripped before API submission via toApiIngredient().
interface BaseFoodData {
  servingSize: number
  servingUnit: string
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  householdUnit?: string    // "large egg", "strip", "slice"
  unitsPerServing?: number  // how many household units = 1 DB serving
}

export interface IngredientDraft {
  key: string
  foodItemId: string | null
  name: string
  quantity: number
  unit: string
  notes: string
  snapshotCalories: number | null
  snapshotProteinG: number | null
  snapshotCarbG: number | null
  snapshotFatG: number | null
  // Client-only: retained so quantity/unit edits can recalculate nutrition.
  _baseFood?: BaseFoodData | null
}

// Returns the ingredient without client-only fields, ready for API submission.
export function toApiIngredient(
  ing: IngredientDraft,
): Omit<IngredientDraft, '_baseFood' | 'key'> & { key?: never; _baseFood?: never } {
  const { _baseFood: _bf, key: _k, ...rest } = ing
  return rest
}

// A macro snapshot is valid when it is a finite, non-negative number.
function isValidSnapshot(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v >= 0
}

// An ingredient has usable nutrition when all four snapshot macros are valid.
// foodItemId is not required — external foods have valid nutrition without a DB link.
export function hasValidNutrition(ing: Pick<IngredientDraft, 'snapshotCalories' | 'snapshotProteinG' | 'snapshotCarbG' | 'snapshotFatG'>): boolean {
  return (
    isValidSnapshot(ing.snapshotCalories) &&
    isValidSnapshot(ing.snapshotProteinG) &&
    isValidSnapshot(ing.snapshotCarbG) &&
    isValidSnapshot(ing.snapshotFatG)
  )
}

// ── Unit sets (mirrored from lib/recipes/nutrition.ts for client-side chip logic) ──
// Keep in sync with lib/recipes/nutrition.ts

const GRAM_UNITS      = new Set(['g', 'gram', 'grams', 'grm'])
const ML_UNITS        = new Set(['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'])
const OZ_UNITS        = new Set(['oz', 'ounce', 'ounces'])
const LB_UNITS        = new Set(['lb', 'lbs', 'pound', 'pounds'])
const CUP_UNITS       = new Set(['cup', 'cups'])
const TBSP_UNITS      = new Set(['tbsp', 'tablespoon', 'tablespoons'])
const TSP_UNITS       = new Set(['tsp', 'teaspoon', 'teaspoons'])
const FL_OZ_UNITS     = new Set(['fl oz', 'floz', 'fl_oz', 'fluid oz', 'fluid ounce', 'fluid ounces'])
const SERVING_ALIASES = new Set(['serving', 'servings', 'portion', 'portions'])

// Build the ordered list of unit options for a given food's base data.
// Used to populate the unit dropdown.
export function getUnitOptions(baseFood: BaseFoodData): { label: string; value: string }[] {
  const options: { label: string; value: string }[] = []
  const fu = baseFood.servingUnit.toLowerCase().trim()

  // Household countable unit is always the top option when available
  if (baseFood.householdUnit) {
    options.push({ label: baseFood.householdUnit, value: baseFood.householdUnit })
  }

  // Standard units based on the food's metric serving type
  if (GRAM_UNITS.has(fu) || OZ_UNITS.has(fu)) {
    options.push(
      { label: 'g', value: 'g' },
      { label: 'oz', value: 'oz' },
      { label: 'lb', value: 'lb' },
    )
  } else if (ML_UNITS.has(fu) || CUP_UNITS.has(fu) || TBSP_UNITS.has(fu) || TSP_UNITS.has(fu) || FL_OZ_UNITS.has(fu)) {
    options.push(
      { label: 'ml', value: 'ml' },
      { label: 'cup', value: 'cup' },
      { label: 'tbsp', value: 'tbsp' },
      { label: 'tsp', value: 'tsp' },
      { label: 'fl oz', value: 'fl oz' },
    )
  } else if (!SERVING_ALIASES.has(fu) && !baseFood.householdUnit) {
    // Unknown / synthesized unit (e.g. "large egg" stored as servingUnit on reopen)
    options.push({ label: baseFood.servingUnit, value: baseFood.servingUnit })
  }

  // Serving is always available
  options.push({ label: 'serving', value: 'serving' })

  // Deduplicate preserving order
  const seen = new Set<string>()
  return options.filter(o => {
    const key = o.value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

interface RecipeIngredientRowProps {
  ingredient: IngredientDraft
  onChange: (updated: IngredientDraft) => void
  onRemove: () => void
}

function applyFactor(
  base: BaseFoodData,
  factor: number,
): Pick<IngredientDraft, 'snapshotCalories' | 'snapshotProteinG' | 'snapshotCarbG' | 'snapshotFatG'> {
  return {
    snapshotCalories: Math.round(base.calories       * factor * 100)  / 100,
    snapshotProteinG: Math.round(base.proteinG        * factor * 1000) / 1000,
    snapshotCarbG:    Math.round(base.carbohydrateG   * factor * 1000) / 1000,
    snapshotFatG:     Math.round(base.fatG            * factor * 1000) / 1000,
  }
}

const NULL_SNAPSHOTS = {
  snapshotCalories: null,
  snapshotProteinG: null,
  snapshotCarbG: null,
  snapshotFatG: null,
} as const

// When an ingredient is loaded from the API (no _baseFood), reconstruct a synthetic
// reference from the persisted snapshot so quantity/unit changes can still recalculate.
// The saved (quantity, unit) becomes the "one serving" reference; subsequent edits scale from it.
function synthesizeBaseFood(ing: IngredientDraft): BaseFoodData | null {
  if (!hasValidNutrition(ing) || !(ing.quantity > 0) || !ing.unit) return null
  return {
    servingSize: ing.quantity,
    servingUnit: ing.unit,
    calories: ing.snapshotCalories!,
    proteinG: ing.snapshotProteinG!,
    carbohydrateG: ing.snapshotCarbG!,
    fatG: ing.snapshotFatG!,
    // householdUnit / unitsPerServing are not reconstructable from the snapshot
    // (they are not stored in RecipeIngredient). The unit itself ("large egg") acts
    // as the serving unit in the synthesized base, so the same-unit path handles it.
  }
}

export function RecipeIngredientRow({ ingredient, onChange, onRemove }: RecipeIngredientRowProps) {
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<FoodSearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleNameChange = useCallback(
    (name: string) => {
      // Clear match when the user edits the name manually
      onChange({ ...ingredient, name, foodItemId: null, _baseFood: null, ...NULL_SNAPSHOTS })
      if (name.trim().length >= 2) {
        if (searchRef.current) clearTimeout(searchRef.current)
        searchRef.current = setTimeout(async () => {
          setSearching(true)
          try {
            const res = await fetch(`/api/nutrition/search?q=${encodeURIComponent(name.trim())}&limit=5&context=recipe`)
            if (res.ok) {
              const data = await res.json() as { results: FoodSearchResult[] }
              const list = data.results ?? []
              setResults(list)
              setShowDropdown(list.length > 0)
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
    (food: FoodSearchResult) => {
      const { calories, proteinG, carbohydrateG, fatG } = food.coreNutrients
      // Guard against malformed provider data
      if (
        !isValidSnapshot(calories) ||
        !isValidSnapshot(proteinG) ||
        !isValidSnapshot(carbohydrateG) ||
        !isValidSnapshot(fatG)
      ) {
        // Name and link food but mark nutrition as unavailable
        onChange({
          ...ingredient,
          name: food.brand ? `${food.name} (${food.brand})` : food.name,
          foodItemId: food.source === 'library' ? (food.internalId ?? food.externalId) : null,
          unit: food.servingUnit,
          _baseFood: null,
          ...NULL_SNAPSHOTS,
        })
        setShowDropdown(false)
        setResults([])
        return
      }

      const servingSize = food.servingSize > 0 ? food.servingSize : 1
      const baseFood: BaseFoodData = {
        servingSize,
        servingUnit: food.servingUnit,
        calories,
        proteinG,
        carbohydrateG,
        fatG,
        householdUnit: food.householdUnit,
        unitsPerServing: food.unitsPerServing,
      }

      // Default to household unit when available (e.g., "1 large egg"), otherwise metric serving.
      const defaultUnit = food.householdUnit ?? food.servingUnit
      const defaultQty  = food.householdUnit && food.unitsPerServing
        ? food.unitsPerServing
        : servingSize

      onChange({
        ...ingredient,
        name: food.brand ? `${food.name} (${food.brand})` : food.name,
        // Use internalId (DB UUID) for recipe ingredient FK when available.
        // Falls back to externalId for backward compatibility with cached results
        // that predate the internalId field.
        foodItemId: food.source === 'library' ? (food.internalId ?? food.externalId) : null,
        quantity: defaultQty,
        unit: defaultUnit,
        _baseFood: baseFood,
        ...applyFactor(baseFood, 1),
      })
      setShowDropdown(false)
      setResults([])
    },
    [ingredient, onChange],
  )

  const handleQuantityChange = useCallback(
    (raw: string) => {
      const qty = parseFloat(raw)
      if (!Number.isFinite(qty) || qty <= 0) {
        onChange({ ...ingredient, quantity: isNaN(qty) ? 0 : qty, ...NULL_SNAPSHOTS })
        return
      }
      // Use explicit _baseFood when available; otherwise synthesize from persisted snapshot.
      // Store the resolved baseFood back so subsequent changes chain off the same reference.
      const baseFood = ingredient._baseFood ?? synthesizeBaseFood(ingredient)
      if (baseFood) {
        const factor = computeIngredientFactor(
          baseFood.servingSize, baseFood.servingUnit, qty, ingredient.unit,
          baseFood.householdUnit, baseFood.unitsPerServing,
        )
        if (factor !== null) {
          onChange({ ...ingredient, quantity: qty, _baseFood: baseFood, ...applyFactor(baseFood, factor) })
        } else {
          onChange({ ...ingredient, quantity: qty, _baseFood: baseFood, ...NULL_SNAPSHOTS })
        }
      } else {
        onChange({ ...ingredient, quantity: qty })
      }
    },
    [ingredient, onChange],
  )

  const handleUnitChange = useCallback(
    (unit: string) => {
      const baseFood = ingredient._baseFood ?? synthesizeBaseFood(ingredient)
      if (baseFood) {
        const factor = computeIngredientFactor(
          baseFood.servingSize, baseFood.servingUnit, ingredient.quantity, unit,
          baseFood.householdUnit, baseFood.unitsPerServing,
        )
        if (factor !== null) {
          onChange({ ...ingredient, unit, _baseFood: baseFood, ...applyFactor(baseFood, factor) })
        } else {
          onChange({ ...ingredient, unit, _baseFood: baseFood, ...NULL_SNAPSHOTS })
        }
      } else {
        onChange({ ...ingredient, unit })
      }
    },
    [ingredient, onChange],
  )

  // Dismiss dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.closest('[data-ingredient-row]')?.contains(e.target as Node)
      ) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const nutritionOk = hasValidNutrition(ingredient)
  const isLinked    = ingredient.foodItemId != null

  // Unit dropdown: show when _baseFood is available; fall back to text input.
  const baseFood = ingredient._baseFood
  const unitOptions = baseFood ? getUnitOptions(baseFood) : []
  const hasUnitOptions = unitOptions.length > 0

  return (
    <div data-ingredient-row className="relative rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3">

      {/* Row 1: Name with inline search + remove */}
      <div className="flex gap-2 items-start">
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
                isLinked && nutritionOk
                  ? 'border-emerald-300 dark:border-emerald-700'
                  : isLinked || nutritionOk
                    ? 'border-amber-300 dark:border-amber-700'
                    : 'border-zinc-200 dark:border-zinc-600',
              )}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {searching ? (
                <Loader2 className="size-3.5 text-zinc-400 animate-spin" />
              ) : isLinked && nutritionOk ? (
                <CheckCircle2 className="size-3.5 text-emerald-500" />
              ) : isLinked && !nutritionOk ? (
                <AlertCircle className="size-3.5 text-amber-500" />
              ) : nutritionOk ? (
                <Link2 className="size-3.5 text-amber-500" />
              ) : ingredient.name.length >= 2 ? (
                <AlertCircle className="size-3.5 text-zinc-300" />
              ) : null}
            </span>
          </div>

          {/* Search dropdown */}
          {showDropdown && (
            <div className="absolute z-20 mt-1 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
              {results.map((food) => {
                const cal = food.coreNutrients?.calories
                const calDisplay =
                  cal != null && Number.isFinite(cal) && cal >= 0
                    ? `${Math.round(cal)} cal`
                    : 'Nutrition unavailable'
                const servingLabel = food.householdServingText
                  ?? `${food.servingSize} ${food.servingUnit}`
                return (
                  <button
                    key={food.externalId}
                    onMouseDown={(e) => { e.preventDefault(); selectFood(food) }}
                    className="flex w-full flex-col px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm"
                  >
                    <span className="font-medium text-zinc-900 dark:text-white truncate">
                      {food.name}{food.brand ? ` (${food.brand})` : ''}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {servingLabel} · {calDisplay}
                    </span>
                  </button>
                )
              })}
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

      {/* Row 2: Quantity + unit */}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={ingredient.quantity || ''}
          onChange={(e) => handleQuantityChange(e.target.value)}
          placeholder="Qty"
          className="w-16 shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-zinc-400"
        />

        {hasUnitOptions ? (
          <select
            value={ingredient.unit}
            onChange={(e) => handleUnitChange(e.target.value)}
            className="rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
          >
            {unitOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            {/* Preserve the current unit if it isn't in our options list */}
            {ingredient.unit && !unitOptions.some(o => o.value.toLowerCase() === ingredient.unit.toLowerCase()) && (
              <option value={ingredient.unit}>{ingredient.unit}</option>
            )}
          </select>
        ) : (
          <input
            type="text"
            value={ingredient.unit}
            onChange={(e) => handleUnitChange(e.target.value)}
            placeholder="Unit"
            className="w-20 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
        )}
      </div>

      {/* Notes */}
      <input
        type="text"
        value={ingredient.notes}
        onChange={(e) => onChange({ ...ingredient, notes: e.target.value })}
        placeholder="Notes (optional)"
        className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 placeholder-zinc-300 focus:outline-none"
      />

      {/* Nutrition preview */}
      {nutritionOk ? (
        <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          ≈ {Math.round(ingredient.snapshotCalories!)} cal · P {ingredient.snapshotProteinG!.toFixed(1)}g · C {ingredient.snapshotCarbG!.toFixed(1)}g · F {ingredient.snapshotFatG!.toFixed(1)}g
        </p>
      ) : ingredient.name.trim() && ingredient._baseFood != null ? (
        // _baseFood is set but factor was null — the selected unit is incompatible with this food's base unit.
        // Show amber so the user knows why and can pick a compatible unit.
        <p className="mt-1.5 text-xs text-amber-500 dark:text-amber-400">
          Unit not convertible for this food — try g, oz, or serving
        </p>
      ) : ingredient.name.trim() && ingredient.foodItemId != null ? (
        <p className="mt-1.5 text-xs text-zinc-400">Nutrition unavailable for this food</p>
      ) : null}
    </div>
  )
}
