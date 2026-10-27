import { describe, it, expect } from 'vitest'

// Mirror of the CircleRing offset formula in nutrition/page.tsx
function ringOffset(value: number, max: number, size: number, stroke: number) {
  const r            = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const filled        = Math.min(value / Math.max(max, 1), 1)
  return circumference * (1 - filled)
}

// Mirror of pct() helper in nutrition/page.tsx
function pct(consumed: number, target: number) {
  return Math.min(Math.round((consumed / target) * 100), 100)
}

// ─── CircleRing offset ────────────────────────────────────────────────────────

describe('CircleRing — calorie ring (140×12)', () => {
  const size   = 140
  const stroke = 12
  const r      = (size - stroke) / 2
  const C      = 2 * Math.PI * r  // full circumference

  it('empty: offset equals full circumference', () => {
    expect(ringOffset(0, 2000, size, stroke)).toBeCloseTo(C)
  })

  it('50% filled: offset is half circumference', () => {
    expect(ringOffset(1000, 2000, size, stroke)).toBeCloseTo(C / 2)
  })

  it('full: offset is zero', () => {
    expect(ringOffset(2000, 2000, size, stroke)).toBeCloseTo(0)
  })

  it('over target: clamped to 0 (full fill)', () => {
    expect(ringOffset(2500, 2000, size, stroke)).toBeCloseTo(0)
  })

  it('zero target guard: no NaN (uses max=1)', () => {
    const offset = ringOffset(0, 0, size, stroke)
    expect(Number.isNaN(offset)).toBe(false)
    expect(offset).toBeCloseTo(C)
  })

  it('just-under-target: offset is a small positive value', () => {
    const offset = ringOffset(1999, 2000, size, stroke)
    expect(offset).toBeGreaterThan(0)
    expect(offset).toBeLessThan(C * 0.01)
  })
})

describe('CircleRing — macro ring (60×5)', () => {
  const size   = 60
  const stroke = 5
  const r      = (size - stroke) / 2
  const C      = 2 * Math.PI * r

  it('empty: offset equals full circumference', () => {
    expect(ringOffset(0, 150, size, stroke)).toBeCloseTo(C)
  })

  it('45g of 150g protein = 30% filled', () => {
    expect(ringOffset(45, 150, size, stroke)).toBeCloseTo(C * 0.7, 4)
  })

  it('200g of 250g carbs = 80% filled', () => {
    expect(ringOffset(200, 250, size, stroke)).toBeCloseTo(C * 0.2, 4)
  })

  it('over-target fat: clamped to zero offset', () => {
    expect(ringOffset(100, 65, size, stroke)).toBeCloseTo(0)
  })
})

// ─── pct helper ───────────────────────────────────────────────────────────────

describe('pct() — percentage display helper', () => {
  it('normal midpoint', () => {
    expect(pct(1000, 2000)).toBe(50)
  })

  it('rounds down correctly', () => {
    expect(pct(1, 3)).toBe(33)   // 33.33…
  })

  it('rounds up correctly', () => {
    expect(pct(2, 3)).toBe(67)   // 66.66…
  })

  it('zero consumption returns 0', () => {
    expect(pct(0, 2000)).toBe(0)
  })

  it('exactly at goal returns 100', () => {
    expect(pct(2000, 2000)).toBe(100)
  })

  it('over goal is capped at 100', () => {
    expect(pct(2500, 2000)).toBe(100)
    expect(pct(9999, 100)).toBe(100)
  })

  it('one over goal still caps at 100', () => {
    expect(pct(2001, 2000)).toBe(100)
  })

  it('high-precision target: rounds correctly', () => {
    expect(pct(150, 150)).toBe(100)
    expect(pct(75, 150)).toBe(50)
  })
})

// ─── remaining calories logic ─────────────────────────────────────────────────

describe('remaining calories display logic', () => {
  function remainingLabel(consumed: number, target: number) {
    const remaining = target - consumed
    if (remaining > 0)  return `${remaining.toLocaleString()} remaining`
    if (remaining === 0) return 'Goal reached!'
    return `${Math.abs(remaining).toLocaleString()} over goal`
  }

  it('under goal shows remaining count', () => {
    expect(remainingLabel(1200, 2000)).toBe('800 remaining')
  })

  it('exactly at goal', () => {
    expect(remainingLabel(2000, 2000)).toBe('Goal reached!')
  })

  it('over goal shows overage amount', () => {
    expect(remainingLabel(2300, 2000)).toBe('300 over goal')
  })

  it('zero consumed', () => {
    expect(remainingLabel(0, 2000)).toBe('2,000 remaining')
  })
})

// ─── macro over-goal display logic ────────────────────────────────────────────

describe('macro over-goal — isOver guard', () => {
  function isOver(consumed: number, target: number) {
    return target > 0 && consumed > target
  }

  it('under goal: false', () => {
    expect(isOver(100, 150)).toBe(false)
  })

  it('at goal exactly: false (not over)', () => {
    expect(isOver(150, 150)).toBe(false)
  })

  it('over goal by any amount: true', () => {
    expect(isOver(150.1, 150)).toBe(true)
    expect(isOver(200, 150)).toBe(true)
  })

  it('zero target: false (safe guard, never over)', () => {
    expect(isOver(0, 0)).toBe(false)
    expect(isOver(50, 0)).toBe(false)
  })

  it('loading state (consumed=0): false', () => {
    expect(isOver(0, 150)).toBe(false)
  })
})

describe('macro over-goal — excess label', () => {
  function excessG(consumed: number, target: number) {
    return Math.round((consumed - target) * 10) / 10
  }

  it('whole-gram excess has no decimal', () => {
    expect(excessG(171, 150)).toBe(21)
  })

  it('fractional excess rounds to 1 decimal', () => {
    expect(excessG(171.1, 150)).toBeCloseTo(21.1)
    expect(excessG(150.14, 150)).toBeCloseTo(0.1)
  })

  it('sub-0.05g excess rounds to 0 (edge: effectively at goal)', () => {
    expect(excessG(150.04, 150)).toBe(0)
  })

  it('large excess', () => {
    expect(excessG(300, 65)).toBeCloseTo(235)
  })
})
