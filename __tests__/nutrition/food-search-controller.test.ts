import { describe, it, expect } from 'vitest'
import { FoodSearchController, isSearchable, SEARCH_MIN_LENGTH } from '../../lib/nutrition/food-search-controller'

describe('isSearchable — minimum query length gate', () => {
  it(`returns false for strings shorter than ${SEARCH_MIN_LENGTH} chars`, () => {
    expect(isSearchable('')).toBe(false)
    expect(isSearchable('a')).toBe(false)
  })

  it('returns false for whitespace-only strings', () => {
    expect(isSearchable(' ')).toBe(false)
    expect(isSearchable('  ')).toBe(false)
  })

  it('returns true at and above the minimum length', () => {
    expect(isSearchable('ab')).toBe(true)
    expect(isSearchable('chicken')).toBe(true)
  })

  it('trims before checking length', () => {
    // " a" looks like 2 chars but only 1 non-whitespace → not searchable
    expect(isSearchable(' a')).toBe(false)
    // " ab" → 2 non-whitespace → searchable
    expect(isSearchable(' ab')).toBe(true)
  })
})

describe('FoodSearchController — stale-request prevention', () => {
  it('begin() returns an AbortSignal and an incrementing sequence number', () => {
    const ctrl = new FoodSearchController()
    const r1 = ctrl.begin()
    const r2 = ctrl.begin()
    expect(r1.signal).toBeInstanceOf(AbortSignal)
    expect(r2.signal).toBeInstanceOf(AbortSignal)
    expect(r2.seq).toBeGreaterThan(r1.seq)
  })

  it('aborts the prior signal when begin() is called again', () => {
    const ctrl = new FoodSearchController()
    const { signal: s1 } = ctrl.begin()
    expect(s1.aborted).toBe(false)
    ctrl.begin()
    expect(s1.aborted).toBe(true)
  })

  it('does not abort the most-recent signal when begin() is called', () => {
    const ctrl = new FoodSearchController()
    ctrl.begin()
    const { signal: s2 } = ctrl.begin()
    expect(s2.aborted).toBe(false)
  })

  it('isCurrent() returns true only for the latest seq', () => {
    const ctrl = new FoodSearchController()
    const { seq: s1 } = ctrl.begin()
    const { seq: s2 } = ctrl.begin()
    expect(ctrl.isCurrent(s1)).toBe(false)
    expect(ctrl.isCurrent(s2)).toBe(true)
  })

  it('isCurrent() prevents stale responses from overwriting current results', () => {
    // Simulate: user types "chi" (seq=1), then "chicken" (seq=2).
    // seq=1 response arrives late — isCurrent(1) is false → discard.
    // seq=2 response arrives — isCurrent(2) is true → apply.
    const ctrl = new FoodSearchController()
    const { seq: staleSeq }   = ctrl.begin() // "chi"
    const { seq: currentSeq } = ctrl.begin() // "chicken"

    expect(ctrl.isCurrent(staleSeq)).toBe(false)   // discard stale
    expect(ctrl.isCurrent(currentSeq)).toBe(true)  // apply current
  })

  it('cancel() aborts the current in-flight request', () => {
    const ctrl = new FoodSearchController()
    const { signal } = ctrl.begin()
    expect(signal.aborted).toBe(false)
    ctrl.cancel()
    expect(signal.aborted).toBe(true)
  })

  it('cancel() before any begin() does not throw', () => {
    const ctrl = new FoodSearchController()
    expect(() => ctrl.cancel()).not.toThrow()
  })

  it('seq increments monotonically across multiple searches', () => {
    const ctrl = new FoodSearchController()
    const seqs = Array.from({ length: 5 }, () => ctrl.begin().seq)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    }
  })

  it('each begin() produces a distinct AbortController (different signal reference)', () => {
    const ctrl = new FoodSearchController()
    const { signal: s1 } = ctrl.begin()
    const { signal: s2 } = ctrl.begin()
    expect(s1).not.toBe(s2)
  })
})
