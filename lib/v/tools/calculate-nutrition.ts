import 'server-only'
import { matchIngredient } from '@/lib/nutrition/matching/matcher'
import { resolveIngredientFactor } from '@/lib/nutrition/conversion/factor'
import { isConversionError } from '@/lib/nutrition/conversion/types'
import type { Decimal } from '@prisma/client/runtime/library'

// ── Public types ──────────────────────────────────────────────────────────────

export interface IngredientInput {
  name: string
  quantity: number
  unit: string
}

export interface IngredientResult {
  userDescription: string       // e.g. "3 eggs"
  matchedFoodName: string       // e.g. "Egg, whole, raw, fresh"
  matchConfidence: 'confident' | 'plausible' | 'ambiguous' | 'no_match'
  calories: number
  proteinG: number
  carbG: number
  fatG: number
  resolved: boolean
  conversionNote?: string       // e.g. "1 large egg = 50g"
  errorReason?: string          // if unresolved
}

export interface UnresolvedIngredient {
  name: string
  reason: string
  suggestion?: string
}

export interface NutritionToolResult {
  ingredients: IngredientResult[]
  totals: {
    calories: number
    proteinG: number
    carbG: number
    fatG: number
  }
  perServing?: {
    servings: number
    calories: number
    proteinG: number
    carbG: number
    fatG: number
  }
  completeness: 'complete' | 'estimated' | 'incomplete'
  unresolvedIngredients: UnresolvedIngredient[]
  assumptions: string[]
}

// ── Tool args (matches JSON schema in constants.ts) ───────────────────────────

export interface CalculateNutritionArgs {
  ingredients: IngredientInput[]
  servings?: number
  context?: string
}

// ── Helper: build a user-readable description string ─────────────────────────

function describeIngredient(ing: IngredientInput): string {
  return `${ing.quantity} ${ing.unit} ${ing.name}`
}

// ── Helper: normalize size qualifiers and common plural units ─────────────────
// When V parses "3 large eggs", it may pass unit='large' — a size qualifier, not
// a quantity unit. The conversion engine does not recognize size qualifiers, so
// they must be remapped before entering the factor pipeline.
//
// Strategy:
//   - Size qualifiers (large, medium, small, xl, etc.) → 'piece'
//     The factor engine's Step 6b broadened count-unit fallback then finds the
//     food-specific USDA portion (e.g. 'large egg', 'egg') automatically.
//   - All plural normalizations are already in SLICE_UNITS / PIECE_UNITS in
//     units.ts, so no extra work is needed there — this guard only covers the
//     size-qualifier case that would otherwise hit unit_unknown.
//
// The original unit string is preserved in userDescription (via describeIngredient)
// so the user-facing output still reads "3 large eggs" not "3 piece eggs".

const SIZE_QUALIFIERS = new Set([
  'large', 'medium', 'small',
  'extra large', 'extra-large', 'x-large',
  'xl', 'lg', 'md', 'sm',
  'jumbo', 'mini',
])

function normalizeIngredientUnit(unit: string): string {
  const u = unit.toLowerCase().trim()
  if (SIZE_QUALIFIERS.has(u)) return 'piece'
  return unit
}

// ── Helper: safe number coercion for Decimal fields ───────────────────────────

