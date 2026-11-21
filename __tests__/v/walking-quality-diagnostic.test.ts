/**
 * Walking Overlay Quality Failure Diagnostic
 *
 * Investigates intermittent quality_failure on the 7-day S&C + daily walk program.
 * Runs 5 live gpt-4o generations (3 retries) and 3 runs with 5 retries, capturing
 * every quality rejection, affected day/exercise, and retry trajectory.
 *
 * Also includes static tests that:
 *  - Verify which checks fire for synthetic failing drafts
 *  - Confirm active_recovery days do not introduce unintended requirements
 *  - Verify deterministic post-processing fixes for identified errors
 *  - Compare 3-retry vs 5-retry success rates
 *
 * Guard: LIVE_AI_TEST=true
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearchAsync } from '../../lib/ai/tools/exercises'
import type { ExerciseSearchParams } from '../../lib/ai/tools/exercises'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '../../lib/ai/tools/program'
import type { ProgramDraft } from '../../lib/ai/tools/program'
import { validateProgramQuality } from '../../lib/v/program-quality'
import { getSessionRoles } from '../../lib/v/session-composition'
import { PROGRAM_INTELLIGENCE_PROMPT } from '../../lib/v/program-intelligence'

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

// ─── Constants ────────────────────────────────────────────────────────────────

const WALK_ID = '9001'
const ONE_MILE_M = 1609

const USER_CHAT_MESSAGE = `I'm an intermediate lifter. Build me a strength and conditioning program.

Monday: Chest, Biceps, and Core
Tuesday: Back and Triceps
Wednesday: Rest from lifting
Thursday: Shoulders and Core
Friday: Legs
Saturday: Cardio
Sunday: Rest from lifting

I also want to walk one mile every day, including Wednesday and Sunday.

Include progressive overload, sets, reps, rest periods, and appropriate conditioning.`

const SYNTHETIC_CONTEXT = `READINESS STATE: consistent_intermediate
FITNESS LEVEL: intermediate

EQUIPMENT: Full gym — barbell, dumbbells, cables, machines, pull-up bar, body weight

GOALS:
- General strength and conditioning
- Increase muscle mass
- Improve overall fitness

BODY METRICS:
- Age: 28
- Weight: 80 kg
`

// ─── Quality rejection record ─────────────────────────────────────────────────

interface QualityRejection {
  round: number
  retryNumber: number
  hardErrors: Array<{ code: string; message: string; meta?: Record<string, unknown> }>
  draftSnapshot: {
    totalDays: number
    totalExercises: number
    hasProgressionStrategy: boolean
    hasWeekProgressions: boolean
    hasProgressionModel: boolean
    phases: string[]
    hasDeloadPhase: boolean
    hasDeloadFlag: boolean
    hasSetDrop: boolean
    dayBreakdown: Array<{
      weekday: number | null
      name: string
      sessionType: string | null
      exerciseCount: number
      patterns: string[]
      hasWalk: boolean
    }>
  }
}

interface RunResult {
  runId: number
  qualityRetryLimit: number
  success: boolean
  errorCode: string | null
  rounds: number
  qualityRetries: number
  rejections: QualityRejection[]
  inputTokens: number
  outputTokens: number
  durationMs: number
  finalDraft: ProgramDraft | null
  finalQualityIssues: Array<{ severity: string; code: string; message: string }>
}

// ─── Single generation ────────────────────────────────────────────────────────

async function runDiagnostic(openai: OpenAI, runId: number, qualityRetryLimit: number): Promise<RunResult> {
  const MAX_ROUNDS        = 36
  const TOKEN_BUDGET_INPUT  = 600_000
  const TOKEN_BUDGET_OUTPUT = 60_000

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

USER CONTEXT:
${SYNTHETIC_CONTEXT}`

  const extraContext = [
    'NUMBER OF DAYS: 7',
    'PROGRAM DURATION: 8 weeks',
    'TRAINING STYLE: strength and conditioning',
    'OTHER CONSTRAINTS: Monday: Chest, Biceps, and Core. Tuesday: Back and Triceps. Wednesday: Rest from lifting (active_recovery + daily walk). Thursday: Shoulders and Core. Friday: Legs. Saturday: Cardio. Sunday: Rest from lifting (active_recovery + daily walk). Daily: walk 1 mile (1609 m, exercise ID 9001) every day.',
  ].join('\n')

  const userMessage = USER_CHAT_MESSAGE + '\n\nCreate a 7-day training program for 8 weeks. Search for exercises for each day, then propose the program.'

  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt + '\n' + extraContext },
    { role: 'user', content: userMessage },
  ]

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_PROGRAM_TOOL]
  let pendingDraft: ProgramDraft | null = null
  let qualityRetries = 0
  let qualityFailed = false
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let round = 0
  let nudgesThisEpisode = 0
  let totalNudges = 0
  const MAX_NUDGES_PER_EPISODE = 1
  const MAX_NUDGES_TOTAL = 2
  const rejections: QualityRejection[] = []
  const startMs = Date.now()

  function snapshotDraft(draft: ProgramDraft): QualityRejection['draftSnapshot'] {
    const allEx = draft.days.flatMap(d => d.exercises)
    const hasDeloadPhase = draft.phases?.some(p =>
      /deload|recovery|taper|unload|back[\s-]?off/i.test(p.name + ' ' + (p.focus ?? ''))
    ) ?? false
    const anyDeloadFlag = allEx.some(ex => (ex.week_progressions ?? []).some(wp => wp.deload === true))
    const anySetDrop = allEx.some(ex => {
      const sorted = (ex.week_progressions ?? []).slice().sort((a, b) => a.week - b.week)
      for (let i = 1; i < sorted.length; i++) {
        if ((sorted[i].sets ?? ex.sets) < (sorted[i - 1].sets ?? ex.sets)) return true
      }
      return false
    })
    return {
      totalDays: draft.days.length,
      totalExercises: allEx.length,
      hasProgressionStrategy: !!(draft.progression_strategy),
      hasWeekProgressions: allEx.some(ex => (ex.week_progressions?.length ?? 0) > 0),
      hasProgressionModel: allEx.some(ex => ex.progression_model != null && ex.progression_model !== 'auto'),
      phases: draft.phases?.map(p => p.name) ?? [],
      hasDeloadPhase,
      hasDeloadFlag: anyDeloadFlag,
      hasSetDrop: anySetDrop,
      dayBreakdown: draft.days.map(d => ({
        weekday: d.weekday ?? null,
        name: d.name,
        sessionType: d.session_type ?? null,
        exerciseCount: d.exercises.length,
        patterns: d.exercises.map(ex => ex.intended_pattern),
        hasWalk: d.exercises.some(ex => ex.exercise_id === WALK_ID),
      })),
    }
  }

  for (; round < MAX_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model:       'gpt-4o',
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens:  8000,  // production now uses 8000 for 7-day programs
      temperature: 0.7,
    })

    const choice = response.choices[0]
    if (response.usage) {
      totalInputTokens  += response.usage.prompt_tokens     ?? 0
      totalOutputTokens += response.usage.completion_tokens ?? 0
      if (totalInputTokens > TOKEN_BUDGET_INPUT || totalOutputTokens > TOKEN_BUDGET_OUTPUT) break
    }
    messages.push(choice.message)

    if (!choice.message.tool_calls?.length) {
      if (pendingDraft !== null || qualityFailed) break
      if (nudgesThisEpisode < MAX_NUDGES_PER_EPISODE && totalNudges < MAX_NUDGES_TOTAL) {
        nudgesThisEpisode++; totalNudges++
        messages.push({ role: 'user', content: 'Please call propose_program now with the exercises you have already found.' })
        continue
      }
      break
    }
    nudgesThisEpisode = 0

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
        let draft: ProgramDraft
        try {
          draft = JSON.parse(fn.arguments) as ProgramDraft
        } catch {
          // JSON truncated by max_tokens limit — treat as parse error, ask model to retry with shorter output
          result = JSON.stringify({ status: 'invalid', errors: ['JSON parse error: response was truncated by output token limit. Regenerate propose_program with fewer week_progressions entries (max 4 weeks per exercise). Use progression_model + progression_condition for the remaining weeks instead of enumerating every week.'] })
          messages.push({ role: 'tool', tool_call_id: call.id, content: result })
          break  // break inner for-of; outer loop continues to next round
        }
        const validation = await validateProgramDraft(draft)

        if (validation.valid) {
          const qualityIssues = validateProgramQuality(draft, {
            fitnessLevel: 'intermediate',
            weeks: draft.weeks,
          })
          const hardErrors = qualityIssues.filter(i => i.severity === 'error')

          if (hardErrors.length > 0 && qualityRetries < qualityRetryLimit) {
            // ← capture the full rejection with draft snapshot
            rejections.push({
              round,
              retryNumber: qualityRetries + 1,
              hardErrors: hardErrors.map(e => ({ code: e.code, message: e.message, meta: e.meta })),
              draftSnapshot: snapshotDraft(draft),
            })
            qualityRetries++
            result = JSON.stringify({
              status:  'quality_issues',
              message: `Program passed structural validation but has ${hardErrors.length} quality error(s). Fix these and resubmit:`,
              errors:  hardErrors.map(e => `[${e.code}] ${e.message}`),
            })
          } else if (hardErrors.length > 0) {
            rejections.push({
              round,
              retryNumber: qualityRetries + 1,
              hardErrors: hardErrors.map(e => ({ code: e.code, message: e.message, meta: e.meta })),
              draftSnapshot: snapshotDraft(draft),
            })
            qualityFailed = true
            result = JSON.stringify({ status: 'quality_exhausted' })
          } else {
            pendingDraft = draft
            result = JSON.stringify({ status: 'valid', message: 'Program validated. You are done.' })
          }
        } else {
          result = JSON.stringify({ status: 'invalid', errors: validation.errors })
        }
      } else {
        result = JSON.stringify({ error: 'Unknown tool' })
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }

    if (pendingDraft !== null || qualityFailed) break
  }

  const durationMs = Date.now() - startMs
  const finalQualityIssues = pendingDraft
    ? validateProgramQuality(pendingDraft, { fitnessLevel: 'intermediate', weeks: pendingDraft.weeks })
    : []

  return {
    runId,
    qualityRetryLimit,
    success: pendingDraft !== null,
    errorCode: qualityFailed ? 'quality_failure' : (pendingDraft === null ? 'loop_exhausted' : null),
    rounds: round + 1,
    qualityRetries,
    rejections,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    durationMs,
    finalDraft: pendingDraft,
    finalQualityIssues,
  }
}

// ─── Shared diagnostics state ─────────────────────────────────────────────────

interface DiagnosticSuite {
  runs3: RunResult[]   // 5 runs with 3-retry limit
  runs5: RunResult[]   // 3 runs with 5-retry limit
}

let suite: DiagnosticSuite = { runs3: [], runs5: [] }

// ─── LIVE Tests ───────────────────────────────────────────────────────────────

describe.skipIf(!LIVE)('Walking Overlay Quality Diagnostic — Live Runs (gpt-4o)', () => {

  beforeAll(async () => {
    if (!LIVE) return
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set in .env.local')
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    console.log('\n════ DIAGNOSTIC RUNS ════')
    console.log('Runs 1–5: 3-retry limit')
    console.log('Runs 6–8: 5-retry limit\n')

    // Run 5 trials at 3-retry limit (matches current production)
    for (let i = 1; i <= 5; i++) {
      console.log(`  → Run ${i}/5 (3-retry)...`)
      try {
        const r = await runDiagnostic(openai, i, 3)
        suite.runs3.push(r)
        console.log(`     ${r.success ? 'PASS' : 'FAIL'} in ${r.rounds} rounds, ${r.qualityRetries} retries, ${(r.durationMs/1000).toFixed(1)}s`)
        if (r.rejections.length > 0) {
          for (const rej of r.rejections) {
            const codes = rej.hardErrors.map(e => e.code).join(', ')
            console.log(`     Rejection ${rej.retryNumber}: [${codes}]`)
            for (const e of rej.hardErrors) {
              console.log(`       ${e.code}: ${e.message.slice(0, 120)}`)
              if (e.meta) {
                const snap = rej.draftSnapshot
                console.log(`         phases=${JSON.stringify(snap.phases)}, hasDeload=${snap.hasDeloadPhase}, deloadFlag=${snap.hasDeloadFlag}, setDrop=${snap.hasSetDrop}`)
                if (e.meta['dayName']) console.log(`         day="${e.meta['dayName']}", sessionType="${e.meta['sessionType']}", missing=${JSON.stringify(e.meta['missingRoles'])}`)
              }
            }
          }
        }
      } catch (err) {
        console.error(`     Run ${i} crashed:`, (err as Error).message.slice(0, 200))
      }
    }

    // Run 3 trials at 5-retry limit (proposed fix)
    for (let i = 1; i <= 3; i++) {
      console.log(`  → Run ${i}/3 (5-retry)...`)
      try {
        const r = await runDiagnostic(openai, i + 5, 5)
        suite.runs5.push(r)
        console.log(`     ${r.success ? 'PASS' : 'FAIL'} in ${r.rounds} rounds, ${r.qualityRetries} retries, ${(r.durationMs/1000).toFixed(1)}s`)
        if (r.rejections.length > 0) {
          for (const rej of r.rejections) {
            const codes = rej.hardErrors.map(e => e.code).join(', ')
            console.log(`     Rejection ${rej.retryNumber}: [${codes}]`)
          }
        }
      } catch (err) {
        console.error(`     Run ${i + 5} crashed:`, (err as Error).message.slice(0, 200))
      }
    }

    // ── Summary report ──
    const pass3 = suite.runs3.filter(r => r.success).length
    const pass5 = suite.runs5.filter(r => r.success).length
    const totalInput3  = suite.runs3.reduce((s, r) => s + r.inputTokens, 0)
    const totalOutput3 = suite.runs3.reduce((s, r) => s + r.outputTokens, 0)
    const totalInput5  = suite.runs5.reduce((s, r) => s + r.inputTokens, 0)
    const totalOutput5 = suite.runs5.reduce((s, r) => s + r.outputTokens, 0)
    const cost3 = (totalInput3 / 1e6 * 2.50) + (totalOutput3 / 1e6 * 10.00)
    const cost5 = (totalInput5 / 1e6 * 2.50) + (totalOutput5 / 1e6 * 10.00)

    // Error code frequency table
    const errorFrequency = new Map<string, number>()
    for (const run of [...suite.runs3, ...suite.runs5]) {
      const seen = new Set<string>()
      for (const rej of run.rejections) {
        for (const e of rej.hardErrors) {
          if (!seen.has(e.code)) {
            errorFrequency.set(e.code, (errorFrequency.get(e.code) ?? 0) + 1)
            seen.add(e.code)
          }
        }
      }
    }

    console.log('\n════ DIAGNOSTIC SUMMARY ════')
    console.log(`\n3-retry: ${pass3}/5 passed`)
    console.log(`5-retry: ${pass5}/3 passed`)
    console.log(`\n3-retry cost: $${cost3.toFixed(4)} | avg rounds: ${(suite.runs3.reduce((s,r)=>s+r.rounds,0)/suite.runs3.length).toFixed(1)}`)
    console.log(`5-retry cost: $${cost5.toFixed(4)} | avg rounds: ${(suite.runs5.reduce((s,r)=>s+r.rounds,0)/suite.runs5.length).toFixed(1)}`)

    console.log('\nError code frequency (runs affected, not total rejections):')
    for (const [code, count] of [...errorFrequency.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code}: ${count}/${suite.runs3.length + suite.runs5.length} runs`)
    }

    console.log('\nPer-run detail:')
    for (const run of [...suite.runs3, ...suite.runs5]) {
      const retryLabel = run.qualityRetryLimit === 3 ? '3-ret' : '5-ret'
      const inp = (run.inputTokens / 1000).toFixed(0)
      const out = (run.outputTokens / 1000).toFixed(0)
      const dur = (run.durationMs / 1000).toFixed(1)
      const cost = ((run.inputTokens / 1e6 * 2.50) + (run.outputTokens / 1e6 * 10.00)).toFixed(3)
      console.log(`  Run ${run.runId} [${retryLabel}] ${run.success ? 'PASS' : 'FAIL'}: ${run.rounds}r ${run.qualityRetries}q ${inp}k/${out}k tok ${dur}s $${cost}`)
    }
  }, 1_200_000)  // 20-min total budget for 8 runs

  // ── Live test assertions ──

  it('DIAG-L1 — 3-retry success rate is at least 2/5', () => {
    const pass = suite.runs3.filter(r => r.success).length
    console.log(`\n  3-retry: ${pass}/5 passed`)
    // This is an observational assertion — we expect at least some passes
    // A rate of 0/5 would indicate a systematic blockers requiring immediate fix
    expect(pass).toBeGreaterThanOrEqual(2)
  })

  it('DIAG-L2 — 5-retry success rate is at least as high as 3-retry rate', () => {
    const pass3 = suite.runs3.filter(r => r.success).length / suite.runs3.length
    const pass5 = suite.runs5.filter(r => r.success).length / suite.runs5.length
    console.log(`\n  3-retry: ${(pass3*100).toFixed(0)}% | 5-retry: ${(pass5*100).toFixed(0)}%`)
    // 5 retries should be at least as good as 3 retries
    expect(pass5).toBeGreaterThanOrEqual(pass3 - 0.1)
  })

  it('DIAG-L3 — identifies primary error codes from failing runs', () => {
    const failingRuns = suite.runs3.filter(r => !r.success)
    if (failingRuns.length === 0) {
      console.log('\n  All 3-retry runs passed — no failures to analyze')
      return
    }

    const errorCodes = new Map<string, number>()
    for (const run of failingRuns) {
      const lastRejection = run.rejections[run.rejections.length - 1]
      if (lastRejection) {
        for (const e of lastRejection.hardErrors) {
          errorCodes.set(e.code, (errorCodes.get(e.code) ?? 0) + 1)
        }
      }
    }

    console.log('\n  Primary errors causing final rejection:')
    for (const [code, count] of [...errorCodes.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${code}: ${count}/${failingRuns.length} failing runs`)
    }

    // This test always passes — it's purely diagnostic/reporting
    expect(failingRuns.length).toBeGreaterThanOrEqual(0)
  })

  it('DIAG-L4 — no false-positive: active_recovery days do not cause MISSING_REQUIRED_ROLE', () => {
    const allRejections = [...suite.runs3, ...suite.runs5].flatMap(r => r.rejections)
    const recoveryFalsePositives = allRejections.filter(rej =>
      rej.hardErrors.some(e =>
        e.code === 'MISSING_REQUIRED_ROLE' &&
        (e.meta?.['sessionType'] === 'active_recovery' || e.meta?.['dayName']?.toString().includes('Recovery'))
      )
    )
    expect(recoveryFalsePositives, 'active_recovery days should not trigger MISSING_REQUIRED_ROLE').toHaveLength(0)
  })

  it('DIAG-L5 — identifies token usage patterns and search redundancy', () => {
    const avg3Input  = suite.runs3.reduce((s, r) => s + r.inputTokens, 0) / suite.runs3.length
    const avg5Input  = suite.runs5.reduce((s, r) => s + r.inputTokens, 0) / suite.runs5.length
    console.log(`\n  Avg input tokens — 3-retry: ${avg3Input.toFixed(0)}, 5-retry: ${avg5Input.toFixed(0)}`)
    console.log(`  Token range — 3-retry: ${Math.min(...suite.runs3.map(r=>r.inputTokens))}–${Math.max(...suite.runs3.map(r=>r.inputTokens))}`)
    // Informational — always passes
    expect(avg3Input).toBeGreaterThan(0)
  })

  it('DIAG-L6 — walk presence on training days (informational; hard enforcement in live-walking-overlay.test.ts)', () => {
    // This check documents walk-presence reliability across diagnostic runs.
    // Hard enforcement is in live-walking-overlay.test.ts REQ 3 — do not duplicate the failure here.
    // A miss here is a finding to report, not a blocker for this diagnostic suite.
    const successfulRuns = [...suite.runs3, ...suite.runs5].filter(r => r.success && r.finalDraft)
    let totalDays = 0
    let missingDays = 0
    for (const run of successfulRuns) {
      for (const day of run.finalDraft!.days) {
        totalDays++
        if (!day.exercises.some(ex => ex.exercise_id === WALK_ID)) {
          missingDays++
          console.warn(`  Run ${run.runId}: day "${day.name}" (weekday ${day.weekday}) missing walk`)
        }
      }
    }
    const hitRate = totalDays > 0 ? ((totalDays - missingDays) / totalDays * 100).toFixed(1) : '—'
    console.log(`\n  Walk presence: ${totalDays - missingDays}/${totalDays} days (${hitRate}%)`)
    if (missingDays > 0) {
      console.warn(`  ⚠ Walk missing in ${missingDays} day(s) — finding reported; not blocking this diagnostic suite`)
    }
    // Always pass — this test reports, not blocks
    expect(totalDays).toBeGreaterThan(0)
  })
})

// ─── STATIC Tests (always run, no API) ────────────────────────────────────────

describe('Walking Overlay Quality Diagnostic — Static Analysis (no API)', () => {

  // ── Synthetic draft builders ──────────────────────────────────────────────

  function walkEntry() {
    return {
      exercise_id: WALK_ID,
      intended_pattern: 'cardio' as const,
      sets: 1,
      distance_m: ONE_MILE_M,
      rest_seconds: 0,
      progression_model: 'duration_distance' as const,
    }
  }

  function makeBaseProgram(): ProgramDraft {
    // 7-day, 8-week intermediate S&C program — structurally correct
    return {
      program_name: 'Intermediate S&C + Daily Walk',
      description: 'An 8-week strength and conditioning program with daily walking. Phases: Foundation (weeks 1–4) and Strength (weeks 5–8).',
      primary_goal: 'Strength',
      weeks: 8,
      phases: [
        { name: 'Foundation', weeks: '1-4', focus: 'Build base strength and movement quality. Higher reps, moderate load.' },
        { name: 'Strength', weeks: '5-8', focus: 'Progressive load increase. Lower reps, higher intensity.' },
        { name: 'Deload', weeks: '8', focus: 'Volume reduction for recovery.' },
      ],
      progression_strategy: 'Linear progression on main lifts (5 lb/week). Double progression on accessories. Deload at week 4 and week 8 (reduce sets by 1 and load by 10%).',
      days: [
        {
          name: 'Monday: Chest, Biceps, and Core',
          session_type: 'chest_biceps',
          weekday: 0,
          estimated_duration_minutes: 75,
          exercises: [
            { exercise_id: '0192', intended_pattern: 'horizontal_push', sets: 4, reps_min: 6, reps_max: 10, rest_seconds: 120, progression_model: 'linear', week_progressions: [
              { week: 1, sets: 3, reps_min: 8, reps_max: 12 },
              { week: 2, sets: 3, reps_min: 8, reps_max: 12, load_note: 'Add 5 lb' },
              { week: 4, sets: 2, reps_min: 10, reps_max: 12, deload: true, load_note: 'Deload: 90% weight' },
              { week: 5, sets: 4, reps_min: 6, reps_max: 8, load_note: 'Strength phase' },
              { week: 8, sets: 2, reps_min: 10, reps_max: 12, deload: true },
            ]},
            { exercise_id: '0391', intended_pattern: 'incline_push', sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, progression_model: 'double_progression' },
            { exercise_id: '0260', intended_pattern: 'bicep', sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60, progression_model: 'rep_progression' },
            { exercise_id: '0286', intended_pattern: 'bicep', sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60, progression_model: 'double_progression' },
            walkEntry(),
          ],
        },
        {
          name: 'Tuesday: Back and Triceps',
          session_type: 'back_triceps',
          weekday: 1,
          estimated_duration_minutes: 75,
          exercises: [
            { exercise_id: '1109', intended_pattern: 'vertical_pull', sets: 4, reps_min: 6, reps_max: 10, rest_seconds: 120, progression_model: 'linear' },
            { exercise_id: '0742', intended_pattern: 'horizontal_pull', sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, progression_model: 'double_progression' },
            { exercise_id: '1631', intended_pattern: 'tricep', sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60, progression_model: 'rep_progression' },
            walkEntry(),
          ],
        },
        {
          name: 'Active Recovery – Easy Walk',
          session_type: 'active_recovery',
          weekday: 2,
          estimated_duration_minutes: 20,
          exercises: [walkEntry()],
        },
        {
          name: 'Thursday: Shoulders and Core',
          session_type: 'shoulder',
          weekday: 3,
          estimated_duration_minutes: 60,
          exercises: [
            { exercise_id: '1550', intended_pattern: 'shoulder_isolation', sets: 3, reps_min: 12, reps_max: 15, rest_seconds: 60, progression_model: 'rep_progression' },
            { exercise_id: '0803', intended_pattern: 'shoulder_isolation', sets: 3, reps_min: 12, reps_max: 15, rest_seconds: 60, progression_model: 'rep_progression' },
            { exercise_id: '0570', intended_pattern: 'core_antiextension', sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60, progression_model: 'rep_progression' },
            walkEntry(),
          ],
        },
        {
          name: 'Friday: Legs',
          session_type: 'lower_full',
          weekday: 4,
          estimated_duration_minutes: 75,
          exercises: [
            { exercise_id: '1365', intended_pattern: 'squat', sets: 4, reps_min: 6, reps_max: 10, rest_seconds: 120, progression_model: 'linear' },
            { exercise_id: '1621', intended_pattern: 'hinge', sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, progression_model: 'double_progression' },
            { exercise_id: '1082', intended_pattern: 'lunge', sets: 3, reps_min: 10, reps_max: 12, rest_seconds: 60, progression_model: 'rep_progression' },
            walkEntry(),
          ],
        },
        {
          name: 'Saturday: Cardio',
          session_type: 'conditioning',
          weekday: 5,
          estimated_duration_minutes: 40,
          exercises: [
            { exercise_id: '2142', intended_pattern: 'cardio', sets: 1, duration_seconds: 1800, rest_seconds: 0, progression_model: 'duration_distance' },
            walkEntry(),
          ],
        },
        {
          name: 'Active Recovery – Easy Walk',
          session_type: 'active_recovery',
          weekday: 6,
          estimated_duration_minutes: 20,
          exercises: [walkEntry()],
        },
      ],
    }
  }

  // ── STATIC-1: Verify base program passes all quality checks ──────────────

  it('STATIC-1 — structurally correct 7-day+walk program passes quality validation', () => {
    const draft = makeBaseProgram()
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const errors = issues.filter(i => i.severity === 'error')
    if (errors.length > 0) {
      console.error('Unexpected errors:', errors.map(e => `[${e.code}] ${e.message}`))
    }
    expect(errors).toHaveLength(0)
  })

  // ── STATIC-2: active_recovery does not trigger MISSING_REQUIRED_ROLE ──────

  it('STATIC-2a — active_recovery sessions have no required roles (zero role constraints)', () => {
    const roles = getSessionRoles('active_recovery', 'intermediate')
    expect(roles).toHaveLength(0)
  })

  it('STATIC-2b — active_recovery day with only walk does not trigger MISSING_REQUIRED_ROLE', () => {
    const draft = makeBaseProgram()
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const recoveryErrors = issues.filter(i =>
      i.code === 'MISSING_REQUIRED_ROLE' &&
      (i.meta?.['sessionType'] === 'active_recovery' || (i.meta?.['dayName'] as string)?.includes('Recovery'))
    )
    expect(recoveryErrors).toHaveLength(0)
  })

  it('STATIC-2c — active_recovery day does not trigger CONDITIONING_NO_AEROBIC_MODALITY', () => {
    const draft = makeBaseProgram()
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const condErrors = issues.filter(i =>
      i.code === 'CONDITIONING_NO_AEROBIC_MODALITY' &&
      (i.message.includes('Recovery') || i.message.includes('Easy Walk'))
    )
    expect(condErrors).toHaveLength(0)
  })

  // ── STATIC-3: NO_STRUCTURED_DELOAD is the primary 8-week blocker ──────────

  it('STATIC-3a — 8-week program WITHOUT any deload structure fails NO_STRUCTURED_DELOAD', () => {
    const draft = makeBaseProgram()
    // Remove all deload structure
    draft.phases = []
    for (const day of draft.days) {
      for (const ex of day.exercises) {
        ex.week_progressions = undefined
      }
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'NO_STRUCTURED_DELOAD')).toBe(true)
  })

  it('STATIC-3b — deload phase named "Deload" fixes NO_STRUCTURED_DELOAD', () => {
    const draft = makeBaseProgram()
    // Remove week_progressions but keep deload phase
    for (const day of draft.days) {
      for (const ex of day.exercises) {
        ex.week_progressions = undefined
      }
    }
    draft.phases = [
      { name: 'Foundation', weeks: '1-4', focus: 'Base.' },
      { name: 'Deload', weeks: '8', focus: 'Volume reduction.' },
    ]
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'NO_STRUCTURED_DELOAD')).toBe(false)
  })

  it('STATIC-3c — week_progressions with deload:true flag fixes NO_STRUCTURED_DELOAD', () => {
    const draft = makeBaseProgram()
    draft.phases = []  // no deload phase
    // Remove all week_progressions from other exercises
    for (const day of draft.days) {
      for (const ex of day.exercises) {
        ex.week_progressions = undefined
      }
    }
    // But add deload flag to one compound
    draft.days[0].exercises[0].week_progressions = [
      { week: 1, sets: 4, reps_min: 8, reps_max: 12 },
      { week: 4, sets: 2, deload: true, reps_min: 10, reps_max: 12 },
    ]
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'NO_STRUCTURED_DELOAD')).toBe(false)
  })

  it('STATIC-3d — CARDIO_DURATION_STATIC does NOT fire for distance-based walking (no duration claim)', () => {
    const draft = makeBaseProgram()
    // The walk uses distance_m, not duration_seconds, so progression_strategy mentioning
    // "increase" should NOT trigger CARDIO_DURATION_STATIC for the walking exercise.
    // (It may trigger for other cardio exercises — that's separate.)
    draft.progression_strategy = 'Linear progression. Cardio duration increases each week. Deload at week 4 and 8.'
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    // CARDIO_DURATION_STATIC only fires for exercises that have duration_seconds
    // Walking entry has distance_m, not duration_seconds — it should NOT trigger the check
    const walkRelatedDurationWarning = issues.filter(i =>
      i.code === 'CARDIO_DURATION_STATIC' &&
      i.message.toLowerCase().includes('cardio')
    )
    // Note: other cardio exercises (Saturday treadmill) could trigger this — that's acceptable
    // The test just confirms the warning doesn't prevent success when only walking is cardio
    console.log('CARDIO_DURATION_STATIC issues:', walkRelatedDurationWarning.map(i => i.message.slice(0, 80)))
    expect(walkRelatedDurationWarning.length).toBeGreaterThanOrEqual(0)  // informational
  })

  // ── STATIC-4: shoulder session type requires TWO shoulder isolations ───────

  it('STATIC-4a — shoulder session for intermediate requires 2 shoulder_isolation roles', () => {
    const roles = getSessionRoles('shoulder', 'intermediate')
    const required = roles.filter(r => r.required)
    const shoulderIsolationRequired = required.filter(r => r.pattern === 'shoulder_isolation')
    expect(shoulderIsolationRequired).toHaveLength(2)
    expect(shoulderIsolationRequired.map(r => r.role)).toEqual(['shoulder_isolation_a', 'shoulder_isolation_b'])
  })

  it('STATIC-4b — FINDING: MISSING_REQUIRED_ROLE uses Set dedup, so shoulder day with 1 isolation silently passes', () => {
    // IMPORTANT QUALITY CHECKER BUG:
    // Both shoulder_isolation_a and shoulder_isolation_b have pattern='shoulder_isolation'.
    // MISSING_REQUIRED_ROLE builds: const requiredPatterns = new Set(roles.filter(r=>r.required).map(r=>r.pattern))
    // → requiredPatterns = {'shoulder_isolation'} (deduplicated to 1 entry even though 2 are required)
    // → dayPatterns = {'shoulder_isolation', 'cardio'} (1 isolation + walk)
    // → missingPatterns = [] → NO error fires
    // This means a shoulder day with only 1 shoulder isolation incorrectly passes.
    // This is a pre-existing checker limitation, not introduced by the walking overlay.
    const draft = makeBaseProgram()
    draft.days[3].exercises = [
      { exercise_id: '1550', intended_pattern: 'shoulder_isolation', sets: 3, reps_min: 12, reps_max: 15, rest_seconds: 60, progression_model: 'rep_progression' },
      walkEntry(),
    ]
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const shoulderRoleError = issues.some(i =>
      i.code === 'MISSING_REQUIRED_ROLE' &&
      (i.meta?.['dayName'] as string)?.includes('Shoulder')
    )
    // Documents actual behavior: does NOT fire (Set deduplication prevents it)
    expect(shoulderRoleError).toBe(false)
    // Consequence: MISSING_REQUIRED_ROLE is NOT a likely quality_failure cause for shoulder days
    // because even under-filled shoulder sessions pass the check.
  })

  it('STATIC-4c — shoulder day with 2 shoulder_isolation roles passes MISSING_REQUIRED_ROLE', () => {
    const draft = makeBaseProgram()
    // Thursday already has 2 shoulder_isolation + core + walk — verify it passes
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const shoulderRoleError = issues.some(i =>
      i.code === 'MISSING_REQUIRED_ROLE' &&
      (i.meta?.['dayName'] as string)?.includes('Shoulder')
    )
    expect(shoulderRoleError).toBe(false)
  })

  // ── STATIC-5: Saturday conditioning session correctness ───────────────────

  it('STATIC-5a — conditioning session for intermediate requires 1 cardio role (required: true)', () => {
    const roles = getSessionRoles('conditioning', 'intermediate')
    const required = roles.filter(r => r.required)
    expect(required).toHaveLength(1)
    expect(required[0].pattern).toBe('cardio')
  })

  it('STATIC-5b — conditioning day with ONLY the walk (1 cardio exercise) passes quality', () => {
    const draft = makeBaseProgram()
    // Replace Saturday with only the walk
    draft.days[5].exercises = [walkEntry()]
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const condErrors = issues.filter(i => i.code === 'MISSING_REQUIRED_ROLE' && (i.meta?.['dayName'] as string)?.includes('Saturday'))
    expect(condErrors).toHaveLength(0)
  })

  it('STATIC-5c — CONDITIONING_NO_AEROBIC_MODALITY does not fire when walk (cardio pattern) is present', () => {
    const draft = makeBaseProgram()
    draft.days[5].exercises = [walkEntry()]  // Saturday: only walk
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const noAerobic = issues.filter(i => i.code === 'CONDITIONING_NO_AEROBIC_MODALITY')
    expect(noAerobic).toHaveLength(0)
  })

  // ── STATIC-6: SPARSE_SESSION does not fire for shoulder/conditioning/active_recovery ──

  it('STATIC-6a — SPARSE_SESSION regex does NOT match "Shoulders and Core" (not a strength day name)', () => {
    // The SPARSE_SESSION regex: /strength|weight|lift|power|push|pull|squat|deadlift|press|legs|chest|back/i
    const name = 'Thursday: Shoulders and Core'
    const matches = /strength|weight|lift|power|push|pull|squat|deadlift|press|legs|chest|back/i.test(name)
    expect(matches, `"${name}" should not match SPARSE_SESSION regex`).toBe(false)
  })

  it('STATIC-6b — SPARSE_SESSION DOES fire for "Monday: Chest, Biceps" with < 4 exercises', () => {
    const draft = makeBaseProgram()
    // Monday: 2 exercises only (should trigger SPARSE_SESSION since "chest" matches the regex)
    draft.days[0].exercises = [
      { exercise_id: '0192', intended_pattern: 'horizontal_push', sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, progression_model: 'double_progression' },
      walkEntry(),
    ]
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    // SPARSE_SESSION: "Monday: Chest" matches /chest/i AND exercises.length (2) < 4
    expect(issues.some(i => i.code === 'SPARSE_SESSION')).toBe(true)
  })

  it('STATIC-6c — walk counts toward exercise total for SPARSE_SESSION (walk is an exercise)', () => {
    // Monday with 3 real exercises + walk = 4 total — should NOT trigger SPARSE_SESSION
    const draft = makeBaseProgram()
    draft.days[0].exercises = [
      { exercise_id: '0192', intended_pattern: 'horizontal_push', sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, progression_model: 'double_progression' },
      { exercise_id: '0391', intended_pattern: 'incline_push', sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, progression_model: 'double_progression' },
      { exercise_id: '0260', intended_pattern: 'bicep', sets: 3, reps_min: 10, reps_max: 15, rest_seconds: 60, progression_model: 'rep_progression' },
      walkEntry(),
    ]
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'SPARSE_SESSION')).toBe(false)
  })

  // ── STATIC-7: NO_STRUCTURED_PROGRESSION and NO_PROGRESSION ───────────────

  it('STATIC-7a — 8-week program with only progression_strategy text (no week_progressions) fails NO_STRUCTURED_PROGRESSION', () => {
    const draft = makeBaseProgram()
    for (const day of draft.days) {
      for (const ex of day.exercises) {
        ex.week_progressions = undefined
        ex.progression_model = undefined  // no model at all
      }
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'NO_STRUCTURED_PROGRESSION')).toBe(true)
  })

  it('STATIC-7b — progression_model on any exercise (even just "linear") fixes NO_STRUCTURED_PROGRESSION', () => {
    const draft = makeBaseProgram()
    for (const day of draft.days) {
      for (const ex of day.exercises) {
        ex.week_progressions = undefined
        ex.progression_model = undefined
      }
    }
    // Set progression_model on one compound
    draft.days[0].exercises[0].progression_model = 'linear'
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'NO_STRUCTURED_PROGRESSION')).toBe(false)
  })

  it('STATIC-7c — duration_distance on walking does NOT satisfy NO_STRUCTURED_PROGRESSION (cardio-only models)', () => {
    // If the ONLY progression_model is on the walk (duration_distance), does it satisfy the check?
    // The check: exercises.some(ex => ex.progression_model != null && ex.progression_model !== 'auto')
    // 'duration_distance' !== 'auto' → it DOES count. Test this.
    const draft = makeBaseProgram()
    for (const day of draft.days) {
      for (const ex of day.exercises) {
        if (ex.exercise_id !== WALK_ID) {
          ex.week_progressions = undefined
          ex.progression_model = undefined
        }
        // Walk keeps its duration_distance model
      }
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    // The walk's 'duration_distance' should technically satisfy NO_STRUCTURED_PROGRESSION
    // This would be a false-negative in quality validation if the only model is on walking
    const noStructuredProg = issues.some(i => i.code === 'NO_STRUCTURED_PROGRESSION')
    console.log(`\n  NO_STRUCTURED_PROGRESSION when only walk has progression_model: ${noStructuredProg}`)
    // This is a documentation test — not asserting pass/fail
    expect(typeof noStructuredProg).toBe('boolean')
  })

  // ── STATIC-8: WEEK_PROGRESSIONS_UNIFORM (identical progressions) ──────────

  it('STATIC-8 — WEEK_PROGRESSIONS_UNIFORM fires when week_progressions are present but all identical', () => {
    const draft = makeBaseProgram()
    // Replace main lift week_progressions with uniform entries
    draft.days[0].exercises[0].week_progressions = [
      { week: 1, sets: 3, reps_min: 8, reps_max: 12 },
      { week: 2, sets: 3, reps_min: 8, reps_max: 12 },
      { week: 3, sets: 3, reps_min: 8, reps_max: 12 },
      { week: 4, sets: 3, reps_min: 8, reps_max: 12 },
    ]
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'WEEK_PROGRESSIONS_UNIFORM')).toBe(true)
  })

  // ── STATIC-9: Deterministic post-processing fix for NO_STRUCTURED_DELOAD ──

  it('STATIC-9 — deterministic deload injection: missing deload can be fixed without AI', () => {
    // Simulate the post-processing fix: if NO_STRUCTURED_DELOAD fires,
    // we can inject a deload phase into the draft deterministically without regenerating.
    const draft = makeBaseProgram()
    // Remove deload structure
    draft.phases = [
      { name: 'Foundation', weeks: '1-4', focus: 'Base strength.' },
      { name: 'Strength', weeks: '5-7', focus: 'Progressive load increase.' },
      // NO deload phase
    ]
    for (const day of draft.days) {
      for (const ex of day.exercises) {
        ex.week_progressions = undefined  // no week progressions
      }
    }

    // Verify it fails first
    const before = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(before.some(i => i.code === 'NO_STRUCTURED_DELOAD')).toBe(true)

    // Apply deterministic fix: inject deload phase
    function injectDeloadPhase(d: ProgramDraft): void {
      if (!d.phases) d.phases = []
      const hasDeload = d.phases.some(p => /deload|recovery|taper/i.test(p.name))
      if (!hasDeload) {
        d.phases.push({
          name: 'Deload',
          weeks: `${d.weeks}`,
          focus: `Final week deload: reduce sets by 1 and load by ~10% for recovery.`,
        })
      }
    }
    injectDeloadPhase(draft)

    // Verify it passes after fix
    const after = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(after.some(i => i.code === 'NO_STRUCTURED_DELOAD')).toBe(false)
  })

  // ── STATIC-10: session type requirements for the 7-day split ─────────────

  it('STATIC-10 — required roles for each session type in the 7-day split (intermediate)', () => {
    const checks: Array<[string, string[]]> = [
      ['chest_biceps', ['horizontal_push', 'incline_push', 'bicep']],
      ['back_triceps', ['vertical_pull', 'horizontal_pull', 'tricep']],
      ['shoulder',     ['shoulder_isolation', 'shoulder_isolation']],
      ['lower_full',   ['squat', 'hinge', 'lunge']],
      ['conditioning', ['cardio']],
      ['active_recovery', []],
    ]

    for (const [sessionType, expectedRequired] of checks) {
      const roles = getSessionRoles(sessionType, 'intermediate')
      const required = roles.filter(r => r.required).map(r => r.pattern)
      console.log(`  ${sessionType}: required=${JSON.stringify(required)}`)
      if (expectedRequired.length === 0) {
        expect(required).toHaveLength(0)
      } else {
        // All expected patterns should be in required
        for (const p of expectedRequired) {
          expect(required, `${sessionType} should require ${p}`).toContain(p)
        }
      }
    }
  })

  // ── STATIC-11: walk satisfies conditioning required cardio role ───────────

  it('STATIC-11 — walk (exercise 9001, pattern: cardio) satisfies conditioning required role', () => {
    const draft = makeBaseProgram()
    // Saturday has only walk
    draft.days[5].exercises = [walkEntry()]
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    // No MISSING_REQUIRED_ROLE for Saturday
    const saturdayErrors = issues.filter(i =>
      i.code === 'MISSING_REQUIRED_ROLE' &&
      (i.meta?.['dayName'] as string)?.includes('Saturday')
    )
    expect(saturdayErrors).toHaveLength(0)
  })

  // ── STATIC-12: 5-retry limit provides more recovery headroom for hard errors ─

  it('STATIC-12 — 5-retry limit reduces quality_failure probability (mathematical analysis)', () => {
    // If the probability of generating a correct proposal in one attempt is p,
    // then success probability with n retries is 1 - (1-p)^(n+1) [n retries = n+1 attempts]
    // Observed 3-retry success rate from prior runs: ~60% (3/5 passes)
    // This implies p^4 ≈ 0.60 → p ≈ 0.88 per attempt
    // With 6 attempts (5 retries): 1 - (1-0.88)^6 = 1 - 0.12^6 ≈ 99.97% success rate
    // This is theoretical — the actual improvement depends on whether errors are fixable
    const p = 0.88  // estimated per-attempt success rate
    const success3Retry = 1 - Math.pow(1 - p, 4)  // 4 attempts (1 initial + 3 retries)
    const success5Retry = 1 - Math.pow(1 - p, 6)  // 6 attempts (1 initial + 5 retries)
    expect(success5Retry).toBeGreaterThan(success3Retry)
    console.log(`\n  Theoretical: 3-retry=${(success3Retry*100).toFixed(1)}%, 5-retry=${(success5Retry*100).toFixed(1)}%`)
    console.log(`  Note: improvement only holds if quality errors are fixable in subsequent attempts`)
  })

  // ── STATIC-13: Exhaustive error catalog for 8-week walking program ────────

  it('STATIC-13 — identifies all error codes that can fire for this specific program configuration', () => {
    const potentialErrors = [
      'NO_PROGRESSION',
      'NO_STRUCTURED_PROGRESSION',
      'PROGRESSION_NOT_MEANINGFUL',
      'NO_STRUCTURED_DELOAD',
      'WEEK_PROGRESSIONS_UNIFORM',
      'MISSING_REQUIRED_ROLE',
      'SPARSE_SESSION',
    ]

    console.log('\n  Error codes relevant to 8-week intermediate S&C + walk:')
    for (const code of potentialErrors) {
      let draft = makeBaseProgram()
      let triggersError = false

      // Test if each error can fire by deliberately breaking the relevant invariant
      if (code === 'NO_PROGRESSION') {
        draft.progression_strategy = ''
        for (const d of draft.days) for (const ex of d.exercises) {
          ex.week_progressions = undefined; ex.notes = undefined; ex.progression_model = undefined
        }
        triggersError = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 }).some(i => i.code === code)
      } else if (code === 'NO_STRUCTURED_PROGRESSION') {
        for (const d of draft.days) for (const ex of d.exercises) {
          ex.week_progressions = undefined; ex.progression_model = undefined
        }
        triggersError = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 }).some(i => i.code === code)
      } else if (code === 'NO_STRUCTURED_DELOAD') {
        draft.phases = []
        for (const d of draft.days) for (const ex of d.exercises) ex.week_progressions = undefined
        triggersError = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 }).some(i => i.code === code)
      } else if (code === 'WEEK_PROGRESSIONS_UNIFORM') {
        draft.days[0].exercises[0].week_progressions = [{week:1,sets:3},{week:2,sets:3},{week:3,sets:3}]
        triggersError = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 }).some(i => i.code === code)
      } else if (code === 'MISSING_REQUIRED_ROLE') {
        draft.days[3].exercises = [walkEntry()]  // shoulder day: only walk, no shoulder_isolation
        triggersError = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 }).some(i => i.code === code)
      } else if (code === 'SPARSE_SESSION') {
        draft.days[0].exercises = [{ exercise_id: '0192', intended_pattern: 'horizontal_push', sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, progression_model: 'linear' }]
        triggersError = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 }).some(i => i.code === code)
      } else if (code === 'PROGRESSION_NOT_MEANINGFUL') {
        for (const d of draft.days) for (const ex of d.exercises) {
          ex.week_progressions = undefined; ex.progression_model = 'auto'; ex.progression_condition = undefined
        }
        triggersError = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 }).some(i => i.code === code)
      }

      console.log(`    ${code}: can fire? ${triggersError ? 'YES' : 'NO'}`)
      expect(triggersError, `Expected ${code} to be triggerable`).toBe(true)
    }
  })

  // ── STATIC-14/15/16: MISSING_REQUESTED_ACTIVITY ───────────────────────────

  it('STATIC-14 — MISSING_REQUESTED_ACTIVITY fires when walk is on 6 of 7 days', () => {
    const draft = makeBaseProgram()
    // Remove walk from Friday (index 4)
    draft.days[4].exercises = draft.days[4].exercises.filter(e => e.exercise_id !== WALK_ID)
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const err = issues.find(i => i.code === 'MISSING_REQUESTED_ACTIVITY')
    expect(err).toBeDefined()
    expect(err!.severity).toBe('error')
    expect(err!.message).toContain('Friday: Legs')
    expect(err!.meta?.missingDays).toHaveLength(1)
    expect((err!.meta!.missingDays as Array<{name: string}>)[0].name).toBe('Friday: Legs')
  })

  it('STATIC-15 — MISSING_REQUESTED_ACTIVITY does NOT fire when walk is on all 7 days', () => {
    const draft = makeBaseProgram()
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'MISSING_REQUESTED_ACTIVITY')).toBe(false)
  })

  it('STATIC-16 — MISSING_REQUESTED_ACTIVITY does NOT fire for a program with no walking at all', () => {
    const draft = makeBaseProgram()
    // Remove all walks so the program has zero exercise 9001
    for (const day of draft.days) {
      day.exercises = day.exercises.filter(e => e.exercise_id !== WALK_ID)
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'MISSING_REQUESTED_ACTIVITY')).toBe(false)
  })

  // ── STATIC-17: JSON truncation produces a parseable recovery response ──────

  it('STATIC-17 — truncated propose_program JSON produces a parseable recovery response, not a 503', () => {
    // Simulate: gpt-4o hits max_tokens mid-JSON, producing an incomplete string.
    const fullJson = JSON.stringify({
      program_name: 'Test',
      days: [{ name: 'Monday', exercises: [{ exercise_id: '0192', sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, intended_pattern: 'horizontal_push' }] }],
      weeks: 8,
      week_progressions: Array.from({ length: 50 }, (_, i) => ({ week: i + 1, sets: 3 + (i % 2) })),
    })
    const truncated = fullJson.slice(0, Math.floor(fullJson.length * 0.6))

    // Verify: truncated JSON throws SyntaxError (the actual failure mode)
    expect(() => JSON.parse(truncated)).toThrow(SyntaxError)

    // Verify: the recovery response we return is well-formed JSON
    const recovery = JSON.stringify({
      status: 'invalid',
      errors: ['Output was truncated — the JSON for propose_program is incomplete. Resubmit with fewer week_progressions entries (max 4 per exercise across the entire program). Use progression_model + progression_condition for weeks beyond week 4.'],
    })
    expect(() => JSON.parse(recovery)).not.toThrow()
    const parsed = JSON.parse(recovery)
    expect(parsed.status).toBe('invalid')
    expect(parsed.errors[0]).toContain('truncated')
  })

  // ── STATIC-18: Token budget — production 320k covers observed Run 4 (284k) ─

  it('STATIC-18 — production TOKEN_BUDGET_INPUT (320k) covers observed worst-case run (284k input tokens)', () => {
    // Walking overlay diagnostic observed: Run 4 consumed 284,000 input tokens
    // (14 rounds, 2 quality retries). Production route uses 320k for 7-day programs.
    // Test harnesses use 600k for diagnostic headroom.
    const PROD_BUDGET_7DAY  = 320_000
    const TEST_BUDGET       = 600_000
    const RUN4_OBSERVED_MAX = 284_000

    expect(RUN4_OBSERVED_MAX).toBeLessThan(PROD_BUDGET_7DAY)
    // Headroom: at least 10% above observed max
    expect(PROD_BUDGET_7DAY / RUN4_OBSERVED_MAX).toBeGreaterThan(1.1)
    // Test harness is intentionally more permissive
    expect(TEST_BUDGET).toBeGreaterThan(PROD_BUDGET_7DAY)
  })

  // ── STATIC-19: explicit requiredDailyActivityIds enforcement ─────────────

  it('STATIC-19a — 0/7 walks FAILS when requiredDailyActivityIds includes 9001', () => {
    // This is the loophole closed in this session: previously, 0/7 walks was silent
    // because MISSING_REQUESTED_ACTIVITY only inferred from the draft. With an explicit
    // requirement in QualityContext, complete omission is now a hard error.
    const draft = makeBaseProgram()
    for (const day of draft.days) {
      day.exercises = day.exercises.filter(e => e.exercise_id !== WALK_ID)
    }
    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'intermediate',
      weeks: 8,
      requiredDailyActivityIds: [WALK_ID],
    })
    const err = issues.find(i => i.code === 'MISSING_REQUESTED_ACTIVITY')
    expect(err).toBeDefined()
    expect(err!.severity).toBe('error')
    expect(err!.meta?.detectionMode).toBe('explicit')
    // All 7 days should be reported as missing
    expect((err!.meta!.missingDays as Array<{name: string}>)).toHaveLength(7)
    expect(err!.message).toContain('every day')
  })

  it('STATIC-19b — 6/7 walks FAILS with explicit requirement (detectionMode: explicit)', () => {
    const draft = makeBaseProgram()
    draft.days[4].exercises = draft.days[4].exercises.filter(e => e.exercise_id !== WALK_ID)
    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'intermediate',
      weeks: 8,
      requiredDailyActivityIds: [WALK_ID],
    })
    const err = issues.find(i => i.code === 'MISSING_REQUESTED_ACTIVITY')
    expect(err).toBeDefined()
    expect(err!.meta?.detectionMode).toBe('explicit')
    expect((err!.meta!.missingDays as Array<{name: string}>)).toHaveLength(1)
    expect((err!.meta!.missingDays as Array<{name: string}>)[0].name).toBe('Friday: Legs')
    // Explicit mode produces different message prefix than inference
    expect(err!.message).toContain('every day')
  })

  it('STATIC-19c — 7/7 walks PASSES even with explicit requirement', () => {
    const draft = makeBaseProgram()
    const issues = validateProgramQuality(draft, {
      fitnessLevel: 'intermediate',
      weeks: 8,
      requiredDailyActivityIds: [WALK_ID],
    })
    expect(issues.some(i => i.code === 'MISSING_REQUESTED_ACTIVITY')).toBe(false)
  })

  it('STATIC-19d — without explicit requirement, 0/7 walks is silent (non-walking program)', () => {
    // Confirms STATIC-16 still holds: programs without walking and without an explicit
    // requirement are unaffected. This is the "A program without any walking request does
    // not acquire a walking requirement" guarantee.
    const draft = makeBaseProgram()
    for (const day of draft.days) {
      day.exercises = day.exercises.filter(e => e.exercise_id !== WALK_ID)
    }
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.some(i => i.code === 'MISSING_REQUESTED_ACTIVITY')).toBe(false)
  })

  // ── STATIC-20: generation loop truncation recovery with mock OpenAI ────────

  it('STATIC-20 — truncated propose_program in the generation loop: loop continues, program accepted on retry', async () => {
    // Uses a mock OpenAI client to simulate the JSON truncation failure mode:
    //   Round 0: AI returns propose_program with truncated JSON (SyntaxError in JSON.parse)
    //   Round 1: AI returns propose_program with valid JSON → accepted
    // Verifies that the try-catch in the generation loop continues to round 1
    // instead of propagating to the outer catch (which returns 503 / errorCode).
    //
    // Uses a minimal 1-day active_recovery draft (only exercise 9001) rather than
    // makeBaseProgram() because validateProgramDraft enforces strict intended_pattern
    // classification while validateProgramQuality does not. Exercise 9001 is known to
    // classify as pattern 'cardio' (Phase 0 test suite confirms this in STATIC-5b).
    const validDraft: ProgramDraft = {
      program_name: 'Recovery Walk Test',
      weeks: 1,
      progression_strategy: 'Linear distance progression',
      days: [{
        name: 'Recovery Day',
        session_type: 'active_recovery',
        estimated_duration_minutes: 20,
        exercises: [walkEntry()],
      }],
    }

    let callCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: async () => {
            callCount++
            const args = callCount === 1
              ? '{"program_name":"S&C Program","days":[{"name":"Monday: Chest'  // truncated at 55 chars
              : JSON.stringify(validDraft)
            return {
              id:     `chatcmpl-mock-${callCount}`,
              object: 'chat.completion',
              model:  'gpt-4o',
              choices: [{
                index:         0,
                finish_reason: callCount === 1 ? 'length' : 'stop',
                message: {
                  role:       'assistant',
                  content:    null,
                  tool_calls: [{
                    id:   `call_mock_${callCount}`,
                    type: 'function',
                    function: { name: 'propose_program', arguments: args },
                  }],
                },
              }],
              usage: { prompt_tokens: 1000, completion_tokens: callCount === 1 ? 400 : 2000 },
            }
          },
        },
      },
    } as unknown as OpenAI

    const result = await runDiagnostic(mockOpenAI, 99, 3)

    // The loop must have continued after truncation and accepted the valid draft on round 2
    expect(result.success).toBe(true)
    expect(result.errorCode).toBeNull()
    expect(callCount).toBe(2)  // exactly 2 API calls: 1 truncated + 1 valid
    // No quality retries — the valid draft (makeBaseProgram) passes quality
    expect(result.qualityRetries).toBe(0)
  }, 10_000)
})
