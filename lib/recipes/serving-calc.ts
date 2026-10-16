/**
 * serving-calc.ts — Phase 4
 *
 * Pure functions for computing recipe nutrition totals from snapshot data
 * already persisted on RecipeIngredient. Never calls external APIs.
 *
 * Completeness rules:
 *   complete   — all non-optional, non-negligible ingredients are resolved
 *   estimated  — all non-optional resolved; some optional/negligible unresolved
 *   incomplete — any non-optional, non-negligible ingredient has null snapshot
 *
 * Optional/to-taste rules:
 *   isToTaste=true  → EXCLUDE from totals (contribute 0)
 *   negligible unit (pinch/dash) → treated as to-taste
 *   isOptional=true → INCLUDE by default; caller can exclude at log time
 */

// Units whose amounts are considered negligible for nutrition purposes.
const NEGLIGIBLE_UNITS = new Set(['pinch', 'dash'])

function isNegligibleUnit(unit: string): boolean {
  return NEGLIGIBLE_UNITS.has(unit.toLowerCase().trim())
}

// An ingredient's snapshot is "resolved" when snapshotCalories is non-null
// (we treat calories as the single completeness indicator — if the conversion
// engine resolved calories it always resolves all four macros).
function isResolved(snapshotCalories: number | null | undefined): boolean {
  return snapshotCalories !== null && snapshotCalories !== undefined
}

export interface IngredientWithNutrition {
  id: string
  name: string                     // cook's typed name
  quantity: number
  unit: string
  isOptional: boolean
  isToTaste: boolean
  conversionSource?: string | null // from DB
  snapshotCalories: number | null
  snapshotProteinG: number | null
  snapshotCarbG: number | null
  snapshotFatG: number | null
}

export type NutritionCompleteness =
  | 'complete'   // all non-optional, non-to-taste ingredients resolved
  | 'estimated'  // some optional or to-taste ingredients unresolved; core resolved
  | 'incomplete' // one or more required (non-optional) ingredients unresolved

export interface RecipeNutritionTotals {
  totalCalories: number
  totalProteinG: number
  totalCarbG: number
  totalFatG: number
  perServingCalories: number
  perServingProteinG: number
  perServingCarbG: number
  perServingFatG: number
  servings: number
  completeness: NutritionCompleteness
  unresolvedCount: number       // number of ingredients without snapshot data
  unresolvedNames: string[]     // cook's names of unresolved ingredients (for UI message)
}

/**
 * Computes nutrition totals from snapshot data already on RecipeIngredient rows.
 *
 * @param ingredients   List of recipe ingredients with snapshot macros
 * @param servings      How many servings this recipe makes (>0; 0 treated as 1)
 * @param optionalIncluded  Set of ingredient IDs to include. If undefined,
 *                          all optional ingredients are included. Use an empty
 *                          Set to exclude all optional ingredients.
 */
export function computeRecipeNutritionTotals(
  ingredients: IngredientWithNutrition[],
  servings: number,
  optionalIncluded?: Set<string>,
): RecipeNutritionTotals {
  const safeServings = servings > 0 ? servings : 1

  let totalCalories = 0
  let totalProteinG = 0
  let totalCarbG = 0
  let totalFatG = 0

  let unresolvedCount = 0
  const unresolvedNames: string[] = []

  // Track completeness:
  // - coreUnresolved: a non-optional, non-negligible ingredient is unresolved
  // - nonCoreUnresolved: optional or negligible is unresolved (only matters for 'estimated')
  let coreUnresolved = false
  let nonCoreUnresolved = false

  for (const ing of ingredients) {
    const negligible = isNegligibleUnit(ing.unit)
    const skipped = ing.isToTaste || negligible

    // Is this ingredient included in totals?
    // - isToTaste / negligible: always excluded from totals
    // - isOptional: included by default; caller can exclude via optionalIncluded
    const optionalExcluded =
      ing.isOptional &&
      optionalIncluded !== undefined &&
      !optionalIncluded.has(ing.id)

    const includedInTotals = !skipped && !optionalExcluded
    const resolved = isResolved(ing.snapshotCalories)

    // Determine if this ingredient is "required" for completeness calculation:
    // required = non-optional AND non-negligible AND non-to-taste
    const required = !ing.isOptional && !ing.isToTaste && !negligible

    if (includedInTotals) {
      if (resolved) {
        totalCalories += ing.snapshotCalories ?? 0
        totalProteinG += ing.snapshotProteinG ?? 0
        totalCarbG    += ing.snapshotCarbG ?? 0
        totalFatG     += ing.snapshotFatG ?? 0
      } else {
        // Unresolved ingredient that would have contributed to totals
        unresolvedCount++
        unresolvedNames.push(ing.name)
        if (required) {
          coreUnresolved = true
        } else {
          nonCoreUnresolved = true
        }
      }
    } else if (!skipped && !resolved) {
      // Optional-excluded and unresolved — still count as unresolved for display
      // but doesn't affect completeness since it's excluded from the log anyway.
      unresolvedCount++
      if (!ing.isToTaste && !negligible && !ing.isOptional) {
        coreUnresolved = true
      } else {
        nonCoreUnresolved = true
      }
    } else if (skipped && !resolved) {
      // to-taste / negligible and unresolved — only 'estimated' at worst
      nonCoreUnresolved = true
    }
  }

  let completeness: NutritionCompleteness
  if (coreUnresolved) {
    completeness = 'incomplete'
  } else if (nonCoreUnresolved || unresolvedCount > 0) {
    completeness = 'estimated'
  } else {
    completeness = 'complete'
  }

  // Edge: if there are no ingredients at all, treat as complete with 0
  if (ingredients.length === 0) {
    completeness = 'complete'
  }

  const round2 = (n: number) => Math.round(n * 100) / 100
  const round3 = (n: number) => Math.round(n * 1000) / 1000

  return {
    totalCalories:      round2(totalCalories),
    totalProteinG:      round3(totalProteinG),
    totalCarbG:         round3(totalCarbG),
    totalFatG:          round3(totalFatG),
    perServingCalories: round2(totalCalories / safeServings),
    perServingProteinG: round3(totalProteinG / safeServings),
    perServingCarbG:    round3(totalCarbG    / safeServings),
    perServingFatG:     round3(totalFatG     / safeServings),
    servings: safeServings,
    completeness,
    unresolvedCount,
    unresolvedNames,
  }
}

/**
 * Adjusts per-serving nutrition for a fractional serving amount.
 * e.g. servingAmount=0.5 → half a recipe serving
 */
export function computeServingNutrition(
  totals: RecipeNutritionTotals,
  servingAmount: number,
): { calories: number; proteinG: number; carbG: number; fatG: number } {
  const safe = servingAmount > 0 ? servingAmount : 1
  const round2 = (n: number) => Math.round(n * 100) / 100
  const round3 = (n: number) => Math.round(n * 1000) / 1000
  return {
    calories: round2(totals.perServingCalories * safe),
    proteinG: round3(totals.perServingProteinG * safe),
    carbG:    round3(totals.perServingCarbG    * safe),
    fatG:     round3(totals.perServingFatG     * safe),
  }
}
