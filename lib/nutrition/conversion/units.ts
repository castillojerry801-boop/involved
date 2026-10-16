// Canonical unit sets — single source of truth for all nutrition conversion logic.
// lib/recipes/nutrition.ts imports from here; lib/nutrition/conversion/factor.ts imports from here.
// Do NOT duplicate these sets anywhere else.

export const SERVING_ALIASES = new Set(['serving', 'servings', 'portion', 'portions'])
// 'grm' is USDA's non-standard gram abbreviation used on some branded food records.
export const GRAM_UNITS      = new Set(['g', 'gram', 'grams', 'grm'])
export const OZ_UNITS        = new Set(['oz', 'ounce', 'ounces'])
export const LB_UNITS        = new Set(['lb', 'lbs', 'pound', 'pounds'])
export const KG_UNITS        = new Set(['kg', 'kilogram', 'kilograms'])
export const ML_UNITS        = new Set(['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'])
export const L_UNITS         = new Set(['l', 'liter', 'liters', 'litre', 'litres'])
// Fluid ounces: volume unit for liquid-base (ml) foods only.
// Distinct from OZ_UNITS (weight) — cross-dimension conversion (fl oz ↔ g) requires density.
export const FL_OZ_UNITS     = new Set(['fl oz', 'floz', 'fl_oz', 'fluid oz', 'fluid ounce', 'fluid ounces'])
export const CUP_UNITS       = new Set(['cup', 'cups'])
export const TBSP_UNITS      = new Set(['tbsp', 'tablespoon', 'tablespoons'])
export const TSP_UNITS       = new Set(['tsp', 'teaspoon', 'teaspoons'])
export const CLOVE_UNITS     = new Set(['clove', 'cloves'])
export const SLICE_UNITS     = new Set(['slice', 'slices'])
export const PIECE_UNITS     = new Set(['piece', 'pieces'])

// All recognized household count units (not volume, not weight).
const HOUSEHOLD_UNITS = new Set([
  ...CLOVE_UNITS,
  ...SLICE_UNITS,
  ...PIECE_UNITS,
])

// Returns gram equivalent for weight units, or null if not a weight unit.
export function weightToGrams(quantity: number, unit: string): number | null {
  const u = unit.toLowerCase().trim()
  if (GRAM_UNITS.has(u)) return quantity
  if (OZ_UNITS.has(u))   return quantity * 28.3495
  if (LB_UNITS.has(u))   return quantity * 453.592
  if (KG_UNITS.has(u))   return quantity * 1000
  return null
}

// Returns ml equivalent for volume units, or null if not a volume unit.
export function volumeToMl(quantity: number, unit: string): number | null {
  const u = unit.toLowerCase().trim()
  if (ML_UNITS.has(u))     return quantity
  if (L_UNITS.has(u))      return quantity * 1000
  if (CUP_UNITS.has(u))    return quantity * 236.588
  if (TBSP_UNITS.has(u))   return quantity * 14.7868
  if (TSP_UNITS.has(u))    return quantity * 4.92892
  if (FL_OZ_UNITS.has(u))  return quantity * 29.5735
  return null
}

// Returns true if the unit is a recognized household count unit (clove, slice, piece, etc.).
export function isHouseholdUnit(unit: string): boolean {
  return HOUSEHOLD_UNITS.has(unit.toLowerCase().trim())
}

// Normalize a unit string to canonical lowercase form.
export function normalizeUnit(unit: string): string {
  return unit.toLowerCase().trim()
}
