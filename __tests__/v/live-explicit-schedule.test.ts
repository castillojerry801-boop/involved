/**
 * V Coach — Live Explicit-Schedule End-to-End Test
 *
 * Verifies the FULL pipeline for the exact production request that caused
 * "How many days per week can you train?" to fire incorrectly:
 *
 *   "Build me an 8-week intermediate strength & conditioning program.
 *    Monday: Chest, Biceps, and Core
 *    Tuesday: Back and Triceps
 *    Wednesday: Legs and Shoulders
 *    Thursday: Rest from lifting, but active recovery
 *    Friday: Chest, Biceps, and Core
 *    Saturday: Back and Triceps
 *    Sunday: Rest from lifting, but active recovery
 *    I also want to walk 1 mile every day."
 *
 * This test mirrors the EXACT steps the coach route takes:
 *   1. parseProgramIntake → verify 5 days, consistent_intermediate, dailyWalk=true
 *   2. missingProgramContext → verify empty (gate passes, no question emitted)
 *   3. Build system prompt with scheduleInstruction (the same way coach route does)
 *   4. Run generation loop with real OpenAI
 *   5. Verify exercise 9001 (walking) on all 7 days
 *   6. Verify Thursday + Sunday are active_recovery days
 *   7. Verify 8 weeks
 *   8. Report rounds, tokens, cost, latency
 *
 * Guard: LIVE_AI_TEST=true
 * Run:   LIVE_AI_TEST=true npx vitest run __tests__/v/live-explicit-schedule.test.ts
 *
 * Cost estimate: ~$0.25–0.50 (gpt-4o, 7-day 8-week program)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import OpenAI from 'openai'

import { SEARCH_EXERCISES_TOOL, executeExerciseSearchAsync } from '../../lib/ai/tools/exercises'
import type { ExerciseSearchParams } from '../../lib/ai/tools/exercises'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '../../lib/ai/tools/program'
import type { ProgramDraft, ProgramValidationResult } from '../../lib/ai/tools/program'
import { validateProgramQuality } from '../../lib/v/program-quality'
import { PROGRAM_INTELLIGENCE_PROMPT } from '../../lib/v/program-intelligence'

import {
  parseProgramIntake,
  missingProgramContext,
  extractExplicitSchedule,
  extractDailyWalkRequested,
  extractReadiness,
} from '../../lib/v/program-intake'

// ─── Guard ────────────────────────────────────────────────────────────────────

const LIVE = process.env.LIVE_AI_TEST === 'true'

// ─── Load .env.local ──────────────────────────────────────────────────────────

{
  const envPath = path.resolve(__dirname, '../../.env.local')
  try {
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key && !process.env[key]) process.env[key] = value
    }
  } catch { /* rely on existing process.env */ }
}

// ─── Production message ───────────────────────────────────────────────────────

const PRODUCTION_MSG = `Build me an 8-week intermediate strength & conditioning program.
Monday: Chest, Biceps, and Core
Tuesday: Back and Triceps
Wednesday: Legs and Shoulders
Thursday: Rest from lifting, but active recovery
Friday: Chest, Biceps, and Core
Saturday: Back and Triceps
Sunday: Rest from lifting, but active recovery
I also want to walk 1 mile every day.`

// ─── Synthetic DB context (equipment from profile, no weekly target set) ─────

const DB_CTX = {
  profile: {
    fitnessLevel: 'intermediate',
    goals: [],
    bodyMetrics: { ageYears: 28, weightKg: 80 },
    weeklyWorkoutTarget: null,
  },
  equipment: { profileName: 'Full Gym', items: ['barbell', 'dumbbell', 'cables', 'machines', 'pull-up bar', 'body weight'] },
  preferences: { favorites: [], moreOften: [], lessOften: [], dontRecommend: [] },
  personalRecords: [],
  recentTraining: [],
  readinessState: null,
  coachingPresence: 'weekly_checkin' as const,
}

