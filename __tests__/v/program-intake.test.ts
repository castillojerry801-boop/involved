/**
 * V Coach program-intake state — multi-turn integration tests
 *
 * Reproduces the exact production conversation that looped, re-asking the same
 * days/goals question after the user already answered it. Asserts the structured
 * intake state is the single source of truth and that missingProgramContext()
 * never re-asks a resolved field.
 *
 * Exact conversation under test:
 *   User: "I want to get back in shape and build some muscle. Make me a 12-week program."
 *   V:    asks training status
 *   User: "returning from a break"
 *   V:    asks equipment
 *   User: "dumbbells, barbell, kettlebells, bench, pull-up bar, resistance bands, treadmill, rower, air dyne and cable machine"
 *   V:    asks days + goal
 *   User: "4 days I want to build muscle and lose fat"
 *   Expected: NOTHING left to ask — V proceeds to generation.
 */

import { describe, it, expect } from 'vitest'
import {
  parseProgramIntake,
  missingProgramContext,
  buildMissingContextPrompt,
  extractTrainingDays,
  extractGoals,
  extractReadiness,
  extractLocation,
  extractWeeks,
} from '../../lib/v/program-intake'
import type { VTrainingContext } from '../../lib/v/training-context'

// ─── Empty DB context (new user, nothing persisted) ───────────────────────────

function emptyCtx(overrides: Partial<VTrainingContext> = {}): VTrainingContext {
  return {
    profile: { fitnessLevel: null, goals: [], bodyMetrics: { ageYears: null, weightKg: null }, weeklyWorkoutTarget: null },
    equipment: null,
    preferences: { favorites: [], moreOften: [], lessOften: [], dontRecommend: [] },
    personalRecords: [],
    recentTraining: [],
    readinessState: null,
    coachingPresence: 'weekly_checkin',
    ...overrides,
  }
}

type Msg = { role: 'user' | 'assistant'; content: string }

// The exact production conversation, built up turn by turn.
const TURN_1: Msg[] = [
  { role: 'user', content: 'I want to get back in shape and build some muscle. Make me a 12-week program.' },
]
const TURN_2: Msg[] = [
  ...TURN_1,
  { role: 'assistant', content: 'Are you currently training, returning after a break, or is this your first time training consistently?' },
  { role: 'user', content: 'returning from a break' },
]
const TURN_3: Msg[] = [
  ...TURN_2,
  { role: 'assistant', content: 'What equipment do you have available?' },
  { role: 'user', content: 'dumbbells, barbell, kettlebells, bench, pull-up bar, resistance bands, treadmill, rower, air dyne and cable machine' },
]
const TURN_4: Msg[] = [
  ...TURN_3,
  { role: 'assistant', content: "How many days per week do you want to train, and what's your main focus: build muscle, get stronger, lose fat, or a combination?" },
  { role: 'user', content: '4 days I want to build muscle and lose fat' },
]

// ─── Field-level extractors ───────────────────────────────────────────────────

describe('extractTrainingDays — natural replies', () => {
  it('extracts from "4 days I want to build muscle and lose fat"', () => {
    expect(extractTrainingDays('4 days I want to build muscle and lose fat')).toBe(4)
  })
  it('extracts "4 days a week"', () => expect(extractTrainingDays('4 days a week')).toBe(4))
  it('extracts "4x/week"', () => expect(extractTrainingDays('4x/week')).toBe(4))
  it('extracts "train 5 days"', () => expect(extractTrainingDays('I can train 5 days')).toBe(5))
  it('extracts word number "four days"', () => expect(extractTrainingDays('four days')).toBe(4))
  it('extracts bare "4"', () => expect(extractTrainingDays('4')).toBe(4))
  it('returns null when no day signal', () => expect(extractTrainingDays('I want to build muscle')).toBeNull())
  it('rejects out-of-range "9 days"', () => expect(extractTrainingDays('9 days')).toBeNull())
})

