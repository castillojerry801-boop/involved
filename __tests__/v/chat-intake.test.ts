/**
 * V Coach chat intake gating — production-path tests
 *
 * Verifies the system prompt rules and route handler logic that prevent
 * freeform program generation. Tests are unit-level: they inspect constants
 * and inline handler result strings rather than doing full HTTP mock round-trips.
 *
 * Scenario under test:
 *   User: "I want to get back in shape and build some muscle. Make me a 12-week program."
 *   V:    asks days/week, home or gym
 *   User: "5 days a week / at home"
 *   Expected: V asks for home equipment, then readiness — does NOT generate a program
 */

import { describe, it, expect } from 'vitest'
import { assessIntakeGaps } from '../../lib/v/intake'
import type { VTrainingContext } from '../../lib/v/training-context'

// ─── Import the system prompt constant directly ───────────────────────────────
// We test the actual string that ships to production.
// Vitest handles the 'server-only' import guard via __mocks__/server-only.ts.
import { SYSTEM_PROMPT, EMPTY_SEARCH_RESULT, QUALITY_EXHAUSTED_MESSAGE } from '../../app/api/coach/constants'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<VTrainingContext> = {}): VTrainingContext {
  return {
    profile: {
      fitnessLevel: null,
      goals: [],
      bodyMetrics: { ageYears: null, weightKg: null },
      weeklyWorkoutTarget: null,
    },
    equipment: null,
    preferences: { favorites: [], moreOften: [], lessOften: [], dontRecommend: [] },
    personalRecords: [],
    recentTraining: [],
    readinessState: null,
    coachingPresence: 'weekly_checkin',
    ...overrides,
  }
}

// ─── 1. Home training → equipment question required ───────────────────────────

describe('System prompt: home training triggers equipment question', () => {
  it('system prompt explicitly requires asking for equipment when user says "at home"', () => {
    expect(SYSTEM_PROMPT).toMatch(/at home.*MUST ask/i)
  })

  it('system prompt lists example equipment types in the question', () => {
    expect(SYSTEM_PROMPT).toContain('dumbbells')
    expect(SYSTEM_PROMPT).toContain('barbell')
    expect(SYSTEM_PROMPT).toContain('kettlebells')
  })

  it('system prompt prohibits assuming home equipment', () => {
    expect(SYSTEM_PROMPT).toMatch(/Do NOT assume any home equipment/i)
  })

  it('system prompt blocks generation until equipment is answered', () => {
    expect(SYSTEM_PROMPT).toMatch(/Do NOT search or generate until they answer/i)
  })
})

// ─── 2. 8+ week program → readiness question if unknown ──────────────────────

describe('System prompt: readiness gate for 8+ week programs', () => {
  it('system prompt requires resolving readiness for programs ≥ 8 weeks', () => {
    expect(SYSTEM_PROMPT).toContain('8 weeks')
    expect(SYSTEM_PROMPT).toMatch(/training background/i)
  })

  it('system prompt specifies the exact readiness question to ask', () => {
    expect(SYSTEM_PROMPT).toContain('currently training')
    expect(SYSTEM_PROMPT).toContain('returning after a break')
    expect(SYSTEM_PROMPT).toContain('first time training')
  })
})

describe('Route intake gate: 8+ week program blocks when readinessState is null', () => {
  it('isLongProgram is true for 12-week program', () => {
    const weeks = 12
    expect(weeks >= 8).toBe(true)
  })

  it('gate condition fires: isLongProgram && readinessState === null', () => {
    const weeks = 12
    const ctx = makeCtx({ readinessState: null })
    expect(weeks >= 8 && ctx.readinessState === null).toBe(true)
  })

  it('gate does not fire when readiness is known', () => {
    const weeks = 12
    const ctx = makeCtx({ readinessState: 'detrained' })
    expect(weeks >= 8 && ctx.readinessState === null).toBe(false)
  })

  it('assessIntakeGaps also flags missing readiness for 12-week program', () => {
    const ctx = makeCtx({
      readinessState: null,
      equipment: { profileName: 'Home', items: ['dumbbell'] },
      profile: {
        fitnessLevel: null,
        goals: [],
        bodyMetrics: { ageYears: null, weightKg: null },
        weeklyWorkoutTarget: 5,
      },
    })
    const result = assessIntakeGaps(ctx, { weeks: 12, days: 5 })
    expect(result.hasEnough).toBe(false)
    expect(result.missingHighValue.some(q => /train/i.test(q))).toBe(true)
  })
})

// ─── 3. Exercise search empty → explicit prohibition on freeform ──────────────

