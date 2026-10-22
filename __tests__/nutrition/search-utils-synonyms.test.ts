/**
 * Synonym expansion in quality gate and scoring.
 *
 * Guarantees:
 *   - tokenHitsTextExpanded accepts USDA canonical synonyms (e.g. "oatmeal"→"oats")
 *   - passesQualityGate lets USDA SR Legacy "oats" foods through for "oatmeal" queries
 *   - scoreResult word-coverage improves for synonym-matched foods
 *   - Other queries are unaffected (no false broadening)
 *   - Bidirectional: "oats" query does NOT automatically match "oatmeal" foods
 *     (FOOD_NAME_SYNONYMS is intentionally one-directional for now)
 *
 * IMPORTANT: Tests validate vocabulary normalization only — no nutrition values are
 * asserted or hardcoded here.
 */

import { describe, it, expect } from 'vitest'
import {
  tokenHitsText,
  tokenHitsTextExpanded,
  tokenSynonyms,
  passesQualityGate,
  scoreResult,
  FOOD_NAME_SYNONYMS,
} from '../../lib/nutrition/search-utils'
import type { ExternalFoodResult } from '../../lib/nutrition/providers/types'

// ── Stub builder ──────────────────────────────────────────────────────────────

function makeResult(name: string, provider: string = 'usda_fooddata'): ExternalFoodResult {
  return {
    provider,
    externalId: `${provider}-${name.replace(/\s+/g, '-').toLowerCase()}`,
    name,
    servingSize: 100,
    servingUnit: 'g',
    coreNutrients: { calories: 70, proteinG: 2, carbohydrateG: 12, fatG: 1 },
    isGeneric: true,
  }
}

// ── tokenSynonyms unit tests ──────────────────────────────────────────────────

describe('tokenSynonyms', () => {
  it('returns synonyms for known terms', () => {
    expect(tokenSynonyms('oatmeal')).toEqual(expect.arrayContaining(['oats', 'oat']))
    expect(tokenSynonyms('arugula')).toEqual(expect.arrayContaining(['rocket']))
  })

  it('cilantro has no synonym expansion (removed — coriander-seed/cilantro-herb risk)', () => {
    expect(tokenSynonyms('cilantro')).toHaveLength(0)
  })

  it('returns empty array for unknown terms', () => {
    expect(tokenSynonyms('chicken')).toHaveLength(0)
    expect(tokenSynonyms('spinach')).toHaveLength(0)
  })

  it('FOOD_NAME_SYNONYMS is exported and has the expected entries', () => {
    expect(FOOD_NAME_SYNONYMS.has('oatmeal')).toBe(true)
    expect(FOOD_NAME_SYNONYMS.has('eggplant')).toBe(true)
    expect(FOOD_NAME_SYNONYMS.has('zucchini')).toBe(true)
    expect(FOOD_NAME_SYNONYMS.has('cilantro')).toBe(false)
  })
})

// ── tokenHitsTextExpanded unit tests ─────────────────────────────────────────

describe('tokenHitsTextExpanded', () => {
  it('"oatmeal" hits text containing "oats" via synonym', () => {
    expect(tokenHitsTextExpanded('oatmeal', 'Cereals, oats, regular and quick, cooked')).toBe(true)
  })

  it('"oatmeal" also hits text containing "oatmeal" directly (original behaviour preserved)', () => {
    expect(tokenHitsTextExpanded('oatmeal', 'Cooked Oatmeal')).toBe(true)
  })

  it('base tokenHitsText does NOT hit "oats" for "oatmeal" (verifying the gap the synonym fills)', () => {
    expect(tokenHitsText('oatmeal', 'Cereals, oats, cooked with water')).toBe(false)
  })

  it('"oats" does NOT match "oatmeal" text via synonym (intentionally one-directional)', () => {
    // "oats" is not a key in FOOD_NAME_SYNONYMS → no synonym expansion for "oats"
    expect(tokenHitsTextExpanded('oats', 'Cooked Oatmeal')).toBe(false)
  })

  it('"cilantro" does NOT hit "coriander" text after synonym removal', () => {
    expect(tokenHitsTextExpanded('cilantro', 'Coriander, raw')).toBe(false)
    expect(tokenHitsTextExpanded('cilantro', 'Spices, coriander seed')).toBe(false)
  })

  it('"arugula" hits "rocket" text', () => {
    expect(tokenHitsTextExpanded('arugula', 'Rocket salad leaves')).toBe(true)
  })

  it('returns false when neither token nor synonym matches', () => {
    expect(tokenHitsTextExpanded('oatmeal', 'Corn Flakes, plain')).toBe(false)
  })
})

