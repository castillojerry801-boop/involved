import 'server-only'
import { matchIngredient } from '@/lib/nutrition/matching/matcher'
import { resolveIngredientFactor } from '@/lib/nutrition/conversion/factor'
import { isConversionError } from '@/lib/nutrition/conversion/types'
import { tokenHitsText, tokenHitsTextExpanded, SYNONYM_BASE_FORM_KEYS } from '@/lib/nutrition/search-utils'
import type { ConversionError as ConversionErrorType } from '@/lib/nutrition/conversion/types'
import type { Decimal } from '@prisma/client/runtime/library'
import { FatSecretProvider } from '@/lib/nutrition/providers/fatsecret'
import {
  PIECE_UNITS,
  SLICE_UNITS,
  FOOD_COUNT_NOUNS,
  CUP_UNITS,
  TBSP_UNITS,
  TSP_UNITS,
  FL_OZ_UNITS,
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
  matchedFoodProvider?: string  // e.g. 'usda_fooddata', 'fatsecret' — present when resolved
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

function isVolumeUnit(unit: string): boolean {
  const u = unit.toLowerCase().trim()
  return CUP_UNITS.has(u) || TBSP_UNITS.has(u) || TSP_UNITS.has(u) || FL_OZ_UNITS.has(u)
}

// ── Guard: portion-size conflict ──────────────────────────────────────────────
// Prevents a resolved portion description from being accepted when it explicitly
// describes a size category that conflicts with the ingredient name's own size
// qualifier (e.g. "1 thin slice (yield after cooking)" for "thick-cut bacon").
// Only explicit antonymous pairs trigger rejection; neutral terms like "strip"
// or "piece" do not. This is intentionally narrow — we only block obvious cases
// where the serving description itself states a conflicting thickness or size.
const PORTION_SIZE_CONFLICT_PAIRS: [string, string][] = [
  ['thick', 'thin'],   // "thick-cut bacon" with "thin slice" portion
  ['thin',  'thick'],  // "thin crust" with "thick slice" portion
]

function portionSizeConflict(ingredientName: string, portionDescription: string): boolean {
  const ing  = ingredientName.toLowerCase()
  const port = portionDescription.toLowerCase()
  for (const [ingWord, portWord] of PORTION_SIZE_CONFLICT_PAIRS) {
    if (ing.includes(ingWord) && port.includes(portWord)) return true
  }
  return false
}

// ── Guard: synonym-expanded preparation-form conflict ─────────────────────────
// When an alternative was found through a BASE-FORM synonym bridge (e.g. "oatmeal"
// expanding to "oats" to find "Oats, rolled, dry"), Guard 5 leaves a gap: it only
// fires when both the request AND the candidate carry explicit preparation states.
// A preparation-neutral request like "oatmeal" or "quick oatmeal" does not carry
// explicit state, so Guard 5 ignores it — yet using dry-grain macros for a
// cooked-porridge quantity produces a ~2× calorie error.
//
// SYNONYM_BASE_FORM_KEYS (from search-utils) distinguishes two synonym types:
//   • Base-form synonyms: key = prepared form, values = base/unprocessed ingredient
//     (e.g. "oatmeal" → "oats"). Guard APPLIES — preparation matters.
//   • Same-form synonyms: regional name equivalents for the same preparation
//     (e.g. "arugula" → "rocket"). Guard does NOT apply — these are the same food.
//
// Non-synonym-key modifier tokens (e.g. "quick", "instant", "rolled") do not
// disable the guard when the food-identity token ("oatmeal") still only bridges
// via the synonym. This closes the "quick oatmeal" → "Oats, quick, dry" gap.
//
// Exported for unit testing. Not part of the public module API.
export function matchedViaSynonymOnly(ingredientName: string, altName: string): boolean {
  const tokens = ingredientName
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length >= 3)
  for (const token of tokens) {
    if (!SYNONYM_BASE_FORM_KEYS.has(token)) continue  // skip non-base-form tokens
    if (tokenHitsText(token, altName)) return false   // base-form key hits directly → no bridge
    if (tokenHitsTextExpanded(token, altName)) return true  // base-form key bridges via synonym
  }
  return false
}