function toNum(v: Decimal | number): number {
  return typeof v === 'number' ? v : Number(v)
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function calculateNutrition(
  args: CalculateNutritionArgs,
): Promise<NutritionToolResult> {
  const { ingredients, servings, context } = args
  const safeServings = servings && servings > 0 ? servings : 1

  console.log('[V-nutrition] tool called', {
    ingredientCount: ingredients.length,
    servings: safeServings,
    units: ingredients.map(i => ({ unit: i.unit, normalized: normalizeIngredientUnit(i.unit) })),
  })

  // ── 1. Match all ingredients in parallel ─────────────────────────────────────
  const matchResults = await Promise.all(
    ingredients.map(async (ing) => {
      // Guard: quantity must be positive
      if (!ing.quantity || ing.quantity <= 0) {
        return { ing, match: null as null, error: 'missing_quantity' }
      }
      try {
        const result = await matchIngredient({
          ingredientName: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
        })
        return { ing, match: result, error: null as null }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Provider error'
        return { ing, match: null as null, error: msg }
      }
    }),
  )

  // ── 2. Resolve factor for each matched ingredient (sequential to avoid DB load) ─
  const ingredientResults: IngredientResult[] = []
  const unresolvedIngredients: UnresolvedIngredient[] = []

  for (const { ing, match, error } of matchResults) {
    const userDesc = describeIngredient(ing)

    // Hard failure from matchIngredient (exception or explicit error string)
    if (error !== null || match === null) {
      const reason =
        error === 'missing_quantity'
          ? 'missing_quantity'
          : 'provider_error'
      const suggestion =
        error === 'missing_quantity'
          ? `Provide a quantity for "${ing.name}"`
          : undefined

      ingredientResults.push({
        userDescription: userDesc,
        matchedFoodName: ing.name,
        matchConfidence: 'no_match',
        calories: 0,
        proteinG: 0,
        carbG: 0,
        fatG: 0,
        resolved: false,
        errorReason:
          error === 'missing_quantity'
            ? 'No quantity provided — cannot calculate macros'
            : (error ?? 'Unknown provider error'),
      })
      unresolvedIngredients.push({
        name: ing.name,
        reason,
        suggestion,
      })
      continue
    }

    // No match
    if (match.confidence === 'no_match' || match.topMatch === null) {
      ingredientResults.push({
        userDescription: userDesc,
        matchedFoodName: ing.name,
        matchConfidence: 'no_match',
        calories: 0,
        proteinG: 0,
        carbG: 0,
        fatG: 0,
        resolved: false,
        errorReason: 'No matching food found in database',
      })
      unresolvedIngredients.push({
        name: ing.name,
        reason: 'no_match',
        suggestion:
          match.alternatives.length > 0
            ? `Did you mean: ${match.alternatives.map(a => a.name).join(', ')}?`
            : undefined,
      })
      continue
    }

    const topMatch = match.topMatch

    // Build FoodForConversion from FoodMatch
    // FoodForConversion.id must be the internal DB id if we have it; otherwise use externalId
    const foodForConversion = {
      id: topMatch.internalId ?? topMatch.externalId,
      servingSize: topMatch.servingSize as unknown as Decimal,
      servingUnit: topMatch.servingUnit,
      calories: topMatch.calories as unknown as Decimal,
      proteinG: topMatch.proteinG as unknown as Decimal,
      carbohydrateG: topMatch.carbohydrateG as unknown as Decimal,
      fatG: topMatch.fatG as unknown as Decimal,
      householdUnit: topMatch.householdUnit ?? null,
      unitsPerServing:
        topMatch.unitsPerServing != null
          ? (topMatch.unitsPerServing as unknown as Decimal)
          : null,
      sourceProvider: topMatch.provider,
      externalId: topMatch.externalId,
      fdcDataType: topMatch.fdcDataType ?? null,
      name: topMatch.name,
    }

    console.log('[V-nutrition] match-result', {
      index: ingredientResults.length,
      confidence: match.confidence,
      topMatchProvider: topMatch.provider,
      topMatchId: topMatch.externalId,
      fdcDataType: topMatch.fdcDataType ?? null,
      hasHouseholdUnit: !!topMatch.householdUnit,
    })

    // Resolve factor — normalize size qualifiers (large/medium/small/xl) to
    // 'piece' so the factor engine's broadened count-unit fallback can find
    // the food-specific USDA portion (e.g. 'large egg', 'egg', 'strip').
    const resolvedUnit = normalizeIngredientUnit(ing.unit)
    let conversionResult: Awaited<ReturnType<typeof resolveIngredientFactor>>
    try {
      conversionResult = await resolveIngredientFactor(
        foodForConversion,
        ing.quantity,
        resolvedUnit,
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Conversion error'
      ingredientResults.push({
        userDescription: userDesc,
        matchedFoodName: topMatch.name,
        matchConfidence: match.confidence,
        calories: 0,
        proteinG: 0,
        carbG: 0,
        fatG: 0,
        resolved: false,
        errorReason: msg,
      })
      unresolvedIngredients.push({
        name: ing.name,
        reason: 'conversion_error',
        suggestion: undefined,
      })
      continue
    }

    if (isConversionError(conversionResult)) {
      console.log('[V-nutrition] conversion-error', {
        index: ingredientResults.length,
        errorCode: conversionResult.errorCode,
        resolvedUnit,
        originalUnit: ing.unit,
        fdcDataType: topMatch.fdcDataType ?? null,
        provider: topMatch.provider,
      })
      ingredientResults.push({
        userDescription: userDesc,
        matchedFoodName: topMatch.name,
        matchConfidence: match.confidence,
        calories: 0,
        proteinG: 0,
        carbG: 0,
        fatG: 0,
        resolved: false,
        errorReason: conversionResult.message,
      })
      unresolvedIngredients.push({
        name: ing.name,
        reason: 'conversion_error',
        suggestion:
          conversionResult.suggestions && conversionResult.suggestions.length > 0
            ? conversionResult.suggestions[0]
            : undefined,
      })
      continue
    }

    // Successfully resolved — compute macros
    const factor = conversionResult.factor
    const calories  = Math.round(toNum(topMatch.calories)      * factor)
    const proteinG  = Math.round(toNum(topMatch.proteinG)      * factor * 10) / 10
    const carbG     = Math.round(toNum(topMatch.carbohydrateG) * factor * 10) / 10
    const fatG      = Math.round(toNum(topMatch.fatG)          * factor * 10) / 10

    ingredientResults.push({
      userDescription: userDesc,
      matchedFoodName: topMatch.name,
      matchConfidence: match.confidence,
      calories,
      proteinG,
      carbG,
      fatG,
      resolved: true,
      conversionNote: conversionResult.portionDescription,
    })
  }

  // ── 3. Aggregate totals ───────────────────────────────────────────────────────
  const resolved = ingredientResults.filter(r => r.resolved)
  const unresolved = ingredientResults.filter(r => !r.resolved)

  const totals = resolved.reduce(
    (acc, r) => ({
      calories: acc.calories + r.calories,
      proteinG: acc.proteinG + r.proteinG,
      carbG:    acc.carbG    + r.carbG,
      fatG:     acc.fatG     + r.fatG,
    }),
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  )

  // Round totals
  totals.calories = Math.round(totals.calories)
  totals.proteinG = Math.round(totals.proteinG * 10) / 10
  totals.carbG    = Math.round(totals.carbG    * 10) / 10
  totals.fatG     = Math.round(totals.fatG     * 10) / 10

  // ── 4. Completeness ───────────────────────────────────────────────────────────
  // 'complete'   — all ingredients resolved
  // 'estimated'  — some unresolved due to database no_match (we have partial data,
  //                the unresolved items are a database gap, not a user input gap)
  // 'incomplete' — any ingredient unresolved because of missing user input
  //                (missing_quantity, conversion_error, or all ingredients failed)
  //
  // The key distinction:
  //   - 'no_match' from the database → 'estimated' (we couldn't find it, but partial data exists)
  //   - 'missing_quantity' or 'conversion_error' → 'incomplete' (user or data problem)
  //   - all unresolved → 'incomplete'
  const hasAnyResolved = resolved.length > 0
  const hasMissingQuantityOrConversionError = unresolvedIngredients.some(
    u => u.reason === 'missing_quantity' || u.reason === 'conversion_error' || u.reason === 'provider_error',
  )

  const completeness: NutritionToolResult['completeness'] =
    unresolved.length === 0
      ? 'complete'
      : !hasAnyResolved
      ? 'incomplete'
      : hasMissingQuantityOrConversionError
      ? 'incomplete'
      : 'estimated'

  // ── 5. Per-serving ────────────────────────────────────────────────────────────
  let perServing: NutritionToolResult['perServing']
  if (servings && servings > 1) {
    const round1 = (n: number) => Math.round(n * 10) / 10
    perServing = {
      servings: safeServings,
      calories: Math.round(totals.calories / safeServings),
      proteinG: round1(totals.proteinG / safeServings),
      carbG:    round1(totals.carbG    / safeServings),
      fatG:     round1(totals.fatG     / safeServings),
    }
  }

  // ── 6. Cooking/context assumptions ────────────────────────────────────────────
  const assumptions: string[] = []

  if (context) {
    const rawPatterns = /\braw\b/i
    const cookingPatterns = /\b(smoked?|smoking|grilled?|grilling|baked?|baking|roasted?|roasting|cooked?|cooking|fried?|frying|seared?)\b/i
    const meatPatterns    = /\b(tri[\s-]?tip|beef|chicken|pork|lamb|steak|brisket|ribs|roast|turkey|salmon|fish)\b/i

    if (rawPatterns.test(context) || cookingPatterns.test(context)) {
      assumptions.push('Calculated from raw weight. Cooking renders fat and reduces weight — actual macros may differ slightly.')
    }
    if (cookingPatterns.test(context) && meatPatterns.test(context)) {
      // More specific note for smoking/low-and-slow cooking
      if (/\bsmo[ck]/i.test(context)) {
        assumptions.push('Smoking renders a significant amount of fat from cuts like tri-tip and brisket. Final cooked macros (especially fat) will be lower than raw-weight estimates.')
      }
    }
  }

  // Also check ingredient names for raw meat context
  const ingredientText = ingredients.map(i => i.name).join(' ')
  const hasMeat = /\b(tri[\s-]?tip|beef|chicken|pork|lamb|steak|brisket|ribs|turkey|salmon)\b/i.test(ingredientText)
  if (hasMeat && assumptions.length === 0) {
    assumptions.push('Macros based on raw/uncooked weight where weight units were provided. Cooking changes the final result.')
  }

  // Check matched food names for untrimmed references (lean and fat, or untrimmed)
  for (const r of resolved) {
    if (/lean and fat|untrimmed/i.test(r.matchedFoodName)) {
      assumptions.push(`"${r.matchedFoodName}" is an untrimmed reference — actual fat may be lower if fat was trimmed before cooking.`)
      break // one note is enough for the batch
    }
  }

  console.log('[V-nutrition] result', {
    completeness,
    resolvedCount: resolved.length,
    unresolvedCount: unresolved.length,
    unresolvedReasons: unresolvedIngredients.map(u => u.reason),
  })

  return {
    ingredients: ingredientResults,
    totals,
    perServing,
    completeness,
    unresolvedIngredients,
    assumptions,
  }
}
