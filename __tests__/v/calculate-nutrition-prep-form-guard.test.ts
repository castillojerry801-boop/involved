/**
 * Preparation-form guard for synonym-expanded alternatives.
 *
 * Verifies that:
 *   - The cilantro/coriander synonym is removed (no seed-for-herb risk)
 *   - Neutral "oatmeal" cannot resolve via synonym to explicitly dry OR raw oats
 *   - "quick oatmeal" cannot resolve to dry oats just because "quick" matches directly
 *   - Cooked oatmeal → cooked oats continues to work (guard does not over-fire)
 *   - Explicit dry/raw/cooked requests are unaffected
 *   - Same-form regional synonyms (arugula/rocket, eggplant/aubergine, zucchini/courgette)
 *     are not affected even when the USDA food name contains "raw"
 *   - matchedViaSynonymOnly only considers base-form synonym keys (SYNONYM_BASE_FORM_KEYS)
 *   - synonymExpandedDryFormConflict correctly uses extractPrepState for both raw and dry
 *
 * IMPORTANT: No nutrition values are asserted or hardcoded. Tests cover guard
 * logic and vocabulary routing only.
 */

import { describe, it, expect } from 'vitest'
import {
  matchedViaSynonymOnly,
  synonymExpandedDryFormConflict,
  extractPrepState,
  topMatchPassesIdentityCheck,
} from '../../lib/v/tools/calculate-nutrition'
import {
  tokenSynonyms,
  tokenHitsText,
  tokenHitsTextExpanded,
  passesQualityGate,
  SYNONYM_BASE_FORM_KEYS,
} from '../../lib/nutrition/search-utils'
import type { ExternalFoodResult } from '../../lib/nutrition/providers/types'

function makeResult(name: string, provider = 'usda_fooddata'): ExternalFoodResult {
  return {
    provider,
    externalId: `${provider}-${name.replace(/\s+/g, '-').toLowerCase()}`,
    name,
    servingSize: 100,
    servingUnit: 'g',
    coreNutrients: { calories: 70, proteinG: 3, carbohydrateG: 10, fatG: 1 },
    isGeneric: true,
  }
}

// ── 1. Cilantro/coriander synonym removal ─────────────────────────────────────

describe('cilantro/coriander synonym removal', () => {
  it('cilantro has no synonym entries', () => {
    expect(tokenSynonyms('cilantro')).toHaveLength(0)
  })

  it('"cilantro" does not hit "Coriander, leaves, raw" via synonym', () => {
    expect(tokenHitsTextExpanded('cilantro', 'Coriander, leaves, raw')).toBe(false)
  })

  it('"cilantro" does not hit "Spices, coriander seed" via synonym', () => {
    expect(tokenHitsTextExpanded('cilantro', 'Spices, coriander seed')).toBe(false)
  })

  it('"fresh cilantro" fails quality gate for "Spices, coriander seed"', () => {
    const seed = makeResult('Spices, coriander seed')
    expect(passesQualityGate(seed, 'fresh cilantro')).toBe(false)
  })

  it('"cilantro" fails quality gate for "Spices, coriander seed"', () => {
    const seed = makeResult('Spices, coriander seed')
    expect(passesQualityGate(seed, 'cilantro')).toBe(false)
  })

  it('direct cilantro name still matches "Cilantro, raw" (no synonym needed)', () => {
    const fresh = makeResult('Cilantro, raw')
    expect(passesQualityGate(fresh, 'cilantro')).toBe(true)
    expect(passesQualityGate(fresh, 'fresh cilantro')).toBe(true)
  })
})

// ── 2. SYNONYM_BASE_FORM_KEYS structure ──────────────────────────────────────

describe('SYNONYM_BASE_FORM_KEYS', () => {
  it('oatmeal is a base-form key (cooked form ↔ dry grain)', () => {
    expect(SYNONYM_BASE_FORM_KEYS.has('oatmeal')).toBe(true)
  })

  it('same-form regional synonyms are NOT base-form keys', () => {
    expect(SYNONYM_BASE_FORM_KEYS.has('arugula')).toBe(false)
    expect(SYNONYM_BASE_FORM_KEYS.has('eggplant')).toBe(false)
    expect(SYNONYM_BASE_FORM_KEYS.has('zucchini')).toBe(false)
  })

  it('modifier words are NOT base-form keys', () => {
    expect(SYNONYM_BASE_FORM_KEYS.has('quick')).toBe(false)
    expect(SYNONYM_BASE_FORM_KEYS.has('instant')).toBe(false)
    expect(SYNONYM_BASE_FORM_KEYS.has('rolled')).toBe(false)
  })
})

// ── 3. matchedViaSynonymOnly — base-form key semantics ────────────────────────

