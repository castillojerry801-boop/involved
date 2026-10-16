'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Trash2, CheckCircle2, AlertCircle, Link2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExternalFoodResult } from '@/lib/nutrition/providers/types'
import { computeIngredientFactor } from '@/lib/recipes/nutrition'
import { parseQuantity, formatQuantity } from '@/lib/utils/fractions'
import { KG_UNITS, L_UNITS } from '@/lib/nutrition/conversion/units'

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
  quantityText: string      // raw input string, e.g. "1½", "2/3", "100"
  quantity: number          // parsed numeric value for calculations
  unit: string
  notes: string
  isOptional: boolean
  isToTaste: boolean
  snapshotCalories: number | null
  snapshotProteinG: number | null
  snapshotCarbG: number | null
  snapshotFatG: number | null
  // Client-only: retained so quantity/unit edits can recalculate nutrition.
  _baseFood?: BaseFoodData | null
  // Cook's name (what the user typed) — separate from the nutrition reference name
  _displayName?: string     // user's typed name — if set, shown instead of auto-resolved name
  // Secondary label shown below name input after food is selected from search
  _matchedFoodName?: string
}

// Returns the ingredient without client-only fields, ready for API submission.
export function toApiIngredient(
  ing: IngredientDraft,
): Omit<IngredientDraft, '_baseFood' | 'key' | 'quantityText' | '_displayName' | '_matchedFoodName'> & {
  key?: never; _baseFood?: never; quantityText?: never; _displayName?: never; _matchedFoodName?: never
} {
  const { _baseFood: _bf, key: _k, quantityText: _qt, _displayName: _dn, _matchedFoodName: _mfn, ...rest } = ing
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

// Units that are negligible — treated same as to-taste for nutrition purposes.
const NEGLIGIBLE_UNITS = new Set(['pinch', 'dash'])

// Grouped unit picker definition.
const UNIT_GROUPS = [
  {
    label: 'Weight',
    units: ['g', 'oz', 'lb', 'kg'],
  },
  {
    label: 'Volume',
    units: ['tsp', 'tbsp', 'cup', 'fl oz', 'ml', 'L'],
  },
  {
    label: 'Count',
    units: ['whole', 'piece', 'slice', 'clove', 'egg', 'tortilla', 'leaf', 'bunch'],
  },
  {
    label: 'Small',
    units: ['pinch', 'dash', 'scoop'],
  },
  {
    label: 'Other',
    units: ['serving'],
  },
] as const

// Legacy export kept for backward compatibility — the component now always uses
// the grouped picker, but external callers that imported getUnitOptions won't break.
export function getUnitOptions(baseFood: BaseFoodData): { label: string; value: string }[] {
  const options: { label: string; value: string }[] = []
  if (baseFood.householdUnit) {
    options.push({ label: baseFood.householdUnit, value: baseFood.householdUnit })
  }
  UNIT_GROUPS.forEach((group) =>
    group.units.forEach((u) => options.push({ label: u, value: u })),
  )
  const seen = new Set<string>()
  return options.filter((o) => {
    const k = o.value.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
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

// Determine all units in UNIT_GROUPS as a flat set
const ALL_GROUP_UNITS = new Set(
  UNIT_GROUPS.flatMap((g) => g.units.map((u) => u.toLowerCase())),
)

export function RecipeIngredientRow({ ingredient, onChange, onRemove }: RecipeIngredientRowProps) {
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<FoodSearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleNameChange = useCallback(
    (name: string) => {
      // Clear match when the user edits the name manually
      onChange({
        ...ingredient,
        name,
        foodItemId: null,
        _baseFood: null,
        _matchedFoodName: undefined,
        ...NULL_SNAPSHOTS,
      })
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
        // Link food but mark nutrition as unavailable
        // Preserve the user's typed name — only use food.name if name field is empty
        const preservedName = ingredient.name.trim() || (food.brand ? `${food.name} (${food.brand})` : food.name)
        onChange({
          ...ingredient,
          name: preservedName,
          foodItemId: food.source === 'library' ? (food.internalId ?? food.externalId) : null,
          unit: food.servingUnit,
          _baseFood: null,
          _matchedFoodName: food.brand ? `${food.name} (${food.brand})` : food.name,
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

      // Preserve the user's typed name — only populate from food.name if name field is empty
      const userTypedName = ingredient.name.trim()
      const nameToUse = userTypedName || (food.brand ? `${food.name} (${food.brand})` : food.name)
      const matchedFoodName = food.brand ? `${food.name} (${food.brand})` : food.name

      onChange({
        ...ingredient,
        name: nameToUse,
        // Use internalId (DB UUID) for recipe ingredient FK when available.
        // Falls back to externalId for backward compatibility with cached results
        // that predate the internalId field.
        foodItemId: food.source === 'library' ? (food.internalId ?? food.externalId) : null,
        quantity: defaultQty,
        quantityText: formatQuantity(defaultQty),
        unit: defaultUnit,
        _baseFood: baseFood,
        _displayName: userTypedName || undefined,
        _matchedFoodName: matchedFoodName,
        ...applyFactor(baseFood, 1),
      })
      setShowDropdown(false)
      setResults([])
    },
    [ingredient, onChange],
  )

  const handleQuantityTextChange = useCallback(
    (raw: string) => {
      const parsed = parseQuantity(raw)
      if (parsed === null) {
        // Invalid input: update display text but keep the last valid quantity for calculations
        onChange({ ...ingredient, quantityText: raw })
        return
      }
      const qty = parsed
      // Use explicit _baseFood when available; otherwise synthesize from persisted snapshot.
      const baseFood = ingredient._baseFood ?? synthesizeBaseFood(ingredient)
      if (baseFood) {
        const factor = computeIngredientFactor(
          baseFood.servingSize, baseFood.servingUnit, qty, ingredient.unit,
          baseFood.householdUnit, baseFood.unitsPerServing,
        )
        if (factor !== null) {
          onChange({ ...ingredient, quantityText: raw, quantity: qty, _baseFood: baseFood, ...applyFactor(baseFood, factor) })
        } else {
          onChange({ ...ingredient, quantityText: raw, quantity: qty, _baseFood: baseFood, ...NULL_SNAPSHOTS })
        }
      } else {
        onChange({ ...ingredient, quantityText: raw, quantity: qty })
      }
    },
    [ingredient, onChange],
  )

  const handleQuantityBlur = useCallback(() => {
    // On blur: if the current quantityText is valid, optionally normalize it
    const parsed = parseQuantity(ingredient.quantityText)
    if (parsed !== null) {
      // Normalize: keep the user's text if it's already clean; don't force unicode fractions
      // on them — just ensure we're in sync with the numeric value
      onChange({ ...ingredient, quantity: parsed })
    }
  }, [ingredient, onChange])

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
  const isNegligibleUnit = NEGLIGIBLE_UNITS.has(ingredient.unit.toLowerCase().trim())
  const isToTaste   = ingredient.isToTaste || isNegligibleUnit

  // Build unit picker options
  // Check if the current unit is in any group
  const currentUnitLower = ingredient.unit.toLowerCase().trim()
  const currentUnitInGroups = ALL_GROUP_UNITS.has(currentUnitLower)
  // Check if household unit is in the groups
  const baseFood = ingredient._baseFood
  const householdUnit = baseFood?.householdUnit
  const householdUnitLower = householdUnit ? householdUnit.toLowerCase().trim() : null
  const householdInGroups = householdUnitLower ? ALL_GROUP_UNITS.has(householdUnitLower) : false

  // Build nutrition status message
  function getNutritionStatus() {
    if (isToTaste && !isNegligibleUnit) {
      return { type: 'totaste' as const, message: 'To taste — not counted in nutrition total' }
    }
    if (isNegligibleUnit) {
      return { type: 'negligible' as const, message: 'Negligible amount — not counted in nutrition total' }
    }
    if (!ingredient.name.trim()) {
      return null
    }
    if (ingredient.isOptional && nutritionOk) {
      return { type: 'optional' as const, message: 'Optional — included in nutrition unless excluded at log time' }
    }
    if (nutritionOk) {
      return {
        type: 'ok' as const,
        message: `≈ ${Math.round(ingredient.snapshotCalories!)} cal · P ${ingredient.snapshotProteinG!.toFixed(1)}g · C ${ingredient.snapshotCarbG!.toFixed(1)}g · F ${ingredient.snapshotFatG!.toFixed(1)}g`,
      }
    }
    if (ingredient._baseFood != null) {
      // _baseFood is set but factor was null — unit is valid but needs server-side lookup
      const iu = ingredient.unit.toLowerCase().trim()
      const isKnownUnit = ALL_GROUP_UNITS.has(iu) || (KG_UNITS.has(iu)) || (L_UNITS.has(iu))
      if (isKnownUnit) {
        return { type: 'pending' as const, message: `Nutrition calculated on save — ${ingredient.unit} needs portion data` }
      }
      return { type: 'incompatible' as const, message: 'Unit not convertible for this food — try g, oz, or serving' }
    }
    if (ingredient.foodItemId != null) {
      return { type: 'unavailable' as const, message: 'Nutrition unavailable for this food' }
    }
    // Has name but no food linked
    return { type: 'unlinked' as const, message: 'No food linked — search above to add nutrition' }
  }

  const nutritionStatus = getNutritionStatus()

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

          {/* Matched food label (shown when food linked but user preserved their own name) */}
          {ingredient._matchedFoodName && ingredient._matchedFoodName !== ingredient.name && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5 block">
              Matched: {ingredient._matchedFoodName}
            </span>
          )}

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

      {/* Row 2: Quantity + unit + optional/to-taste toggles */}
      {isToTaste ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-zinc-400 italic">to taste</span>
          <button
            type="button"
            onClick={() => onChange({ ...ingredient, isToTaste: false })}
            className={cn(
              'rounded-full px-2 py-0.5 text-xs border transition-colors',
              'border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400',
            )}
          >
            To taste
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            inputMode="decimal"
            value={ingredient.quantityText}
            onChange={(e) => handleQuantityTextChange(e.target.value)}
            onBlur={handleQuantityBlur}
            placeholder="Qty"
            className="w-20 shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />

          {/* Grouped unit picker */}
          <select
            value={ingredient.unit}
            onChange={(e) => handleUnitChange(e.target.value)}
            className="min-w-[4.5rem] rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
          >
            {/* Household unit first (if set and not already in groups) */}
            {householdUnit && !householdInGroups && (
              <optgroup label="Food unit">
                <option value={householdUnit}>{householdUnit}</option>
              </optgroup>
            )}

            {/* Current unit first (if not in any group and not the household unit) */}
            {ingredient.unit && !currentUnitInGroups && !(householdUnitLower && householdUnitLower === currentUnitLower) && (
              <optgroup label="Current">
                <option value={ingredient.unit}>{ingredient.unit}</option>
              </optgroup>
            )}

            {UNIT_GROUPS.map((group) => {
              // Check if household unit is in this group — if so, surface it first within the group
              const groupUnits = [...group.units]
              const groupHouseholdIdx = householdUnit
                ? groupUnits.findIndex((u) => u.toLowerCase() === householdUnitLower)
                : -1
              let orderedUnits: string[]
              if (groupHouseholdIdx > 0) {
                orderedUnits = [
                  groupUnits[groupHouseholdIdx],
                  ...groupUnits.slice(0, groupHouseholdIdx),
                  ...groupUnits.slice(groupHouseholdIdx + 1),
                ]
              } else {
                orderedUnits = groupUnits
              }
              return (
                <optgroup key={group.label} label={group.label}>
                  {orderedUnits.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </optgroup>
              )
            })}
          </select>

          {/* Optional toggle */}
          <button
            type="button"
            onClick={() => onChange({ ...ingredient, isOptional: !ingredient.isOptional })}
            className={cn(
              'rounded-full px-2 py-0.5 text-xs border transition-colors',
              ingredient.isOptional
                ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                : 'border-zinc-200 text-zinc-400 dark:border-zinc-600',
            )}
          >
            Optional
          </button>

          {/* To taste toggle */}
          <button
            type="button"
            onClick={() => onChange({ ...ingredient, isToTaste: !ingredient.isToTaste })}
            className={cn(
              'rounded-full px-2 py-0.5 text-xs border transition-colors',
              ingredient.isToTaste
                ? 'border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400'
                : 'border-zinc-200 text-zinc-400 dark:border-zinc-600',
            )}
          >
            To taste
          </button>
        </div>
      )}

      {/* Notes */}
      <input
        type="text"
        value={ingredient.notes}
        onChange={(e) => onChange({ ...ingredient, notes: e.target.value })}
        placeholder="Notes (optional)"
        className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 placeholder-zinc-300 focus:outline-none"
      />

      {/* Nutrition status */}
      {nutritionStatus && (
        <p className={cn(
          'mt-1.5 text-xs',
          nutritionStatus.type === 'ok' && 'text-emerald-600 dark:text-emerald-400',
          nutritionStatus.type === 'optional' && 'text-zinc-400',
          nutritionStatus.type === 'pending' && 'text-amber-500 dark:text-amber-400',
          nutritionStatus.type === 'incompatible' && 'text-amber-500 dark:text-amber-400',
          nutritionStatus.type === 'unavailable' && 'text-zinc-400',
          nutritionStatus.type === 'unlinked' && 'text-zinc-400',
          nutritionStatus.type === 'totaste' && 'text-sky-500 dark:text-sky-400',
          nutritionStatus.type === 'negligible' && 'text-zinc-400',
        )}>
          {nutritionStatus.message}
        </p>
      )}
    </div>
  )
}
