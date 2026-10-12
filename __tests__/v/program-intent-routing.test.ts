/**
 * V Coach program-intent routing — regression tests
 *
 * Covers the two-pattern routing fix that prevents the intake gate from
 * intercepting lookup queries mid-conversation:
 *
 *   PROGRAM_INTENT_PATTERN — "schedule" removed; no longer matches
 *     informational schedule questions.
 *   LOOKUP_INTENT_PATTERN  — matches informational lookup signals.
 *   CREATION_INTENT_PATTERN — matches explicit creation verbs; overrides
 *     lookup signals when both are present.
 *
 * Root cause of the original bug:
 *   1. PROGRAM_INTENT_PATTERN included "schedule".
 *   2. conversationHasProgramIntent checked ALL prior messages, so asking
 *      "build me a program" in turn 1 permanently set the flag.
 *   3. The pre-generation gate fired on turn 5 ("what's my schedule?") and
 *      asked "how many days per week?" instead of answering the question.
 */

import { describe, it, expect } from 'vitest'
import {
  PROGRAM_INTENT_PATTERN,
  LOOKUP_INTENT_PATTERN,
  CREATION_INTENT_PATTERN,
  selectRoundTools,
} from '../../app/api/coach/constants'

// Helper mirrors the route's currentTurnIsLookup logic.
function isLookupTurn(message: string): boolean {
  return LOOKUP_INTENT_PATTERN.test(message) && !CREATION_INTENT_PATTERN.test(message)
}

// ─── PROGRAM_INTENT_PATTERN ───────────────────────────────────────────────────

describe('PROGRAM_INTENT_PATTERN — schedule removed', () => {
  it('does NOT match standalone schedule questions', () => {
    expect(PROGRAM_INTENT_PATTERN.test("What's my workout schedule this week?")).toBe(false)
    expect(PROGRAM_INTENT_PATTERN.test("Show me my schedule")).toBe(false)
    expect(PROGRAM_INTENT_PATTERN.test("My schedule for this week")).toBe(false)
  })

  it('still matches explicit program-creation vocabulary', () => {
    expect(PROGRAM_INTENT_PATTERN.test("Build me a 12-week program")).toBe(true)
    expect(PROGRAM_INTENT_PATTERN.test("Create a 3-day split")).toBe(true)
    expect(PROGRAM_INTENT_PATTERN.test("I want a training plan")).toBe(true)
    expect(PROGRAM_INTENT_PATTERN.test("Make me a routine")).toBe(true)
    expect(PROGRAM_INTENT_PATTERN.test("6-week strength block")).toBe(true)
    expect(PROGRAM_INTENT_PATTERN.test("Upper/lower split")).toBe(true)
  })

  it('matches week counts in program requests', () => {
    expect(PROGRAM_INTENT_PATTERN.test("8 week program for beginners")).toBe(true)
    expect(PROGRAM_INTENT_PATTERN.test("8-week program")).toBe(true)
  })
})

// ─── LOOKUP_INTENT_PATTERN ────────────────────────────────────────────────────

describe('LOOKUP_INTENT_PATTERN — informational signal detection', () => {
  it('matches schedule lookup questions', () => {
    expect(LOOKUP_INTENT_PATTERN.test("What's my workout schedule this week?")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("What's my next workout?")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("what workouts have I completed?")).toBe(true)
  })

  it('matches step and health metric questions', () => {
    expect(LOOKUP_INTENT_PATTERN.test("How many steps did I average this week?")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("How much sleep did I get?")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("My steps today")).toBe(true)
  })

  it('matches history and log queries', () => {
    expect(LOOKUP_INTENT_PATTERN.test("Show me my workout history")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("Activity history for last week")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("Did I train on Monday?")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("Have I done any cardio this week?")).toBe(true)
  })

  it('matches current-state lookups', () => {
    expect(LOOKUP_INTENT_PATTERN.test("Show me my current program")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("What's my active plan?")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("My recent workouts")).toBe(true)
    expect(LOOKUP_INTENT_PATTERN.test("My next workout")).toBe(true)
  })

  it('matches correction redirects ("No, I asked about…")', () => {
    expect(LOOKUP_INTENT_PATTERN.test("No, I asked about my steps")).toBe(true)
  })
})

// ─── CREATION_INTENT_PATTERN ──────────────────────────────────────────────────

