import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

// Week starts Monday
function getWeekBounds() {
  const now = new Date()
  const day = now.getDay() // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { monday, sunday }
}

// ─── GET: current targets + this week's progress ─────────────────────────────

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { monday, sunday } = getWeekBounds()

    const [targets, workoutsThisWeek, nutritionDaysThisWeek] = await Promise.all([
      prisma.weeklyTarget.findMany({ where: { userId: user.id } }),
      prisma.workout.count({
        where: {
          userId: user.id,
          status: 'completed',
          completedAt: { gte: monday, lte: sunday },
        },
      }),
      prisma.foodLogEntry.findMany({
        where: {
          userId: user.id,
          loggedAt: { gte: monday, lte: sunday },
        },
        select: { loggedAt: true },
      }),
    ])

    const nutritionDays = new Set(
      nutritionDaysThisWeek.map(e => e.loggedAt.toISOString().slice(0, 10))
    ).size

    const progress: Record<string, number> = {
      workouts_per_week: workoutsThisWeek,
      training_days: workoutsThisWeek,
      nutrition_log_days: nutritionDays,
      protein_target_days: 0, // requires protein target check — return 0 for now
    }

    return Response.json({
      targets: targets.map(t => ({
        targetType: t.targetType,
        targetValue: t.targetValue,
        progress: progress[t.targetType] ?? 0,
      })),
      week: { from: monday.toISOString(), to: sunday.toISOString() },
    })
  } catch {
    return Response.json({ error: 'Failed to load targets' }, { status: 500 })
  }
}

// ─── PUT: upsert a weekly target ─────────────────────────────────────────────

interface PutBody {
  targets: Array<{ targetType: string; targetValue: number }>
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as PutBody

  const validTypes = new Set(['workouts_per_week', 'training_days', 'nutrition_log_days', 'protein_target_days'])

  try {
    const ops = body.targets
      .filter(t => validTypes.has(t.targetType) && t.targetValue >= 0)
      .map(t => prisma.weeklyTarget.upsert({
        where: { userId_targetType: { userId: user.id, targetType: t.targetType as never } },
        create: { userId: user.id, targetType: t.targetType as never, targetValue: t.targetValue },
        update: { targetValue: t.targetValue },
      }))

    const results = await Promise.all(ops)
    return Response.json({ targets: results })
  } catch {
    return Response.json({ error: 'Failed to save targets' }, { status: 500 })
  }
}