// Fires when all three conditions hold:
//   1. The ingredient request is preparation-neutral (Guard 5 would not fire)
//   2. The alternative food is explicitly raw or dry (extractPrepState = raw_or_dry)
//   3. The food-identity connection runs through a base-form synonym bridge
// Does not fire for same-form regional synonyms (arugula/rocket etc.) because
// those keys are absent from SYNONYM_BASE_FORM_KEYS.
// Exported for unit testing. Not part of the public module API.
export function synonymExpandedDryFormConflict(ingredientName: string, altName: string): boolean {
  if (extractPrepState(ingredientName) !== 'neutral') return false
  if (extractPrepState(altName) !== 'raw_or_dry') return false
  return matchedViaSynonymOnly(ingredientName, altName)
}

// ── Helper: extract base food name from preparation-method compound names ─────
// Used as a last-resort fallback when a count-unit ingredient cannot be resolved
// because the topMatch is a prepared form with no count-unit portion (e.g.
// "scrambled eggs" → USDA Survey "Eggs, scrambled" with no per-egg serving).
// Strips a known preparation-method prefix to yield the base food name ("eggs")
// for a secondary matchIngredient call.
//
// Returns null when the name has no recognized preparation prefix, or when the
// remaining base food contains a compound-dish indicator (e.g. "scrambled egg
// salad" → not a simple base food after stripping "scrambled").
//
// The caller is responsible for disclosing that base-food macros (e.g. raw egg)
// do not reflect preparation additions (e.g. cooking fat from scrambling).

const PREPARATION_COUNT_PREFIXES: string[] = [
  'scrambled',
  'poached',
  'hard-boiled',
  'hard boiled',
  'soft-boiled',
  'soft boiled',
]