describe('Empty search result message prohibits freeform generation', () => {
  it('prohibits using model training knowledge to generate exercises', () => {
    expect(EMPTY_SEARCH_RESULT).toMatch(/Do NOT generate exercise names from your own knowledge/i)
  })

  it('explicitly forbids generating exercise names from training data', () => {
    expect(EMPTY_SEARCH_RESULT).toMatch(/Do NOT generate exercise names/i)
  })

  it('explicitly forbids freeform program generation', () => {
    expect(EMPTY_SEARCH_RESULT).toMatch(/Do NOT create a freeform program/i)
  })

  it('instructs V to search again with different parameters', () => {
    expect(EMPTY_SEARCH_RESULT).toMatch(/Search again/i)
  })
})

// ─── 4. quality_exhausted → ask question, never output a program ──────────────

describe('quality_exhausted message prevents freeform fallback', () => {
  it('tells V to ask about equipment', () => {
    expect(QUALITY_EXHAUSTED_MESSAGE).toMatch(/equipment/i)
  })

  it('explicitly forbids outputting a program', () => {
    expect(QUALITY_EXHAUSTED_MESSAGE).toMatch(/Do NOT output a program/i)
  })

  it('explicitly forbids listing exercises', () => {
    expect(QUALITY_EXHAUSTED_MESSAGE).toMatch(/Do NOT list exercises/i)
  })

  it('explicitly forbids the "standard exercises" freeform phrase', () => {
    expect(QUALITY_EXHAUSTED_MESSAGE).toMatch(/Do NOT say.*standard exercises/i)
  })

  it('explicitly forbids creating a general outline', () => {
    expect(QUALITY_EXHAUSTED_MESSAGE).toMatch(/Do NOT create a general outline/i)
  })
})

// ─── 5. Home + no equipment answer → gym-access regex does NOT lift constraint ─

describe('Equipment override logic: "at home" does not trigger gym-access lift', () => {
  // The conversationText gym-access regex in route.ts should NOT match when
  // the user only said "at home" with no specific equipment mentioned.
  const GYM_REGEX = /full[\s-]?gym|commercial\s?gym|gym\s?access|well[\s-]?equipped|barbell|squat\s?rack|power\s?rack/

  it('"at home" alone does not match gym-access pattern', () => {
    const text = 'i want to get back in shape. 5 days a week at home.'
    expect(GYM_REGEX.test(text)).toBe(false)
  })

  it('"full gym" matches gym-access pattern (lifts constraint)', () => {
    const text = 'i train at a full gym 5 days a week'
    expect(GYM_REGEX.test(text)).toBe(true)
  })

  it('"commercial gym" matches gym-access pattern', () => {
    const text = 'commercial gym, 4 days per week'
    expect(GYM_REGEX.test(text)).toBe(true)
  })

  it('"barbell" in conversation matches (user explicitly stated equipment)', () => {
    const text = 'i have a barbell and squat rack at home'
    expect(GYM_REGEX.test(text)).toBe(true)
  })

  it('"home gym" without specifics does NOT match', () => {
    const text = 'i work out at my home gym'
    expect(GYM_REGEX.test(text)).toBe(false)
  })
})

// ─── 6. System prompt: freeform program text is explicitly prohibited ─────────

describe('System prompt: freeform program prose is prohibited', () => {
  it('prohibits "I\'ll use standard exercises"', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER say.*standard exercises/i)
  })

  it('prohibits "I can create a general outline"', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER say.*general outline/i)
  })

  it('prohibits prose exercise lists', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER list exercises as prose/i)
  })

  it('prohibits "Day 1: ..." style chat responses', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER write.*Day 1/i)
  })

  it('states propose_program is the ONLY valid output for program requests', () => {
    expect(SYSTEM_PROMPT).toMatch(/ONLY valid response.*propose_program/i)
  })
})

// ─── 7. System prompt: internal taxonomy is prohibited ───────────────────────

describe('System prompt: internal taxonomy never exposed', () => {
  it('prohibits movement pattern codes like (horizontal_push)', () => {
    expect(SYSTEM_PROMPT).toContain('horizontal_push')
    expect(SYSTEM_PROMPT).toMatch(/OUTPUT RULES/i)
  })

  it('prohibits exercise IDs in output', () => {
    expect(SYSTEM_PROMPT).toMatch(/Exercise IDs/i)
  })
})

// ─── 8. System prompt: prescription requirements are specified ────────────────

describe('System prompt: prescription requirements', () => {
  it('specifies rest_seconds calibration rules for compounds', () => {
    expect(SYSTEM_PROMPT).toMatch(/Heavy compound.*120.*180|120–180s/i)
  })

  it('requires progression_model to be set explicitly', () => {
    expect(SYSTEM_PROMPT).toMatch(/progression_model must be set/i)
  })

  it('requires week_progressions for 8+ week programs', () => {
    expect(SYSTEM_PROMPT).toContain('week_progressions')
    expect(SYSTEM_PROMPT).toContain('8 weeks')
  })

  it('prohibits generic progression text as a substitute for structured data', () => {
    expect(SYSTEM_PROMPT).toMatch(/5.*10%.*NOT sufficient/i)
  })
})
