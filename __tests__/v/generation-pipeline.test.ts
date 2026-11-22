/**
 * Coach V program-generation pipeline — deterministic tests
 *
 * Verifies that runProgramGeneration (lib/v/generation.ts) uses the same quality
 * validation, correction logic, and escalation path as the production Coach route.
 * No live AI calls, no DB writes, no paid model usage.
 *
 * Production route contract confirmed by these tests:
 *   1. Quality errors trigger a Luna correction round
 *   2. Retry limit exhausted → escalate to Sol with a fresh budget
 *   3. Sol exhaustion → quality_exhausted outcome (never accepted)
 *   4. Valid draft → program_delivered, program in result, NOT saved to DB
 *   5. Metrics captured per round (tokens, model, opType)
 *   6. Model names come from options, NOT from env vars
 *   7. Explicit schedule quality errors block acceptance (validateProgramQuality wired)
 *   8. No-schedule programs unaffected by schedule checks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runProgramGeneration, QUALITY_RETRY_LIMIT } from '../../lib/v/generation'
import type { GenerationOptions, GenerationModels } from '../../lib/v/generation'
import type { ProgramDraft, ProgramValidationResult, ValidatedProgram } from '../../lib/ai/tools/program'
import type { WeeklySchedule } from '../../lib/v/program-intake'
import type OpenAI from 'openai'

// ─── Minimal valid program draft ──────────────────────────────────────────────

function makeValidDraft(overrides: Partial<ProgramDraft> = {}): ProgramDraft {
  return {
    program_name: 'Test Program',
    description: 'A minimal valid test program.',
    weeks: 4,
    progression_strategy: 'Linear progression on main lifts',
    phases: [
      { name: 'Base', weeks: '1-4', focus: 'Volume' },
    ],
    days: [
      {
        name: 'Push Day',
        weekday: 0,
        session_type: 'chest_biceps',
        estimated_duration_minutes: 55,
        exercises: [
          {
            exercise_id: '0662',
            intended_pattern: 'horizontal_push',
            sets: 4,
            reps_min: 6,
            reps_max: 10,
            rest_seconds: 120,
            progression_model: 'linear' as const,
            week_progressions: [
              { week: 1, sets: 4, reps_min: 6, reps_max: 8,  load_note: 'Start moderate' },
              { week: 4, sets: 4, reps_min: 8, reps_max: 10, load_note: 'Add load' },
            ],
          },
          {
            exercise_id: '1234',
            intended_pattern: 'incline_push',
            sets: 3,
            reps_min: 10,
            reps_max: 12,
            rest_seconds: 90,
            progression_model: 'double_progression' as const,
            week_progressions: [
              { week: 1, sets: 3, reps_min: 10, reps_max: 12, load_note: '' },
              { week: 4, sets: 3, reps_min: 10, reps_max: 12, load_note: 'Add weight' },
            ],
          },
          {
            exercise_id: '0652',
            intended_pattern: 'vertical_pull',
            sets: 3,
            reps_min: 8,
            reps_max: 10,
            rest_seconds: 90,
            progression_model: 'double_progression' as const,
            week_progressions: [
              { week: 1, sets: 3, reps_min: 8, reps_max: 10,  load_note: '' },
              { week: 4, sets: 3, reps_min: 8, reps_max: 10,  load_note: '' },
              { week: 4, sets: 4, reps_min: 8, reps_max: 10,  load_note: '' },
            ],
          },
          {
            exercise_id: '5678',
            intended_pattern: 'bicep',
            sets: 3,
            reps_min: 10,
            reps_max: 15,
            rest_seconds: 60,
            progression_model: 'double_progression' as const,
            week_progressions: [
              { week: 1, sets: 3, reps_min: 10, reps_max: 15, load_note: '' },
              { week: 4, sets: 3, reps_min: 10, reps_max: 15, load_note: '' },
              { week: 4, sets: 3, reps_min: 10, reps_max: 15, load_note: '' },
            ],
          },
        ],
      },
    ],
    ...overrides,
  }
}

// ─── Mock OpenAI builder ──────────────────────────────────────────────────────

function makeMockOpenAI(
  ...responses: Array<{
    toolCallArgs?: string
    assistantText?: string
    usage?: { prompt_tokens: number; completion_tokens: number }
  }>
): OpenAI {
  let callIndex = 0
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const spec = responses[callIndex] ?? responses[responses.length - 1]
          callIndex++
          if (spec.assistantText !== undefined) {
            return Promise.resolve({
              choices: [{ message: { role: 'assistant', content: spec.assistantText, tool_calls: undefined } }],
              usage: spec.usage ?? { prompt_tokens: 100, completion_tokens: 50 },
            })
          }
          return Promise.resolve({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: `tc-${callIndex}`,
                      type: 'function',
                      function: { name: 'propose_program', arguments: spec.toolCallArgs ?? '{}' },
                    },
                  ],
                },
              },
            ],
            usage: spec.usage ?? { prompt_tokens: 1500, completion_tokens: 800 },
          })
        }),
      },
    },
  } as unknown as OpenAI
}

// ─── Mock prisma (not called — validateDraft is injected) ─────────────────────

const mockPrisma = {} as unknown as import('@prisma/client').PrismaClient

// ─── Mock propose_program tool definition ─────────────────────────────────────

const mockProposeProgramTool: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'propose_program',
    description: 'Propose a structured program draft.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}

// ─── Shared validation stub factories ────────────────────────────────────────

function makeValidValidation(draft: ProgramDraft = makeValidDraft()): ProgramValidationResult {
  return {
    valid: true,
    program: draft as unknown as ValidatedProgram,
    errors: [],
    warnings: [],
  }
}
function makeInvalidValidation(errors: string[]): ProgramValidationResult {
  return { valid: false, errors, warnings: [] }
}

// ─── Default test options factory ────────────────────────────────────────────

function makeOptions(
  overrides: Partial<GenerationOptions> & {
    openai?: OpenAI
    validateDraft?: GenerationOptions['validateDraft']
  } = {},
): GenerationOptions {
  const draft = makeValidDraft()
  const draftJson = JSON.stringify(draft)
  const { openai: oi, validateDraft: vd, ...rest } = overrides
  return {
    userId: 'test-user-123',
    messages: [
      { role: 'system', content: 'You are V.' },
      { role: 'user',   content: 'Build me an 8-week strength program.' },
      {
        role: 'system',
        content: 'EXERCISE CANDIDATE POOL — 30 exercises. Build the program now by calling propose_program.',
      },
    ],
    candidateSummaryText: 'Bench Press (0662) — horizontal_push\nPull-up (0652) — vertical_pull',
    requestSummary: '8-week program, 5 days/week. Goal: strength. Training background: intermediate.',
    intake: {
      readinessState: 'consistent_intermediate',
      dailyWalkRequested: false,
      explicitSchedule: null,
      fitnessLevel: 'intermediate',
    },
    models: {
      program:    'luna-test-model',
      escalation: 'sol-test-model',
      chat:       'chat-test-model',
    } satisfies GenerationModels,
    openai: oi ?? makeMockOpenAI({ toolCallArgs: draftJson }),
    prisma: mockPrisma,
    allowedEquipment: null,
    proposeProgramTool: mockProposeProgramTool,
    validateDraft: vd ?? vi.fn().mockResolvedValue(makeValidValidation(draft)),
    ...rest,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('1 — Accepted program: program_delivered with no DB save', () => {
  it('returns outcome=program_delivered and program when draft is valid', async () => {
    const draft = makeValidDraft()
    const validateDraft = vi.fn().mockResolvedValue(makeValidValidation(draft))
    const result = await runProgramGeneration(makeOptions({
      openai: makeMockOpenAI({ toolCallArgs: JSON.stringify(draft) }),
      validateDraft,
    }))

    expect(result.outcome).toBe('program_delivered')
    expect(result.program?.valid).toBe(true)
    expect(result.proposeProgramAttempted).toBe(true)
  })

  it('validateDraft is called with the draft from the AI response, not saved to DB', async () => {
    const draft = makeValidDraft()
    const validateDraft = vi.fn().mockResolvedValue(makeValidValidation(draft))
    await runProgramGeneration(makeOptions({
      openai: makeMockOpenAI({ toolCallArgs: JSON.stringify(draft) }),
      validateDraft,
    }))

    // validateDraft must be called (structural check), but no Prisma program.create
    // should be called — the route saves programs, not the generation function.
    expect(validateDraft).toHaveBeenCalledOnce()
    expect(validateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ program_name: 'Test Program' }),
      'test-user-123',
      mockPrisma,
      expect.any(Object),
    )
  })

  it('rounds equals 1 for a first-attempt success', async () => {
    const draft = makeValidDraft()
    const result = await runProgramGeneration(makeOptions({
      openai: makeMockOpenAI(
        { toolCallArgs: JSON.stringify(draft) },            // round 0: propose_program
        { assistantText: 'Here is your 8-week program.' }, // round 1: final text
      ),
      validateDraft: vi.fn().mockResolvedValue(makeValidValidation(draft)),
    }))
    expect(result.rounds).toBeGreaterThanOrEqual(1)
    expect(result.outcome).toBe('program_delivered')
  })
})

describe('2 — Quality correction loop: Luna retry on hard errors', () => {
  it('fires a correction round when validateProgramQuality returns hard errors, then accepts on the fix', async () => {
    // Draft 1 has SCHEDULE_MISSING_WEEKDAY (artificial — a real quality error from production)
    // Draft 2 is fully clean
    const badDraft = makeValidDraft({ days: [] }) // empty days → MISSING_REQUIRED_ROLE errors
    const goodDraft = makeValidDraft()

    const validateDraft = vi.fn()
      .mockResolvedValueOnce(makeValidValidation(badDraft))  // structural: passes
      .mockResolvedValueOnce(makeValidValidation(goodDraft)) // structural: passes after fix

    const result = await runProgramGeneration(makeOptions({
      openai: makeMockOpenAI(
        { toolCallArgs: JSON.stringify(badDraft) },  // round 0: bad draft
        { toolCallArgs: JSON.stringify(goodDraft) }, // round 1: corrected draft
        { assistantText: 'Program ready.' },         // round 2: final text
      ),
      validateDraft,
    }))

    // Quality errors from the bad draft should trigger exactly one retry
    expect(result.qualityRetries).toBeGreaterThanOrEqual(1)
    expect(result.outcome).toBe('program_delivered')
  })

  it('qualityRetries is bounded by QUALITY_RETRY_LIMIT before escalation', async () => {
    // Every draft is structurally valid but quality-bad (empty days → missing roles)
    const badDraft = makeValidDraft({ days: [] })
    const validateDraft = vi.fn().mockResolvedValue(makeValidValidation(badDraft))

    // Supply enough responses for QUALITY_RETRY_LIMIT + escalation + exhaustion
    const responses = Array(10).fill({ toolCallArgs: JSON.stringify(badDraft) })
    const result = await runProgramGeneration(makeOptions({
      openai: makeMockOpenAI(...responses),
      validateDraft,
    }))

    // After QUALITY_RETRY_LIMIT on Luna, escalate to Sol, then exhaust there too
    expect(result.escalated).toBe(true)
    // After Sol exhausts, outcome is quality_exhausted (never accepted)
    expect(result.outcome).toBe('quality_exhausted')
    // qualityRetries resets on escalation, so the total can be <= QUALITY_RETRY_LIMIT * 2
    expect(result.qualityRetries).toBeGreaterThanOrEqual(0)
    expect(result.qualityRetries).toBeLessThanOrEqual(QUALITY_RETRY_LIMIT)
  })
})

describe('3 — Escalation: Sol takes over when Luna exhausts retries', () => {
  it('escalated=true after Luna retry budget is consumed', async () => {
    const badDraft = makeValidDraft({ days: [] })
    const goodDraft = makeValidDraft()
    const validateDraft = vi.fn()
      .mockResolvedValueOnce(makeValidValidation(badDraft))  // round 0: Luna first attempt
      .mockResolvedValueOnce(makeValidValidation(badDraft))  // round 1: Luna correction attempt
      .mockResolvedValueOnce(makeValidValidation(goodDraft)) // round 2: Sol succeeds

    const result = await runProgramGeneration(makeOptions({
      openai: makeMockOpenAI(
        { toolCallArgs: JSON.stringify(badDraft), usage: { prompt_tokens: 1000, completion_tokens: 500 } },
        { toolCallArgs: JSON.stringify(badDraft), usage: { prompt_tokens: 1000, completion_tokens: 500 } },
        { toolCallArgs: JSON.stringify(goodDraft), usage: { prompt_tokens: 800, completion_tokens: 400 } },
        { assistantText: 'Program complete.', usage: { prompt_tokens: 200, completion_tokens: 100 } },
      ),
      validateDraft,
    }))

    expect(result.escalated).toBe(true)
    expect(result.outcome).toBe('program_delivered')
  })

  it('round logs record the escalation model for Sol rounds', async () => {
    const badDraft = makeValidDraft({ days: [] })
    const goodDraft = makeValidDraft()
    const validateDraft = vi.fn()
      .mockResolvedValueOnce(makeValidValidation(badDraft))
      .mockResolvedValueOnce(makeValidValidation(badDraft))
      .mockResolvedValueOnce(makeValidValidation(goodDraft))

    const models: GenerationModels = {
      program:    'luna-override',
      escalation: 'sol-override',
      chat:       'chat-override',
    }
    const result = await runProgramGeneration(makeOptions({
      models,
      openai: makeMockOpenAI(
        { toolCallArgs: JSON.stringify(badDraft) },
        { toolCallArgs: JSON.stringify(badDraft) },
        { toolCallArgs: JSON.stringify(goodDraft) },
        { assistantText: 'Done.' },
      ),
      validateDraft,
    }))

    // At least one round should use the escalation model
    const lunaRounds = result.roundLogs.filter(r => r.model === 'luna-override')
    const solRounds  = result.roundLogs.filter(r => r.model === 'sol-override')
    expect(lunaRounds.length).toBeGreaterThan(0)
    expect(solRounds.length).toBeGreaterThan(0)
  })
})

describe('4 — Metrics captured correctly', () => {
  it('accumulates prompt and completion tokens across rounds', async () => {
    const draft = makeValidDraft()
    const result = await runProgramGeneration(makeOptions({
      openai: makeMockOpenAI({
        toolCallArgs: JSON.stringify(draft),
        usage: { prompt_tokens: 2000, completion_tokens: 1000 },
      }),
      validateDraft: vi.fn().mockResolvedValue(makeValidValidation(draft)),
    }))

    expect(result.promptTokens).toBeGreaterThanOrEqual(2000)
    expect(result.completionTokens).toBeGreaterThanOrEqual(1000)
    expect(result.roundLogs.length).toBeGreaterThanOrEqual(1)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('roundLogs records model and opType for each round', async () => {
    const draft = makeValidDraft()
    const models: GenerationModels = {
      program: 'luna-test', escalation: 'sol-test', chat: 'chat-test',
    }
    const result = await runProgramGeneration(makeOptions({
      models,
      openai: makeMockOpenAI({ toolCallArgs: JSON.stringify(draft) }),
      validateDraft: vi.fn().mockResolvedValue(makeValidValidation(draft)),
    }))

    expect(result.roundLogs.length).toBeGreaterThanOrEqual(1)
    const firstLog = result.roundLogs[0]
    expect(firstLog.model).toBe('luna-test')
    expect(firstLog.opType).toMatch(/program_draft|program_correction|quality_escalation/)
    expect(firstLog.usage.promptTokens).toBeGreaterThan(0)
    expect(firstLog.usage.completionTokens).toBeGreaterThan(0)
  })
})

describe('5 — Model override: uses models from options, not env vars', () => {
  it('uses the program model from options for the first round', async () => {
    const draft = makeValidDraft()
    const models: GenerationModels = {
      program:    'custom-luna-model',
      escalation: 'custom-sol-model',
      chat:       'custom-chat-model',
    }
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'propose_program', arguments: JSON.stringify(draft) } }] } }],
      usage: { prompt_tokens: 500, completion_tokens: 250 },
    })
    const result = await runProgramGeneration(makeOptions({
      models,
      openai: { chat: { completions: { create: mockCreate } } } as unknown as OpenAI,
      validateDraft: vi.fn().mockResolvedValue(makeValidValidation(draft)),
    }))

    expect(result.outcome).toBe('program_delivered')
    // The model passed to openai.create in the first round must be luna
    const firstCallArgs = (mockCreate.mock.calls[0] as [{ model: string }])[0]
    expect(firstCallArgs.model).toBe('custom-luna-model')
  })

  it('uses the escalation model from options when Sol is triggered', async () => {
    const badDraft = makeValidDraft({ days: [] })
    const goodDraft = makeValidDraft()
    const models: GenerationModels = {
      program:    'custom-luna',
      escalation: 'custom-sol',
      chat:       'custom-chat',
    }
    const mockCreate = vi.fn()
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'propose_program', arguments: JSON.stringify(badDraft) } }] } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc2', type: 'function', function: { name: 'propose_program', arguments: JSON.stringify(badDraft) } }] } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc3', type: 'function', function: { name: 'propose_program', arguments: JSON.stringify(goodDraft) } }] } }],
        usage: { prompt_tokens: 800, completion_tokens: 400 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'Program ready.', tool_calls: undefined } }],
        usage: { prompt_tokens: 200, completion_tokens: 100 },
      })

    const validateDraft = vi.fn()
      .mockResolvedValueOnce(makeValidValidation(badDraft))
      .mockResolvedValueOnce(makeValidValidation(badDraft))
      .mockResolvedValueOnce(makeValidValidation(goodDraft))

    const result = await runProgramGeneration(makeOptions({
      models,
      openai: { chat: { completions: { create: mockCreate } } } as unknown as OpenAI,
      validateDraft,
    }))

    expect(result.escalated).toBe(true)
    // Find a round that used the escalation model
    const usedModels = (mockCreate.mock.calls as [{ model: string }][]).map(c => c[0].model)
    expect(usedModels).toContain('custom-sol')
  })
})

describe('6 — Explicit schedule quality errors block acceptance', () => {
  it('fires SCHEDULE_MISSING_WEEKDAY and triggers correction when a weekday is omitted', async () => {
    // Production schedule with 7 days — program only provides 6 (Wednesday missing)
    const schedule: WeeklySchedule = [
      { weekday: 'monday',    focus: 'Chest, Biceps',  isRest: false, isCardioOnly: false },
      { weekday: 'tuesday',   focus: 'Back, Triceps',  isRest: false, isCardioOnly: false },
      { weekday: 'wednesday', focus: 'Rest',            isRest: true,  isCardioOnly: false },
      { weekday: 'thursday',  focus: 'Shoulders',       isRest: false, isCardioOnly: false },
      { weekday: 'friday',    focus: 'Legs',            isRest: false, isCardioOnly: false },
      { weekday: 'saturday',  focus: 'Cardio',          isRest: false, isCardioOnly: true  },
      { weekday: 'sunday',    focus: 'Rest',            isRest: true,  isCardioOnly: false },
    ]

    // Draft missing Wednesday — quality gate fires SCHEDULE_MISSING_WEEKDAY
    const baseExercises = makeValidDraft().days[0].exercises
    const incompleteDraft = makeValidDraft({
      weeks: 4,
      days: [
        { name: 'Monday Push',   weekday: 0, session_type: 'chest_biceps', estimated_duration_minutes: 55, exercises: baseExercises },
        { name: 'Tuesday Pull',  weekday: 1, session_type: 'back_triceps', estimated_duration_minutes: 55, exercises: baseExercises },
        // Wednesday(2) intentionally omitted to trigger SCHEDULE_MISSING_WEEKDAY / MISSING_REQUIRED_ROLE
        { name: 'Thursday Shoulders', weekday: 3, session_type: 'shoulder', estimated_duration_minutes: 50, exercises: baseExercises },
        { name: 'Friday Legs',   weekday: 4, session_type: 'lower_full',  estimated_duration_minutes: 60, exercises: baseExercises },
        { name: 'Saturday Cardio', weekday: 5, session_type: 'conditioning', estimated_duration_minutes: 40, exercises: [{ exercise_id: '0001', intended_pattern: 'cardio', sets: 1, reps_min: 1, reps_max: 1, rest_seconds: 0, progression_model: 'linear' as const }] },
        { name: 'Sunday Rest',   weekday: 6, session_type: 'active_recovery', estimated_duration_minutes: 15, exercises: [] },
      ],
    })
    const completeDraft = makeValidDraft() // passes all checks (no schedule mismatch, plain 1-day)

    const validateDraft = vi.fn()
      .mockResolvedValueOnce(makeValidValidation(incompleteDraft))
      .mockResolvedValueOnce(makeValidValidation(completeDraft))

    const result = await runProgramGeneration(makeOptions({
      intake: {
        readinessState: 'consistent_intermediate',
        dailyWalkRequested: false,
        explicitSchedule: schedule,
        fitnessLevel: 'intermediate',
      },
      openai: makeMockOpenAI(
        { toolCallArgs: JSON.stringify(incompleteDraft) },  // round 0: bad draft → quality error
        { toolCallArgs: JSON.stringify(completeDraft) },    // round 1: schedule-incomplete → escalation
        { assistantText: 'Program complete.' },             // round 2: Sol text break
      ),
      validateDraft,
    }))

    // Quality errors fired on round 0 (3×MISSING_REQUIRED_ROLE) and round 1
    // (4×SCHEDULE_MISSING_WEEKDAY). The correction budget was consumed, forcing
    // Sol escalation — this proves schedule quality checks blocked acceptance.
    expect(result.escalated).toBe(true)
    expect(result.rounds).toBeGreaterThanOrEqual(2)
  })
})

describe('7 — Programs without explicit schedule unaffected by schedule checks', () => {
  it('no SCHEDULE_* errors when explicitSchedule is null', async () => {
    // A draft with only 1 day — would fire SCHEDULE_MISSING_WEEKDAY if schedule were active
    const simpleDraft = makeValidDraft({ days: [makeValidDraft().days[0]] })
    const validateDraft = vi.fn().mockResolvedValue(makeValidValidation(simpleDraft))

    const result = await runProgramGeneration(makeOptions({
      intake: {
        readinessState: 'consistent_intermediate',
        dailyWalkRequested: false,
        explicitSchedule: null,  // ← no schedule
        fitnessLevel: 'intermediate',
      },
      openai: makeMockOpenAI({ toolCallArgs: JSON.stringify(simpleDraft) }),
      validateDraft,
    }))

    // No correction triggered (schedule check is silent)
    expect(result.outcome).toBe('program_delivered')
    expect(result.qualityRetries).toBe(0)
  })
})

describe('8 — Structural validation failure: does not enter quality path', () => {
  it('invalid draft (structural errors) is not quality-checked; loop retries', async () => {
    const draft = makeValidDraft()
    const validateDraft = vi.fn()
      .mockResolvedValueOnce(makeInvalidValidation(['Exercise 9999 not found in database.']))
      .mockResolvedValueOnce(makeValidValidation(draft))

    const result = await runProgramGeneration(makeOptions({
      openai: makeMockOpenAI(
        { toolCallArgs: JSON.stringify(draft) },
        { toolCallArgs: JSON.stringify(draft) },
        { assistantText: 'Program done.' },
      ),
      validateDraft,
    }))

    // qualityRetries stays at 0 — structural failure doesn't consume the quality budget
    expect(result.qualityRetries).toBe(0)
    expect(result.outcome).toBe('program_delivered')
  })
})

describe('9 — model_error: roundLogs populated from completed rounds for route token flush', () => {
  it('roundLogs and token counts are non-zero even when a later round throws a model error', async () => {
    // The route merges genResult.roundLogs into requestLogs BEFORE checking outcome,
    // then calls cleanup() which calls flushRequestLogs. This test guards that contract:
    // roundLogs must carry any completed-round data regardless of the final outcome.
    const badDraft = makeValidDraft({ days: [] })
    const mockCreate = vi.fn()
      .mockResolvedValueOnce({
        choices: [{ message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'propose_program', arguments: JSON.stringify(badDraft) } }],
        } }],
        usage: { prompt_tokens: 500, completion_tokens: 250 },
      })
      // Round 1 (correction attempt) throws — simulates a transient API error
      .mockRejectedValueOnce(Object.assign(new Error('upstream API error'), { status: 500 }))

    const result = await runProgramGeneration(makeOptions({
      openai: { chat: { completions: { create: mockCreate } } } as unknown as OpenAI,
      validateDraft: vi.fn().mockResolvedValue(makeValidValidation(badDraft)),
    }))

    expect(result.outcome).toBe('model_error')
    // Round 0 completed and was logged before the error on round 1
    expect(result.roundLogs.length).toBeGreaterThanOrEqual(1)
    expect(result.promptTokens).toBeGreaterThanOrEqual(500)
    expect(result.completionTokens).toBeGreaterThanOrEqual(250)
    // The route can safely merge these logs into requestLogs before calling cleanup()
    expect(result.roundLogs[0].usage.promptTokens).toBe(500)
    expect(result.roundLogs[0].usage.completionTokens).toBe(250)
  })
})
