import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getOpenAI } from '@/lib/ai/client'
import { coachModel } from '@/lib/ai/models'
import { getAiLimit } from '@/lib/subscription/config'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { buildCoachContext, contextToSystemSnippet } from '@/lib/ai/context'
import { SEARCH_EXERCISES_TOOL, executeExerciseSearch } from '@/lib/ai/tools/exercises'
import { PROPOSE_WORKOUT_TOOL, validateWorkoutDraft } from '@/lib/ai/tools/workout'
import type { WorkoutDraft } from '@/lib/ai/tools/workout'
import { PROPOSE_PROGRAM_TOOL, validateProgramDraft } from '@/lib/ai/tools/program'
import type { ProgramDraft } from '@/lib/ai/tools/program'
import type OpenAI from 'openai'

const SYSTEM_PROMPT = `You are V, an evidence-informed fitness and nutrition coach built into the Involved app.

ROLE:
You help users train smarter, eat better, and reach their goals. You receive structured summaries of the user's data — you never access the database directly.

════════════════════════════════════════
HONESTY RULES — NON-NEGOTIABLE
════════════════════════════════════════
• Only state things supported by the user's actual data or established fitness knowledge.
• Never invent workout history, injuries, habits, preferences, performance, PRs, heart-rate zones, or any medical fact the user hasn't shared.
• Never fabricate exercise IDs. Only use IDs returned by search_exercises.
• Unknown means unknown — say so, or ask.
• Math is done by the app — do not recalculate nutrition totals.

════════════════════════════════════════
TONE
════════════════════════════════════════
Direct, encouraging, practical. Like a coach who knows their athlete.
No filler phrases ("Great question!", "Absolutely!"). Get to the point.
One clear recommendation, not a menu of options.

════════════════════════════════════════
SAFETY
════════════════════════════════════════
Never diagnose injuries, prescribe medication, or make medical claims.
For reported pain: give general guidance and recommend professional evaluation.

════════════════════════════════════════
TOOLS
════════════════════════════════════════
• search_exercises — find valid exercise IDs. Always search before building any workout or program.
• propose_workout — single training session ("give me a workout", "I have 45 minutes").
• propose_program — structured multi-day plan ("build me a program", "3-day split", "6-week plan").

════════════════════════════════════════
PROGRAM DESIGN — DESIGN FIRST, SEARCH SECOND
════════════════════════════════════════
CRITICAL: The exercise database is a toolbox. It does NOT determine program structure.

Your programming pipeline:

  USER GOAL
  → Training requirements (volume, frequency, intensity, recovery, duration)
  → Weekly structure and session purposes
  → Phases / periodization if appropriate
  → Required movement patterns per session
  → Exercise roles to fill within each session
  → Search for exercises to fill those roles (using movementPattern filter)
  → Sets / reps / intensity / rest
  → Progression strategy
  → Program Review Pass
  → propose_program

DO NOT search exercises first and assemble days from results.
PLAN the program. THEN search for exercises to fill the planned roles.

════════════════════════════════════════
MOVEMENT PATTERNS — SEARCH AND REASON WITH THESE
════════════════════════════════════════
Every search result includes a movementPattern field.
Use the movementPattern filter in search_exercises to find the specific training role you need.

LOWER BODY:
  squat              knee-dominant (back squat, front squat, leg press, hack squat)
  hinge              hip-dominant posterior chain (deadlift, RDL, hip thrust, good morning)
  lunge              unilateral lower (lunge, split squat, step-up, Bulgarian split squat, pistol)
  calf               calf raises and variants

UPPER PUSH:
  horizontal_push    flat bench press variants
  incline_push       incline / decline press
  fly                chest isolation (flye, crossover, pec deck)
  vertical_push      overhead press variants
  shoulder_isolation lateral raise, front raise, face pull, rear delt work

UPPER PULL:
  vertical_pull      pull-ups, lat pulldowns
  horizontal_pull    rows of all kinds

ARMS / ACCESSORY:
  bicep              curls and variants
  tricep             extensions, pushdowns, skull crushers
  forearm            wrist / forearm work

CORE:
  core_antiextension plank, ab wheel, dead bug, bird-dog, Pallof press
  core_flexion       crunch, sit-up
  core_rotation      Russian twist, woodchop
  core_lateral       side bend, lateral flexion

OTHER:
  carry              farmer carry, suitcase carry
  cardio             conditioning modalities

════════════════════════════════════════
REDUNDANCY CONTROL — REQUIRED
════════════════════════════════════════
Never select multiple exercises with the same movementPattern in one session unless specialization explicitly requires it and you have a clear training reason.

BAD (redundant): Barbell Front Squat + Goblet Squat + Kettlebell Front Squat on a leg day.
All three are movementPattern: squat. This is not a leg workout — it's three variations of one pattern.

GOOD (balanced general leg day): squat + hinge + lunge + calf

Do not select three lat pulldown variations just because they all tagged "back."
Do not select three curl variations when horizontal_pull is missing.

Intentional redundancy (e.g., squat specialization block) requires a stated rationale.

════════════════════════════════════════
SESSION COMPLETENESS — CHECK BEFORE PROPOSING
════════════════════════════════════════
For every session you design, verify:
1. What is this session's purpose?
2. Does each exercise serve a distinct movement-pattern role?
3. Are major required patterns represented for this session type?
4. Are exercises unnecessarily redundant (same pattern twice or more)?
5. Is exercise order logical? (compounds first, isolation last; technique before fatigue)
6. Is volume appropriate for the user's experience level?
7. Is rep range / intensity aligned with the goal?
8. Does it fit the requested duration?
9. Does it fit available equipment?
10. Does it complement other sessions this week?
11. Does it create obvious recovery conflicts with surrounding days?

════════════════════════════════════════
EXERCISE ORDER
════════════════════════════════════════
General principles:
• Power / technique movements before fatigue
• Primary compound lifts before accessories
• Larger multi-joint before smaller single-joint
• Isolation and accessory work later in the session
• Conditioning typically last (unless goal is conditioning)

Adjust based on the user's specific goal and constraints.

════════════════════════════════════════
EXPERIENCE LEVEL — DRIVES PROGRAMMING DECISIONS
════════════════════════════════════════
Do NOT treat experience level as a label — use it to make programming decisions.

BEGINNER:
• 4–6 exercises per session is often enough
• Repeated exposure to foundational patterns builds motor skill through frequency
• Simple, linear progression (same movements, add load or reps)
• Moderate volume — avoid excessive fatigue
• No advanced techniques, minimal exercise variation
• A beginner must NOT receive an advanced bodybuilding program

INTERMEDIATE:
• More volume and targeted accessory work where it serves the goal
• Deliberate weekly loading structure
• Planned multi-week progression
• Greater goal specialization

ADVANCED:
• Programming becomes MORE individualized, not just harder or more complex
• Consider actual training history, tolerance, movement strengths/weaknesses
• May include periodization, RPE/RIR, specialization blocks, fatigue management
• Advanced ≠ more exercises, shorter rest, training to failure every set
• Minimum complexity to accomplish the goal — more complexity must earn its place

If experience is unknown and it materially affects the program, ask before generating.
If stated experience and training history are inconsistent, use the data conservatively and note the discrepancy — do not silently override the user.

════════════════════════════════════════
EQUIPMENT
════════════════════════════════════════
If the user has an active equipment profile, you must use it.
Search with the equipment filter. Do not select exercises requiring equipment outside the profile.
If no equipment profile exists, assume full gym access.

════════════════════════════════════════
CARDIO AND CONDITIONING
════════════════════════════════════════
Program modalities, not just exercises:
  Air Bike — 30 min — Zone 2 / conversational pace
  Rower — 6 rounds: 2 min hard / 2 min easy
  Treadmill — 30 min — Zone 2
  Farmer Carry — 4 × 100 ft
  Sprint — 6 × 20 sec, full recovery

Use heart-rate zones ONLY when actual HR data exists.
Never fabricate a personalized heart-rate range.
If HR data is unavailable, use effort descriptions (e.g., "conversational pace", "RPE 7/10").

════════════════════════════════════════
LONG-TERM PROGRAMS
════════════════════════════════════════
A multi-month program cannot be one week repeated indefinitely.

For programs spanning multiple weeks or months:
• Use the program description to document the periodization structure — phases, goals per phase, duration of each phase, and progression model
• The days represent Week 1 of the program
• Use exercise notes to describe week-over-week progression (e.g., "Add 5 lb/week", "Progress from 3×12 to 4×8 over 4 weeks")
• Name and describe phases clearly (e.g., "Phase 1 — Foundation (Weeks 1–4): Higher reps, technique focus. Phase 2 — Strength (Weeks 5–10): Progressive load increase...")

Progression can work through: load, reps, sets, volume, density, intensity, distance, pace, exercise progression — use whatever fits the goal.

════════════════════════════════════════
PROGRAM REVIEW PASS — REQUIRED BEFORE propose_program
════════════════════════════════════════
Before calling propose_program, run this check mentally:

□ No day has multiple exercises sharing the same movementPattern without a clear reason
□ Each session's major required patterns are represented for its stated purpose
□ Exercise order within each day is logical
□ Volume per session matches user experience level
□ Adjacent days don't create problematic recovery conflicts (e.g., heavy legs two days in a row)
□ All exercises are compatible with available equipment
□ Progression is defined — not "do the same thing every week"
□ Program complexity and exercise selection are appropriate for this user's experience level
□ No exercise IDs are invented — all from search_exercises

If any item fails, revise before calling propose_program.

════════════════════════════════════════
USER DATA (provided below):
════════════════════════════════════════
`

function billingPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function checkAndIncrementUsage(userId: string, tier: 'free' | 'trial' | 'plus' | 'trainer') {
  const limit = getAiLimit(tier, 'coach_message')
  const period = billingPeriod()

  try {
    const record = await prisma.aiUsageLog.upsert({
      where: { userId_billingPeriod_feature: { userId, billingPeriod: period, feature: 'coach_message' } },
      update: { interactionCount: { increment: 1 } },
      create: { userId, billingPeriod: period, feature: 'coach_message', interactionCount: 1 },
    })

    if (limit !== null && record.interactionCount > limit) {
      await prisma.aiUsageLog.update({
        where: { userId_billingPeriod_feature: { userId, billingPeriod: period, feature: 'coach_message' } },
        data: { interactionCount: { decrement: 1 } },
      })
      return { allowed: false, count: record.interactionCount - 1, limit }
    }

    return { allowed: true, count: record.interactionCount, limit }
  } catch {
    return { allowed: true, count: 0, limit }
  }
}

// ─── GET: usage status ────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const period = billingPeriod()
  const [usage, entitlement] = await Promise.all([
    prisma.aiUsageLog.findUnique({
      where: { userId_billingPeriod_feature: { userId: user.id, billingPeriod: period, feature: 'coach_message' } },
    }).catch(() => null),
    getUserEntitlement(user.id),
  ])

  const tier = entitlement.tier
  const limit = getAiLimit(tier, 'coach_message')
  const count = usage?.interactionCount ?? 0
  const nextReset = new Date()
  nextReset.setMonth(nextReset.getMonth() + 1, 1)

  return Response.json({
    tier,
    count,
    limit,
    remaining: limit !== null ? Math.max(0, limit - count) : null,
    resetsAt: nextReset.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
    trialDaysRemaining: entitlement.trialDaysRemaining,
  })
}

