/**
 * Pure, side-effect-free helpers for dietary preference validation.
 * No server imports — safe for unit tests and client-side use.
 */

export type DietaryApproach =
  | 'keto'
  | 'carnivore'
  | 'vegan'
  | 'vegetarian'
  | 'mediterranean'
  | 'paleo'
  | 'low_carb'
  | 'high_protein'
  | 'plant_based'
  | 'gluten_free'
  | 'dairy_free'

export type AllergenSeverity = 'allergy' | 'intolerance' | 'dislike'

export interface DietaryConflict {
  approaches: [DietaryApproach, DietaryApproach]
  reason: string
}

// Pairs that are biologically/logically incompatible.
// Not exhaustive — this list covers the cases where selecting both would
// produce an impossible meal plan (e.g., no animal products + only animal
// products). Compatible combinations like keto+dairy_free are allowed.
const INCOMPATIBLE_PAIRS: Array<[DietaryApproach, DietaryApproach, string]> = [
  ['vegan',       'carnivore',   'Vegan excludes all animal products; carnivore consists entirely of animal products.'],
  ['vegetarian',  'carnivore',   'Vegetarian excludes meat; carnivore consists entirely of meat.'],
  ['plant_based', 'carnivore',   'Plant-based excludes animal products; carnivore consists entirely of animal products.'],
  ['vegan',       'paleo',       'Standard paleo includes meat and fish, which vegan excludes. Select one or describe your custom approach in notes.'],
]

/**
 * Returns conflicts found in the given set of dietary approaches.
 * Returns an empty array when all combinations are compatible.
 */
export function detectDietaryConflicts(
  approaches: DietaryApproach[],
): DietaryConflict[] {
  const conflicts: DietaryConflict[] = []
  for (const [a, b, reason] of INCOMPATIBLE_PAIRS) {
    if (approaches.includes(a) && approaches.includes(b)) {
      conflicts.push({ approaches: [a, b], reason })
    }
  }
  return conflicts
}

/**
 * Returns a human-readable error string for a conflict, or null if none.
 * Convenience wrapper for single-message display.
 */
export function formatConflictErrors(approaches: DietaryApproach[]): string | null {
  const conflicts = detectDietaryConflicts(approaches)
  if (conflicts.length === 0) return null
  return conflicts
    .map(c => `"${c.approaches[0]}" and "${c.approaches[1]}" are incompatible: ${c.reason}`)
    .join(' ')
}

export const ALL_DIETARY_APPROACHES: DietaryApproach[] = [
  'keto',
  'carnivore',
  'vegan',
  'vegetarian',
  'mediterranean',
  'paleo',
  'low_carb',
  'high_protein',
  'plant_based',
  'gluten_free',
  'dairy_free',
]

export function isValidDietaryApproach(value: unknown): value is DietaryApproach {
  return ALL_DIETARY_APPROACHES.includes(value as DietaryApproach)
}

export const ALL_ALLERGEN_SEVERITIES: AllergenSeverity[] = ['allergy', 'intolerance', 'dislike']

export function isValidAllergenSeverity(value: unknown): value is AllergenSeverity {
  return ALL_ALLERGEN_SEVERITIES.includes(value as AllergenSeverity)
}
