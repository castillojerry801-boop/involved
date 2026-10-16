import { describe, it, expect } from 'vitest'
import { getClarificationQuestion } from '@/lib/nutrition/matching/clarifications'
import type { FoodMatch } from '@/lib/nutrition/matching/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMatch(name: string, calories = 150, matchScore = 80): FoodMatch {
  return {
    provider: 'usda_fooddata',
    externalId: name,
    name,
    servingSize: 100,
    servingUnit: 'g',
    calories,
    proteinG: 10,
    carbohydrateG: 10,
    fatG: 5,
    isGeneric: true,
    matchScore,
    matchReasons: [],
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('getClarificationQuestion', () => {
  it('"chicken" → clarification about breast/thigh/whole when macros diverge', () => {
    const results = [
      makeMatch('Chicken, breast, raw', 110),
      makeMatch('Chicken, thigh, raw', 180),
    ]
    const q = getClarificationQuestion('chicken', results)
    expect(q).toBe('Breast, thigh, or whole chicken?')
  })

  it('"chicken breast" → null (already specific)', () => {
    const results = [makeMatch('Chicken, breast, raw', 110)]
    expect(getClarificationQuestion('chicken breast', results)).toBeNull()
  })

  it('"pasta" → asks about dry vs cooked', () => {
    const results = [makeMatch('Pasta, dry'), makeMatch('Pasta, cooked')]
    const q = getClarificationQuestion('pasta', results)
    expect(q).toBe('Dry or cooked pasta?')
  })

  it('"spaghetti" → asks about dry vs cooked', () => {
    const results = [makeMatch('Spaghetti, dry'), makeMatch('Spaghetti, cooked')]
    const q = getClarificationQuestion('spaghetti', results)
    expect(q).toBe('Dry or cooked pasta?')
  })

  it('"olive oil" → null (not ambiguous category)', () => {
    const results = [makeMatch('Oil, olive')]
    expect(getClarificationQuestion('olive oil', results)).toBeNull()
  })

  it('"milk" → clarification about fat level when macros diverge', () => {
    const results = [
      makeMatch('Milk, whole', 61),
      makeMatch('Milk, skim',  34),
    ]
    const q = getClarificationQuestion('milk', results)
    expect(q).toBe('Whole, 2%, or skim milk?')
  })

  it('"whole milk" → null (already specific)', () => {
    const results = [makeMatch('Milk, whole', 61)]
    expect(getClarificationQuestion('whole milk', results)).toBeNull()
  })

  it('"plain Greek yogurt" → null (already specific enough)', () => {
    const results = [makeMatch('Yogurt, Greek, plain')]
    expect(getClarificationQuestion('plain Greek yogurt', results)).toBeNull()
  })

  it('"yogurt" → clarification about plain/flavored/Greek', () => {
    const results = [
      makeMatch('Yogurt, plain, whole milk'),
      makeMatch('Yogurt, Greek, plain, nonfat'),
    ]
    const q = getClarificationQuestion('yogurt', results)
    expect(q).toBe('Plain or flavored? Greek or regular?')
  })

  it('"chicken" with similar macros → no clarification (not divergent enough)', () => {
    const results = [
      makeMatch('Chicken, breast, raw', 110),
      makeMatch('Chicken, thigh, raw', 115),  // Very similar calories
    ]
    // requiresDivergentMacros: true for chicken — won't trigger if macros close
    const q = getClarificationQuestion('chicken', results)
    expect(q).toBeNull()
  })

  it('returns null when results list is empty', () => {
    expect(getClarificationQuestion('chicken', [])).toBeNull()
  })
})