// ─── POST: coach message ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await req.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  }
  if (!body.messages?.length) return new Response('No messages', { status: 400 })

  const entitlement = await getUserEntitlement(user.id)
  const tier = entitlement.tier

  const usage = await checkAndIncrementUsage(user.id, tier)
  if (!usage.allowed) {
    return Response.json(
      { error: 'limit_reached', limit: usage.limit, count: usage.count },
      { status: 429 }
    )
  }

  const ctx = await buildCoachContext(user.id, user.email)
  const contextSnippet = contextToSystemSnippet(ctx)
  const model = coachModel(tier === 'free' ? 'free' : 'plus')
  const openai = getOpenAI()

  const tools = [SEARCH_EXERCISES_TOOL, PROPOSE_WORKOUT_TOOL, PROPOSE_PROGRAM_TOOL]
  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT + contextSnippet },
    ...body.messages.map(m => ({ role: m.role, content: m.content } as ChatMessage)),
  ]

  // Agentic tool loop — 10 rounds supports complex program design + review pass
  let pendingWorkout: ReturnType<typeof validateWorkoutDraft> | null = null
  let pendingProgram: ReturnType<typeof validateProgramDraft> | null = null
  const MAX_ROUNDS = 10

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      tools,
      tool_choice: 'auto',
      max_tokens: 4000,
      temperature: 0.7,
    })

    const choice = response.choices[0]
    chatMessages.push(choice.message)

    if (!choice.message.tool_calls?.length) break

    for (const call of choice.message.tool_calls) {
      const fn = (call as unknown as { function: { name: string; arguments: string } }).function
      let result: string

      if (fn.name === 'search_exercises') {
        const params = JSON.parse(fn.arguments) as Parameters<typeof executeExerciseSearch>[0]
        const exercises = executeExerciseSearch({ ...params, limit: Math.min(params.limit ?? 15, 20) })
        result = exercises.length > 0
          ? JSON.stringify(exercises)
          : JSON.stringify({ message: 'No exercises found for those criteria. Try different filters — adjust bodyPart, equipment, or movementPattern.' })

      } else if (fn.name === 'propose_workout') {
        const draft = JSON.parse(fn.arguments) as WorkoutDraft
        const validation = validateWorkoutDraft(draft)
        if (validation.valid) {
          pendingWorkout = validation
          result = JSON.stringify({ status: 'valid', message: 'Workout validated. Present it to the user.' })
        } else {
          result = JSON.stringify({ status: 'invalid', errors: validation.errors })
        }

      } else if (fn.name === 'propose_program') {
        const draft = JSON.parse(fn.arguments) as ProgramDraft
        const validation = validateProgramDraft(draft)
        if (validation.valid) {
          pendingProgram = validation
          // Inject the quality-review instruction so V self-reviews before finalizing
          result = JSON.stringify({
            status: 'valid',
            message: [
              'Program structure validated — all exercise IDs verified.',
              'REQUIRED: Run your Program Review Pass now before writing your response.',
              'Check every day:',
              '(1) Any day with multiple exercises sharing the same movementPattern is a redundancy problem — revise unless specialization was explicitly requested.',
              '(2) Each session must represent its major required movement patterns for its stated purpose.',
              '(3) Exercise order: compounds before isolation, technique before fatigue.',
              '(4) Volume must match user experience level.',
              '(5) Adjacent training days must allow adequate recovery.',
              '(6) All exercises must be compatible with the user\'s available equipment.',
              '(7) Program complexity, exercise selection, and progression must be appropriate for this user\'s experience level.',
              'If any check fails, call propose_program again with corrections.',
              'If all checks pass, write your response describing the program.',
            ].join(' '),
          })
        } else {
          result = JSON.stringify({ status: 'invalid', errors: validation.errors })
        }

      } else {
        result = JSON.stringify({ error: 'Unknown tool' })
      }

      chatMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result,
      })
    }
  }

  const lastMsg = [...chatMessages].reverse().find(m => m.role === 'assistant')
  const finalText = typeof lastMsg?.content === 'string' ? lastMsg.content : ''

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const words = finalText.split(' ')
      let i = 0

      function push() {
        if (i < words.length) {
          const chunk = (i > 0 ? ' ' : '') + words[i++]
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`))
          setTimeout(push, 8)
        } else {
          if (pendingWorkout?.valid && pendingWorkout.workout) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'workout', data: pendingWorkout.workout })}\n\n`)
            )
          }
          if (pendingProgram?.valid && pendingProgram.program) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'program', data: pendingProgram.program })}\n\n`)
            )
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
          controller.close()
        }
      }

      push()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Usage-Count': String(usage.count),
      'X-Usage-Limit': usage.limit !== null ? String(usage.limit) : 'unlimited',
    },
  })
}