describe('CREATION_INTENT_PATTERN — explicit creation verb detection', () => {
  it('matches explicit build/make/create verbs', () => {
    expect(CREATION_INTENT_PATTERN.test("Build me a 6-week program")).toBe(true)
    expect(CREATION_INTENT_PATTERN.test("Make me a routine")).toBe(true)
    expect(CREATION_INTENT_PATTERN.test("Create me a 3-day split")).toBe(true)
    expect(CREATION_INTENT_PATTERN.test("Create a new plan")).toBe(true)
    expect(CREATION_INTENT_PATTERN.test("Generate me a program")).toBe(true)
    expect(CREATION_INTENT_PATTERN.test("Design me a training plan")).toBe(true)
    expect(CREATION_INTENT_PATTERN.test("Give me a new routine")).toBe(true)
  })

  it('does NOT match lookup-only messages', () => {
    expect(CREATION_INTENT_PATTERN.test("What's my schedule?")).toBe(false)
    expect(CREATION_INTENT_PATTERN.test("How many steps?")).toBe(false)
    expect(CREATION_INTENT_PATTERN.test("Show me my program")).toBe(false)
    expect(CREATION_INTENT_PATTERN.test("Did I train yesterday?")).toBe(false)
  })
})

// ─── Combined isLookupTurn logic ──────────────────────────────────────────────

describe('currentTurnIsLookup — combined gate bypass logic', () => {
  it('bypasses gate for schedule lookup', () => {
    expect(isLookupTurn("What's my workout schedule this week?")).toBe(true)
  })

  it('bypasses gate for step question', () => {
    expect(isLookupTurn("How many steps did I average this week?")).toBe(true)
  })

  it('bypasses gate for completion history', () => {
    expect(isLookupTurn("What workouts have I completed?")).toBe(true)
  })

  it('bypasses gate for next-workout question', () => {
    expect(isLookupTurn("What's my next workout?")).toBe(true)
  })

  it('bypasses gate for current-program lookup', () => {
    expect(isLookupTurn("Show me my current program")).toBe(true)
  })

  it('does NOT bypass gate for explicit program creation', () => {
    expect(isLookupTurn("Build me a 12-week program")).toBe(false)
    expect(isLookupTurn("Make me a 3-day split")).toBe(false)
    expect(isLookupTurn("Create a new training plan")).toBe(false)
  })

  it('creation verb overrides lookup signal in the same message', () => {
    // "Build me a program — what equipment do I need?" has both.
    // Creation verb wins → not a lookup bypass.
    expect(isLookupTurn("Build me a program, what equipment should I bring?")).toBe(false)
  })

  it('intake-continuation answers are NOT treated as lookups', () => {
    // Short answers that resolve intake fields ("4 days a week", "I have dumbbells")
    // contain no lookup signal and no creation verb → gate fires normally to check
    // remaining missing fields or proceed to generation.
    expect(isLookupTurn("4 days a week")).toBe(false)
    expect(isLookupTurn("I have dumbbells and a barbell")).toBe(false)
    expect(isLookupTurn("Muscle gain")).toBe(false)
    expect(isLookupTurn("I train at the gym")).toBe(false)
  })
})

// ─── selectRoundTools — tool-list + execution-boundary invariants ─────────────

const SEARCH_TOOL  = { function: { name: 'search_exercises' } }
const WORKOUT_TOOL = { function: { name: 'propose_workout' } }
const PROGRAM_TOOL = { function: { name: 'propose_program' } }
const ALL_TOOLS = [SEARCH_TOOL, WORKOUT_TOOL, PROGRAM_TOOL] as const

describe('selectRoundTools — propose_program availability', () => {
  it('lookup turn: propose_program excluded from tool list', () => {
    const { tools } = selectRoundTools(ALL_TOOLS, false, true)
    expect(tools.map(t => t.function.name)).not.toContain('propose_program')
  })

  it('lookup turn: search_exercises and propose_workout still available', () => {
    const { tools } = selectRoundTools(ALL_TOOLS, false, true)
    const names = tools.map(t => t.function.name)
    expect(names).toContain('search_exercises')
    expect(names).toContain('propose_workout')
  })

  it('lookup turn: tool_choice is auto (not forced)', () => {
    const { tool_choice } = selectRoundTools(ALL_TOOLS, false, true)
    expect(tool_choice).toBe('auto')
  })

  it('non-lookup chat turn: all three tools available', () => {
    const { tools, tool_choice } = selectRoundTools(ALL_TOOLS, false, false)
    expect(tools.map(t => t.function.name)).toContain('propose_program')
    expect(tools).toHaveLength(3)
    expect(tool_choice).toBe('auto')
  })

  it('program generation mode: only propose_program available', () => {
    const { tools, tool_choice } = selectRoundTools(ALL_TOOLS, true, false)
    expect(tools).toHaveLength(1)
    expect(tools[0].function.name).toBe('propose_program')
  })

  it('program generation mode: tool_choice forces propose_program', () => {
    const { tool_choice } = selectRoundTools(ALL_TOOLS, true, false)
    expect(typeof tool_choice).toBe('object')
    expect((tool_choice as { type: string; function: { name: string } }).function.name).toBe('propose_program')
  })

  it('program generation mode + lookup: generation mode wins, propose_program still forced', () => {
    // programGenerationMode=true takes precedence — once all intake fields are
    // complete and the model is generating, a lookup signal in the same message
    // does not demote the round back to chat mode.
    const { tools, tool_choice } = selectRoundTools(ALL_TOOLS, true, true)
    expect(tools).toHaveLength(1)
    expect(tools[0].function.name).toBe('propose_program')
    expect(typeof tool_choice).toBe('object')
  })
})

