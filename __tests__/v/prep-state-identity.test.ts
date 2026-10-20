/**
 * Unit tests for extractPrepState and topMatchPassesIdentityCheck.
 *
 * These functions are internal to calculate-nutrition.ts but exported for testing.
 * Tests verify the classification rules and Guard 5 (prep-state bidirectional check).
 *
 * Key rule: "fresh" is a freshness/provenance qualifier, not an explicit preparation
 * state. Only "raw" and "dry" assert an uncooked nutrition reference. Guard 4 (in
 * topMatchPassesIdentityCheck) independently blocks dried forms for "fresh" or "raw"
 * requests via a direct string check, regardless of extractPrepState output.
 *
 * IMPORTANT: Tests here use generic/held-out food names — not the six customer evaluation
 * inputs from Phase 2C. These must remain independent measurements of pipeline behavior.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    foodItem: { findFirst: vi.fn().mockResolvedValue(null) },
    foodItemPortion: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/nutrition/providers/fatsecret', () => ({
  FatSecretProvider: class {
    readonly name = 'FatSecret'
    readonly providerId = 'fatsecret'
    search = vi.fn().mockResolvedValue([])
    getById = vi.fn().mockResolvedValue(null)
    getByIdForEnrichment = vi.fn().mockResolvedValue(null)
    searchByBarcode = vi.fn().mockResolvedValue(null)
  },
}))

import {
  extractPrepState,
  topMatchPassesIdentityCheck,
} from '../../lib/v/tools/calculate-nutrition'

// ── extractPrepState ──────────────────────────────────────────────────────────

describe('extractPrepState — classification', () => {
  // ── raw_or_dry cases ─────────────────────────────────────────────────────

  it('"chicken, raw" → raw_or_dry', () => {
    expect(extractPrepState('chicken, raw')).toBe('raw_or_dry')
  })

  it('"dry rolled oats" → raw_or_dry (dry grain, not dehydrated)', () => {
    expect(extractPrepState('dry rolled oats')).toBe('raw_or_dry')
  })

  it('"fresh taro" → neutral (fresh is freshness/provenance, not raw prep state)', () => {
    expect(extractPrepState('fresh taro')).toBe('neutral')
  })

  it('"fresh cassava" → neutral', () => {
    expect(extractPrepState('fresh cassava')).toBe('neutral')
  })

  it('"fresh spinach" → neutral', () => {
    expect(extractPrepState('fresh spinach')).toBe('neutral')
  })

  it('"Taro, raw" (USDA name) → raw_or_dry', () => {
    expect(extractPrepState('Taro, raw')).toBe('raw_or_dry')
  })

  // ── cooked cases ──────────────────────────────────────────────────────────

  it('"grilled chicken" → cooked', () => {
    expect(extractPrepState('grilled chicken')).toBe('cooked')
  })

  it('"cooked oatmeal" → cooked', () => {
    expect(extractPrepState('cooked oatmeal')).toBe('cooked')
  })

  it('"smoked salmon" → cooked', () => {
    expect(extractPrepState('smoked salmon')).toBe('cooked')
  })

  it('"baked potato" → cooked', () => {
    expect(extractPrepState('baked potato')).toBe('cooked')
  })

  // ── cooked takes priority over fresh/raw when both present ───────────────

  it('"fresh grilled salmon" → cooked (grilled takes priority over fresh)', () => {
    expect(extractPrepState('fresh grilled salmon')).toBe('cooked')
  })

  it('"dry roasted peanuts" → cooked (roasted takes priority over dry)', () => {
    expect(extractPrepState('dry roasted peanuts')).toBe('cooked')
  })

  it('"fresh baked bread" → cooked (baked takes priority over fresh)', () => {
    expect(extractPrepState('fresh baked bread')).toBe('cooked')
  })

  // ── neutral cases (no prep state) ────────────────────────────────────────

  it('"peanut butter" → neutral', () => {
    expect(extractPrepState('peanut butter')).toBe('neutral')
  })

  it('"whole milk" → neutral', () => {
    expect(extractPrepState('whole milk')).toBe('neutral')
  })

  it('"scrambled eggs" → neutral (scrambled is not in COOKED_STATE_WORDS)', () => {
    // "scrambled" is not in COOKED_STATE_WORDS and not a raw/fresh/dry keyword.
    // This is intentional: the word conveys cooking method but Guard 4/5 work at
    // name-comparison level, not egg cooking method level.
    expect(extractPrepState('scrambled eggs')).toBe('neutral')
  })

  it('"brown rice" → neutral', () => {
    expect(extractPrepState('brown rice')).toBe('neutral')
  })
})

// ── topMatchPassesIdentityCheck — Guard 5 with fresh/raw prep state ───────────

describe('topMatchPassesIdentityCheck — Guard 5 with fresh/raw requests', () => {
  // ── "fresh X" is neutral — Guard 5 does not fire, both raw and cooked forms accepted ──
  //
  // "fresh" is a freshness/provenance qualifier. It does NOT restrict to raw nutrition.
  // "fresh taro" can refer to the ripe whole fruit that a customer will cook at home,
  // or eat raw — Guard 5 does not make that decision. Scoring picks the best candidate.
  // Guard 4 (string-based, independent of extractPrepState) still blocks dried forms.

  it('"fresh taro" accepts USDA "Taro, raw" (req neutral, Guard 5 does not fire)', () => {
    expect(topMatchPassesIdentityCheck('fresh taro', 'Taro, raw')).toBe(true)
  })

  it('"fresh cassava" accepts USDA "Cassava, raw" (req neutral, Guard 5 does not fire)', () => {
    expect(topMatchPassesIdentityCheck('fresh cassava', 'Cassava, raw')).toBe(true)
  })

  it('"fresh spinach" accepts USDA "Spinach, raw" (req neutral, Guard 5 does not fire)', () => {
    expect(topMatchPassesIdentityCheck('fresh spinach', 'Spinach, raw')).toBe(true)
  })

  it('"fresh taro" accepts a cooked topMatch (neutral req — Guard 5 does not restrict prep form)', () => {
    // "fresh taro" does not assert raw preparation — cooked taro is a valid topMatch.
    // Scoring determines which form ranks highest; Guard 5 stays silent for neutral requests.
    expect(topMatchPassesIdentityCheck('fresh taro', 'Taro, cooked, without salt')).toBe(true)
  })

  it('"fresh cassava" accepts a cooked topMatch (neutral req)', () => {
    expect(topMatchPassesIdentityCheck('fresh cassava', 'Cassava, cooked')).toBe(true)
  })

  it('"fresh bread" accepts "Fresh Baked Bread" (neutral req accepts cooked topMatch)', () => {
    // The core requirement: "fresh bread" should be compatible with "Fresh Baked Bread".
    // "fresh" = freshness indicator, not raw-dough assertion.
    expect(topMatchPassesIdentityCheck('fresh bread', 'Fresh Baked Bread')).toBe(true)
  })

  // ── Preserved behavior from Phase 2C ─────────────────────────────────────

  it('"grilled chicken" rejects raw chicken topMatch (cooked vs raw_or_dry)', () => {
    expect(topMatchPassesIdentityCheck('grilled chicken', 'Chicken, breast, meat only, raw')).toBe(false)
  })

  it('"grilled chicken" accepts a cooked chicken topMatch', () => {
    expect(topMatchPassesIdentityCheck('grilled chicken', 'Chicken, broilers, breast, roasted')).toBe(true)
  })

  it('"chicken, raw" rejects a cooked topMatch (raw_or_dry vs cooked)', () => {
    expect(topMatchPassesIdentityCheck('chicken, raw', 'Chicken, breast, roasted')).toBe(false)
  })

  // ── "fresh" + cooked descriptor: cooked wins ─────────────────────────────

  it('"fresh grilled salmon" rejects a raw topMatch (fresh grilled → cooked)', () => {
    // extractPrepState("fresh grilled salmon") = 'cooked' (grilled takes priority)
    // extractPrepState("Salmon, Atlantic, wild, raw") = 'raw_or_dry'
    // cooked ≠ raw_or_dry → rejected
    expect(topMatchPassesIdentityCheck('fresh grilled salmon', 'Salmon, Atlantic, wild, raw')).toBe(false)
  })

  it('"fresh grilled salmon" accepts a cooked salmon topMatch', () => {
    expect(topMatchPassesIdentityCheck('fresh grilled salmon', 'Salmon, coho, wild, cooked, dry heat')).toBe(true)
  })

  // ── Neutral requests: no prep-state constraint from Guard 5 ──────────────

  it('"salmon" (neutral) accepts raw topMatch (Guard 5 does not fire for neutral)', () => {
    expect(topMatchPassesIdentityCheck('salmon', 'Salmon, Atlantic, wild, raw')).toBe(true)
  })

  it('"peanut butter" (neutral) accepts neutral topMatch', () => {
    expect(topMatchPassesIdentityCheck('peanut butter', 'Peanut Butter, smooth')).toBe(true)
  })

  // ── Guard 4: dried form still blocked for fresh/raw requests ─────────────

  it('"fresh taro" rejects "Taro, dried" (Guard 4 fires on dried + fresh)', () => {
    expect(topMatchPassesIdentityCheck('fresh taro', 'Taro, dried')).toBe(false)
  })

  it('"fresh cassava" rejects "Cassava, dried"', () => {
    expect(topMatchPassesIdentityCheck('fresh cassava', 'Cassava, dried')).toBe(false)
  })

  // ── Guard 2: juice still blocked ─────────────────────────────────────────

  it('"fresh taro" rejects "Taro, juice" (Guard 2)', () => {
    expect(topMatchPassesIdentityCheck('fresh taro', 'Taro, juice')).toBe(false)
  })
})
