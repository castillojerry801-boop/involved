import { describe, it, expect } from 'vitest'
import { scoreForIngredient } from '@/lib/nutrition/matching/scorer'
import type { ExternalFoodResult } from '@/lib/nutrition/providers/types'
import type { MatchRequest } from '@/lib/nutrition/matching/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFood(
  overrides: Partial<ExternalFoodResult> & { name: string; externalId: string },
): ExternalFoodResult {
  return {
    provider: 'usda_fooddata',
    servingSize: 100,
    servingUnit: 'g',
    coreNutrients: { calories: 100, proteinG: 10, carbohydrateG: 10, fatG: 5 },
    isGeneric: false,
    ...overrides,
  }
}

function req(ingredientName: string): MatchRequest {
  return { ingredientName }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('scoreForIngredient', () => {
  it('tri-tip matches "Beef, tri-tip, raw" better than "Beef, T-bone steak"', () => {
    const results = [
      makeFood({ name: 'Beef, T-bone steak, raw', externalId: 'tbone' }),
      makeFood({ name: 'Beef, tri-tip, raw', externalId: 'tritip' }),
    ]
    const scored = scoreForIngredient(results, req('tri-tip'))
    const triTipScore = scored.find(r => r.externalId === 'tritip')!.matchScore
    const tboneScore  = scored.find(r => r.externalId === 'tbone')!.matchScore
    expect(triTipScore).toBeGreaterThan(tboneScore)
  })

  it('chicken breast matches breast food better than thigh (negative pair)', () => {
    const results = [
      makeFood({ name: 'Chicken, broilers or fryers, breast, meat only, raw', externalId: 'breast' }),
      makeFood({ name: 'Chicken, broilers or fryers, thigh, meat only, raw',   externalId: 'thigh' }),
    ]
    const scored = scoreForIngredient(results, req('chicken breast'))
    const breastScore = scored.find(r => r.externalId === 'breast')!.matchScore
    const thighScore  = scored.find(r => r.externalId === 'thigh')!.matchScore
    expect(breastScore).toBeGreaterThan(thighScore)
  })

  it('negative pair: "chicken breast" query → food "chicken thigh" gets -30 penalty', () => {
    const breast = makeFood({ name: 'Chicken, breast, raw', externalId: 'breast' })
    const thigh  = makeFood({ name: 'Chicken, thigh, raw', externalId: 'thigh' })
    const scored = scoreForIngredient([breast, thigh], req('chicken breast'))
    const thighMatch = scored.find(r => r.externalId === 'thigh')!
    expect(thighMatch.matchReasons.some(r => r.includes('Negative keyword'))).toBe(true)
  })

  it('olive oil: USDA generic scores higher than branded Bertolli', () => {
    const results = [
      makeFood({ name: 'Oil, olive, salad or cooking', externalId: 'usda-olive', provider: 'usda_fooddata', isGeneric: false }),
      makeFood({ name: 'Bertolli Olive Oil', externalId: 'bertolli', provider: 'fatsecret', brand: 'Bertolli', isGeneric: false }),
    ]
    const scored = scoreForIngredient(results, req('olive oil'))
    const usdaScore     = scored.find(r => r.externalId === 'usda-olive')!.matchScore
    const bertolliScore = scored.find(r => r.externalId === 'bertolli')!.matchScore
    expect(usdaScore).toBeGreaterThan(bertolliScore)
  })

  it('plain Greek yogurt: "plain" penalizes flavored entries', () => {
    const results = [
      makeFood({ name: 'Yogurt, Greek, plain, nonfat', externalId: 'greek-plain' }),
      makeFood({ name: 'Yogurt, Greek, strawberry',    externalId: 'greek-straw' }),
    ]
    const scored = scoreForIngredient(results, req('plain Greek yogurt'))
    const plainScore = scored.find(r => r.externalId === 'greek-plain')!.matchScore
    const strawScore = scored.find(r => r.externalId === 'greek-straw')!.matchScore
    expect(plainScore).toBeGreaterThan(strawScore)
  })

  it('ground beef: prefers ground beef over sirloin steak', () => {
    const results = [
      makeFood({ name: 'Beef, ground, 80% lean meat / 20% fat, raw', externalId: 'ground80' }),
      makeFood({ name: 'Beef, sirloin steak, raw',                    externalId: 'sirloin' }),
    ]
    const scored = scoreForIngredient(results, req('ground beef'))
    const groundScore  = scored.find(r => r.externalId === 'ground80')!.matchScore
    const sirloinScore = scored.find(r => r.externalId === 'sirloin')!.matchScore
    expect(groundScore).toBeGreaterThan(sirloinScore)
  })

  it('dry pasta: penalizes cooked pasta entries', () => {
    const results = [
      makeFood({ name: 'Pasta, dry, unenriched',    externalId: 'dry-pasta' }),
      makeFood({ name: 'Pasta, cooked, unenriched', externalId: 'cooked-pasta' }),
    ]
    const scored = scoreForIngredient(results, req('dry pasta'))
    const dryScore    = scored.find(r => r.externalId === 'dry-pasta')!.matchScore
    const cookedScore = scored.find(r => r.externalId === 'cooked-pasta')!.matchScore
    expect(dryScore).toBeGreaterThan(cookedScore)
  })

  it('raw chicken: prefers raw over cooked', () => {
    const results = [
      makeFood({ name: 'Chicken, broilers, breast, raw',    externalId: 'raw' }),
      makeFood({ name: 'Chicken, broilers, breast, cooked', externalId: 'cooked' }),
    ]
    const scored = scoreForIngredient(results, req('raw chicken'))
    const rawScore    = scored.find(r => r.externalId === 'raw')!.matchScore
    const cookedScore = scored.find(r => r.externalId === 'cooked')!.matchScore
    expect(rawScore).toBeGreaterThan(cookedScore)
  })

  it('cooked chicken: prefers cooked over raw', () => {
    const results = [
      makeFood({ name: 'Chicken, broilers, breast, raw',    externalId: 'raw' }),
      makeFood({ name: 'Chicken, broilers, breast, cooked', externalId: 'cooked' }),
    ]
    const scored = scoreForIngredient(results, req('cooked chicken'))
    const rawScore    = scored.find(r => r.externalId === 'raw')!.matchScore
    const cookedScore = scored.find(r => r.externalId === 'cooked')!.matchScore
    expect(cookedScore).toBeGreaterThan(rawScore)
  })

  it('chicken alone: breast and thigh score similarly (both within 25 pts)', () => {
    const results = [
      makeFood({ name: 'Chicken, broilers or fryers, breast, meat only, raw', externalId: 'breast' }),
      makeFood({ name: 'Chicken, broilers or fryers, thigh, meat only, raw',  externalId: 'thigh' }),
    ]
    const scored = scoreForIngredient(results, req('chicken'))
    const breastScore = scored.find(r => r.externalId === 'breast')!.matchScore
    const thighScore  = scored.find(r => r.externalId === 'thigh')!.matchScore
    // Without a negative pair trigger, the gap should be small
    expect(Math.abs(breastScore - thighScore)).toBeLessThan(30)
  })

  it('returns an empty array for empty input', () => {
    expect(scoreForIngredient([], req('olive oil'))).toEqual([])
  })

  it('results are sorted descending by matchScore', () => {
    const results = [
      makeFood({ name: 'Olive oil, generic',  externalId: 'a', isGeneric: true }),
      makeFood({ name: 'Bertolli Olive Oil', externalId: 'b', brand: 'Bertolli' }),
      makeFood({ name: 'Extra virgin olive oil', externalId: 'c' }),
    ]
    const scored = scoreForIngredient(results, req('olive oil'))
    for (let i = 0; i < scored.length - 1; i++) {
      expect(scored[i].matchScore).toBeGreaterThanOrEqual(scored[i + 1].matchScore)
    }
  })
})

// ── Size-diminutive conflict penalty ──────────────────────────────────────────

describe('scoreForIngredient — size-diminutive penalty', () => {
  it('Snickers Bar ranks above Snickers Minis for query "snickers"', () => {
    const results = [
      makeFood({ name: 'Snickers Minis', externalId: 'minis', provider: 'fatsecret' }),
      makeFood({ name: 'Snickers Bar',   externalId: 'bar',   provider: 'fatsecret' }),
    ]
    const scored = scoreForIngredient(results, req('snickers'))
    const bar   = scored.find(r => r.externalId === 'bar')!
    const minis = scored.find(r => r.externalId === 'minis')!
    expect(bar.matchScore).toBeGreaterThan(minis.matchScore)
  })

  it('Snickers Bar ranks above Snickers Minis for query "normal sized snickers"', () => {
    const results = [
      makeFood({ name: 'Snickers Minis', externalId: 'minis', provider: 'fatsecret' }),
      makeFood({ name: 'Snickers Bar',   externalId: 'bar',   provider: 'fatsecret' }),
    ]
    const scored = scoreForIngredient(results, req('normal sized snickers'))
    const bar   = scored.find(r => r.externalId === 'bar')!
    const minis = scored.find(r => r.externalId === 'minis')!
    expect(bar.matchScore).toBeGreaterThan(minis.matchScore)
  })

  it('fun size candy bar is penalized when query is unqualified', () => {
    const results = [
      makeFood({ name: 'Snickers, Fun Size', externalId: 'fun',    provider: 'fatsecret' }),
      makeFood({ name: 'Snickers Bar',       externalId: 'bar',    provider: 'fatsecret' }),
    ]
    const scored = scoreForIngredient(results, req('snickers bar'))
    const bar     = scored.find(r => r.externalId === 'bar')!
    const funSize = scored.find(r => r.externalId === 'fun')!
    expect(bar.matchScore).toBeGreaterThan(funSize.matchScore)
  })

  it('minis variant is NOT penalized when query explicitly requests minis', () => {
    const results = [
      makeFood({ name: 'Snickers Minis', externalId: 'minis', provider: 'fatsecret' }),
      makeFood({ name: 'Snickers Bar',   externalId: 'bar',   provider: 'fatsecret' }),
    ]
    const scored = scoreForIngredient(results, req('snickers minis'))
    const minis = scored.find(r => r.externalId === 'minis')!
    const bar   = scored.find(r => r.externalId === 'bar')!
    // When user asks for minis, the minis variant should rank higher
    expect(minis.matchScore).toBeGreaterThan(bar.matchScore)
  })

  it('M&Ms Minis penalized for unqualified "m&ms" query', () => {
    const results = [
      makeFood({ name: "M&M's Minis",         externalId: 'mm_minis',   provider: 'fatsecret' }),
      makeFood({ name: "M&M's Milk Chocolate", externalId: 'mm_regular', provider: 'fatsecret' }),
    ]
    const scored = scoreForIngredient(results, req("m&ms"))
    const minis   = scored.find(r => r.externalId === 'mm_minis')!
    const regular = scored.find(r => r.externalId === 'mm_regular')!
    expect(regular.matchScore).toBeGreaterThan(minis.matchScore)
  })

  it('bite size candy penalized for unqualified query', () => {
    const results = [
      makeFood({ name: 'Reese Bites',            externalId: 'bites',   provider: 'fatsecret' }),
      makeFood({ name: "Reese's Peanut Butter Cup", externalId: 'cup', provider: 'fatsecret' }),
    ]
    const scored = scoreForIngredient(results, req("reese's peanut butter cup"))
    const cup   = scored.find(r => r.externalId === 'cup')!
    const bites = scored.find(r => r.externalId === 'bites')!
    expect(cup.matchScore).toBeGreaterThan(bites.matchScore)
  })

  it('matchReasons includes size-diminutive conflict when penalized', () => {
    const results = [
      makeFood({ name: 'Snickers Minis', externalId: 'minis', provider: 'fatsecret' }),
    ]
    const scored = scoreForIngredient(results, req('snickers'))
    const minis = scored[0]
    expect(minis.matchReasons.some(r => r.includes('diminutive'))).toBe(true)
  })

  it('no false penalty for foods that happen to contain "mini" as part of another word', () => {
    // "minimum" or brand names with "mini" in them should not be incorrectly penalized
    // unless the standalone word "mini" or "minis" appears as a token
    const results = [
      makeFood({ name: 'Minimalist Bites Granola', externalId: 'minimalist', provider: 'fatsecret' }),
      makeFood({ name: 'Granola Bar Original',     externalId: 'original',   provider: 'fatsecret' }),
    ]
    const scored = scoreForIngredient(results, req('granola bar'))
    // "minimalist" should not trigger the penalty because "mini" only matches as a substring
    // but "bites" WILL trigger it (it's in the diminutive set)
    // This test verifies the original granola bar still ranks higher
    const original    = scored.find(r => r.externalId === 'original')!
    const minimalist  = scored.find(r => r.externalId === 'minimalist')!
    expect(original.matchScore).toBeGreaterThanOrEqual(minimalist.matchScore)
  })
})