// Exported for unit testing. Not part of the public module API.
export function extractBaseCountFood(name: string): string | null {
  const lower = name.toLowerCase().trim()
  for (const prefix of PREPARATION_COUNT_PREFIXES) {
    if (lower.startsWith(prefix + ' ')) {
      const base = lower.slice(prefix.length).trim()
      if (base && !hasCompoundIndicator(base)) return base
    }
  }
  return null
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

// ── Helper: generalized food-identity and preparation-compatibility check ──────
// Applied to every alternative in Part C before accepting it. Guards against:
//
//   1. Compound-dish substitution: an alt that combines the query ingredient with
//      other ingredients (e.g. "Salmon and Broccoli Bowl" for a plain salmon query)
//      is rejected when the topMatch is a standalone food. If topMatch is itself
//      compound, compound alts are allowed (customer asked for a dish).
//
//   2. Preparation-state conflict (bidirectional): if the customer's requested food
//      name or the topMatch carries an explicit preparation state (raw/dry vs
//      cooked/grilled/smoked/etc.), an alt with a conflicting state is rejected.
//      The customer's requested name takes priority when it carries a clear state —
//      for example, a customer asking for "grilled salmon" overrides a USDA Foundation
//      topMatch named "Salmon, Atlantic, Wild, Raw", allowing a cooked alt to resolve.
//      When the customer's request is neutral, the topMatch's preparation state is
//      used as the reference.
//
// Does NOT attempt food-noun identity matching by string — USDA and FatSecret use
// structurally different naming conventions ("Oats, Rolled, Dry" vs "Old Fashioned
// Oats") and a string equality check would over-reject valid equivalents. The score-
// based gate already handles name-similarity; this function handles form and state.

const COMPOUND_INDICATORS = new Set([
  'with', 'and', 'over',
  'bowl', 'salad', 'soup', 'stew', 'casserole', 'chili',
  'pasta', 'risotto', 'lasagna',
  'sandwich', 'pizza', 'burrito', 'taco', 'wrap',
  'combo', 'meal', 'dinner', 'entree', 'dish', 'medley', 'platter',
])

function hasCompoundIndicator(name: string): boolean {
  const lower = name.toLowerCase()
  const words = lower.split(/[\s,]+/)
  if (words.some(w => COMPOUND_INDICATORS.has(w))) return true
  if (lower.includes(' with ') || lower.includes(' & ')) return true
  return false
}

const COOKED_STATE_WORDS = [
  'cooked', 'grilled', 'baked', 'roasted', 'broiled', 'fried',
  'poached', 'steamed', 'smoked', 'canned', 'pickled',
  'glazed', 'marinated', 'seasoned', 'flavored', 'breaded',
  'stuffed', 'prepared',
]

type PrepState = 'raw_or_dry' | 'cooked' | 'neutral'

// Exported for unit testing. Not part of the public module API.
export function extractPrepState(name: string): PrepState {
  const lower = name.toLowerCase()
  // Cooked-state words take priority. "Fresh grilled salmon" is cooked, not raw.
  if (COOKED_STATE_WORDS.some(w => lower.includes(w))) return 'cooked'
  // Only EXPLICIT uncooked markers ("raw", "dry") imply an unprocessed nutrition reference.
  // "fresh" is a freshness/provenance qualifier — it does NOT assert raw preparation.
  // "fresh bread" means recently baked, not raw dough; "fresh jackfruit" means the ripe
  // whole fruit regardless of how it will be eaten. Guard 4 independently blocks dried
  // forms when the request contains "fresh" or "raw" via a direct string check.
  if (/\braw\b/.test(lower) || /\bdry\b/.test(lower)) return 'raw_or_dry'
  return 'neutral'
}

// requestedName: the customer's original ingredient name (e.g. "grilled salmon").
// When it carries an explicit prep state it takes priority over topMatchName.
function altPassesIdentityCheck(topMatchName: string, altName: string, requestedName?: string): boolean {
  const topNorm = topMatchName.toLowerCase()
  const altNorm = altName.toLowerCase()

  // Guard 1: compound-dish substitution
  if (!hasCompoundIndicator(topNorm) && hasCompoundIndicator(altNorm)) return false

  // Guard 2: preparation-state conflict (bidirectional)
  // Prefer the customer's explicitly stated preparation. When neutral, fall back to topMatch.
  const requestedPrepState = requestedName ? extractPrepState(requestedName.toLowerCase()) : 'neutral'
  const refPrepState = requestedPrepState !== 'neutral' ? requestedPrepState : extractPrepState(topNorm)
  const altPrepState = extractPrepState(altNorm)
  if (refPrepState !== 'neutral' && altPrepState !== 'neutral' && refPrepState !== altPrepState) return false

  return true
}

// Stronger compound-dish indicators for topMatch validation.
// Excludes 'and', 'with', 'over' from COMPOUND_INDICATORS because USDA food names
// routinely use these words in single-food descriptions (e.g. "separable lean and fat",
// "cooked with salt") — catching them as compound dishes would over-reject valid USDA matches.
const STRONG_COMPOUND_INDICATORS = new Set([
  'bowl', 'salad', 'soup', 'stew', 'casserole', 'chili',
  'pasta', 'risotto', 'lasagna',
  'sandwich', 'pizza', 'burrito', 'taco', 'wrap',
  'combo', 'meal', 'dinner', 'entree', 'dish', 'medley', 'platter',
])

function hasStrongCompoundIndicator(name: string): boolean {
  const lower = name.toLowerCase()
  const words = lower.split(/[\s,]+/)
  return words.some(w => STRONG_COMPOUND_INDICATORS.has(w))
}

// Validates whether the topMatch candidate is a plausible food for the customer's
// request before committing to enrichment and conversion. Applied to every topMatch,
// not just alternatives — prevents wrong-form foods from being accepted silently when
// they happen to rank highest in the provider results.
//
// Uses stricter compound checks (STRONG_COMPOUND_INDICATORS) than altPassesIdentityCheck
// to avoid false positives on USDA names that use 'and' descriptively.
// Guard 5 is bidirectional: prefers a preparation-compatible record when one exists
// rather than silently applying raw-food macros to a cooked-food quantity.
// Exported for unit testing. Not part of the public module API.
export function topMatchPassesIdentityCheck(requestedName: string, topMatchName: string): boolean {
  const reqNorm = requestedName.toLowerCase()
  const topNorm = topMatchName.toLowerCase()

  // Guard 1: compound dish when a standalone ingredient was requested.
  // Uses strong indicators (no 'and'/'with') to avoid USDA false positives.
  if (!hasStrongCompoundIndicator(reqNorm) && hasStrongCompoundIndicator(topNorm)) return false

  // Guard 2: juice form when the whole food was requested
  if (/\bjuice\b/.test(topNorm) && !/\bjuice\b/.test(reqNorm)) return false

  // Guard 3: powder/extract form when not requested
  if (/\b(powder|powdered|extract)\b/.test(topNorm) && !/\b(powder|extract)\b/.test(reqNorm)) return false

  // Guard 4: dehydrated form conflicts with an explicit raw or fresh request.
  // "Dried Jackfruit" is not a match for "jackfruit raw" — concentrated macros differ
  // significantly. Does NOT apply when the request uses "dry" without "raw" (e.g. "rolled
  // oats dry") — that describes uncooked grains, not dehydration.
  if (/\bdried\b/.test(topNorm) && /\b(raw|fresh)\b/.test(reqNorm)) return false

  // Guard 5: preparation-state conflict — bidirectional.
  // A raw USDA entry must NOT be silently used for a cooked quantity: 100g of grilled
  // chicken and 100g of raw chicken have meaningfully different macros and weights.
  // When the customer specifies a cooked form, prefer a preparation-compatible record
  // (e.g. "Grilled Chicken Breast" from FatSecret or USDA cooked variant). If no
  // compatible record exists in alternatives either, leave unresolved rather than
  // returning raw-food macros for a stated cooked portion.
  const reqPrepState = extractPrepState(reqNorm)
  const topPrepState = extractPrepState(topNorm)
  if (reqPrepState !== 'neutral' && topPrepState !== 'neutral' && reqPrepState !== topPrepState) return false

  return true
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
    // Serving size is now verified from the detail API — clear the estimated flag.
    servingSizeIsEstimated: false,
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
// When V parses "3 large eggs" or "1 whole avocado", it may pass unit='large'
// or unit='whole' — quantity descriptors, not recognized conversion units. These
// must be remapped to 'piece' before entering the factor pipeline.
//
// Strategy:
//   - Size/form qualifiers → 'piece'
//     The factor engine's Step 6b broadened count-unit fallback then finds the
//     food-specific USDA portion (e.g. 'large egg', 'whole avocado') automatically.
//   - 'whole' means "1 whole item" — valid when the food has a piece-based serving.
//     If no such serving exists, the pipeline returns unit_incompatible, which is
//     correct — do not guess gram weights.
//   - All plural normalizations are already in SLICE_UNITS / PIECE_UNITS in
//     units.ts, so no extra work is needed there.
//
// The original unit string is preserved in userDescription (via describeIngredient)
// so the user-facing output still reads "3 large eggs" not "3 piece eggs".

const SIZE_QUALIFIERS = new Set([
  'large', 'medium', 'small',
  'extra large', 'extra-large', 'x-large',
  'xl', 'lg', 'md', 'sm',
  'jumbo', 'mini',
  'whole',
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
    let topMatchRejected = false

    // ── Identity check: validate topMatch before enrichment and conversion ────
    // If the top provider result is the wrong food form (dried fruit when raw was
    // requested, juice instead of whole food, compound dish for a standalone ingredient),
    // demote it and attempt alternatives first rather than returning wrong nutrition.
    if (!topMatchPassesIdentityCheck(ing.name, topMatch.name)) {
      topMatchRejected = true
      console.log('[V-nutrition] topMatch-identity-rejected', {
        index: ingredientResults.length,
        requestedName: ing.name,
        topMatchName: topMatch.name,
        topMatchScore: match.topMatch.matchScore,
        topMatchProvider: match.topMatch.provider,
      })
    }

    // resolvedUnit is used in both topMatch conversion and Part C alternative resolution.
    const resolvedUnit = normalizeIngredientUnit(ing.unit)
    let conversionResult: Awaited<ReturnType<typeof resolveIngredientFactor>>

    if (!topMatchRejected) {
      // ── Part B: FatSecret detail enrichment ─────────────────────────────────
      // When the search result lacks a usable household unit and the user wants a
      // count-based unit (piece/strip/egg/tortilla/etc.), fetch the FatSecret detail
      // API to get the canonical serving description (e.g. "1 strip", "1 large", "1 tortilla").
      //
      // Skip condition: householdUnit is already a usable (non-generic) serving unit.
      // "1 large" (size qualifier) and "1 strip" (count noun) are both usable.
      // Do NOT skip when householdUnit is a generic non-count word like "serving" —
      // e.g. "1 serving" from the search result is useless for count resolution and the
      // detail API may return a more specific "1 strip" or "1 tortilla" serving.
      const resolvedUnitForEnrichCheck = resolvedUnit
      const hasUsableHouseholdUnit =
        !!topMatch.householdUnit && isUsableHouseholdUnit(topMatch.householdUnit)
      const hadEstimatedServingSize = topMatch.servingSizeIsEstimated === true
      let enrichmentSucceeded = false

      if (
        topMatch.provider === 'fatsecret' &&
        !hasUsableHouseholdUnit &&
        (isCountUnit(resolvedUnitForEnrichCheck) || isVolumeUnit(resolvedUnitForEnrichCheck) || hadEstimatedServingSize)
      ) {
        const enriched = await enrichFatSecretMatch(topMatch, resolvedUnitForEnrichCheck)
        if (enriched) {
          enrichmentSucceeded = true
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

      // When enrichment was triggered because the serving size was estimated (no gram
      // parenthetical in the search description) but the detail API returned no usable
      // serving data, the 100g default is fabricated. Do not return nutrition based on it.
      // Weight-unit inputs fall through here; count-unit inputs already fail conversion below.
      if (hadEstimatedServingSize && !enrichmentSucceeded && !isCountUnit(resolvedUnitForEnrichCheck)) {
        ingredientResults.push({
          userDescription: userDesc,
          matchedFoodName: topMatch.name,
          matchConfidence: match.confidence,
          calories: 0, proteinG: 0, carbG: 0, fatG: 0,
          resolved: false,
          errorReason: `Serving weight unknown for "${topMatch.name}" — no gram measurement in product description.`,
        })
        unresolvedIngredients.push({
          name: ing.name,
          reason: 'conversion_error',
          suggestion: `Try specifying the exact amount, e.g. "1.69 oz bag of ${ing.name}".`,
        })
        continue
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
    } else {
      // topMatch rejected by identity check — synthesize a ConversionError to route
      // into the Part C alternatives loop below.
      conversionResult = {
        kind: 'conversion_error',
        errorCode: 'identity_rejected',
        message: `"${topMatch.name}" does not match the food form or preparation state requested for "${ing.name}".`,
      }
    }

    // ── Portion-size conflict guard ───────────────────────────────────────────
    // When the topMatch resolves successfully, verify that the resolved portion
    // description doesn't explicitly conflict with a size qualifier in the
    // ingredient name (e.g. "thin slice" for "thick-cut bacon"). If a conflict
    // exists, demote to a ConversionError so Part C can try alternatives.
    if (!isConversionError(conversionResult) && portionSizeConflict(ing.name, conversionResult.portionDescription)) {
      console.log('[V-nutrition] portion-size-conflict', {
        index: ingredientResults.length,
        ingredientName: ing.name,
        portionDescription: conversionResult.portionDescription,
        topMatchName: topMatch.name,
      })
      conversionResult = {
        kind: 'conversion_error',
        errorCode: 'portion_not_found',
        message: `Portion "${conversionResult.portionDescription}" conflicts with requested size "${ing.name}" — cannot use a thin-slice serving for a thick-cut ingredient`,
        suggestions: ['Specify amount in grams or ounces for an accurate result'],
      }
    }

    // ── Part C: Alternative candidate fallback ────────────────────────────────
    // When the topMatch fails conversion OR was identity-rejected, four ordered
    // sub-paths attempt resolution:
    //
    //   Pre)     USDA volume promotion — FatSecret topMatch fails a volume unit;
    //            promote a USDA Foundation/SR Legacy alt that can trigger Step 7
    //            (USDA portion fetch). Bypasses relative quality gate; requires
    //            both identity guards instead.
    //
    //   Std)     Standard alt loop — existing relative quality + identity gates.
    //
    //   PBorrow) Portion-borrow for count units — borrow only the count-to-gram
    //            portion weight from a USDA SR Legacy/Foundation alt while
    //            retaining the topMatch's prepared-food per-100g macros.
    //            Prevents raw-food macro substitution for prepared foods.
    //
    // All paths mark results 'plausible'.
    let usedFallback = false
    if (isConversionError(conversionResult) && match.alternatives.length > 0) {
      console.log('[V-nutrition] trying-alternatives', {
        index: ingredientResults.length,
        topError: conversionResult.errorCode,
        altCount: match.alternatives.length,
        alts: match.alternatives.map(a => ({
          provider: a.provider,
          id: a.externalId,
          name: a.name,
          score: a.matchScore,
          householdUnit: a.householdUnit ?? null,
        })),
      })

      // ── Part C-Pre: USDA volume promotion ──────────────────────────────────
      // Two provider paths can end up with a topMatch that carries no volume-unit
      // portion data:
      //   • FatSecret (+15 bonus): beats USDA on scoring but has no USDA FDC
      //     portion lookup (Step 7 skips non-USDA foods).
      //   • USDA Survey / FNDDS: wins topMatch when FatSecret returns no strong
      //     result; Survey foods also lack USDA FDC portion data in Step 7 because
      //     Step 7 requires Foundation or SR Legacy fdcDataType.
      // In both cases, a USDA Foundation/SR Legacy alt can trigger Step 7 and
      // resolve the volume unit. The relative quality gate is bypassed; both
      // identity guards are required.
      const topMatchLacksVolumeData =
        isVolumeUnit(resolvedUnit) &&
        (conversionResult as ConversionErrorType).errorCode === 'unit_incompatible' &&
        (
          match.topMatch.provider === 'fatsecret' ||
          (match.topMatch.provider === 'usda_fooddata' &&
           match.topMatch.fdcDataType === 'Survey (FNDDS)')
        )
      if (topMatchLacksVolumeData) {
        for (const alt of match.alternatives) {
          if (usedFallback) break
          if (alt.matchScore < 40) continue
          if (alt.provider !== 'usda_fooddata') continue
          if (alt.fdcDataType !== 'Foundation' && alt.fdcDataType !== 'SR Legacy') continue
          // Use topMatchPassesIdentityCheck (STRONG_COMPOUND_INDICATORS) rather than
          // altPassesIdentityCheck for USDA alts. USDA names routinely include "with"
          // as a preparation descriptor (e.g. "Oatmeal, cooked with water") — not a
          // compound-dish indicator — and altPassesIdentityCheck's COMPOUND_INDICATORS
          // set includes 'with', which would over-reject valid USDA equivalents.
          if (!topMatchPassesIdentityCheck(ing.name, alt.name)) continue
          if (synonymExpandedDryFormConflict(ing.name, alt.name)) {
            console.log('[V-nutrition] synonym-dry-form-guard-pre', {
              index: ingredientResults.length,
              ingredientName: ing.name,
              altName: alt.name,
            })
            continue
          }

          let altResult: Awaited<ReturnType<typeof resolveIngredientFactor>>
          try {
            altResult = await resolveIngredientFactor(
              buildFoodForConversion(alt),
              ing.quantity,
              resolvedUnit,
            )
          } catch (err) {
            console.log('[V-nutrition] usda-vol-alt-threw', {
              index: ingredientResults.length,
              altId: alt.externalId,
              error: err instanceof Error ? err.message : String(err),
            })
            continue
          }
          if (isConversionError(altResult)) continue

          topMatch = alt
          conversionResult = altResult
          usedFallback = true
          assumptions.push(
            `"${ing.name}": volume portion from USDA "${alt.name}" (${altResult.portionDescription}) — primary match "${match.topMatch.name}" lacked volume serving data`
          )
          console.log('[V-nutrition] usda-volume-promotion', {
            index: ingredientResults.length,
            fatsecretMatch: match.topMatch.name,
            usdaAlt: alt.name,
            portionDescription: altResult.portionDescription,
          })
        }
      }

      // ── Part C-Standard: relative quality + identity gate loop ─────────────
      if (!usedFallback) {
        for (const alt of match.alternatives) {
          // Semantic safety gate: skip alternatives with matchScore below the minimum
          // 'worthwhile' threshold (40). Prevents resolving "chicken patty" via a
          // poor-scoring unrelated food just to get a number.
          if (alt.matchScore < 40) continue
          // Relative quality gate: alternative must score ≥ 80% of the top match's
          // score. Prevents a semantically wrong food (e.g. a compound dish that
          // merely contains the query ingredient) from substituting for a correct top
          // match that happened to lack serving conversion data.
          if (alt.matchScore < match.topMatch.matchScore * 0.80) {
            // USDA Foundation and SR Legacy foods structurally never carry household
            // serving data (mapFood only extracts it for Branded foods). Their elevated
            // match scores partly reflect data-type bonuses, not superior food identity.
            // Apply a relaxed 50% floor for these so serving-compatible FatSecret
            // alternatives can still resolve while very low-scoring entries are still blocked.
            const topIsNonBrandedUsda =
              match.topMatch.provider === 'usda_fooddata' &&
              (match.topMatch.fdcDataType === 'Foundation' || match.topMatch.fdcDataType === 'SR Legacy')
            if (!topIsNonBrandedUsda) continue
            if (alt.matchScore < match.topMatch.matchScore * 0.50) continue
          }

          // Structural identity check: reject compound dishes and preparation-state
          // substitutions regardless of which gate path was used.
          if (!altPassesIdentityCheck(match.topMatch.name, alt.name, ing.name)) {
            console.log('[V-nutrition] alt-identity-rejected', {
              index: ingredientResults.length,
              altId: alt.externalId,
              altName: alt.name,
              topName: match.topMatch.name,
            })
            continue
          }
          if (synonymExpandedDryFormConflict(ing.name, alt.name)) {
            console.log('[V-nutrition] synonym-dry-form-guard-std', {
              index: ingredientResults.length,
              ingredientName: ing.name,
              altName: alt.name,
            })
            continue
          }

          let altMatch = alt

          // Apply same enrichment logic: if FatSecret + count/volume unit + no usable household unit
          const altHasUsable = !!altMatch.householdUnit && isUsableHouseholdUnit(altMatch.householdUnit)
          if (altMatch.provider === 'fatsecret' && !altHasUsable && (isCountUnit(resolvedUnit) || isVolumeUnit(resolvedUnit))) {
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
          } catch (err) {
            console.log('[V-nutrition] alt-conversion-threw', {
              index: ingredientResults.length,
              altId: altMatch.externalId,
              altProvider: altMatch.provider,
              error: err instanceof Error ? err.message : String(err),
            })
            continue
          }

          if (isConversionError(altResult)) {
            console.log('[V-nutrition] alt-conversion-failed', {
              index: ingredientResults.length,
              altId: altMatch.externalId,
              altProvider: altMatch.provider,
              altName: altMatch.name,
              errorCode: altResult.errorCode,
              householdUnit: altMatch.householdUnit ?? null,
            })
            continue
          }

          if (!isConversionError(altResult)) {
            // Portion-size conflict: if the alt's portion description conflicts
            // with the ingredient's own size qualifier, skip this alt too.
            if (portionSizeConflict(ing.name, altResult.portionDescription)) {
              console.log('[V-nutrition] alt-portion-size-conflict', {
                index: ingredientResults.length,
                altName: altMatch.name,
                portionDescription: altResult.portionDescription,
              })
              continue
            }
            console.log('[V-nutrition] alt-match-used', {
              index: ingredientResults.length,
              altProvider: altMatch.provider,
              altId: altMatch.externalId,
              altName: altMatch.name,
              originalError: (conversionResult as ConversionErrorType).errorCode,
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

      // ── Part C-PBorrow: Portion-borrow for count units ──────────────────────
      // When all alternatives failed for a count unit: if the topMatch is a
      // prepared-form food with per-100g macros but no count-unit serving (e.g.
      // USDA Survey "Eggs, scrambled"), try to borrow ONLY the count-to-gram
      // portion weight from a USDA SR Legacy/Foundation alt. The prepared food's
      // per-100g macros are retained — macros reflect the prepared form (e.g.
      // cooking-fat calories already included in Survey reference values).
      // topMatch is not reassigned here; only conversionResult is replaced.
      if (!usedFallback && isCountUnit(resolvedUnit)) {
        const preparedTopMatch = topMatch
        for (const alt of match.alternatives) {
          if (alt.matchScore < 40) continue
          if (alt.provider !== 'usda_fooddata') continue
          if (alt.fdcDataType !== 'Foundation' && alt.fdcDataType !== 'SR Legacy') continue
          // Identity check for base food compatibility; prep-state Guard 2 is
          // intentionally lenient here because we borrow only portion weight.
          if (!altPassesIdentityCheck(preparedTopMatch.name, alt.name, ing.name)) continue
          if (synonymExpandedDryFormConflict(ing.name, alt.name)) {
            console.log('[V-nutrition] synonym-dry-form-guard-pborrow', {
              index: ingredientResults.length,
              ingredientName: ing.name,
              altName: alt.name,
            })
            continue
          }

          let altFactor: Awaited<ReturnType<typeof resolveIngredientFactor>>
          try {
            altFactor = await resolveIngredientFactor(
              buildFoodForConversion(alt),
              ing.quantity,
              resolvedUnit,
            )
          } catch {
            continue
          }
          if (isConversionError(altFactor)) continue

          // Portion-size conflict: a conflicting size descriptor (e.g. "thin slice"
          // for a "thick-cut" ingredient) is wrong even when used only for gram-
          // weight. Skip this alt rather than borrowing a size-incompatible portion.
          if (portionSizeConflict(ing.name, altFactor.portionDescription)) {
            console.log('[V-nutrition] pborrow-portion-size-conflict', {
              index: ingredientResults.length,
              altName: alt.name,
              portionDescription: altFactor.portionDescription,
            })
            continue
          }

          // Keep topMatch (prepared-food macros). Only replace conversionResult
          // so that: calories = preparedTopMatch.calories × altFactor.factor
          conversionResult = altFactor
          usedFallback = true
          assumptions.push(
            `"${ing.name}": count-to-gram from "${alt.name}" (${altFactor.portionDescription}); macros from prepared food "${preparedTopMatch.name}"`
          )
          console.log('[V-nutrition] portion-borrow-used', {
            index: ingredientResults.length,
            preparedFood: preparedTopMatch.name,
            portionSource: alt.name,
            portionDescription: altFactor.portionDescription,
          })
          break
        }
      }
    }

    // ── Part C-BaseFallback: Base-food disclosed fallback for count units ──────
    // Last resort when alternatives are exhausted or absent. When the ingredient
    // name is a preparation-method compound ("scrambled eggs", "hard-boiled egg"),
    // strip the preparation prefix and retry matchIngredient with the base food.
    // The base food's macros do NOT include preparation additions (e.g. cooking
    // fat) — this is explicitly disclosed in the assumption note so the customer
    // can understand the limitation before confirming a log entry.
    if (!usedFallback && isCountUnit(resolvedUnit) && isConversionError(conversionResult)) {
      const baseFood = extractBaseCountFood(ing.name)
      if (baseFood) {
        try {
          const baseMatch = await matchIngredient({
            ingredientName: baseFood,
            quantity: ing.quantity,
            unit: resolvedUnit,
          })
          if (baseMatch?.topMatch && topMatchPassesIdentityCheck(baseFood, baseMatch.topMatch.name)) {
            const baseFactor = await resolveIngredientFactor(
              buildFoodForConversion(baseMatch.topMatch),
              ing.quantity,
              resolvedUnit,
            )
            if (!isConversionError(baseFactor)) {
              topMatch = baseMatch.topMatch
              conversionResult = baseFactor
              usedFallback = true
              assumptions.push(
                `"${ing.name}": resolved as base food "${baseFood}" — macros do not include preparation-specific additions (e.g. cooking fat)`
              )
              console.log('[V-nutrition] base-food-fallback-used', {
                index: ingredientResults.length,
                originalName: ing.name,
                baseFood,
                baseFoodMatch: baseMatch.topMatch.name,
              })
            }
          }
        } catch (err) {
          console.log('[V-nutrition] base-food-fallback-failed', {
            index: ingredientResults.length,
            originalName: ing.name,
            baseFood,
            error: err instanceof Error ? err.message : String(err),
          })
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
      matchedFoodProvider: topMatch.provider,
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
