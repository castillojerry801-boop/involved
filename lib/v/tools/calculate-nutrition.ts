import 'server-only'
import { matchIngredient } from '@/lib/nutrition/matching/matcher'
import { resolveIngredientFactor } from '@/lib/nutrition/conversion/factor'
import { isConversionError } from '@/lib/nutrition/conversion/types'
import type { Decimal } from '@prisma/client/runtime/library'
import { FatSecretProvider } from '@/lib/nutrition/providers/fatsecret'
import {
  PIECE_UNITS,
  SLICE_UNITS,
  FOOD_COUNT_NOUNS,
} from '@/lib/nutrition/conversion/units'
import { prisma } from '@/lib/prisma'
import type { FoodMatch } from '@/lib/nutrition/matching/types'

// Singleton provider for enrichment calls — avoids re-constructing per call.
const _fatsecretProvider = new FatSecretProvider()

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

// ── Helper: is the input unit a count-based unit? ─────────────────────────────
// Returns true for units like 'piece', 'strip', 'egg', 'tortilla', etc.
// Used to decide whether to call FatSecret getById() for enrichment.

function isCountUnit(unit: string): boolean {
  const u = unit.toLowerCase().trim()
  return PIECE_UNITS.has(u) || SLICE_UNITS.has(u) || FOOD_COUNT_NOUNS.has(u)
}

// ── Helper: is a household unit from a FatSecret search result "usable"? ──────
// Returns false for generic non-count words that offer no unit resolution
// ('serving', 'portion', 'g', 'ml', etc.). Returns true for count units (strip,
// piece, egg, tortilla) AND for size qualifiers (large, medium) that FatSecret
// uses as count-noun proxies (e.g. "1 large" egg = 1 egg).
//
// When this returns false, enrichFatSecretMatch() will still be called to fetch
// a better serving description from the FatSecret detail API.

const NON_COUNT_HOUSEHOLD_WORDS = new Set([
  'serving', 'servings', 'portion', 'portions',
  'meal', 'meals',   // "1 meal" is ambiguous — don't skip enrichment hoping for a better serving
  'g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters',
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons',
  'tsp', 'teaspoon', 'teaspoons',
])

function isUsableHouseholdUnit(unit: string): boolean {
  return !NON_COUNT_HOUSEHOLD_WORDS.has(unit.toLowerCase().trim())
}

// ── Helper: enrich a FatSecret match that lacks household serving data ─────────
// Called when a FatSecret search result has no householdUnit/householdServingText
// and the user requested a count-based unit (piece/strip/egg/etc.).
//
// Hard timeout: 4000ms — don't let a slow detail fetch block the tool call.
// Returns the enriched FoodMatch on success, or null on failure (caller uses original).
//
// After a successful enrichment that yields count-based serving data, this function
// also tries to cache the portion in FoodItemPortion (if a FoodItem row exists for
// this externalId). Caching is best-effort — failure does not block the result.

const ENRICH_TIMEOUT_MS = 4000