describe('selectRoundTools — scenario: schedule lookup mid-program-intake', () => {
  it('step question cannot call propose_program', () => {
    const msg = "How many steps did I average this week?"
    const isLookup = LOOKUP_INTENT_PATTERN.test(msg) && !CREATION_INTENT_PATTERN.test(msg)
    const { tools } = selectRoundTools(ALL_TOOLS, false, isLookup)
    expect(tools.map(t => t.function.name)).not.toContain('propose_program')
  })

  it('schedule question cannot call propose_program', () => {
    const msg = "What's my workout schedule this week?"
    const isLookup = LOOKUP_INTENT_PATTERN.test(msg) && !CREATION_INTENT_PATTERN.test(msg)
    const { tools } = selectRoundTools(ALL_TOOLS, false, isLookup)
    expect(tools.map(t => t.function.name)).not.toContain('propose_program')
  })

  it('history question cannot call propose_program', () => {
    const msg = "What workouts have I completed this week?"
    const isLookup = LOOKUP_INTENT_PATTERN.test(msg) && !CREATION_INTENT_PATTERN.test(msg)
    const { tools } = selectRoundTools(ALL_TOOLS, false, isLookup)
    expect(tools.map(t => t.function.name)).not.toContain('propose_program')
  })

  it('redirect ("No, I asked about my steps") cannot call propose_program', () => {
    const msg = "No, I asked about my steps"
    const isLookup = LOOKUP_INTENT_PATTERN.test(msg) && !CREATION_INTENT_PATTERN.test(msg)
    const { tools } = selectRoundTools(ALL_TOOLS, false, isLookup)
    expect(tools.map(t => t.function.name)).not.toContain('propose_program')
  })

  it('explicit creation request CAN call propose_program (chat mode, intake complete)', () => {
    const msg = "Build me a 12-week program"
    const isLookup = LOOKUP_INTENT_PATTERN.test(msg) && !CREATION_INTENT_PATTERN.test(msg)
    const { tools } = selectRoundTools(ALL_TOOLS, false, isLookup)
    expect(tools.map(t => t.function.name)).toContain('propose_program')
  })

  it('"Can you put together a training plan?" is treated as program intent, not a lookup', () => {
    // Natural phrasing without explicit creation verb — PROGRAM_INTENT_PATTERN
    // matches "plan"; CREATION_INTENT_PATTERN does NOT match → no explicit creation
    // verb. LOOKUP_INTENT_PATTERN does NOT match → isLookup=false → propose_program
    // available.
    const msg = "Can you put together a training plan?"
    const matchesProgram = PROGRAM_INTENT_PATTERN.test(msg)
    const isLookup = LOOKUP_INTENT_PATTERN.test(msg) && !CREATION_INTENT_PATTERN.test(msg)
    expect(matchesProgram).toBe(true)
    expect(isLookup).toBe(false)
    const { tools } = selectRoundTools(ALL_TOOLS, false, isLookup)
    expect(tools.map(t => t.function.name)).toContain('propose_program')
  })

  it('"I want a routine" is treated as program intent, not a lookup', () => {
    const msg = "I want a routine"
    const matchesProgram = PROGRAM_INTENT_PATTERN.test(msg)
    const isLookup = LOOKUP_INTENT_PATTERN.test(msg) && !CREATION_INTENT_PATTERN.test(msg)
    expect(matchesProgram).toBe(true)
    expect(isLookup).toBe(false)
    const { tools } = selectRoundTools(ALL_TOOLS, false, isLookup)
    expect(tools.map(t => t.function.name)).toContain('propose_program')
  })
})
