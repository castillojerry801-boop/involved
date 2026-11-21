import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getOpenAI } from '@/lib/ai/client'
import { workoutModel } from '@/lib/ai/models'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearchAsync } from '@/lib/ai/tools/exercises'
import type { ExerciseSearchParams } from '@/lib/ai/tools/exercises'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft, ProgramValidationResult } from '@/lib/ai/tools/program'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage, decrementVUsage } from '@/lib/v/usage'
import { buildVTrainingContext, trainingContextToPrompt } from '@/lib/v/training-context'
import { PROGRAM_INTELLIGENCE_PROMPT } from '@/lib/v/program-intelligence'
import { getSportRules } from '@/lib/v/sport-rules'
import { validateProgramQuality } from '@/lib/v/program-quality'
import { assessIntakeGaps } from '@/lib/v/intake'
import { buildTokenLog, flushRequestLogs } from '@/lib/ai/request-logger'
import type { PendingRequestLog } from '@/lib/ai/request-logger'
import type OpenAI from 'openai'

function buildSystemPrompt(sport?: string): string {
  const sportRules = sport ? getSportRules(sport) : null
  return `You are Involved V, an AI training program designer.

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
${sportRules ?? ''}

USER CONTEXT:
`
}

export interface ProgramPreviewExercise {
  exercise_id: string
  sets: number
  reps_min?: number
  reps_max?: number
  duration_seconds?: number
  rest_seconds: number
  notes?: string
  rpe?: number
  set_type?: string
  exercise: { id: string; name: string; bodyPart: string; equipment: string; target: string }
}

export interface ProgramPreviewDay {
  name: string
  focus?: string
  weekday?: number
  estimated_duration_minutes: number
  exercises: ProgramPreviewExercise[]
}

export interface ProgramPreview {
  program_name: string
  description?: string
  primary_goal?: string
  weeks?: number
  progression_strategy?: string
  days: ProgramPreviewDay[]
}

