// Shared household serving parser used by all food providers.
// Extracts a countable unit noun and per-serving count from household serving descriptions.

export interface ParsedHousehold {
  /** Singular form of the unit noun, e.g. "large egg", "strip", "tablespoon", "cup". */
  householdUnit: string
  /** How many of this unit equal one nutritional serving in the DB (e.g. 2 for "2 strips = 1 serving"). */
  unitsPerServing: number
}

// Metric weight units that are already handled by the oz→g and lb→g conversion
// paths in computeIngredientFactor. Skip these — storing them as "household units"
// would create redundancy and confusion with the existing conversion logic.
const SKIP_NOUNS = new Set([
  'g', 'gram', 'grams',
  'oz', 'oza', 'ounce', 'ounces',  // 'oza' = USDA abbreviation for fluid ounce
  'lb', 'lbs', 'pound', 'pounds',
  'kg', 'kilogram', 'kilograms',
  'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres',
  'l', 'liter', 'liters', 'litre', 'litres',
  'fl',  // 'fl oz' abbreviation prefix
])

// Size adjectives that, alone, are ambiguous unit labels.
// "1 large" is not useful; "1 large egg" is. Used by enrichWithFoodNoun().
const SIZE_ADJECTIVES = new Set([
  'large', 'medium', 'small',
  'extra large', 'extra-large', 'xl', 'x-large',
  'jumbo', 'mini', 'miniature',
])

// Individual adjective words (subset of SIZE_ADJECTIVES, each word separately)
// used when scanning a food description word-by-word.
const SIZE_ADJ_WORDS = new Set([
  'large', 'medium', 'small', 'extra', 'jumbo', 'mini', 'miniature', 'xl',
])

// Common descriptor words in USDA food descriptions that are NOT food nouns.
const DESC_WORDS = new Set([
  'whole', 'raw', 'fresh', 'dried', 'cooked', 'frozen', 'organic', 'natural',
  'grade', 'cage', 'free', 'brown', 'white', 'light', 'dark', 'plain', 'original',
  'sweet', 'dry', 'without', 'with', 'all', 'classic', 'traditional', 'reduced',
  'low', 'high', 'zero', 'enriched', 'fortified', 'pasteurized', 'homogenized',
  'certified', 'premium', 'select', 'choice', 'soft', 'hard', 'firm', 'crispy',
])

// Strip trailing 's' to normalize common plurals.
//   strips → strip, cups → cup, tablespoons → tablespoon, patties → patty
// Preserves double-s endings (glass → glass) and handles -ies → -y.
function toSingular(noun: string): string {
  const n = noun.toLowerCase()
  if (n.endsWith('ss')) return n
  if (n.endsWith('ies') && n.length > 5) return n.slice(0, -3) + 'y'  // patties → patty
  if (n.endsWith('s') && n.length > 3)  return n.slice(0, -1)          // strips → strip
  return n
}

// Parse a quantity string that may be a whole number, decimal, or simple fraction.
//   "1" → 1, "2.5" → 2.5, "1/4" → 0.25, "3/4" → 0.75
function parseQuantity(raw: string): number | null {
  if (raw.includes('/')) {
    const parts = raw.split('/')
    if (parts.length !== 2) return null
    const num = parseFloat(parts[0])
    const den = parseFloat(parts[1])
    if (isNaN(num) || isNaN(den) || den === 0) return null
    return num / den
  }
  const v = parseFloat(raw)
  return isNaN(v) ? null : v
}

/**
 * Parse a household serving description into a countable unit noun and per-serving count.
 *
 * Returns null for:
 *   - Pure metric weight units (g, oz, lb) — already handled by unit conversion paths
 *   - Inputs without a leading numeric quantity
 *   - Invalid or zero quantities
 *
 * Examples:
 *   "1 large egg"    → { householdUnit: "large egg",   unitsPerServing: 1    }
 *   "2 strips"       → { householdUnit: "strip",        unitsPerServing: 2    }
 *   "3 tablespoons"  → { householdUnit: "tablespoon",   unitsPerServing: 3    }
 *   "1/4 cup"        → { householdUnit: "cup",          unitsPerServing: 0.25 }
 *   "1 tortilla"     → { householdUnit: "tortilla",     unitsPerServing: 1    }
 *   "1 oz"           → null  (metric weight — use oz→g conversion instead)
 *   "28g"            → null  (no leading number + noun pattern)
 */
export function parseHouseholdText(text: string): ParsedHousehold | null {
  const cleaned = text.trim()
  if (!cleaned) return null

  // Match: <quantity> <noun>  (fraction or decimal supported)
  const m = cleaned.match(/^(\d+(?:[./]\d+)?)\s+(.+)$/)
  if (!m) return null

  const n = parseQuantity(m[1])
  if (n === null || !(n > 0) || !Number.isFinite(n)) return null

  const rawNoun = m[2].trim()
  if (!rawNoun) return null

  const normalizedNoun = toSingular(rawNoun)
  if (!normalizedNoun || normalizedNoun.length < 1) return null

  // Skip metric weight units — the standard unit conversion paths already cover them
  if (SKIP_NOUNS.has(normalizedNoun)) return null

  return { householdUnit: normalizedNoun, unitsPerServing: n }
}

/**
 * When a USDA household unit is a bare size adjective (e.g. "large", "medium"),
 * enrich it with the primary food noun found in the USDA description string.
 *
 * Only applies when householdUnit is exactly a known size adjective.
 * Uses the first non-descriptor word found in the description as the food noun.
 *
 * Examples:
 *   enrichWithFoodNoun("large",  "EGGS, LARGE, GRADE A, RAW") → "large egg"
 *   enrichWithFoodNoun("medium", "Apple, raw, with skin")      → "medium apple"
 *   enrichWithFoodNoun("cup",    "Oatmeal, dry")               → "cup"  (not a size adj — no change)
 *   enrichWithFoodNoun("large egg", "Eggs, whole, raw")        → "large egg"  (already has noun)
 */
export function enrichWithFoodNoun(householdUnit: string, foodDescription: string): string {
  const adj = householdUnit.toLowerCase().trim()
  if (!SIZE_ADJECTIVES.has(adj)) return householdUnit

  const SKIP = new Set([...SIZE_ADJ_WORDS, ...DESC_WORDS, ...SKIP_NOUNS])

  const words = foodDescription
    .toLowerCase()
    .split(/[\s,\/\-()]+/)
    .map(w => w.replace(/[^a-z]/g, ''))
    .filter(w => w.length >= 3)

  const foodNoun = words.find(w => !SKIP.has(w) && !/^\d/.test(w))
  if (!foodNoun || foodNoun.length < 3) return householdUnit

  return `${adj} ${toSingular(foodNoun)}`
}
