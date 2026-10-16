'use client'

/**
 * RecipeNutritionPanel — Phase 4
 *
 * Displays whole-recipe and per-serving macros with a NutritionCompleteness badge.
 * Editable serving count lets user recalculate per-serving in real time (pure math).
 * Shows imported macros when available alongside ingredient-calculated totals.
 */

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  computeRecipeNutritionTotals,
  type IngredientWithNutrition,
  type NutritionCompleteness,
} from '@/lib/recipes/serving-calc'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecipeIngredientForPanel {
  id: string
  name: string
  quantity: number
  unit: string
  isOptional: boolean
  isToTaste: boolean
  conversionSource?: string | null
  snapshotCalories: number | null
  snapshotProteinG: number | null
  snapshotCarbG: number | null
  snapshotFatG: number | null
}

interface RecipeNutritionPanelProps {
  ingredients: RecipeIngredientForPanel[]
  servings: number
  // Recipe-level imported macros (per serving) — from Phase 0 schema
  importedCalPerServing?: number | null
  importedProteinGPerServing?: number | null
  importedCarbGPerServing?: number | null
  importedFatGPerServing?: number | null
  // Display serving count can be overridden externally (e.g. user selects "makes N")
  displayServings?: number
  onServingsChange?: (n: number) => void
}

// ── Completeness badge ────────────────────────────────────────────────────────

function CompletenessBadge({ completeness }: { completeness: NutritionCompleteness }) {
  if (completeness === 'complete') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3" />
        Complete
      </span>
    )
  }
  if (completeness === 'estimated') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
        <Info className="size-3" />
        Estimated
      </span>
    )
  }
  // incomplete
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
      <AlertTriangle className="size-3" />
      Incomplete
    </span>
  )
}

// ── MacroRow ──────────────────────────────────────────────────────────────────

function MacroRow({
  label,
  value,
  unit = 'g',
  colorClass,
  prefix,
}: {
  label: string
  value: number
  unit?: string
  colorClass?: string
  prefix?: string
}) {
  return (
    <div>
      <p className={cn('text-base font-black', colorClass ?? 'text-zinc-900 dark:text-white')}>
        {prefix ?? ''}{unit === 'cal' ? Math.round(value) : value.toFixed(1)}{unit !== 'cal' ? unit : ''}
      </p>
      <p className="text-xs text-zinc-400">{label}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function RecipeNutritionPanel({
  ingredients,
  servings,
  importedCalPerServing,
  importedProteinGPerServing,
  importedCarbGPerServing,
  importedFatGPerServing,
  displayServings,
  onServingsChange,
}: RecipeNutritionPanelProps) {
  // Map ingredients to IngredientWithNutrition (the serving-calc interface)
  const ingWithNutrition: IngredientWithNutrition[] = ingredients.map((i) => ({
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    isOptional: i.isOptional,
    isToTaste: i.isToTaste,
    conversionSource: i.conversionSource,
    snapshotCalories: i.snapshotCalories,
    snapshotProteinG: i.snapshotProteinG,
    snapshotCarbG: i.snapshotCarbG,
    snapshotFatG: i.snapshotFatG,
  }))

  // Compute totals using the authoritative serving count (recipe.servings)
  const totals = computeRecipeNutritionTotals(ingWithNutrition, servings)

  // Per-serving using displayServings if different from recipe.servings
  const activeServings = displayServings && displayServings > 0 ? displayServings : servings
  const perServing = activeServings !== servings
    ? {
        calories: Math.round(totals.totalCalories / activeServings * 100) / 100,
        proteinG: Math.round(totals.totalProteinG / activeServings * 1000) / 1000,
        carbG: Math.round(totals.totalCarbG / activeServings * 1000) / 1000,
        fatG: Math.round(totals.totalFatG / activeServings * 1000) / 1000,
      }
    : {
        calories: totals.perServingCalories,
        proteinG: totals.perServingProteinG,
        carbG: totals.perServingCarbG,
        fatG: totals.perServingFatG,
      }

  const hasImported =
    importedCalPerServing != null &&
    importedProteinGPerServing != null &&
    importedCarbGPerServing != null &&
    importedFatGPerServing != null

  const { completeness, unresolvedCount, unresolvedNames } = totals

  // For incomplete + imported, show both
  const showBothSources = completeness === 'incomplete' && hasImported

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 p-4 space-y-3">
      {/* Header: Per Serving + badge + serving selector */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">
            Per Serving
          </p>
          <CompletenessBadge completeness={completeness} />
        </div>

        {/* Serving count selector */}
        {onServingsChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-400">Servings</span>
            <button
              onClick={() => onServingsChange(Math.max(1, activeServings - 1))}
              className="flex size-6 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
              aria-label="Decrease servings"
            >−</button>
            <span className="text-sm font-semibold text-zinc-900 dark:text-white w-5 text-center">
              {activeServings}
            </span>
            <button
              onClick={() => onServingsChange(activeServings + 1)}
              className="flex size-6 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
              aria-label="Increase servings"
            >+</button>
          </div>
        )}
      </div>

      {/* Macros row — ingredient-calculated */}
      {completeness !== 'incomplete' || totals.totalCalories > 0 ? (
        <div className="flex gap-5">
          <MacroRow
            label="cal"
            value={perServing.calories}
            unit="cal"
            prefix={completeness !== 'complete' ? '~' : undefined}
            colorClass="text-zinc-900 dark:text-white text-2xl"
          />
          <MacroRow label="Protein" value={perServing.proteinG} colorClass="text-sky-500" />
          <MacroRow label="Carbs"   value={perServing.carbG}    colorClass="text-amber-500" />
          <MacroRow label="Fat"     value={perServing.fatG}     colorClass="text-orange-500" />
        </div>
      ) : null}

      {/* Incomplete warning with unresolved names */}
      {completeness === 'incomplete' && unresolvedCount > 0 && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 space-y-1">
          <div className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span className="font-semibold">
              Nutrition incomplete — {unresolvedCount} ingredient{unresolvedCount > 1 ? 's' : ''} not matched
            </span>
          </div>
          {unresolvedNames.length > 0 && (
            <ul className="ml-5.5 pl-0 text-xs text-amber-600 dark:text-amber-500 space-y-0.5">
              {unresolvedNames.map((n) => (
                <li key={n} className="list-disc ml-4">{n}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-amber-500 dark:text-amber-600 ml-0">
            Total shown above is partial. Match all ingredients for accurate nutrition.
          </p>
        </div>
      )}

      {/* Imported macros section */}
      {hasImported && (
        <div className={cn(
          'rounded-xl px-3 py-2.5',
          showBothSources
            ? 'bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-700'
            : 'hidden', // Only show imported when ingredient calc is incomplete
        )}>
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
            Imported estimate (per serving)
          </p>
          <div className="flex gap-5">
            <MacroRow label="cal" value={importedCalPerServing!} unit="cal" colorClass="text-zinc-700 dark:text-zinc-300 text-lg" />
            <MacroRow label="Protein" value={importedProteinGPerServing!} colorClass="text-sky-400" />
            <MacroRow label="Carbs"   value={importedCarbGPerServing!}    colorClass="text-amber-400" />
            <MacroRow label="Fat"     value={importedFatGPerServing!}      colorClass="text-orange-400" />
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Sourced from recipe import. Use when logging if ingredient nutrition is unavailable.
          </p>
        </div>
      )}

      {/* Estimated disclaimer */}
      {completeness === 'estimated' && (
        <p className="text-xs text-zinc-400">
          Some optional or to-taste ingredients are unmatched and excluded from this estimate.
        </p>
      )}
    </div>
  )
}
