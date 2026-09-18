import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getOpenAI } from '@/lib/ai/client'
import { workoutModel } from '@/lib/ai/models'
import { PROPOSE_SHORTENING_TOOL } from '@/lib/ai/tools/shorten'
import type { ShorteningPlan } from '@/lib/ai/tools/shorten'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage } from '@/lib/v/usage'
import type OpenAI from 'openai'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workoutId } = await params
  const body = await req.json() as { targetMinutes: number }

  if (!body.targetMinutes || body.targetMinutes < 10) {
    return Response.json({ error: 'targetMinutes must be at least 10' }, { status: 400 })
  }

  const entitlement = await getUserEntitlement(user.id)
  const tier = entitlement.tier

  if (!hasFeatureAccess(tier, 'shorten_workout')) {
    return Response.json({ error: 'Involved+ required to shorten workouts with V' }, { status: 403 })
  }

  const usage = await checkAndConsumeVUsage(user.id, tier, 'workout_adjustment')
  if (!usage.allowed) {
    return Response.json({ error: 'limit_reached', limit: usage.limit }, { status: 429 })
  }

  const workout = await prisma.workout.findUnique({
    where: { id: workoutId },
    include: {
      exercises: {
        orderBy: { order: 'asc' },
        include: { sets: { orderBy: { setNumber: 'asc' } } },
      },
    },
  })

  if (!workout || workout.userId !== user.id) {
    return Response.json({ error: 'Workout not found' }, { status: 404 })
  }

  if (workout.status === 'completed') {
    return Response.json({ error: 'Cannot shorten a completed workout' }, { status: 400 })
  }

  if (workout.exercises.length <= 1) {
    return Response.json({ error: 'Workout only has one exercise — nothing to shorten' }, { status: 400 })
  }

  const model = workoutModel(tier === 'free' ? 'free' : 'plus')
  const openai = getOpenAI()

  const exerciseSummary = workout.exercises.map(we => {
    const completedSets = we.sets.filter(s => s.completed).length
    const totalSets = we.sets.length
    return {
      exercise_id: we.exerciseId,
      order: we.order,
      sets_total: totalSets,
      sets_completed: completedSets,
      rest_seconds: we.restSeconds ?? 60,
    }
  })

  type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are Involved V. The user needs to shorten their active workout.

RULES:
• Preserve compound movements (squats, deadlifts, bench, rows, overhead press).
• Remove accessory or isolation exercises first.
• Do NOT remove exercises that already have completed sets.
• You may reduce set counts but never below 1 set.
• Return exercise_id values exactly as provided — do not modify them.
• Call propose_shortening once with your plan.`,
    },
    {
      role: 'user',
      content: `Shorten this workout to ~${body.targetMinutes} minutes. Current exercises:\n${JSON.stringify(exerciseSummary, null, 2)}\n\nExercises with completed sets cannot be removed.`,
    },
  ]

  let plan: ShorteningPlan | null = null

  for (let round = 0; round < 3; round++) {
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools: [PROPOSE_SHORTENING_TOOL],
      tool_choice: { type: 'function', function: { name: 'propose_shortening' } },
      max_tokens: 1000,
      temperature: 0.3,
    })

    const choice = response.choices[0]
    messages.push(choice.message)

    if (!choice.message.tool_calls?.length) break

    for (const call of choice.message.tool_calls) {
      const fn = (call as unknown as { function: { name: string; arguments: string } }).function
      if (fn.name === 'propose_shortening') {
        const proposed = JSON.parse(fn.arguments) as ShorteningPlan

        const workoutExerciseIds = new Set(workout.exercises.map(we => we.exerciseId))
        const completedExerciseIds = new Set(
          workout.exercises
            .filter(we => we.sets.some(s => s.completed))
            .map(we => we.exerciseId)
        )

        const invalidRemovals = proposed.exercises_to_remove.filter(
          id => !workoutExerciseIds.has(id) || completedExerciseIds.has(id)
        )

        if (invalidRemovals.length > 0) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              status: 'invalid',
              error: `Cannot remove: ${invalidRemovals.join(', ')}. These are either not in the workout or have completed sets.`,
            }),
          })
          continue
        }

        const invalidReductions = proposed.set_reductions.filter(
          r => !workoutExerciseIds.has(r.exercise_id) || proposed.exercises_to_remove.includes(r.exercise_id)
        )
        if (invalidReductions.length > 0) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ status: 'invalid', error: 'set_reductions contains invalid exercise IDs' }),
          })
          continue
        }

        plan = proposed
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: 'accepted' }) })
        break
      }
    }
    if (plan) break
  }

  if (!plan) {
    return Response.json({ error: 'V could not produce a shortening plan. Please try again.' }, { status: 422 })
  }

  const exercisesToRemove = workout.exercises.filter(we =>
    plan!.exercises_to_remove.includes(we.exerciseId)
  )

  await prisma.$transaction(async tx => {
    for (const we of exercisesToRemove) {
      await tx.workoutExercise.delete({ where: { id: we.id } })
    }

    for (const reduction of plan!.set_reductions) {
      const we = workout.exercises.find(e => e.exerciseId === reduction.exercise_id)
      if (!we) continue

      const completedCount = we.sets.filter(s => s.completed).length
      const targetCount = Math.max(reduction.new_set_count, completedCount, 1)
      const setsToDelete = we.sets
        .filter(s => !s.completed)
        .slice(targetCount - completedCount)

      for (const s of setsToDelete) {
        await tx.workoutSet.delete({ where: { id: s.id } })
      }
    }
  })

  return Response.json({
    removed: plan.exercises_to_remove,
    reduced: plan.set_reductions,
    reasoning: plan.reasoning,
  })
}