async function enrichFatSecretMatch(topMatch: FoodMatch, inputUnit?: string): Promise<FoodMatch | null> {
  let detail: Awaited<ReturnType<typeof _fatsecretProvider.getById>>
  try {
    detail = await Promise.race([
      inputUnit
        ? _fatsecretProvider.getByIdForEnrichment(topMatch.externalId, inputUnit)
        : _fatsecretProvider.getById(topMatch.externalId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ENRICH_TIMEOUT_MS)),
    ])
  } catch {
    return null
  }

  if (!detail) return null
  if (!detail.householdUnit && !detail.householdServingText) return null

  const enriched: FoodMatch = {
    ...topMatch,
    householdUnit: detail.householdUnit ?? topMatch.householdUnit,
    unitsPerServing: detail.unitsPerServing ?? topMatch.unitsPerServing,
    householdServingText: detail.householdServingText ?? topMatch.householdServingText,
    // Update macros from the canonical serving returned by the detail API
    calories: detail.coreNutrients.calories,
    proteinG: detail.coreNutrients.proteinG,
    carbohydrateG: detail.coreNutrients.carbohydrateG,
    fatG: detail.coreNutrients.fatG,
    // Update serving size from the detail (it's per the canonical serving, not per 100g)
    servingSize: detail.servingSize,
    servingUnit: detail.servingUnit,
  }

  // ── Best-effort portion cache ────────────────────────────────────────────────
  // Only if this food is already in the library (has a FoodItem row); never create
  // a FoodItem just to store a portion — that would be scope creep.
  if (detail.householdUnit && detail.unitsPerServing != null) {
    try {
      const foodItem = await prisma.foodItem.findFirst({
        where: { externalId: topMatch.externalId, sourceProvider: 'fatsecret' },
        select: { id: true },
      })
      if (foodItem) {
        // Idempotent: skip if a portion with the same unit+description already exists
        const existing = await prisma.foodItemPortion.findFirst({
          where: {
            foodItemId: foodItem.id,
            unit: detail.householdUnit,
            portionDescription: detail.householdServingText ?? detail.householdUnit,
          },
        })
        if (!existing) {
          await prisma.foodItemPortion.create({
            data: {
              foodItemId: foodItem.id,
              portionDescription: detail.householdServingText ?? `1 ${detail.householdUnit}`,
              quantity: detail.unitsPerServing,
              unit: detail.householdUnit,
              gramWeight: detail.servingSize / (detail.unitsPerServing || 1),
              fdcPortionId: null,
              sourceConfidence: 'manufacturer_declared',
              preparationState: null,
            },
          })
        }
      }
    } catch (err) {
      // Caching failure is non-fatal — log and continue
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[V-nutrition] portion cache write failed (non-fatal):', msg)
    }
  }

  return enriched
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

// ── Helper: build FoodForConversion from a FoodMatch ─────────────────────────
// Used for both the primary topMatch and fallback alternative candidates.