// ─── Deterministic intake verification (always runs, no LIVE guard) ───────────

describe('Deterministic intake verification — production message', () => {
  it('parseProgramIntake: 5 training days, source=conversation', () => {
    const intake = parseProgramIntake([{ role: 'user', content: PRODUCTION_MSG }], DB_CTX)
    expect(intake.trainingDaysPerWeek).toBe(5)
    expect(intake.trainingDaysSource).toBe('conversation')
  })

  it('parseProgramIntake: readinessState=consistent_intermediate (not recreationally_active)', () => {
    const intake = parseProgramIntake([{ role: 'user', content: PRODUCTION_MSG }], DB_CTX)
    expect(intake.readinessState).toBe('consistent_intermediate')
  })

  it('parseProgramIntake: weeks=8', () => {
    const intake = parseProgramIntake([{ role: 'user', content: PRODUCTION_MSG }], DB_CTX)
    expect(intake.weeks).toBe(8)
  })

  it('parseProgramIntake: dailyWalkRequested=true', () => {
    const intake = parseProgramIntake([{ role: 'user', content: PRODUCTION_MSG }], DB_CTX)
    expect(intake.dailyWalkRequested).toBe(true)
  })

  it('parseProgramIntake: explicitSchedule has 7 entries (5 training, 2 rest)', () => {
    const intake = parseProgramIntake([{ role: 'user', content: PRODUCTION_MSG }], DB_CTX)
    expect(intake.explicitSchedule).not.toBeNull()
    expect(intake.explicitSchedule!.filter(d => !d.isRest).length).toBe(5)
    expect(intake.explicitSchedule!.filter(d => d.isRest).length).toBe(2)
  })

  it('parseProgramIntake: equipment comes from DB profile', () => {
    const intake = parseProgramIntake([{ role: 'user', content: PRODUCTION_MSG }], DB_CTX)
    expect(intake.equipmentProfile).toContain('barbell')
  })

  it('missingProgramContext: returns empty → no questions, generation starts immediately', () => {
    const intake = parseProgramIntake([{ role: 'user', content: PRODUCTION_MSG }], DB_CTX)
    const missing = missingProgramContext(intake, DB_CTX)
    expect(missing).toHaveLength(0)
  })

  it('scheduleInstruction text: contains MUST FOLLOW and all 7 days', () => {
    const intake = parseProgramIntake([{ role: 'user', content: PRODUCTION_MSG }], DB_CTX)
    const instruction = intake.explicitSchedule
      ? `MUST FOLLOW THIS EXACT WEEKLY SCHEDULE:\n` +
        intake.explicitSchedule.map(d =>
          `${d.weekday.charAt(0).toUpperCase() + d.weekday.slice(1)}: ${d.focus}`
        ).join('\n')
      : '(no schedule)'
    expect(instruction).toMatch(/MUST FOLLOW THIS EXACT WEEKLY SCHEDULE/)
    expect(instruction).toMatch(/Monday/)
    expect(instruction).toMatch(/Thursday/)
    expect(instruction).toMatch(/Sunday/)
  })
})

// ─── Generation result type ───────────────────────────────────────────────────

interface GenerationResult {
  success: boolean
  program: ProgramDraft | null
  validationResult: ProgramValidationResult | null
  rounds: number
  qualityRetries: number
  nudgesUsed: number
  totalInputTokens: number
  totalOutputTokens: number
  durationMs: number
  errorCode?: string
  qualityIssues: Array<{ severity: string; code: string; message: string }>
}

// ─── Full generation loop — mirrors the coach route's programGenerationMode ───

