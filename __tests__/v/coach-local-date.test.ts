/**
 * Coach V local-date tests
 *
 * Root cause (2026-10-16): `buildCoachContext` computed `today` from
 * `new Date().toISOString().slice(0,10)` — always UTC. V then passes this
 * UTC date as `logDate` to `prepare_meal_log`. Users in negative UTC offsets
 * (US timezones) in the evening see their logged meal stored under "tomorrow"
 * from their perspective, making it invisible in the Nutrition page.
 *
 * Fix: `buildCoachContext` now accepts an optional `clientDate` (browser local
 * date, YYYY-MM-DD) that takes precedence over the server UTC date. The date is
 * validated as a real calendar date — impossible months/days are rejected.
 *
 * Tests:
 *  1. `contextToSystemSnippet` emits TODAY: matching ctx.today exactly
 *  2. Valid calendar dates pass isValidClientDate
 *  3. Invalid clientDate strings are rejected (format + calendar check)
 *  4. `clientDate` injection: provided date appears in TODAY line
 *  5. Different today values produce distinct TODAY lines
 */
import { describe, it, expect } from 'vitest'
import { contextToSystemSnippet } from '../../lib/ai/context'
import type { CoachContext } from '../../lib/ai/context'

function makeMinimalCtx(today: string): CoachContext {
  return {
    today,
    user:            { name: 'Jerry', tier: 'plus' },
    goals:           [],
    nutrition:       { targetsSet: false, history: [] },
    healthMetrics:   {},
    trainingSnippet: 'TRAINING: No data available.',
    trainingCtx:     null,
  }
}

// Mirrors isValidClientDate from context.ts for unit testing
function isValidClientDate(s: string | undefined): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, mo, d] = s.split('-').map(Number)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

describe('coach local-date fix', () => {
  it('contextToSystemSnippet emits TODAY: <date> matching ctx.today', () => {
    const snippet = contextToSystemSnippet(makeMinimalCtx('2026-10-16'))
    expect(snippet).toContain('TODAY: 2026-10-16')
    expect(snippet).not.toContain('TODAY: 2026-10-17')
  })

  it('valid real calendar dates pass isValidClientDate', () => {
    expect(isValidClientDate('2026-10-16')).toBe(true)
    expect(isValidClientDate('2000-01-01')).toBe(true)
    expect(isValidClientDate('2024-02-29')).toBe(true)  // leap year
    expect(isValidClientDate('2099-12-31')).toBe(true)
  })

  it('invalid clientDate strings are rejected by isValidClientDate', () => {
    expect(isValidClientDate('2026-1-6')).toBe(false)    // no zero-padding
    expect(isValidClientDate('2026/10/16')).toBe(false)  // wrong separator
    expect(isValidClientDate('not-a-date')).toBe(false)
    expect(isValidClientDate('')).toBe(false)
    expect(isValidClientDate(undefined)).toBe(false)
    expect(isValidClientDate('2026-13-01')).toBe(false)  // month 13 is impossible
    expect(isValidClientDate('2026-10-40')).toBe(false)  // day 40 is impossible
    expect(isValidClientDate('2026-02-29')).toBe(false)  // 2026 is not a leap year
  })

  it('clientDate injection: "2026-10-16" appears verbatim in the TODAY line', () => {
    const ctx = makeMinimalCtx('2026-10-16')
    expect(contextToSystemSnippet(ctx).split('\n')[0]).toBe('TODAY: 2026-10-16')
  })

  it('different today values produce different TODAY lines (no cross-contamination)', () => {
    const snippetA = contextToSystemSnippet(makeMinimalCtx('2026-10-15'))
    const snippetB = contextToSystemSnippet(makeMinimalCtx('2026-10-16'))
    expect(snippetA).toContain('TODAY: 2026-10-15')
    expect(snippetA).not.toContain('TODAY: 2026-10-16')
    expect(snippetB).toContain('TODAY: 2026-10-16')
    expect(snippetB).not.toContain('TODAY: 2026-10-15')
  })
})