function buildFoodForConversion(m: FoodMatch) {
  return {
    id: m.internalId ?? m.externalId,
    servingSize: m.servingSize as unknown as Decimal,
    servingUnit: m.servingUnit,
    calories: m.calories as unknown as Decimal,
    proteinG: m.proteinG as unknown as Decimal,
    carbohydrateG: m.carbohydrateG as unknown as Decimal,
    fatG: m.fatG as unknown as Decimal,
    householdUnit: m.householdUnit ?? null,
    unitsPerServing: m.unitsPerServing != null ? (m.unitsPerServing as unknown as Decimal) : null,
    householdServingText: m.householdServingText ?? null,
    sourceProvider: m.provider,
    externalId: m.externalId,
    fdcDataType: m.fdcDataType ?? null,
    name: m.name,
  }
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
    quantities: ingredients.map(i => i.quantity),
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
  // Assumptions are accumulated through the loop (enrichment notes) and finalized in step 6.
  const assumptions: string[] = []

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

    let topMatch = match.topMatch

    // ── Part B: FatSecret detail enrichment ───────────────────────────────────
    // When the search result lacks a usable household unit and the user wants a
    // count-based unit (piece/strip/egg/tortilla/etc.), fetch the FatSecret detail
    // API to get the canonical serving description (e.g. "1 strip", "1 large", "1 tortilla").
    //
    // Skip condition: householdUnit is already a usable (non-generic) serving unit.
    // "1 large" (size qualifier) and "1 strip" (count noun) are both usable.
    // Do NOT skip when householdUnit is a generic non-count word like "serving" —
    // e.g. "1 serving" from the search result is useless for count resolution and the
    // detail API may return a more specific "1 strip" or "1 tortilla" serving.
    const resolvedUnitForEnrichCheck = normalizeIngredientUnit(ing.unit)
    const hasUsableHouseholdUnit =
      !!topMatch.householdUnit && isUsableHouseholdUnit(topMatch.householdUnit)
    if (
      topMatch.provider === 'fatsecret' &&
      !hasUsableHouseholdUnit &&
      isCountUnit(resolvedUnitForEnrichCheck)
    ) {
      const enriched = await enrichFatSecretMatch(topMatch, resolvedUnitForEnrichCheck)
      if (enriched) {
        topMatch = enriched
        console.log('[V-nutrition] fatsecret-enriched', {
          externalId: topMatch.externalId,
          householdUnit: topMatch.householdUnit,
          householdServingText: topMatch.householdServingText,
          servingSize: topMatch.servingSize,
        })
        assumptions.push(`Food ID details fetched from FatSecret for "${ing.name}" (id ${topMatch.externalId})`)
      }
    }

    const foodForConversion = buildFoodForConversion(topMatch)

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

    // ── Part C: Alternative candidate fallback ────────────────────────────────
    // When the top match fails conversion (e.g. library food with no portion data,
    // or FatSecret record whose only serving is "meal"/"serving"), try the pre-ranked
    // alternatives from the matcher in order. Apply the same enrichment logic as
    // topMatch. Stop at the first alternative that resolves.
    //
    // Fallback results are marked 'plausible' regardless of the alt's original score —
    // we couldn't use the best match so confidence is conservatively capped.
    let usedFallback = false
    if (isConversionError(conversionResult) && match.alternatives.length > 0) {
      for (const alt of match.alternatives) {
        // Semantic safety gate: skip alternatives with matchScore below the minimum
        // 'worthwhile' threshold (40). Prevents resolving "chicken patty" via a
        // poor-scoring unrelated food just to get a number.
        if (alt.matchScore < 40) continue

        let altMatch = alt

        // Apply same enrichment logic: if FatSecret + count unit + no usable household unit
        const altHasUsable = !!altMatch.householdUnit && isUsableHouseholdUnit(altMatch.householdUnit)
        if (altMatch.provider === 'fatsecret' && !altHasUsable && isCountUnit(resolvedUnit)) {
          const enriched = await enrichFatSecretMatch(altMatch, resolvedUnit)
          if (enriched) {
            altMatch = enriched
            console.log('[V-nutrition] alt-enriched', {
              externalId: altMatch.externalId,
              householdUnit: altMatch.householdUnit,
              servingSize: altMatch.servingSize,
            })
          }
        }

        let altResult: Awaited<ReturnType<typeof resolveIngredientFactor>>
        try {
          altResult = await resolveIngredientFactor(
            buildFoodForConversion(altMatch),
            ing.quantity,
            resolvedUnit,
          )
        } catch {
          continue
        }

        if (!isConversionError(altResult)) {
          console.log('[V-nutrition] alt-match-used', {
            index: ingredientResults.length,
            altProvider: altMatch.provider,
            altId: altMatch.externalId,
            altName: altMatch.name,
            originalError: conversionResult.errorCode,
          })
          topMatch = altMatch
          conversionResult = altResult
          usedFallback = true
          // Surface the substitution in assumptions so V can disclose it to the user
          assumptions.push(
            `"${ing.name}": no serving conversion for best match — used comparable reference "${altMatch.name}" (${altMatch.provider}, confidence: plausible)`
          )
          break
        }
      }
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

    // Successfully resolved — either the original topMatch or a fallback alternative.
    const factor = conversionResult.factor
    const calories  = Math.round(toNum(topMatch.calories)      * factor)
    const proteinG  = Math.round(toNum(topMatch.proteinG)      * factor * 10) / 10
    const carbG     = Math.round(toNum(topMatch.carbohydrateG) * factor * 10) / 10
    const fatG      = Math.round(toNum(topMatch.fatG)          * factor * 10) / 10

    ingredientResults.push({
      userDescription: userDesc,
      matchedFoodName: topMatch.name,
      // Fallback results cap at 'plausible' — we couldn't use the best match
      matchConfidence: usedFallback ? 'plausible' : match.confidence,
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
