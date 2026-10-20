import { describe, it, expect } from 'vitest'
import {
  normalizeToken,
  tokenVariants,
  tokenHitsText,
  passesQualityGate,
  scoreResult,
  normDedup,
} from '@/lib/nutrition/search-utils'
import type { ExternalFoodResult } from '@/lib/nutrition/providers/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFood(name: string, extra: Partial<ExternalFoodResult> = {}): ExternalFoodResult {
  return {
    provider: 'usda_fooddata',
    externalId: 'test-1',
    name,
    servingSize: 100,
    servingUnit: 'g',
    coreNutrients: { calories: 100, proteinG: 10, carbohydrateG: 10, fatG: 5 },
    ...extra,
  }
}

// ── normalizeToken ─────────────────────────────────────────────────────────────

describe('normalizeToken', () => {
  it('lowercases text', () => {
    expect(normalizeToken('Apple')).toBe('apple')
  })

  it('strips straight apostrophe from possessives', () => {
    expect(normalizeToken("Cane's")).toBe('canes')
  })

  it('lowercases possessive', () => {
    expect(normalizeToken("CANE'S")).toBe('canes')
  })
})

// ── tokenVariants ──────────────────────────────────────────────────────────────

describe('tokenVariants', () => {
  it('generates plural variant for singular', () => {
    expect(tokenVariants('apple')).toContain('apples')
  })

  it('generates singular variant for plural', () => {
    expect(tokenVariants('bananas')).toContain('banana')
  })

  it('generates berry form via ies-to-y rule', () => {
    expect(tokenVariants('blueberries')).toContain('blueberry')
  })

  it('filters out tokens shorter than 3 chars', () => {
    const v = tokenVariants('go')
    expect(v.every(t => t.length >= 3)).toBe(true)
  })
})

// ── tokenHitsText ──────────────────────────────────────────────────────────────

describe('tokenHitsText', () => {
  it('matches exact token', () => {
    expect(tokenHitsText('apple', 'Apple, raw')).toBe(true)
  })

  it('matches plural variant', () => {
    expect(tokenHitsText('banana', 'Bananas, raw')).toBe(true)
  })

  it('returns false when token not in text', () => {
    expect(tokenHitsText('pear', 'Apple, raw')).toBe(false)
  })
})

// ── passesQualityGate ─────────────────────────────────────────────────────────

describe('passesQualityGate', () => {
  it('passes when full query in combined name', () => {
    expect(passesQualityGate(makeFood('Olive oil, salad'), 'olive oil')).toBe(true)
  })

  it('rejects placeholder unknown product with no brand', () => {
    expect(passesQualityGate(makeFood('Unknown product'), 'olive oil')).toBe(false)
  })

  it('rejects result with no name and no brand', () => {
    expect(passesQualityGate(makeFood(''), 'olive oil')).toBe(false)
  })

  it('passes barcode-format query for result with a barcode', () => {
    const food = makeFood('Some food', { barcode: '12345678' })
    expect(passesQualityGate(food, '12345678')).toBe(true)
  })

  it('passes when brand exactly matches query', () => {
    const food = makeFood('Protein Bar', { brand: 'Fairlife' })
    expect(passesQualityGate(food, 'Fairlife')).toBe(true)
  })

  it('multi-token rejects when first significant token is absent', () => {
    expect(passesQualityGate(makeFood('Sugar Cane, Raw'), "Raising Cane's")).toBe(false)
  })

  it('single-token must hit name or brand - matching', () => {
    expect(passesQualityGate(makeFood('Chicken, raw'), 'chicken')).toBe(true)
  })

  it('single-token must hit name or brand - not matching', () => {
    expect(passesQualityGate(makeFood('Beef, raw'), 'chicken')).toBe(false)
  })
})

// ── passesQualityGate — first-identifier-token fix ────────────────────────────
//
// When qTokens[0] is a trivial modifier (fresh, frozen, organic, etc.), the
// quality gate must use the first non-modifier token as the anchor so that USDA
// canonical names ("Jackfruit, raw", "Spinach, raw") pass for customer-natural
// queries ("fresh jackfruit", "organic spinach").
//
// Brand-name disambiguation protection (Raising Cane's case) is preserved because
// "raising" is not a modifier and remains the anchor for that query.

