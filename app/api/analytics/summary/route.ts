import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

function weekStart(d: Date): string {
  const day = new Date(d)
  day.setUTCHours(0, 0, 0, 0)
  day.setUTCDate(day.getUTCDate() - day.getUTCDay())
  return day.toISOString().slice(0, 10)
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()

  // Date anchors
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30)
  const eightWeeksAgo = new Date(now); eightWeeksAgo.setDate(now.getDate() - 56)

  const [
    workoutsThisMonth,
    totalWorkouts8Weeks,
    recentNutrition,
    latestWeight,
    weeklyWorkouts,
    topPRs,
  ] = await Promise.all([

    prisma.workout.count({
      where: { userId: user.id, status: 'completed', completedAt: { gte: monthStart } },
    }),

    prisma.workout.count({
      where: { userId: user.id, status: 'completed', completedAt: { gte: eightWeeksAgo } },
    }),

    prisma.foodLogEntry.findMany({
      where:   { userId: user.id, logDate: { gte: thirtyDaysAgo } },
      select:  { logDate: true, servingMultiplier: true, snapshotCaloriesPerServing: true },
    }),

    prisma.healthMetric.findFirst({
      where:   { userId: user.id, metricType: 'body_weight_kg' },
      orderBy: { recordedAt: 'desc' },
      select:  { value: true, recordedAt: true },
    }),

    prisma.workout.findMany({
      where: {
        userId: user.id,
        status: 'completed',
        completedAt: { gte: eightWeeksAgo },
      },
      select: {
        completedAt: true,
        exercises: {
          select: {
            sets: {
              where: { completed: true, setType: { not: 'warmup' } },
              select: { actualWeightKg: true, actualReps: true },
            },
          },
        },
      },
      orderBy: { completedAt: 'asc' },
    }),

    prisma.personalRecord.findMany({
      where:   { userId: user.id },
      orderBy: { achievedAt: 'desc' },
      take:    200,
    }),
  ])

  // Avg daily calories
  const caloriesByDay = new Map<string, number>()
  for (const e of recentNutrition) {
    const day = e.logDate.toISOString().slice(0, 10)
    const kcal = Number(e.snapshotCaloriesPerServing) * Number(e.servingMultiplier)
    caloriesByDay.set(day, (caloriesByDay.get(day) ?? 0) + kcal)
  }
  const avgDailyCalories = caloriesByDay.size > 0
    ? Math.round(Array.from(caloriesByDay.values()).reduce((a, b) => a + b, 0) / caloriesByDay.size)
    : null

  // Latest body weight (HealthMetric, falls back to profile)
  let latestBodyWeightKg: number | null = latestWeight ? Number(latestWeight.value) : null
  if (!latestBodyWeightKg) {
    const profile = await prisma.profile.findUnique({ where: { id: user.id }, select: { weightKg: true } })
    latestBodyWeightKg = profile?.weightKg ? Number(profile.weightKg) : null
  }

  // Weekly volume buckets (last 8 complete weeks + current)
  const weekMap = new Map<string, { totalKg: number; sessions: number }>()
  for (const w of weeklyWorkouts) {
    if (!w.completedAt) continue
    const wk = weekStart(w.completedAt)
    const entry = weekMap.get(wk) ?? { totalKg: 0, sessions: 0 }
    entry.sessions += 1
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        entry.totalKg += Number(s.actualWeightKg ?? 0) * (s.actualReps ?? 0)
      }
    }
    weekMap.set(wk, entry)
  }

  // Build 8 ordered week slots (oldest→newest)
  const weeklyVolume: { week: string; totalKg: number; sessions: number }[] = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i * 7)
    const wk = weekStart(d)
    const entry = weekMap.get(wk) ?? { totalKg: 0, sessions: 0 }
    weeklyVolume.push({ week: wk, totalKg: Math.round(entry.totalKg), sessions: entry.sessions })
  }

  // Top PRs — best per exercise (weight > estimated_1rm > reps > duration > distance)
  const METRIC_PRIORITY: Record<string, number> = {
    weight: 5, estimated_1rm: 4, reps: 3, duration: 2, distance: 1,
  }
  const prByExercise = new Map<string, typeof topPRs[number]>()
  for (const pr of topPRs) {
    const key = `${pr.exerciseId}::${pr.metric}`
    if (!prByExercise.has(key)) prByExercise.set(key, pr)
  }

  const dedupedPRs = Array.from(prByExercise.values())
    .sort((a, b) => (METRIC_PRIORITY[b.metric] ?? 0) - (METRIC_PRIORITY[a.metric] ?? 0))
    .slice(0, 12)
    .map(pr => {
      const ex = getExerciseById(pr.exerciseId)
      return {
        exerciseId:   pr.exerciseId,
        exerciseName: ex?.name ?? pr.exerciseId,
        metric:       pr.metric,
        value:        Number(pr.value),
        unit:         pr.unit,
        achievedAt:   pr.achievedAt.toISOString(),
      }
    })

  return Response.json({
    workoutsThisMonth,
    avgWeeklyWorkouts: Math.round((totalWorkouts8Weeks / 8) * 10) / 10,
    avgDailyCalories,
    latestBodyWeightKg,
    weeklyVolume,
    topPRs: dedupedPRs,
  })
}
