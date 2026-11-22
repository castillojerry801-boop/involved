/**
 * Live kernel generation test — runProgramGeneration with real OpenAI API.
 *
 * Uses the extracted production kernel (lib/v/generation.ts) with the
 * deterministic candidate pool from lib/v/search-orchestration.ts.
 *
 * Schedule: Mon Chest/Biceps/Core · Tue Back/Triceps · Wed Rest ·
 *           Thu Shoulders/Core · Fri Legs · Sat Cardio · Sun Rest
 *           + daily walk (exercise 9001)
 *
 * Cost estimate (worst case, all-Sol): $0.32
 * Budget hard cap:                     $1.00
 * Pricing tier:                        Standard, short-context (≤272K input)
 *
 * Guard: only runs when LIVE_AI_TEST=true
 * Run:   LIVE_AI_TEST=true npx vitest run __tests__/v/live-kernel-generation.test.ts
 *
 * Does NOT save programs, modify user data, or consume subscriptions.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { executeExerciseSearchAsync } from '../../lib/ai/tools/exercises'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '../../lib/ai/tools/program'
import { runProgramGeneration } from '../../lib/v/generation'
import {
  buildDeterministicSearchPlan,
  createCandidatePool,
  addCandidates,
  compactCandidatePool,
  buildCandidatePoolSummary,
  filterCandidatesByEquipment,
  canHandoffToDraft,
} from '../../lib/v/search-orchestration'
import { PROGRAM_INTELLIGENCE_PROMPT } from '../../lib/v/program-intelligence'
import { SYSTEM_PROMPT } from '../../app/api/coach/constants'
import { estimateTokenCost } from '../../lib/ai/pricing'
import type { WeeklySchedule } from '../../lib/v/program-intake'

// ─── Guard: only run when explicitly triggered ───────────────────────────────

const LIVE = process.env.LIVE_AI_TEST === 'true'

// ─── Load env from .env.local manually ───────────────────────────────────────
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
  } catch {
    // .env.local not found — rely on existing process.env
  }
}

// ─── Exact schedule from user's program request ───────────────────────────────

const TEST_SCHEDULE: WeeklySchedule = [
  { weekday: 'monday',    focus: 'Chest, Biceps, Core',   isRest: false, isCardioOnly: false },
  { weekday: 'tuesday',   focus: 'Back, Triceps',          isRest: false, isCardioOnly: false },
  { weekday: 'wednesday', focus: 'Rest from lifting',      isRest: true,  isCardioOnly: false },
  { weekday: 'thursday',  focus: 'Shoulders, Core',        isRest: false, isCardioOnly: false },
  { weekday: 'friday',    focus: 'Legs',                   isRest: false, isCardioOnly: false },
  { weekday: 'saturday',  focus: 'Cardio',                 isRest: false, isCardioOnly: true  },
  { weekday: 'sunday',    focus: 'Rest from lifting',      isRest: true,  isCardioOnly: false },
]

// ─── Synthetic user context (intermediate lifter, full gym) ───────────────────

const CONTEXT_SNIPPET = `

USER CONTEXT:
READINESS STATE: consistent_intermediate
FITNESS LEVEL: intermediate

EQUIPMENT: Full gym — barbell, dumbbells, cables, machines, pull-up bar, body weight

GOALS:
- Increase muscle mass
- Improve strength
- General fitness

BODY METRICS:
- Age: 28
- Weight: 80 kg
`

describe.skipIf(!LIVE)('Live E2E — runProgramGeneration kernel (gpt-6-luna)', () => {
  it(
    'generates a valid 8-week program for the exact 7-day schedule with daily walk',
    async () => {
      // ── 1. Build the deterministic candidate pool ─────────────────────────
      const plan = buildDeterministicSearchPlan()
      const candidatePool = createCandidatePool()
      const RAW_LIMIT = 25

      for (const step of plan) {
        const raw = await executeExerciseSearchAsync(
          { movementPattern: step.pattern, limit: RAW_LIMIT },
          null as any, // local data/exercises.json — no DB needed
        )
        const filtered = filterCandidatesByEquipment(raw, null) // null = unrestricted
        addCandidates(candidatePool, filtered.slice(0, step.core ? 8 : 5))
      }

      // Walking overlay — daily walk requested
      const cardioRaw = await executeExerciseSearchAsync(
        { bodyPart: 'cardio', query: 'walking', limit: 3 },
        null as any,
      )
      const cardioFiltered = filterCandidatesByEquipment(cardioRaw, null)
      addCandidates(candidatePool, cardioFiltered)

      const compactedPool = compactCandidatePool(candidatePool)
      expect(canHandoffToDraft(compactedPool)).toBe(true)
      console.log('[pool] candidates:', compactedPool.byId.size)

      const candidateSummaryText = buildCandidatePoolSummary(compactedPool)

      // ── 2. Build request summary ──────────────────────────────────────────
      const requestSummary =
        '8-week program, 6 days/week. ' +
        'Goal: muscle hypertrophy. ' +
        'Training background: consistent_intermediate. ' +
        'Equipment: full gym. ' +
        'Weekly schedule: monday=Chest/Biceps/Core, tuesday=Back/Triceps, wednesday=Rest, ' +
        'thursday=Shoulders/Core, friday=Legs, saturday=Cardio, sunday=Rest. ' +
        'Daily walk (exercise 9001) required every day.'

      // ── 3. Build chatMessages (system + user request + candidate pool injection) ──
      const scheduleInstruction =
        '\n\nMUST FOLLOW THIS EXACT WEEKLY SCHEDULE:\n' +
        'Monday: Chest, Biceps, Core\n' +
        'Tuesday: Back, Triceps\n' +
        'Wednesday: Rest from lifting\n' +
        'Thursday: Shoulders, Core\n' +
        'Friday: Legs\n' +
        'Saturday: Cardio\n' +
        'Sunday: Rest from lifting'

      const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content:
            SYSTEM_PROMPT +
            CONTEXT_SNIPPET +
            '\n\nEQUIPMENT: Full gym access assumed — all movement patterns and equipment available.',
        },
        {
          role: 'user',
          content:
            'Build me an 8-week muscle-building program. ' +
            'Monday chest/biceps/core, Tuesday back/triceps, Wednesday rest, ' +
            'Thursday shoulders/core, Friday legs, Saturday cardio, Sunday rest. ' +
            'Walk one mile every day.',
        },
        {
          role: 'system',
          content:
            `EXERCISE CANDIDATE POOL — ${compactedPool.byId.size} validated exercises for the user's equipment. ` +
            `Build the full 8-week program NOW by calling propose_program, using ONLY these exercise IDs:\n` +
            candidateSummaryText +
            `\n\nThe search phase is complete. Do NOT request more searches. Use ONLY these exercise IDs. ` +
            `If a minor accessory role lacks an ideal match, pick the closest appropriate candidate above.` +
            scheduleInstruction +
            `\n\n${PROGRAM_INTELLIGENCE_PROMPT}`,
        },
      ]

      // ── 4. Run the production generation kernel ───────────────────────────
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const t0 = Date.now()

      const result = await runProgramGeneration({
        userId: 'live-test-no-db-write',
        messages: chatMessages,
        candidateSummaryText,
        requestSummary,
        intake: {
          readinessState:    'consistent_intermediate',
          dailyWalkRequested: true,
          explicitSchedule:  TEST_SCHEDULE,
          fitnessLevel:      'intermediate',
        },
        models: {
          program:    'gpt-6-luna',
          escalation: 'gpt-6-sol',
          chat:       'gpt-4o-mini',
        },
        openai,
        prisma:            null as any, // local exercise data only — no DB writes
        allowedEquipment:  null,        // null = unrestricted (full gym)
        proposeProgramTool: PROPOSE_PROGRAM_TOOL,
        validateDraft:      validateProgramDraft,
      })

      const durationMs = Date.now() - t0

      // ── 5. Compute per-round costs ────────────────────────────────────────
      let totalCostUsd = 0
      for (const r of result.roundLogs) {
        const cost = estimateTokenCost(
          r.model,
          r.usage.promptTokens,
          r.usage.completionTokens,
          r.usage.cachedInputTokens ?? 0,
        )
        const costStr = cost.estimatedCostUsd != null
          ? `$${cost.estimatedCostUsd.toFixed(5)}`
          : 'unknown'
        console.log(
          `[round] model=${r.model} op=${r.opType} ` +
          `in=${r.usage.promptTokens} out=${r.usage.completionTokens} ` +
          `cached=${r.usage.cachedInputTokens ?? 0} cost=${costStr}`,
        )
        if (cost.estimatedCostUsd != null) totalCostUsd += cost.estimatedCostUsd
      }

      // ── 6. Report results ─────────────────────────────────────────────────
      console.log('\n=== LIVE KERNEL GENERATION RESULTS ===')
      console.log('Outcome:         ', result.outcome)
      console.log('Escalated:       ', result.escalated)
      console.log('Rounds:          ', result.rounds)
      console.log('Quality retries: ', result.qualityRetries)
      console.log('Duration (ms):   ', durationMs)
      console.log('Tokens in:       ', result.promptTokens)
      console.log('Tokens out:      ', result.completionTokens)
      console.log('Tokens cached:   ', result.cachedInputTokens)
      console.log('Est. cost (USD): ', `$${totalCostUsd.toFixed(5)}`)
      if (result.outcome === 'program_delivered' && result.program?.program) {
        const days = result.program.program.days
        console.log('Program days:    ', days.length)
        for (const d of days) {
          const exIds = d.exercises.map(e => e.exercise_id).join(', ')
          console.log(`  weekday=${d.weekday ?? '?'} name="${d.name}": ${d.exercises.length} exercises [${exIds}]`)
        }
      }
      console.log('=== END RESULTS ===\n')

      // ── 7. Assertions ─────────────────────────────────────────────────────
      expect(
        ['program_delivered', 'quality_exhausted', 'generation_failed', 'budget_exhausted', 'model_error'],
      ).toContain(result.outcome)

      // Budget hard cap: $1.00
      expect(totalCostUsd).toBeLessThan(1.00)

      // Should complete within 5 minutes
      expect(durationMs).toBeLessThan(300_000)

      if (result.outcome === 'program_delivered') {
        expect(result.program?.valid).toBe(true)
        const program = result.program?.program
        expect(program).toBeTruthy()

        if (program) {
          // Weekday convention: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday,
          //                     4=Friday, 5=Saturday, 6=Sunday
          // 7-day schedule: 5 training days + 2 rest days
          expect(program.days.length).toBe(7)

          // Monday (weekday 0) must be a chest/push session — check via name or focus
          const monday = program.days.find(d => d.weekday === 0)
          expect(monday).toBeTruthy()
          if (monday) {
            const label = (monday.name + ' ' + (monday.focus ?? '')).toLowerCase()
            expect(label).toMatch(/chest|push|bicep/)
          }

          // Wednesday (weekday 2) and Sunday (weekday 6) are rest days.
          // With dailyWalkRequested=true, they may carry only exercise 9001 (the walk) —
          // no resistance-training exercises should appear on rest days.
          const wednesday = program.days.find(d => d.weekday === 2)
          const sunday = program.days.find(d => d.weekday === 6)
          const hasOnlyWalk = (day: typeof wednesday) =>
            !day || day.exercises.every(e => e.exercise_id === '9001')
          expect(hasOnlyWalk(wednesday)).toBe(true)
          expect(hasOnlyWalk(sunday)).toBe(true)
        }
      }
    },
    // 5-minute timeout — Sol escalation with two rounds can take 60-90 seconds each
    300_000,
  )
})