async function runGenerationFromProductionMsg(openai: OpenAI): Promise<GenerationResult> {
  const intake = parseProgramIntake([{ role: 'user', content: PRODUCTION_MSG }], DB_CTX)

  const programDays         = 7
  const MAX_ROUNDS          = Math.min(Math.max(16, programDays * 4 + 6), 36)
  const QUALITY_RETRY_LIMIT = 5
  const TOKEN_BUDGET_INPUT  = 600_000
  const TOKEN_BUDGET_OUTPUT = 60_000

  // Exactly what the coach route builds for requestSummary + scheduleInstruction
  const scheduleSuffix = intake.explicitSchedule
    ? ` Weekly schedule: ${intake.explicitSchedule.map(d => `${d.weekday}=${d.isRest ? 'rest' : d.focus}`).join(', ')}.`
    : ''
  const walkSuffix = intake.dailyWalkRequested ? ' Daily walk (exercise 9001) required every day.' : ''
  const requestSummary =
    `${intake.weeks ?? '?'}-week program, ${intake.trainingDaysPerWeek ?? '?'} days/week. ` +
    `Goal: ${intake.primaryGoal ?? 'general fitness'}. ` +
    `Training background: ${intake.readinessState ?? 'unspecified'}. ` +
    `Equipment: ${intake.equipmentProfile?.join(', ') ?? 'full gym'}.` +
    scheduleSuffix + walkSuffix

  const scheduleInstruction = intake.explicitSchedule
    ? `\n\nMUST FOLLOW THIS EXACT WEEKLY SCHEDULE:\n` +
      intake.explicitSchedule.map(d =>
        `${d.weekday.charAt(0).toUpperCase() + d.weekday.slice(1)}: ${d.focus}`
      ).join('\n')
    : ''

  const requiredDailyActivityIds = intake.dailyWalkRequested ? ['9001'] : undefined

  const systemPrompt = `You are Involved V, an AI training program designer.

RULES:
• Only use exercise IDs returned by search_exercises. Never invent IDs.
• Search for exercises for each day separately — one search per movement-pattern role per day.
• Plan all movement-pattern roles first. Then search to fill them. Never search first and assemble later.
• Respect equipment constraints and exercise preferences.
• Complete the Program Review Pass before calling propose_program.
• Set weeks and progression_strategy when designing programs longer than one week.
• For programs ≥ 4 weeks: populate progression_strategy with specific percentages or volume changes.
• For programs ≥ 8 weeks: define phases in the program draft.
• For main compound lifts in strength programs: populate week_progressions for at least 4 weeks.
${PROGRAM_INTELLIGENCE_PROMPT}

REQUEST (immutable): ${requestSummary}`

  const candidatePoolMsg =
    `Build the full 8-week program NOW by calling propose_program, using ONLY exercise IDs from search results. ` +
    `You have sufficient candidates. Do NOT request more searches.` +
    scheduleInstruction

  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: PRODUCTION_MSG + '\n\nSearch for exercises for each day, then propose the full 8-week program.' },
  ]

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_PROGRAM_TOOL]
  let pendingProgram: ProgramValidationResult | null = null
  let pendingDraft: ProgramDraft | null = null
  let qualityRetries = 0
  let qualityFailed  = false
  let totalInputTokens  = 0
  let totalOutputTokens = 0
  let nudgesUsed = 0
  let round = 0
  let searchPhaseDone = false
  const startMs = Date.now()

  for (; round < MAX_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model:       'gpt-4o',
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens:  8000,
      temperature: 0.7,
    })

    const choice = response.choices[0]
    if (response.usage) {
      totalInputTokens  += response.usage.prompt_tokens     ?? 0
      totalOutputTokens += response.usage.completion_tokens ?? 0
      if (totalInputTokens > TOKEN_BUDGET_INPUT || totalOutputTokens > TOKEN_BUDGET_OUTPUT) {
        console.warn('[test budget-exceeded]', { totalInputTokens, totalOutputTokens, round })
        break
      }
    }
    messages.push(choice.message)

    if (!choice.message.tool_calls?.length) {
      if (pendingProgram !== null || qualityFailed) break
      // After search phase, inject candidate pool message and force propose_program
      if (!searchPhaseDone) {
        searchPhaseDone = true
        messages.push({ role: 'user', content: candidatePoolMsg })
        continue
      }
      if (nudgesUsed < 2) {
        nudgesUsed++
        messages.push({ role: 'user', content: 'Please call propose_program now with the exercises you have already found.' })
        continue
      }
      break
    }

    // Track when search phase ends
    const hasPropose = choice.message.tool_calls.some(
      (c: unknown) => (c as { function: { name: string } }).function.name === 'propose_program'
    )
    if (!hasPropose && !searchPhaseDone) {
      // Still in search phase — after all searches in this round complete, inject
      // the schedule instruction for the draft
    }

    for (const call of choice.message.tool_calls) {
      const fn = (call as unknown as { function: { name: string; arguments: string } }).function
      let result: string

      if (fn.name === 'search_exercises') {
        const params = JSON.parse(fn.arguments) as ExerciseSearchParams
        const exercises = await executeExerciseSearchAsync({ ...params, limit: Math.min(params.limit ?? 15, 20) })
        result = exercises.length > 0
          ? JSON.stringify(exercises)
          : JSON.stringify({ message: 'No exercises found. Try different filters.' })
      } else if (fn.name === 'propose_program') {
        searchPhaseDone = true
        let draft: ProgramDraft
        try {
          draft = JSON.parse(fn.arguments) as ProgramDraft
        } catch {
          result = JSON.stringify({ status: 'invalid', errors: ['JSON truncated. Regenerate with fewer week_progressions.'] })
          messages.push({ role: 'tool', tool_call_id: call.id, content: result })
          break
        }
        const validation = await validateProgramDraft(draft)
        if (validation.valid) {
          const qualityIssues = validateProgramQuality(draft, {
            fitnessLevel: DB_CTX.profile.fitnessLevel ?? undefined,
            weeks: draft.weeks,
            readinessState: intake.readinessState ?? undefined,
            requiredDailyActivityIds,
          })
          const hardErrors = qualityIssues.filter(i => i.severity === 'error')
          if (hardErrors.length > 0 && qualityRetries < QUALITY_RETRY_LIMIT) {
            qualityRetries++
            result = JSON.stringify({
              status:  'quality_issues',
              message: `Program has ${hardErrors.length} quality error(s). Fix ALL and resubmit:`,
              errors:  hardErrors.map(e => `[${e.code}] ${e.message}`),
            })
          } else if (hardErrors.length > 0) {
            qualityFailed = true
            console.error('[quality_failure]', hardErrors.map(e => `[${e.code}] ${e.message}`))
            result = JSON.stringify({ status: 'quality_exhausted' })
          } else {
            pendingProgram = validation
            pendingDraft   = draft
            result = JSON.stringify({ status: 'valid', message: 'Program validated. Present it to the user.' })
          }
        } else {
          result = JSON.stringify({ status: 'invalid', errors: validation.errors })
        }
      } else {
        result = JSON.stringify({ error: 'Unknown tool' })
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }

    if (pendingProgram?.valid || qualityFailed) break
  }

  const durationMs = Date.now() - startMs
  const finalQualityIssues = pendingDraft
    ? validateProgramQuality(pendingDraft, {
        fitnessLevel: DB_CTX.profile.fitnessLevel ?? undefined,
        weeks: pendingDraft.weeks,
        requiredDailyActivityIds,
      })
    : []

  return {
    success: !!(pendingProgram?.valid),
    program: pendingDraft,
    validationResult: pendingProgram,
    rounds: round + 1,
    qualityRetries,
    nudgesUsed,
    totalInputTokens,
    totalOutputTokens,
    durationMs,
    errorCode: qualityFailed ? 'quality_failure' : (!pendingProgram ? 'loop_exhausted' : undefined),
    qualityIssues: finalQualityIssues,
  }
}

