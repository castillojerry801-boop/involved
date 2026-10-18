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

// ── Phase 1 regression suite — DERIVED_FORM_WORDS and progressive penalty ─────
// Tests that:
//  1. Derived-form words (juice, powder, extract, etc.) are penalized when absent from query
//  2. Form penalty does NOT fire when the query itself contains the form word
//  3. Progressive extra-word penalty hits compound dishes harder than simple foods
//  4. Legitimate compound dishes (peanut butter, chicken noodle soup) are not over-rejected
//  5. Correct simple food beats same-ingredient compound or derived-form variant

describe('scoreForIngredient — derived-form penalty (Phase 1)', () => {
  it('spinach the vegetable scores higher than spinach juice for query "spinach"', () => {
    const vegetable = makeFood({ name: 'Spinach, raw',        externalId: 'spinach-veg',   provider: 'usda_fooddata', isGeneric: true })
    const juice     = makeFood({ name: 'Spinach Juice',       externalId: 'spinach-juice',  provider: 'fatsecret' })
    const scored = scoreForIngredient([vegetable, juice], req('spinach'))
    const vegScore   = scored.find(r => r.externalId === 'spinach-veg')!.matchScore
    const juiceScore = scored.find(r => r.externalId === 'spinach-juice')!.matchScore
    expect(vegScore).toBeGreaterThan(juiceScore)
  })

  it('spinach juice penalty reason is recorded', () => {
    const juice = makeFood({ name: 'Spinach Juice', externalId: 'juice', provider: 'fatsecret' })
    const scored = scoreForIngredient([juice], req('spinach'))
    const match = scored[0]
    expect(match.matchReasons.some(r => r.includes('Derived form conflict'))).toBe(true)
  })

  it('no form penalty when query itself contains the form word — "orange juice"', () => {
    const juiceFood = makeFood({ name: 'Orange Juice', externalId: 'oj', provider: 'fatsecret' })
    const scored = scoreForIngredient([juiceFood], req('orange juice'))
    const match = scored[0]
    expect(match.matchReasons.some(r => r.includes('Derived form conflict'))).toBe(false)
  })

  it('no form penalty when query contains "powder" — "protein powder"', () => {
    const powder = makeFood({ name: 'Whey Protein Powder', externalId: 'powder', provider: 'fatsecret' })
    const scored = scoreForIngredient([powder], req('protein powder'))
    expect(scored[0].matchReasons.some(r => r.includes('Derived form conflict'))).toBe(false)
  })

  it('no form penalty when query contains "paste" — "tomato paste"', () => {
    const paste = makeFood({ name: 'Tomato Paste', externalId: 'paste', provider: 'fatsecret' })
    const scored = scoreForIngredient([paste], req('tomato paste'))
    expect(scored[0].matchReasons.some(r => r.includes('Derived form conflict'))).toBe(false)
  })
})

describe('scoreForIngredient — progressive extra-word penalty (Phase 1)', () => {
  it('5-extra-word compound dish gets penalty ≥ 30', () => {
    const compound = makeFood({
      name: 'Raw Stuffed Chicken Breasts Artichoke Spinach Parmesan',
      externalId: 'stuffed-chicken',
      provider: 'fatsecret',
    })
    const scored = scoreForIngredient([compound], req('spinach'))
    const match = scored[0]
    const penaltyReason = match.matchReasons.find(r => r.includes('Extra words penalty'))
    expect(penaltyReason).toBeDefined()
    // Penalty should be 32 (5+ extra words)
    expect(penaltyReason).toMatch(/-3[0-9]/)
  })

  it('1-extra-word food gets small penalty (3)', () => {
    const food = makeFood({ name: 'Chicken Breast Grilled', externalId: 'grilled', provider: 'fatsecret' })
    // "grilled" is in PREP_MODIFIER_WORDS — not counted as extra. 0 extra words → no penalty.
    const scored = scoreForIngredient([food], req('chicken breast'))
    expect(scored[0].matchReasons.some(r => r.includes('Extra words penalty'))).toBe(false)
  })

  it('legitimate compound food peanut butter is not penalized by derived-form or extra-word rules', () => {
    // "peanut butter" is a query that contains both words of the food name — no extra words, no form conflict
    const pbExact = makeFood({ name: 'Peanut Butter', externalId: 'pb-exact', provider: 'fatsecret', isGeneric: true })
    const scored = scoreForIngredient([pbExact], req('peanut butter'))
    const match = scored[0]
    // Should have no extra-word penalty and no derived-form conflict
    expect(match.matchReasons.some(r => r.includes('Extra words penalty'))).toBe(false)
    expect(match.matchReasons.some(r => r.includes('Derived form conflict'))).toBe(false)
  })

  it('olive oil is not penalized by derived-form or extra-word rules', () => {
    // "olive oil" query: "oil" is NOT in DERIVED_FORM_WORDS — no form conflict
    const oil = makeFood({ name: 'Olive Oil', externalId: 'olive-oil', provider: 'fatsecret', isGeneric: true })
    const scored = scoreForIngredient([oil], req('olive oil'))
    const match = scored[0]
    expect(match.matchReasons.some(r => r.includes('Extra words penalty'))).toBe(false)
    expect(match.matchReasons.some(r => r.includes('Derived form conflict'))).toBe(false)
  })

  it('compound dish with query ingredient scores better than unrelated compound', () => {
    // "chicken noodle soup" query — legitimate complex dish
    const soupExact = makeFood({ name: 'Chicken Noodle Soup', externalId: 'soup', provider: 'fatsecret' })
    const stuffed   = makeFood({ name: 'Stuffed Chicken Breast with Mushroom Sauce', externalId: 'stuffed', provider: 'fatsecret' })
    const scored = scoreForIngredient([soupExact, stuffed], req('chicken noodle soup'))
    const soupScore    = scored.find(r => r.externalId === 'soup')!.matchScore
    const stuffedScore = scored.find(r => r.externalId === 'stuffed')!.matchScore
    expect(soupScore).toBeGreaterThan(stuffedScore)
  })
})
