import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/ai/client'
import { workoutModel } from '@/lib/ai/models'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearch } from '@/lib/ai/tools/exercises'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft } from '@/lib/ai/tools/program'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage, decrementVUsage } from '@/lib/v/usage'
import { buildVTrainingContext, trainingContextToPrompt } from '@/lib/v/training-context'
import { PROGRAM_INTELLIGENCE_PROMPT } from '@/lib/v/program-intelligence'
import { getSportRules } from '@/lib/v/sport-rules'
import { validateProgramQuality } from '@/lib/v/program-quality'
import { assessIntakeGaps } from '@/lib/v/intake'
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

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_PROGRAM_TOOL]
  let pendingProgram: ReturnType<typeof validateProgramDraft> | null = null
  let pendingDraft: ProgramDraft | null = null
  const MAX_ROUNDS = 12
  const QUALITY_RETRY_LIMIT = 2
  let qualityRetries = 0
  let qualityFailed = false
  const allowedEquipment = ctx.equipment?.items

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
        max_tokens: 4000,
        temperature: 0.7,
      })

      const choice = response.choices[0]
      messages.push(choice.message)

      if (!choice.message.tool_calls?.length) break

      for (const call of choice.message.tool_calls) {
        const fn = (call as unknown as { function: { name: string; arguments: string } }).function
        let result: string

        if (fn.name === 'search_exercises') {
          const params = JSON.parse(fn.arguments) as Parameters<typeof executeExerciseSearch>[0]
          const exercises = executeExerciseSearch({ ...params, limit: Math.min(params.limit ?? 15, 20) })
          result = exercises.length > 0
            ? JSON.stringify(exercises)
            : JSON.stringify({ message: 'No exercises found. Try different filters.' })
        } else if (fn.name === 'propose_program') {
          const draft = JSON.parse(fn.arguments) as ProgramDraft
          const validation = validateProgramDraft(draft, { allowedEquipment })
          if (validation.valid) {
            // Run semantic quality check
            const qualityIssues = validateProgramQuality(draft, {
              sport: body.sport,
              fitnessLevel: ctx.profile.fitnessLevel,
              weeks: body.weeks ?? draft.weeks,
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
    // OpenAI API failure — return the credit
    await decrementVUsage(user.id, 'workout_generation')
    return Response.json({ error: 'V encountered an error. Please try again.' }, { status: 503 })
  }

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
