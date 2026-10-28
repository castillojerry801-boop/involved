import { describe, it, expect } from 'vitest'

// Mirrors CircleRing / ConcentricMacroRings fill formula
function ringFilled(consumed: number, target: number) {
  return Math.min(consumed / Math.max(target, 1), 1)
}

// Mirrors macro isOver guard
function isOver(consumed: number, target: number) {
  return target > 0 && consumed > target
}

// Mirrors macro excessG formula
function excessG(consumed: number, target: number) {
  return Math.round((consumed - target) * 10) / 10
}

// Mirrors calorie status text in NutritionRingsSummary
function calorieStatusText(calories: number, target: number) {
  const remaining = target - calories
  if (remaining > 0)  return `${remaining.toLocaleString()} left`
  if (remaining === 0) return 'Goal reached!'
  return `${Math.abs(remaining).toLocaleString()} over`
}

// Mirrors calorieRingClass in nutrition-rings-summary.tsx
function calorieRingClass(consumed: number, target: number): string {
  if (!target) return 'text-emerald-500'
  const ratio = consumed / target
  if (ratio > 1.0)   return 'text-red-500'
  if (ratio >= 0.75) return 'text-amber-400'
  return 'text-emerald-500'
}

// ─── Calorie ring clamping ────────────────────────────────────────────────────

describe('Today card — calorie ring clamping', () => {
  it('empty: fill = 0', () => {
    expect(ringFilled(0, 2000)).toBe(0)
  })

  it('half: fill = 0.5', () => {
    expect(ringFilled(1000, 2000)).toBe(0.5)
  })

  it('at goal: fill = 1', () => {
    expect(ringFilled(2000, 2000)).toBe(1)
  })

  it('over goal: clamped to 1', () => {
    expect(ringFilled(2500, 2000)).toBe(1)
    expect(ringFilled(9999, 2000)).toBe(1)
  })

  it('zero target: no NaN, fill = 0', () => {
    const f = ringFilled(0, 0)
    expect(Number.isNaN(f)).toBe(false)
    expect(f).toBe(0)
  })

  it('zero target with consumption: ring uses max=1 guard', () => {
    expect(ringFilled(10, 0)).toBe(1)
  })
})

// ─── Calorie status text ──────────────────────────────────────────────────────

describe('NutritionRingsSummary — calorie status text', () => {
  it('under goal shows remaining', () => {
    expect(calorieStatusText(1500, 2000)).toBe('500 left')
  })

  it('exactly at goal', () => {
    expect(calorieStatusText(2000, 2000)).toBe('Goal reached!')
  })

  it('over goal shows overage (not remaining)', () => {
    expect(calorieStatusText(2300, 2000)).toBe('300 over')
  })

  it('1 over goal', () => {
    expect(calorieStatusText(2001, 2000)).toBe('1 over')
  })

  it('large overage uses toLocaleString formatting', () => {
    expect(calorieStatusText(3200, 2000)).toBe('1,200 over')
  })
})

// ─── Calorie ring color thresholds ───────────────────────────────────────────

describe('NutritionRingsSummary — calorieRingClass thresholds', () => {
  it('zero target returns emerald', () => {
    expect(calorieRingClass(0, 0)).toBe('text-emerald-500')
  })

  it('0% is emerald', () => {
    expect(calorieRingClass(0, 2000)).toBe('text-emerald-500')
  })

  it('74.9% is emerald (just under amber threshold)', () => {
    expect(calorieRingClass(1498, 2000)).toBe('text-emerald-500')
  })

  it('75% is amber (threshold boundary)', () => {
    expect(calorieRingClass(1500, 2000)).toBe('text-amber-400')
  })

  it('90% is amber', () => {
    expect(calorieRingClass(1800, 2000)).toBe('text-amber-400')
  })

  it('100% is amber (at goal, not over)', () => {
    expect(calorieRingClass(2000, 2000)).toBe('text-amber-400')
  })

  it('100.1% is red (just over goal)', () => {
    expect(calorieRingClass(2002, 2000)).toBe('text-red-500')
  })

  it('150% is red (well over goal)', () => {
    expect(calorieRingClass(3000, 2000)).toBe('text-red-500')
  })
})

// ─── Concentric macro rings clamping ─────────────────────────────────────────

describe('Today card — concentric macro ring clamping', () => {
  it('protein at goal: full ring', () => {
    expect(ringFilled(150, 150)).toBe(1)
  })

  it('protein over goal: clamped to 1', () => {
    expect(ringFilled(200, 150)).toBe(1)
  })

  it('carbs partial', () => {
    expect(ringFilled(100, 300)).toBeCloseTo(1 / 3)
  })

  it('fat zero: empty ring', () => {
    expect(ringFilled(0, 65)).toBe(0)
  })

  it('zero macro target guard', () => {
    expect(ringFilled(0, 0)).toBe(0)
    expect(Number.isNaN(ringFilled(0, 0))).toBe(false)
  })
})

// ─── Macro over-goal guard and excess label ───────────────────────────────────

describe('Today card — macro over-goal guard', () => {
  it('under: false', () => {
    expect(isOver(140, 150)).toBe(false)
  })

  it('at goal exactly: false', () => {
    expect(isOver(150, 150)).toBe(false)
  })

  it('over by 0.1g: true', () => {
    expect(isOver(150.1, 150)).toBe(true)
  })

  it('zero target: always false', () => {
    expect(isOver(0, 0)).toBe(false)
    expect(isOver(50, 0)).toBe(false)
  })
})

describe('Today card — macro excess label', () => {
  it('whole gram excess', () => {
    expect(excessG(171, 150)).toBe(21)
  })

  it('fractional excess rounds to 1 decimal', () => {
    expect(excessG(171.1, 150)).toBeCloseTo(21.1)
  })

  it('tiny excess (< 0.05g) rounds to 0', () => {
    expect(excessG(150.04, 150)).toBe(0)
  })

  it('large excess', () => {
    expect(excessG(300, 65)).toBeCloseTo(235)
  })
})