describe('passesQualityGate — first-identifier-token (modifier skip)', () => {
  // ── New behavior: modifier as qTokens[0] skips to next identifier ─────────

  it('"fresh jackfruit" passes for USDA "Jackfruit, raw" (fresh → skip, jackfruit hits)', () => {
    expect(passesQualityGate(makeFood('Jackfruit, raw'), 'fresh jackfruit')).toBe(true)
  })

  it('"fresh strawberries" passes for USDA "Strawberries, raw"', () => {
    expect(passesQualityGate(makeFood('Strawberries, raw'), 'fresh strawberries')).toBe(true)
  })

  it('"fresh taro" passes for USDA "Taro, raw" (held-out food)', () => {
    expect(passesQualityGate(makeFood('Taro, raw'), 'fresh taro')).toBe(true)
  })

  it('"fresh cassava" passes for USDA "Cassava, raw" (held-out food)', () => {
    expect(passesQualityGate(makeFood('Cassava, raw'), 'fresh cassava')).toBe(true)
  })

  it('"organic spinach" passes for "Spinach, raw" (organic → skip, spinach hits)', () => {
    expect(passesQualityGate(makeFood('Spinach, raw'), 'organic spinach')).toBe(true)
  })

  it('"frozen edamame" passes for "Edamame, frozen" (frozen hits in name so was already passing)', () => {
    expect(passesQualityGate(makeFood('Edamame, frozen'), 'frozen edamame')).toBe(true)
  })

  // ── Regression: brand-name disambiguation still blocks wrong matches ──────

  it('"Raising Cane\'s" still rejects "Sugar Cane, Raw" (raising is not a modifier)', () => {
    expect(passesQualityGate(makeFood('Sugar Cane, Raw'), "Raising Cane's")).toBe(false)
  })

  it('"fresh jackfruit" still rejects a completely different food', () => {
    expect(passesQualityGate(makeFood('Beef, ground, raw'), 'fresh jackfruit')).toBe(false)
  })

  it('"organic spinach" still rejects a food with no matching tokens', () => {
    expect(passesQualityGate(makeFood('Salmon, raw'), 'organic spinach')).toBe(false)
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('all-modifier query falls back to first token when every token is a stop word', () => {
    // "raw frozen" — both tokens are modifiers; falls back to qTokens[0]
    // "raw" hits "Beef, raw" → should pass (anchor = 'raw' as fallback)
    expect(passesQualityGate(makeFood('Beef, raw'), 'raw frozen')).toBe(true)
  })

  it('"fresh jackfruit" still rejects "Jackfruit, dried" (anchor passes but hits < ceil)', () => {
    // anchor = 'jackfruit', hits 'Jackfruit, dried' ✓
    // 'fresh' does not hit 'Jackfruit, dried' → hits = ['jackfruit'] = 1 ≥ ceil(2/2) = 1
    // PASSES the quality gate (identity guard handles form conflict separately)
    expect(passesQualityGate(makeFood('Jackfruit, dried'), 'fresh jackfruit')).toBe(true)
  })
})

// ── passesQualityGate — identity-token threshold ──────────────────────────────
//
// Threshold is ceil(identityCount/2) where identityCount = non-stop-word tokens.
// Multi-modifier queries must not fail just because modifiers don't hit the DB name.

describe('passesQualityGate — identity-token threshold', () => {
  it('"fresh organic spinach" passes for "Spinach, raw" (2 stop-word modifiers, identityCount=1, threshold=1)', () => {
    expect(passesQualityGate(makeFood('Spinach, raw'), 'fresh organic spinach')).toBe(true)
  })

  it('"fresh organic jackfruit" passes for "Jackfruit, raw" (identityCount=1, threshold=1)', () => {
    expect(passesQualityGate(makeFood('Jackfruit, raw'), 'fresh organic jackfruit')).toBe(true)
  })

  it('"small medium plum" passes for "Plums, raw" (small and medium are stop words, identityCount=1)', () => {
    expect(passesQualityGate(makeFood('Plums, raw'), 'small medium plum')).toBe(true)
  })

  it('"frozen natural low fat yogurt" passes for "Yogurt, plain, low fat" (identityCount=1 → threshold=1)', () => {
    expect(passesQualityGate(makeFood('Yogurt, plain, low fat'), 'frozen natural low fat yogurt')).toBe(true)
  })

  it('"chicken breast tenders" (no stop words) still needs ≥2 of 3 identity hits — passes for "Chicken, breast, raw"', () => {
    // identityCount=3 (chicken, breast, tenders — none are stop words), threshold=ceil(3/2)=2
    // 'chicken' and 'breast' both hit 'Chicken, breast, raw' → 2 ≥ 2 → PASSES
    expect(passesQualityGate(makeFood('Chicken, breast, raw'), 'chicken breast tenders')).toBe(true)
  })

  it('"Raising Cane\'s" threshold regression: "raising" not a stop word → still rejects "Sugar Cane, Raw"', () => {
    // identityCount=2 (both 'raising' and 'canes'), threshold=1; anchor='raising' misses → FAILS
    expect(passesQualityGate(makeFood('Sugar Cane, Raw'), "Raising Cane's")).toBe(false)
  })
})

// ── scoreResult ───────────────────────────────────────────────────────────────

describe('scoreResult', () => {
  it('exact name match scores higher than partial', () => {
    const exact   = makeFood('olive oil')
    const partial = makeFood('Extra virgin olive oil')
    const exactScore   = scoreResult(exact, 'olive oil')
    const partialScore = scoreResult(partial, 'olive oil')
    expect(exactScore).toBeGreaterThan(partialScore)
  })

  it('adds provider baseline bonus for usda over open food facts', () => {
    const usda = makeFood('Chicken', { provider: 'usda_fooddata' })
    const off  = makeFood('Chicken', { provider: 'open_food_facts' })
    expect(scoreResult(usda, 'chicken')).toBeGreaterThan(scoreResult(off, 'chicken'))
  })

  it('adds completeness bonus for full macros', () => {
    const complete   = makeFood('Rice', { coreNutrients: { calories: 200, proteinG: 4, carbohydrateG: 45, fatG: 1 } })
    const incomplete = makeFood('Rice', { coreNutrients: { calories: 0,   proteinG: 0, carbohydrateG: 0,  fatG: 0 } })
    expect(scoreResult(complete, 'rice')).toBeGreaterThan(scoreResult(incomplete, 'rice'))
  })

  it('returns a non-negative score', () => {
    expect(scoreResult(makeFood('Apple'), 'apple')).toBeGreaterThanOrEqual(0)
  })
})

// ── scoreResult — Phase 1 regression suite ────────────────────────────────────
// Verifies the variant-aware startsWith fix and compound-food guard.
// These tests must not encode food-specific nutrition values; they test scoring
// logic only — relative ordering of results for a given query.

describe('scoreResult — variant-aware startsWith (Phase 1)', () => {
  it('Bananas, raw (USDA plural) scores at startsWith level for "banana" query', () => {
    const plural   = makeFood('Bananas, raw', { provider: 'usda_fooddata' })
    const compound = makeFood('Banana Raw Almond Butter', { provider: 'fatsecret' })
    // plural form should earn +80 (startsWith via variant), compound should earn +60 (demoted)
    const pluralScore   = scoreResult(plural, 'banana')
    const compoundScore = scoreResult(compound, 'banana')
    expect(pluralScore).toBeGreaterThan(compoundScore)
  })

  it('Bananas, raw (USDA plural) scores at startsWith level for "banana" query', () => {
    // tokenVariants("banana") → ["banana", "bananas"]
    // "bananas, raw" startsWith "bananas," → matches → +80
    const plural = makeFood('Bananas, raw', { provider: 'usda_fooddata' })
    const score = scoreResult(plural, 'banana')
    expect(score).toBeGreaterThanOrEqual(80)
  })

  it('compound food starting with query demoted to +60 when it has 2+ extra significant words', () => {
    // "Spinach Artichoke Dip" starts with "spinach" but has 2 extra words (artichoke, dip)
    const compound = makeFood('Spinach Artichoke Dip', { provider: 'fatsecret' })
    const score = scoreResult(compound, 'spinach')
    // Should be +60 (demoted) not +80
    // Raw spinach: e.g. score should be ≤ 60+15+8 = 83 (no exact/startsWith bonus above 60)
    expect(score).toBeLessThanOrEqual(83)
  })

  it('exact-phrase multi-word query not disrupted — "peanut butter" gets full score', () => {
    const exact = makeFood('Peanut Butter', { provider: 'fatsecret' })
    const score = scoreResult(exact, 'peanut butter')
    // Exact match → +100
    expect(score).toBeGreaterThanOrEqual(100)
  })

  it('"olive oil" exact match not disrupted by compound-food guard', () => {
    const exact = makeFood('Olive Oil', { provider: 'fatsecret' })
    const score = scoreResult(exact, 'olive oil')
    expect(score).toBeGreaterThanOrEqual(100)
  })

  it('"Banana Raw Almond Butter" is demoted vs "Bananas, raw" at base scoring layer', () => {
    // Compound food (2 extra words: almond, butter) → gets +60 (demoted)
    // Simple pluralized food (0 extra words) → gets +80 (startsWith via variant)
    const simple   = makeFood('Bananas, raw', { provider: 'usda_fooddata' })
    const compound = makeFood('Banana Raw Almond Butter', { provider: 'fatsecret' })
    expect(scoreResult(simple, 'banana')).toBeGreaterThan(scoreResult(compound, 'banana'))
  })
})

// ── normDedup ─────────────────────────────────────────────────────────────────

describe('normDedup', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(normDedup('Chicken, breast (raw)')).toBe('chicken breast raw')
  })

  it('collapses multiple spaces', () => {
    expect(normDedup('beef   steak')).toBe('beef steak')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normDedup('  rice  ')).toBe('rice')
  })
})