describe('extractGoals — natural replies', () => {
  it('extracts muscle + fat from "build muscle and lose fat"', () => {
    const goals = extractGoals('4 days I want to build muscle and lose fat')
    expect(goals).toContain('muscle_gain')
    expect(goals).toContain('fat_loss')
  })
  it('orders primary by appearance: muscle first', () => {
    const goals = extractGoals('I want to build muscle and lose fat')
    expect(goals[0]).toBe('muscle_gain')
  })
  it('orders fat first when stated first', () => {
    const goals = extractGoals('I want to lose fat and build muscle')
    expect(goals[0]).toBe('fat_loss')
  })
  it('extracts strength from "get stronger"', () => {
    expect(extractGoals('I want to get stronger')).toContain('strength')
  })
  it('returns empty when no goal', () => {
    expect(extractGoals('4 days a week')).toHaveLength(0)
  })
})

describe('extractReadiness — natural replies', () => {
  it('maps "returning from a break" → detrained', () => {
    expect(extractReadiness('returning from a break')).toBe('detrained')
  })
  it('does NOT infer readiness from vague "get back in shape" — must be asked', () => {
    expect(extractReadiness('I want to get back in shape')).toBeNull()
  })
  it('maps "first time" → never_trained', () => {
    expect(extractReadiness('this is my first time')).toBe('never_trained')
  })
  it('maps "currently training" → recreationally_active', () => {
    expect(extractReadiness('I am currently training')).toBe('recreationally_active')
  })
  it('returns null when no readiness signal', () => {
    expect(extractReadiness('4 days a week')).toBeNull()
  })
})

describe('extractLocation + extractWeeks', () => {
  it('detects home', () => expect(extractLocation('I train at home')).toBe('home'))
  it('detects gym', () => expect(extractLocation('I go to a commercial gym')).toBe('gym'))
  it('extracts 12 weeks', () => expect(extractWeeks('Make me a 12-week program')).toBe(12))
})

// ─── Multi-turn state accumulation ────────────────────────────────────────────

describe('parseProgramIntake — turn-by-turn accumulation', () => {
  it('Turn 1: weeks + goal known; readiness NOT assumed from "get back in shape"', () => {
    const state = parseProgramIntake(TURN_1, emptyCtx())
    expect(state.weeks).toBe(12)
    expect(state.primaryGoal).toBe('muscle_gain')     // "build some muscle"
    expect(state.readinessState).toBeNull()            // vague phrase → must ask
    expect(state.trainingDaysPerWeek).toBeNull()
    expect(state.equipmentProfile).toBeNull()
  })

  it('Turn 2: readiness explicitly confirmed', () => {
    const state = parseProgramIntake(TURN_2, emptyCtx())
    expect(state.readinessState).toBe('detrained')
    expect(state.readinessSource).toBe('conversation')
  })

  it('Turn 3: equipment now resolved', () => {
    const state = parseProgramIntake(TURN_3, emptyCtx())
    expect(state.equipmentProfile).not.toBeNull()
    expect(state.equipmentProfile).toContain('barbell')
    expect(state.equipmentProfile).toContain('dumbbell')
    expect(state.equipmentProfile).toContain('kettlebell')
    expect(state.equipmentProfile).toContain('cable')
  })

  it('Turn 4: days + goals resolved — FULL intake complete', () => {
    const state = parseProgramIntake(TURN_4, emptyCtx())
    expect(state.trainingDaysPerWeek).toBe(4)
    expect(state.primaryGoal).toBe('muscle_gain')
    expect(state.secondaryGoals).toContain('fat_loss')
    expect(state.readinessState).toBe('detrained')
    expect(state.equipmentProfile).not.toBeNull()
    expect(state.weeks).toBe(12)
  })
})

// ─── The regression: missingProgramContext must not re-ask resolved fields ─────

