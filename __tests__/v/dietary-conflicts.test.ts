import { describe, it, expect } from 'vitest'
import {
  detectDietaryConflicts,
  formatConflictErrors,
  isValidDietaryApproach,
  isValidAllergenSeverity,
  ALL_DIETARY_APPROACHES,
  ALL_ALLERGEN_SEVERITIES,
  type DietaryApproach,
} from '../../lib/nutrition/dietary-conflicts'

describe('detectDietaryConflicts', () => {
  it('returns empty array for a single approach', () => {
    expect(detectDietaryConflicts(['keto'])).toEqual([])
  })

  it('returns empty array for an empty selection', () => {
    expect(detectDietaryConflicts([])).toEqual([])
  })

  it('returns empty array for compatible multi-approach selection', () => {
    expect(detectDietaryConflicts(['keto', 'dairy_free'])).toEqual([])
    expect(detectDietaryConflicts(['high_protein', 'gluten_free'])).toEqual([])
    expect(detectDietaryConflicts(['mediterranean', 'low_carb'])).toEqual([])
    expect(detectDietaryConflicts(['vegetarian', 'keto'])).toEqual([])
  })

  it('detects vegan + carnivore conflict', () => {
    const result = detectDietaryConflicts(['vegan', 'carnivore'])
    expect(result).toHaveLength(1)
    expect(result[0].approaches).toContain('vegan')
    expect(result[0].approaches).toContain('carnivore')
    expect(result[0].reason).toBeTruthy()
  })

  it('detects vegetarian + carnivore conflict', () => {
    const result = detectDietaryConflicts(['vegetarian', 'carnivore'])
    expect(result).toHaveLength(1)
    expect(result[0].approaches).toContain('vegetarian')
    expect(result[0].approaches).toContain('carnivore')
  })

  it('detects plant_based + carnivore conflict', () => {
    const result = detectDietaryConflicts(['plant_based', 'carnivore'])
    expect(result).toHaveLength(1)
  })

  it('detects vegan + paleo conflict', () => {
    const result = detectDietaryConflicts(['vegan', 'paleo'])
    expect(result).toHaveLength(1)
    expect(result[0].approaches).toContain('vegan')
    expect(result[0].approaches).toContain('paleo')
  })

  it('detects multiple conflicts in one call', () => {
    // vegan conflicts with both carnivore and paleo
    const result = detectDietaryConflicts(['vegan', 'carnivore', 'paleo'])
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('conflict detection is order-independent', () => {
    const a = detectDietaryConflicts(['carnivore', 'vegan'])
    const b = detectDietaryConflicts(['vegan', 'carnivore'])
    expect(a).toHaveLength(b.length)
  })

  it('vegetarian is NOT in conflict with vegan', () => {
    expect(detectDietaryConflicts(['vegetarian', 'vegan'])).toEqual([])
  })

  it('carnivore alone has no conflict', () => {
    expect(detectDietaryConflicts(['carnivore'])).toEqual([])
  })

  it('vegan + gluten_free has no conflict', () => {
    expect(detectDietaryConflicts(['vegan', 'gluten_free'])).toEqual([])
  })

  it('all 11 approaches passed individually produce no self-conflict', () => {
    for (const approach of ALL_DIETARY_APPROACHES) {
      expect(detectDietaryConflicts([approach])).toEqual([])
    }
  })
})

describe('formatConflictErrors', () => {
  it('returns null when no conflicts', () => {
    expect(formatConflictErrors(['keto', 'dairy_free'])).toBeNull()
  })

  it('returns a descriptive string for a conflict', () => {
    const msg = formatConflictErrors(['vegan', 'carnivore'])
    expect(msg).not.toBeNull()
    expect(msg).toContain('vegan')
    expect(msg).toContain('carnivore')
  })

  it('returns null for empty selection', () => {
    expect(formatConflictErrors([])).toBeNull()
  })
})

describe('isValidDietaryApproach', () => {
  it('returns true for each known approach', () => {
    for (const a of ALL_DIETARY_APPROACHES) {
      expect(isValidDietaryApproach(a)).toBe(true)
    }
  })

  it('returns false for an unknown string', () => {
    expect(isValidDietaryApproach('raw_food')).toBe(false)
    expect(isValidDietaryApproach('pescatarian')).toBe(false)
  })

  it('returns false for non-string values', () => {
    expect(isValidDietaryApproach(null)).toBe(false)
    expect(isValidDietaryApproach(42)).toBe(false)
    expect(isValidDietaryApproach(undefined)).toBe(false)
  })
})

describe('isValidAllergenSeverity', () => {
  it('returns true for each known severity', () => {
    for (const s of ALL_ALLERGEN_SEVERITIES) {
      expect(isValidAllergenSeverity(s)).toBe(true)
    }
  })

  it('returns false for unknown values', () => {
    expect(isValidAllergenSeverity('severe')).toBe(false)
    expect(isValidAllergenSeverity('none')).toBe(false)
  })

  it('returns false for non-string values', () => {
    expect(isValidAllergenSeverity(null)).toBe(false)
    expect(isValidAllergenSeverity(1)).toBe(false)
  })
})

describe('ALL_DIETARY_APPROACHES completeness', () => {
  it('contains exactly 11 approaches', () => {
    expect(ALL_DIETARY_APPROACHES).toHaveLength(11)
  })

  it('contains all expected values', () => {
    const expected: DietaryApproach[] = [
      'keto', 'carnivore', 'vegan', 'vegetarian', 'mediterranean',
      'paleo', 'low_carb', 'high_protein', 'plant_based', 'gluten_free', 'dairy_free',
    ]
    for (const e of expected) {
      expect(ALL_DIETARY_APPROACHES).toContain(e)
    }
  })
})