describe('matchedViaSynonymOnly', () => {
  it('"oatmeal" → "Oats, rolled, dry": base-form key hits via synonym only → true', () => {
    expect(tokenHitsText('oatmeal', 'Oats, rolled, dry')).toBe(false)
    expect(matchedViaSynonymOnly('oatmeal', 'Oats, rolled, dry')).toBe(true)
  })

  it('"quick oatmeal" → "Oats, quick, dry": modifier "quick" direct hit does NOT suppress guard', () => {
    // "quick" hits directly but it is not a base-form synonym key — does not disable the guard
    // "oatmeal" is the base-form key and only matches via synonym
    expect(tokenHitsText('quick', 'Oats, quick, dry')).toBe(true)
    expect(SYNONYM_BASE_FORM_KEYS.has('quick')).toBe(false)
    expect(matchedViaSynonymOnly('quick oatmeal', 'Oats, quick, dry')).toBe(true)
  })

  it('"instant oatmeal" → "Oats, instant, dry": modifier "instant" does not suppress guard', () => {
    expect(matchedViaSynonymOnly('instant oatmeal', 'Oats, instant, dry')).toBe(true)
  })

  it('"oatmeal" → "Cereals, oats, raw": base-form key hits via synonym only → true', () => {
    expect(matchedViaSynonymOnly('oatmeal', 'Cereals, oats, raw')).toBe(true)
  })

  it('"arugula" → "Rocket, raw": arugula is same-form key, not in SYNONYM_BASE_FORM_KEYS → false', () => {
    // arugula and rocket are regional names for the identical food, not prepared vs base
    expect(SYNONYM_BASE_FORM_KEYS.has('arugula')).toBe(false)
    expect(matchedViaSynonymOnly('arugula', 'Rocket, raw')).toBe(false)
  })

  it('"zucchini" → "Courgette, boiled": same-form key → false', () => {
    expect(matchedViaSynonymOnly('zucchini', 'Courgette, boiled')).toBe(false)
  })

  it('"chicken breast" → "Chicken, raw": neither token is a base-form key → false', () => {
    expect(matchedViaSynonymOnly('chicken breast', 'Chicken, raw')).toBe(false)
  })

  it('returns false when no synonym key is present at all', () => {
    expect(matchedViaSynonymOnly('spinach', 'Spinach, raw')).toBe(false)
    expect(matchedViaSynonymOnly('brown rice', 'Rice, brown, cooked')).toBe(false)
  })
})

// ── 4. synonymExpandedDryFormConflict — dry AND raw forms ─────────────────────

describe('synonymExpandedDryFormConflict — fires for both dry and raw forms', () => {
  it('fires for neutral "oatmeal" → "Oats, rolled, dry"', () => {
    expect(extractPrepState('oatmeal')).toBe('neutral')
    expect(extractPrepState('Oats, rolled, dry')).toBe('raw_or_dry')
    expect(synonymExpandedDryFormConflict('oatmeal', 'Oats, rolled, dry')).toBe(true)
  })

  it('fires for neutral "quick oatmeal" → "Oats, quick, dry" (key fix: "quick" must not suppress)', () => {
    expect(extractPrepState('quick oatmeal')).toBe('neutral')
    expect(synonymExpandedDryFormConflict('quick oatmeal', 'Oats, quick, dry')).toBe(true)
  })

  it('fires for neutral "oatmeal" → "Cereals, oats, raw" (extended: raw form also blocked)', () => {
    expect(extractPrepState('Cereals, oats, raw')).toBe('raw_or_dry')
    expect(synonymExpandedDryFormConflict('oatmeal', 'Cereals, oats, raw')).toBe(true)
  })

  it('does NOT fire for "cooked oatmeal" → dry oats (request is cooked, not neutral)', () => {
    expect(extractPrepState('cooked oatmeal')).toBe('cooked')
    expect(synonymExpandedDryFormConflict('cooked oatmeal', 'Oats, rolled, dry')).toBe(false)
  })

  it('does NOT fire when request explicitly states "dry" (request prep is raw_or_dry)', () => {
    expect(extractPrepState('dry oats')).toBe('raw_or_dry')
    expect(synonymExpandedDryFormConflict('dry oats', 'Oats, rolled, dry')).toBe(false)
  })

  it('does NOT fire when request explicitly states "raw"', () => {
    expect(extractPrepState('raw oats')).toBe('raw_or_dry')
    expect(synonymExpandedDryFormConflict('raw oats', 'Cereals, oats, raw')).toBe(false)
  })

  it('does NOT fire when alt is cooked/neutral (no raw_or_dry prep state)', () => {
    expect(synonymExpandedDryFormConflict('oatmeal', 'Cereals, oats, cooked with water')).toBe(false)
    expect(synonymExpandedDryFormConflict('oatmeal', 'Oatmeal, Multigrain')).toBe(false)
  })

  it('does NOT fire for "arugula" → "Rocket, raw" (same-form synonym, not base-form)', () => {
    // arugula and rocket are the same food — "raw" is the natural state, not a dry grain form
    expect(synonymExpandedDryFormConflict('arugula', 'Rocket, raw')).toBe(false)
  })

  it('does NOT fire for "eggplant" → "Aubergine, raw" (same-form synonym)', () => {
    expect(synonymExpandedDryFormConflict('eggplant', 'Aubergine, raw')).toBe(false)
  })

  it('does NOT fire for "zucchini" → "Courgette, boiled"', () => {
    expect(synonymExpandedDryFormConflict('zucchini', 'Courgette, boiled')).toBe(false)
  })

  it('does NOT fire for foods with no synonym relationship', () => {
    expect(synonymExpandedDryFormConflict('spinach', 'Spinach, raw')).toBe(false)
    expect(synonymExpandedDryFormConflict('spinach', 'Spinach, dry')).toBe(false)
  })
})