describe('missingProgramContext — no re-asking resolved fields', () => {
  it('after Turn 4, NOTHING is missing — V proceeds to generation', () => {
    const state = parseProgramIntake(TURN_4, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    expect(missing).toHaveLength(0)
    expect(buildMissingContextPrompt(missing)).toBeNull()
  })

  it('after Turn 4, does NOT ask days again', () => {
    const state = parseProgramIntake(TURN_4, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    expect(missing.find(m => m.field === 'trainingDays')).toBeUndefined()
  })

  it('after Turn 4, does NOT ask goal again', () => {
    const state = parseProgramIntake(TURN_4, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    expect(missing.find(m => m.field === 'goal')).toBeUndefined()
  })

  it('Turn 3 (before days/goal answered) asks days — the ONE missing field', () => {
    // At Turn 3: readiness ✓, equipment ✓, weeks ✓, goal ✓ (from turn 1 "build muscle").
    // Only trainingDays is missing.
    const state = parseProgramIntake(TURN_3, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    expect(missing.map(m => m.field)).toEqual(['trainingDays'])
    expect(buildMissingContextPrompt(missing)).toMatch(/how many days/i)
  })

  it('Turn 1 asks readiness + equipment + days (goal inferred, readiness NOT)', () => {
    const state = parseProgramIntake(TURN_1, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    const fields = missing.map(m => m.field)
    expect(fields).toContain('readiness')   // "get back in shape" is too vague to assume
    expect(fields).toContain('equipment')
    expect(fields).toContain('trainingDays')
    // goal inferred from "build muscle"
    expect(fields).not.toContain('goal')
    // readiness is asked first (12-week program requires it)
    expect(buildMissingContextPrompt(missing)).toMatch(/currently training|returning|first time/i)
  })
})

// ─── Only one field missing → ask exactly that one ────────────────────────────

describe('missingProgramContext — single missing field', () => {
  it('everything but goal present → asks only goal', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'Build me an 8-week program. I train at home with dumbbells and a barbell, returning after a break, 4 days a week.' },
    ]
    const state = parseProgramIntake(msgs, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    expect(missing.map(m => m.field)).toEqual(['goal'])
    expect(buildMissingContextPrompt(missing)).toMatch(/main focus/i)
  })

  it('everything but days present → asks only days', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'Build me an 8-week muscle program. I have a full gym. Returning after a long break.' },
    ]
    const state = parseProgramIntake(msgs, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    expect(missing.map(m => m.field)).toEqual(['trainingDays'])
  })
})

// ─── DB context merge ─────────────────────────────────────────────────────────

describe('parseProgramIntake — DB fallback and conversation priority', () => {
  it('uses DB weekly target when conversation omits days', () => {
    const ctx = emptyCtx({ profile: { fitnessLevel: null, goals: [], bodyMetrics: { ageYears: null, weightKg: null }, weeklyWorkoutTarget: 3 } })
    const msgs: Msg[] = [{ role: 'user', content: 'Build me a muscle program' }]
    const state = parseProgramIntake(msgs, ctx)
    expect(state.trainingDaysPerWeek).toBe(3)
  })

  it('conversation days override DB weekly target', () => {
    const ctx = emptyCtx({ profile: { fitnessLevel: null, goals: [], bodyMetrics: { ageYears: null, weightKg: null }, weeklyWorkoutTarget: 3 } })
    const msgs: Msg[] = [{ role: 'user', content: 'Actually I want to train 5 days' }]
    const state = parseProgramIntake(msgs, ctx)
    expect(state.trainingDaysPerWeek).toBe(5)
  })

  it('gym location resolves equipment even with no DB profile', () => {
    const msgs: Msg[] = [{ role: 'user', content: 'Build me an 8-week muscle program, I train at a commercial gym 4 days, returning after a break' }]
    const state = parseProgramIntake(msgs, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    expect(missing.find(m => m.field === 'equipment')).toBeUndefined()
  })
})

// ─── EXACT reported production conversation (the go-ahead loop) ────────────────

describe('reported failure: first-timer, full home equipment, no days given', () => {
  // 1. user: 12-week program
  // 2. V: readiness?  3. user: "first time training consistently"
  // 4. V: equipment?  5. user: full home equipment list (NO training days anywhere)
  const conversation: Msg[] = [
    { role: 'user', content: 'I want to get back in shape and build some muscle. Make me a 12-week program.' },
    { role: 'assistant', content: 'Are you currently training, returning after a break, or is this your first time training consistently?' },
    { role: 'user', content: 'first time training consistently' },
    { role: 'assistant', content: 'What equipment do you have available at home? For example: dumbbells, barbell, kettlebells, bench, pull-up bar, resistance bands, bodyweight only, etc.' },
    { role: 'user', content: 'dumbbells, barbell, kettlebells, bench, pull-up bar, resistance bands, cable machine, treadmill, rower and air dyne' },
  ]

  it('readiness (first time) and equipment resolve, but training days is MISSING', () => {
    const state = parseProgramIntake(conversation, emptyCtx())
    expect(state.readinessState).toBe('never_trained')
    expect(state.equipmentProfile).not.toBeNull()
    expect(state.trainingDaysSource).toBeNull()      // never stated
    expect(state.trainingDaysPerWeek).toBeNull()
    expect(state.weeks).toBe(12)
  })

  it('the ONLY missing field is training days → V must ask exactly that', () => {
    const state = parseProgramIntake(conversation, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    expect(missing.map(m => m.field)).toEqual(['trainingDays'])
    expect(buildMissingContextPrompt(missing)).toBe('How many days per week can you train?')
  })

  it('pre-gate fires: program intent present AND context missing → no generation', () => {
    const state = parseProgramIntake(conversation, emptyCtx())
    const missing = missingProgramContext(state, emptyCtx())
    const conversationHasProgramIntent = conversation.some(
      m => m.role === 'user' && /\b(program|plan|routine|\d+[\s-]?week|split|schedule|build\s+me|make\s+me)\b/i.test(m.content),
    )
    // This is the exact route pre-gate condition. When true, the tool loop
    // (search + propose_program) never runs.
    expect(conversationHasProgramIntent && missing.length > 0).toBe(true)
  })

  it('a DB weeklyWorkoutTarget does NOT silently satisfy the days requirement', () => {
    // The reported user had generation proceed on a day-count they never chose.
    // Even with a profile default of 3, the program-specific requirement is unmet.
    const ctxWithTarget = emptyCtx({
      profile: { fitnessLevel: null, goals: [], bodyMetrics: { ageYears: null, weightKg: null }, weeklyWorkoutTarget: 3 },
    })
    const state = parseProgramIntake(conversation, ctxWithTarget)
    const missing = missingProgramContext(state, ctxWithTarget)
    expect(missing.map(m => m.field)).toContain('trainingDays')
  })

  it('once user answers "4 days", nothing is missing → V proceeds to generation', () => {
    const answered: Msg[] = [
      ...conversation,
      { role: 'assistant', content: 'How many days per week can you train?' },
      { role: 'user', content: '4 days' },
    ]
    const state = parseProgramIntake(answered, emptyCtx())
    expect(state.trainingDaysPerWeek).toBe(4)
    expect(state.trainingDaysSource).toBe('conversation')
    const missing = missingProgramContext(state, emptyCtx())
    expect(missing).toHaveLength(0)
    expect(buildMissingContextPrompt(missing)).toBeNull()
  })
})

// ─── Determinism: identical inputs never produce a different question ──────────

describe('deterministic gate — no-progress loop protection', () => {
  it('same conversation state yields byte-identical missing-context prompt', () => {
    const msgs: Msg[] = [{ role: 'user', content: 'make me a 12 week program, first time, dumbbells only' }]
    const a = buildMissingContextPrompt(missingProgramContext(parseProgramIntake(msgs, null), null))
    const b = buildMissingContextPrompt(missingProgramContext(parseProgramIntake(msgs, null), null))
    expect(a).toBe(b)
  })
})