// Constraints forwarded back to the modal so they survive into modify requests.
export interface GenerationConstraints {
  days?: number
  focus?: string
  durationPerDayMinutes?: number
  weeks?: number
  injuries?: string
  style?: string
  sport?: string
  sequencing?: string
  constraints?: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    name?: string
    days?: number
    focus?: string
    durationPerDayMinutes?: number
    weeks?: number
    injuries?: string
    style?: string
    sport?: string
    sequencing?: string
    constraints?: string
    /** Explicit flag: caller sets true when the user requested daily walking. */
    dailyWalkRequired?: boolean
  }

  const entitlement = await getUserEntitlement(user.id)
  const tier = entitlement.tier

  if (!hasFeatureAccess(tier, 'workout_generation_ai')) {
    return Response.json({ error: 'Involved+ required for AI program generation' }, { status: 403 })
  }

  // Build context before consuming credit so intake gate can run for free
  const ctx = await buildVTrainingContext(user.id)

  // Intake gate: block generation when context is insufficient — no credit consumed
  const intakeAssessment = assessIntakeGaps(ctx, {
    weeks: body.weeks,
    days: body.days,
    sport: body.sport,
    focus: body.focus,
    injuries: body.injuries,
  })
  if (!intakeAssessment.hasEnough) {
    return Response.json({ error: 'intake_incomplete', questions: intakeAssessment.missingHighValue }, { status: 200 })
  }

  const usage = await checkAndConsumeVUsage(user.id, tier, 'workout_generation')
  if (!usage.allowed) {
    return Response.json({ error: 'limit_reached', limit: usage.limit }, { status: 429 })
  }
  const contextSnippet = trainingContextToPrompt(ctx)
  const model = workoutModel(tier === 'free' ? 'free' : 'plus')
  const openai = getOpenAI()

  const lines: string[] = []
  if (body.days)                  lines.push(`NUMBER OF DAYS: ${body.days}`)
  if (body.focus)                 lines.push(`PROGRAM FOCUS: ${body.focus}`)
  if (body.durationPerDayMinutes) lines.push(`TARGET DURATION PER SESSION: ${body.durationPerDayMinutes} minutes`)
  if (body.weeks)                 lines.push(`PROGRAM DURATION: ${body.weeks} weeks`)
  if (body.style)                 lines.push(`TRAINING STYLE: ${body.style}`)
  if (body.sport)                 lines.push(`SPORT / ACTIVITY: ${body.sport}`)
  if (body.sequencing)            lines.push(`SEQUENCING PREFERENCE: ${body.sequencing}`)
  if (body.injuries)              lines.push(`INJURIES / LIMITATIONS: ${body.injuries}`)
  if (body.constraints)           lines.push(`OTHER CONSTRAINTS: ${body.constraints}`)
  const extraContext = lines.length > 0 ? '\n' + lines.join('\n') : ''

  const focusDesc = body.focus ? ` focused on ${body.focus}` : ''
  const weeksDesc = body.weeks ? ` (${body.weeks}-week program)` : ''
  const userMessage = `Create a ${body.days ?? 3}-day training program${focusDesc}${weeksDesc}. Search for exercises for each day, then propose the program.`

  const systemPrompt = buildSystemPrompt(body.sport)

  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt + contextSnippet + extraContext },
    { role: 'user', content: userMessage },
  ]

  // Detect daily walking requirement from the original request, independent of the
  // AI-generated draft. When set, MISSING_REQUESTED_ACTIVITY fires even if the model
  // omits all walking activities (0/N days) rather than only detecting partial omission.
  //   • Explicit flag: caller sets dailyWalkRequired: true in the request body.
  //   • Constraint text fallback: "daily walk", "walk every day", or similar pattern
  //     in body.constraints covers callers that haven't adopted the explicit flag yet.
  const dailyWalkDetected =
    body.dailyWalkRequired === true ||
    /daily.{0,15}walk|walk.*every\s+day/i.test(body.constraints ?? '')
  const requiredDailyActivityIds: string[] | undefined = dailyWalkDetected ? ['9001'] : undefined

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_PROGRAM_TOOL]
  let pendingProgram: ProgramValidationResult | null = null
  let pendingDraft: ProgramDraft | null = null

  // Dynamic round budget — scales with program complexity so multi-day splits
  // don't exhaust the loop before finishing their exercise searches.
  // Each training day needs ~4 AI completion rounds on average (planning + searches).
  // Add rounds for propose + quality retries + a planning buffer.
  const programDays = body.days ?? 3
  const MAX_ROUNDS = Math.min(Math.max(16, programDays * 4 + 6), 36)
  // 7-day programs reliably trigger a 2-step correction cycle (MISSING_REQUIRED_ROLE +
  // NO_STRUCTURED_DELOAD on attempt 1; WEEK_PROGRESSIONS_UNIFORM on attempt 2) that
  // exhausts 3 retries. 5 retries resolves the cascade without increasing cost on
  // smaller programs.
  const QUALITY_RETRY_LIMIT = programDays >= 7 ? 5 : programDays >= 5 ? 3 : 2

  // Token budget guard — prevents runaway expensive sessions regardless of round count.
  // Input tokens grow quickly with conversation history; output tokens bound generation size.
  // 7-day programs with week_progressions need more output headroom.
  // 7-day budget raised from 240k → 320k: walking overlay diagnostic observed a 14-round,
  // 2-quality-retry run consuming 284k input tokens — within the new 320k limit with ~12% headroom.
  const TOKEN_BUDGET_INPUT  = programDays >= 7 ? 320_000 : programDays >= 5 ? 240_000 : 120_000
  const TOKEN_BUDGET_OUTPUT = programDays >= 7 ? 50_000 : 30_000
  let totalInputTokens  = 0
  let totalOutputTokens = 0

  let qualityRetries = 0
  let qualityFailed = false
  // Nudge state — gpt-4o occasionally writes a planning text response instead
  // of calling propose_program directly. Rather than breaking the loop on the
  // first text-only response, we inject a follow-up directing the model to call
  // the tool. MAX_NUDGES_PER_EPISODE prevents double-nudging in a single episode
  // (between tool calls); MAX_NUDGES_TOTAL is the absolute lifetime cap.
  let nudgesThisEpisode = 0
  let totalNudges = 0
  const MAX_NUDGES_PER_EPISODE = 1
  const MAX_NUDGES_TOTAL = 2
  const allowedEquipment = ctx.equipment?.items
  const requestLogs: PendingRequestLog[] = []

  // Credit was consumed above. If the AI loop fails (model error or exhausts
  // MAX_ROUNDS without a valid program), we return the credit. A valid program
  // that the user then discards does not get a refund — the AI ran successfully.
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await openai.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: programDays >= 7 ? 8000 : 4000,
        temperature: 0.7,
      })

      const choice = response.choices[0]
      if (response.usage) {
        const opType = qualityRetries > 0 ? 'program_correction' : 'workout_generation'
        requestLogs.push(buildTokenLog(user.id, 'workout_generation', opType, model, response.usage))
        totalInputTokens  += response.usage.prompt_tokens     ?? 0
        totalOutputTokens += response.usage.completion_tokens ?? 0
        const inputPct = totalInputTokens / TOKEN_BUDGET_INPUT
        if (inputPct >= 0.8 && inputPct < 1) {
          console.warn('[V budget-warning]', { userId: user.id, totalInputTokens, TOKEN_BUDGET_INPUT, pct: Math.round(inputPct * 100), round })
        }
        if (totalInputTokens > TOKEN_BUDGET_INPUT || totalOutputTokens > TOKEN_BUDGET_OUTPUT) {
          console.warn('[V budget-exceeded]', { userId: user.id, totalInputTokens, totalOutputTokens, round, programDays })
          break
        }
      }
      messages.push(choice.message)

      if (!choice.message.tool_calls?.length) {
        // If we already have a result (valid program or quality exhausted), a text
        // response is a natural closing message — exit cleanly.
        // pendingProgram is only set when validation.valid is true, so a non-null
        // check is equivalent to pendingProgram?.valid here.
        if (pendingProgram !== null || qualityFailed) break
        // Otherwise the model wrote a planning or summary text without calling a
        // tool. Nudge it back to propose_program rather than breaking immediately.
        if (nudgesThisEpisode < MAX_NUDGES_PER_EPISODE && totalNudges < MAX_NUDGES_TOTAL) {
          nudgesThisEpisode++
          totalNudges++
          console.log('[V nudge]', { userId: user.id, nudgesThisEpisode, totalNudges, round })
          messages.push({ role: 'user', content: 'Please call propose_program now with the exercises you have already found.' })
          continue
        }
        break
      }

      // Model called at least one tool — reset per-episode counter so a future
      // text-only response after tool use starts a fresh episode (can receive
      // another nudge rather than being blocked by the per-episode cap).
      nudgesThisEpisode = 0

      for (const call of choice.message.tool_calls) {
        const fn = (call as unknown as { function: { name: string; arguments: string } }).function
        let result: string

        if (fn.name === 'search_exercises') {
          const params = JSON.parse(fn.arguments) as ExerciseSearchParams
          const exercises = await executeExerciseSearchAsync({ ...params, limit: Math.min(params.limit ?? 15, 20) }, prisma)
          result = exercises.length > 0
            ? JSON.stringify(exercises)
            : JSON.stringify({ message: 'No exercises found. Try different filters.' })
        } else if (fn.name === 'propose_program') {
          let draft: ProgramDraft
          try {
            draft = JSON.parse(fn.arguments) as ProgramDraft
          } catch {
            // JSON truncated by max_tokens — the tool arguments string is incomplete.
            // Push a bounded recovery instruction and continue the round loop; do not
            // propagate to the outer catch (which returns 503) and do not save a partial draft.
            result = JSON.stringify({
              status: 'invalid',
              errors: ['Output was truncated — the JSON for propose_program is incomplete. Resubmit with fewer week_progressions entries (max 4 per exercise across the entire program). Use progression_model + progression_condition for weeks beyond week 4.'],
            })
            messages.push({ role: 'tool', tool_call_id: call.id, content: result })
            break  // break inner for-of; outer round loop continues
          }
          const validation = await validateProgramDraft(draft, user.id, prisma, { allowedEquipment })
          if (validation.valid) {
            // Run semantic quality check
            const qualityIssues = validateProgramQuality(draft, {
              sport: body.sport,
              fitnessLevel: ctx.profile.fitnessLevel,
              weeks: body.weeks ?? draft.weeks,
              requiredDailyActivityIds,
            })
            const hardErrors = qualityIssues.filter(i => i.severity === 'error')

            if (hardErrors.length > 0 && qualityRetries < QUALITY_RETRY_LIMIT) {
              qualityRetries++
              result = JSON.stringify({
                status: 'quality_issues',
                message: `Program passed structural validation but has ${hardErrors.length} quality error(s). Fix these and resubmit:`,
                errors: hardErrors.map(e => `[${e.code}] ${e.message}`),
              })
            } else if (hardErrors.length > 0) {
              // Final retry exhausted with remaining hard errors — mark failed, halt loop
              qualityFailed = true
              console.error('[V quality-failure]', { userId: user.id, codes: hardErrors.map(e => e.code) })
              result = JSON.stringify({ status: 'quality_exhausted', message: 'Quality improvement retries exhausted.' })
            } else {
              // No hard errors — accept
              pendingProgram = validation
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

      if (pendingProgram?.valid || qualityFailed) break
    }
  } catch {
    await flushRequestLogs(requestLogs)
    await decrementVUsage(user.id, 'workout_generation')
    return Response.json({ error: 'V encountered an error. Please try again.' }, { status: 503 })
  }

  await flushRequestLogs(requestLogs)

  // Hard quality errors remained after all retries — refund credit, surface clean message
  if (qualityFailed) {
    await decrementVUsage(user.id, 'workout_generation')
    return Response.json({
      error: 'quality_failure',
      message: "I couldn't build this program to the quality standard I want yet. Let me try again with a slightly different approach.",
    }, { status: 422 })
  }

  if (!pendingProgram?.valid || !pendingProgram.program || !pendingDraft) {
    // Loop exhausted without a valid program — return the credit
    await decrementVUsage(user.id, 'workout_generation')
    return Response.json({ error: 'V could not generate a valid program. Please try again.' }, { status: 422 })
  }

  // Collect quality warnings from the final accepted program
  const finalQualityIssues = validateProgramQuality(pendingDraft, {
    sport: body.sport,
    fitnessLevel: ctx.profile.fitnessLevel,
    weeks: body.weeks ?? pendingDraft.weeks,
    requiredDailyActivityIds,
  })
  const qualityWarnings = [
    ...(pendingProgram.warnings ?? []),
    ...finalQualityIssues.filter(i => i.severity === 'warning').map(i => i.message),
  ]

  const validated = pendingProgram.program

  // Build preview — same shape the coach ProgramCard uses, plus new fields
  const preview: ProgramPreview = {
    program_name: body.name ?? validated.program_name,
    description: validated.description,
    primary_goal: pendingDraft.primary_goal,
    weeks: pendingDraft.weeks,
    progression_strategy: pendingDraft.progression_strategy,
    days: validated.days.map(day => ({
      name: day.name,
      focus: day.focus,
      weekday: day.weekday,
      estimated_duration_minutes: day.estimated_duration_minutes ?? 45,
      exercises: day.exercises.map(ex => ({
        exercise_id: ex.exercise_id,
        sets: ex.sets,
        reps_min: ex.reps_min,
        reps_max: ex.reps_max,
        duration_seconds: ex.duration_seconds,
        rest_seconds: ex.rest_seconds,
        notes: ex.notes,
        rpe: ex.rpe,
        set_type: ex.set_type,
        exercise: {
          id: ex.exercise.id,
          name: ex.exercise.name,
          bodyPart: ex.exercise.bodyPart,
          equipment: ex.exercise.equipment,
          target: ex.exercise.target,
        },
      })),
    })),
  }

  // Capture the request constraints so the modal can forward them to modify requests.
  // This keeps injury/equipment/style restrictions alive through the entire session.
  const returnedConstraints: GenerationConstraints = {
    days: body.days,
    focus: body.focus,
    durationPerDayMinutes: body.durationPerDayMinutes,
    weeks: body.weeks,
    injuries: body.injuries,
    style: body.style,
    sport: body.sport,
    sequencing: body.sequencing,
    constraints: body.constraints,
  }

  // Return draft (for the save endpoint) + preview (for the UI)
  // No DB write — the user confirms before save
  return Response.json({ draft: pendingDraft, preview, constraints: returnedConstraints, qualityWarnings }, { status: 200 })
}