// ── 5. Valid cooked oatmeal path is preserved ─────────────────────────────────

describe('valid cooked oatmeal path is preserved', () => {
  it('"cooked oatmeal" → cooked oats: quality gate still passes', () => {
    const cookedOats = makeResult('Cereals, oats, regular and quick, cooked with water, without salt')
    expect(passesQualityGate(cookedOats, 'cooked oatmeal')).toBe(true)
  })

  it('"cooked oatmeal" → cooked oats: prep-form conflict does NOT fire (cooked request)', () => {
    expect(synonymExpandedDryFormConflict('cooked oatmeal', 'Cereals, oats, regular and quick, cooked with water')).toBe(false)
  })

  it('"cooked oatmeal" → cooked oats: topMatchPassesIdentityCheck passes (cooked == cooked)', () => {
    expect(topMatchPassesIdentityCheck('cooked oatmeal', 'Cereals, oats, regular and quick, cooked with water')).toBe(true)
  })

  it('"cooked oatmeal" → dry oats: existing Guard 5 still rejects (cooked ≠ raw_or_dry)', () => {
    expect(extractPrepState('cooked oatmeal')).toBe('cooked')
    expect(extractPrepState('Oats, rolled, dry')).toBe('raw_or_dry')
    expect(topMatchPassesIdentityCheck('cooked oatmeal', 'Oats, rolled, dry')).toBe(false)
  })
})

// ── 6. Regional synonym pairs are unaffected ──────────────────────────────────

describe('regional food synonyms continue working', () => {
  it('arugula/rocket: quality gate passes for "arugula" query', () => {
    const rocket = makeResult('Rocket salad leaves')
    expect(passesQualityGate(rocket, 'arugula')).toBe(true)
  })

  it('arugula/rocket: guard does not fire for any rocket alt (raw or cooked)', () => {
    expect(synonymExpandedDryFormConflict('arugula', 'Rocket salad leaves')).toBe(false)
    expect(synonymExpandedDryFormConflict('arugula', 'Rocket, raw')).toBe(false)
  })

  it('eggplant/aubergine: quality gate passes for "eggplant" query', () => {
    const aubergine = makeResult('Aubergine, raw')
    expect(passesQualityGate(aubergine, 'eggplant')).toBe(true)
  })

  it('zucchini/courgette: quality gate passes for "zucchini" query', () => {
    const courgette = makeResult('Courgette, boiled')
    expect(passesQualityGate(courgette, 'zucchini')).toBe(true)
  })

  it('all three same-form pairs: synonymExpandedDryFormConflict returns false', () => {
    expect(synonymExpandedDryFormConflict('arugula', 'Rocket, raw')).toBe(false)
    expect(synonymExpandedDryFormConflict('eggplant', 'Aubergine, raw')).toBe(false)
    expect(synonymExpandedDryFormConflict('zucchini', 'Courgette, boiled')).toBe(false)
  })
})

// ── 7. Existing preparation and portion-size guards are preserved ─────────────

describe('existing guards are unaffected', () => {
  it('Guard 5: raw-form foods are rejected for explicitly cooked requests', () => {
    expect(topMatchPassesIdentityCheck('grilled salmon', 'Salmon, Atlantic, wild, raw')).toBe(false)
    expect(topMatchPassesIdentityCheck('cooked chicken breast', 'Chicken, broilers, raw')).toBe(false)
  })

  it('Guard 5: does not reject raw for neutral requests (only fires when both non-neutral)', () => {
    expect(topMatchPassesIdentityCheck('chicken breast', 'Chicken, broilers, raw')).toBe(true)
  })

  it('Guard 2: juice form is rejected for whole-food request', () => {
    expect(topMatchPassesIdentityCheck('orange', 'Orange juice, chilled')).toBe(false)
  })

  it('Guard 1: compound dish rejected for standalone ingredient', () => {
    expect(topMatchPassesIdentityCheck('salmon', 'Salmon and Broccoli Bowl')).toBe(false)
    expect(topMatchPassesIdentityCheck('chicken', 'Chicken Bowl with Rice')).toBe(false)
  })

  it('Guard 5 (topMatch): cooked request rejects raw topMatch and vice versa', () => {
    expect(topMatchPassesIdentityCheck('grilled chicken', 'Chicken, raw')).toBe(false)
    expect(topMatchPassesIdentityCheck('raw chicken', 'Chicken, grilled')).toBe(false)
  })
})
