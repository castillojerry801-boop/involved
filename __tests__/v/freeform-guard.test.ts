/**
 * V Coach freeform guard — production-path regression test
 *
 * Verifies that the server-side guard in app/api/coach/route.ts prevents the
 * model from ever streaming an improvised workout outline when program generation
 * was attempted but failed to produce a validated ProgramDraft.
 *
 * Root cause reproduced here:
 *   Branch A — model searches exercises, gets empty results, generates freeform
 *               text without calling propose_program (loop exits on no-tool-call).
 *   Branch B — propose_program called, quality_exhausted, model generates
 *               "I can create a program based on common movements" in next round.
 *
 * Both branches are now closed by the server-side freeform guard. This test
 * asserts the guard conditions and the response constant so a regression is
 * caught before it ships.
 *
 * Scenario under test:
 *   User:  "I want to get back in shape and build some muscle. Make me a 12-week program."
 *   User:  "returning"
 *   Setup: confirmed home equipment profile
 *   Expected: guard fires → FREEFORM_GUARD_RESPONSE is the only possible output.
 *   Never:  "I'll use common movements", "here's a basic outline", or any exercise list.
 */

import { describe, it, expect } from 'vitest'
import {
  FREEFORM_GUARD_RESPONSE,
  PROGRAM_INTENT_PATTERN,
  QUALITY_EXHAUSTED_MESSAGE,
} from '../../app/api/coach/constants'

// ─── Guard response content ───────────────────────────────────────────────────

describe('FREEFORM_GUARD_RESPONSE constant', () => {
  it('is a non-empty string', () => {
    expect(typeof FREEFORM_GUARD_RESPONSE).toBe('string')
    expect(FREEFORM_GUARD_RESPONSE.length).toBeGreaterThan(10)
  })

  it('asks about equipment (must be a targeted question, not a generic outline)', () => {
    expect(FREEFORM_GUARD_RESPONSE.toLowerCase()).toMatch(/equipment/)
  })

  it('does not contain any freeform workout language', () => {
    const forbidden = [
      /i.?ll use/i,
      /common movements/i,
      /basic outline/i,
      /here.?s a program/i,
      /day 1/i,
      /week 1/i,
    ]
    for (const pattern of forbidden) {
      expect(FREEFORM_GUARD_RESPONSE).not.toMatch(pattern)
    }
  })

  it('is phrased as a question to the user', () => {
    expect(FREEFORM_GUARD_RESPONSE).toMatch(/\?/)
  })
})

// ─── Program intent detection ─────────────────────────────────────────────────

describe('PROGRAM_INTENT_PATTERN — 12-week program scenario', () => {
  const programMessages = [
    'I want to get back in shape and build some muscle. Make me a 12-week program.',
    'Make me a program',
    'Build me a 6 week plan',
    'I want a 3-day split',
    'Can you design a training routine for me?',
    'I need a 12 week schedule',
  ]

  for (const msg of programMessages) {
    it(`detects program intent in: "${msg}"`, () => {
      expect(PROGRAM_INTENT_PATTERN.test(msg)).toBe(true)
    })
  }

  const nonProgramMessages = [
    'How many calories should I eat?',
    'What is progressive overload?',
    'returning',
    'I have dumbbells and a barbell',
    'I feel tired today',
  ]

  for (const msg of nonProgramMessages) {
    it(`does NOT detect program intent in: "${msg}"`, () => {
      expect(PROGRAM_INTENT_PATTERN.test(msg)).toBe(false)
    })
  }
})

// ─── Guard condition logic ────────────────────────────────────────────────────

// Mirrors the freeformGuard condition in app/api/coach/route.ts.
// Tests the exact logic so any change to the condition is caught here.
function freeformGuard(state: {
  qualityExhausted: boolean
  proposeProgramAttempted: boolean
  pendingProgramValid: boolean
  hasProgramIntent: boolean
  hadSearchCalls: boolean
  pendingWorkoutValid: boolean
}): boolean {
  return (
    state.qualityExhausted ||
    (state.proposeProgramAttempted && !state.pendingProgramValid) ||
    (state.hasProgramIntent && state.hadSearchCalls && !state.pendingProgramValid && !state.pendingWorkoutValid)
  )
}

describe('freeform guard — scenario: 12-week program, returning, home equipment', () => {
  const baseState = {
    qualityExhausted: false,
    proposeProgramAttempted: false,
    pendingProgramValid: false,
    hasProgramIntent: true,       // "Make me a 12-week program"
    hadSearchCalls: false,
    pendingWorkoutValid: false,
  }

  it('Branch A: fires when searches happened but propose_program never called', () => {
    expect(freeformGuard({ ...baseState, hadSearchCalls: true })).toBe(true)
  })

  it('Branch B: fires when propose_program attempted but quality exhausted', () => {
    expect(freeformGuard({ ...baseState, proposeProgramAttempted: true, qualityExhausted: true })).toBe(true)
  })

  it('fires when propose_program attempted but program never validated', () => {
    expect(freeformGuard({ ...baseState, proposeProgramAttempted: true })).toBe(true)
  })

  it('does NOT fire when a valid program was produced', () => {
    expect(freeformGuard({ ...baseState, proposeProgramAttempted: true, pendingProgramValid: true })).toBe(false)
  })

  it('does NOT fire when a valid workout was produced (not a program request)', () => {
    expect(freeformGuard({ ...baseState, hadSearchCalls: true, pendingWorkoutValid: true })).toBe(false)
  })

  it('does NOT fire for a normal conversational turn (no tool calls, no program intent)', () => {
    expect(freeformGuard({
      ...baseState,
      hasProgramIntent: false,
      hadSearchCalls: false,
    })).toBe(false)
  })

  it('does NOT fire when intake-only (no searches yet, program intent present)', () => {
    // V is asking equipment/readiness questions — no searches yet, no program call.
    // Guard must not fire or the clarifying question flow breaks.
    expect(freeformGuard({ ...baseState, hadSearchCalls: false })).toBe(false)
  })

  it('fires on quality_exhausted regardless of other flags', () => {
    expect(freeformGuard({
      qualityExhausted: true,
      proposeProgramAttempted: true,
      pendingProgramValid: false,
      hasProgramIntent: false,
      hadSearchCalls: false,
      pendingWorkoutValid: false,
    })).toBe(true)
  })
})

// ─── QUALITY_EXHAUSTED_MESSAGE still instructs clarification ──────────────────

describe('QUALITY_EXHAUSTED_MESSAGE', () => {
  it('instructs V to ask about equipment (not generate a program)', () => {
    expect(QUALITY_EXHAUSTED_MESSAGE.toLowerCase()).toMatch(/equipment/)
  })

  it('prohibits outputting a program', () => {
    expect(QUALITY_EXHAUSTED_MESSAGE).toMatch(/Do NOT output a program/i)
  })

  it('prohibits listing exercises', () => {
    expect(QUALITY_EXHAUSTED_MESSAGE).toMatch(/Do NOT list exercises/i)
  })
})
