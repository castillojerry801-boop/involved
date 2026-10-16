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