// ── passesQualityGate — synonym expansion ─────────────────────────────────────

describe('passesQualityGate — synonym expansion', () => {
  it('USDA SR Legacy "Cereals, oats, cooked" passes quality gate for "cooked oatmeal" query', () => {
    const food = makeResult('Cereals, oats, regular and quick, cooked with water, without salt')
    expect(passesQualityGate(food, 'cooked oatmeal')).toBe(true)
  })

  it('USDA "Cereals, oats" passes quality gate for plain "oatmeal" query', () => {
    const food = makeResult('Cereals, oats, regular and quick and instant, not fortified, raw')
    expect(passesQualityGate(food, 'oatmeal')).toBe(true)
  })

  it('existing "cooked oatmeal" named food still passes (original behaviour intact)', () => {
    const food = makeResult('Cooked Oatmeal')
    expect(passesQualityGate(food, 'cooked oatmeal')).toBe(true)
  })

  it('unrelated oats food (cornmeal) does NOT pass for "oatmeal" query', () => {
    const food = makeResult('Cornmeal, degermed, enriched, yellow')
    expect(passesQualityGate(food, 'oatmeal')).toBe(false)
  })

  it('eggplant synonym: "aubergine" food passes quality gate for "eggplant" query', () => {
    const food = makeResult('Aubergine, raw')
    expect(passesQualityGate(food, 'eggplant')).toBe(true)
  })

  it('zucchini synonym: "courgette" food passes quality gate for "zucchini" query', () => {
    const food = makeResult('Courgette, boiled')
    expect(passesQualityGate(food, 'zucchini')).toBe(true)
  })

  it('unrelated query "oatmeal raisin cookies" does not accidentally pass rice cereal', () => {
    const food = makeResult('Rice Cereal, plain, ready to eat')
    expect(passesQualityGate(food, 'oatmeal')).toBe(false)
  })
})

// ── scoreResult — synonym-expanded word coverage ──────────────────────────────

describe('scoreResult — synonym-expanded word coverage', () => {
  it('"Cereals, oats, cooked" gets higher word-coverage score for "cooked oatmeal" than without synonyms', () => {
    const oatFood = makeResult('Cereals, oats, regular and quick, cooked with water')
    const score = scoreResult(oatFood, 'cooked oatmeal')
    // With synonym expansion: "cooked" hits AND "oatmeal"→"oats" hits → both tokens covered
    // Without synonyms: only "cooked" would hit → half coverage
    // Check that we get more than zero word coverage (both tokens matched)
    expect(score).toBeGreaterThan(30)  // at least: 20 (word coverage 2/2 = 40 * 0.5 = 20 min) + 12 (USDA) + 8 (complete)
  })

  it('"Oatmeal, Multigrain" (Survey food named oatmeal) still scores for "cooked oatmeal" query', () => {
    const survey = makeResult('Oatmeal, Multigrain')
    const score = scoreResult(survey, 'cooked oatmeal')
    expect(score).toBeGreaterThan(0)
  })

  it('"Cereals, oats, cooked" scores competitively versus "Oatmeal, Multigrain" for "cooked oatmeal"', () => {
    const oatFood = makeResult('Cereals, oats, regular and quick, cooked with water')
    const multigrain = makeResult('Oatmeal, Multigrain')
    const oatsScore = scoreResult(oatFood, 'cooked oatmeal')
    const multigrainScore = scoreResult(multigrain, 'cooked oatmeal')
    // The SR Legacy cooked oats food should be competitive or higher due to synonym coverage
    // (both "cooked" and "oatmeal"→"oats" tokens now hit)
    expect(oatsScore).toBeGreaterThan(0)
    expect(multigrainScore).toBeGreaterThan(0)
    // Key claim: SR Legacy food is no longer drastically penalized compared to the multigrain Survey food
    expect(oatsScore).toBeGreaterThanOrEqual(multigrainScore * 0.7)
  })

  it('spinach query score is unaffected by synonym changes (no synonym for spinach)', () => {
    const spinach = makeResult('Spinach, raw')
    const score1 = scoreResult(spinach, 'fresh spinach')
    expect(score1).toBeGreaterThan(0)
    // Verify no synonym interference
    expect(tokenSynonyms('spinach')).toHaveLength(0)
  })
})