// ─── Live tests ───────────────────────────────────────────────────────────────

describe.skipIf(!LIVE)('Live E2E — production explicit-schedule request (gpt-4o)', () => {
  let result: GenerationResult

  beforeAll(async () => {
    if (!LIVE) return
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set in .env.local')
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    result = await runGenerationFromProductionMsg(openai)

    console.log('\n════ Live Explicit-Schedule E2E — Results ════')
    console.log('Success:         ', result.success)
    console.log('Error code:      ', result.errorCode ?? 'none')
    console.log('Rounds:          ', result.rounds)
    console.log('Quality retries: ', result.qualityRetries)
    console.log('Nudges used:     ', result.nudgesUsed)
    console.log('Input tokens:    ', result.totalInputTokens.toLocaleString())
    console.log('Output tokens:   ', result.totalOutputTokens.toLocaleString())
    console.log('Duration:        ', `${(result.durationMs / 1000).toFixed(1)}s`)
    const cost = (result.totalInputTokens / 1e6 * 2.50) + (result.totalOutputTokens / 1e6 * 10.00)
    console.log('Est. cost (gpt-4o):', `$${cost.toFixed(4)}`)

    if (result.program) {
      console.log('\nGenerated days:')
      for (const day of result.program.days) {
        const walks = day.exercises.filter(ex => ex.exercise_id === '9001')
        console.log(
          `  ${String(day.weekday ?? '?').padEnd(9)} session_type=${String(day.session_type ?? '—').padEnd(20)} ` +
          `exercises=${String(day.exercises.length).padEnd(3)} walk=${walks.length > 0 ? `yes (${walks.map(w => w.distance_m).join(',')}m)` : 'MISSING'} ` +
          `name="${day.name}"`
        )
      }
      const hardErrors = result.qualityIssues.filter(i => i.severity === 'error')
      const warnings   = result.qualityIssues.filter(i => i.severity === 'warning')
      if (hardErrors.length) console.log('\nHard errors:', hardErrors.map(e => `[${e.code}]`).join(', '))
      if (warnings.length)   console.log('Warnings:   ', warnings.map(w => `[${w.code}]`).join(', '))
    }
    console.log('════════════════════════════════════════════')
  }, 600_000)

  it('REQ-1: generation succeeds', () => {
    expect(result.success).toBe(true)
  })

  it('REQ-2: produced an 8-week program', () => {
    expect(result.program?.weeks).toBe(8)
  })

  it('REQ-3: program has exactly 7 days', () => {
    expect(result.program?.days.length).toBe(7)
  })

  it('REQ-4: exercise 9001 (walking) present on ALL 7 days', () => {
    const days = result.program!.days
    const daysWithWalk = days.filter(d => d.exercises.some(ex => ex.exercise_id === '9001'))
    expect(daysWithWalk.length).toBe(7)
  })

  it('REQ-5: Thursday is rest or active_recovery (user said "rest from lifting")', () => {
    const thu = result.program?.days.find(d => String(d.weekday) === 'thursday')
    expect(thu).toBeDefined()
    const sessionType = String(thu!.session_type ?? '')
    const isRestDay = sessionType === 'active_recovery' || sessionType === 'rest'
    const onlyWalking = thu!.exercises.every(ex => ex.exercise_id === '9001')
    expect(isRestDay || onlyWalking).toBe(true)
  })

  it('REQ-6: Sunday is rest or active_recovery (user said "rest from lifting")', () => {
    const sun = result.program?.days.find(d => String(d.weekday) === 'sunday')
    expect(sun).toBeDefined()
    const sessionType = String(sun!.session_type ?? '')
    const isRestDay = sessionType === 'active_recovery' || sessionType === 'rest'
    const onlyWalking = sun!.exercises.every(ex => ex.exercise_id === '9001')
    expect(isRestDay || onlyWalking).toBe(true)
  })

  it('REQ-7: no quality hard errors in final program', () => {
    const hardErrors = result.qualityIssues.filter(i => i.severity === 'error')
    expect(hardErrors).toHaveLength(0)
  })

  it('REQ-8: completed within token budget', () => {
    expect(result.totalInputTokens).toBeLessThan(600_000)
  })
})
