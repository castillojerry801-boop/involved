import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'
import { buildWeeklyReview } from '@/lib/v/weekly-review'
import type { CompletedWorkoutSummary } from '@/lib/v/weekly-review'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.id

  const entitlement = await getUserEntitlement(userId)
  if (!hasFeatureAccess(entitlement.tier, 'weekly_review')) {
    return NextResponse.json({ error: 'Involved+ required for weekly review' }, { status: 403 })
  }

  // Monday–Sunday window for this week
  const now     = new Date()
  const dow     = now.getDay()
  const diffToMon = dow === 0 ? -6 : 1 - dow
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() + diffToMon)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)

  // Active program for context
  const activeProgram = await prisma.program.findFirst({
    where:   { userId, isActive: true },
    select:  { id: true, name: true, createdAt: true, durationWeeks: true },
  }).catch(() => null)

  // Compute program week (1-based; fallback to 1 if no active program)
  let programWeek = 1
  if (activeProgram) {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    programWeek = Math.max(1, Math.floor((now.getTime() - activeProgram.createdAt.getTime()) / msPerWeek) + 1)
    if (activeProgram.durationWeeks) {
      programWeek = Math.min(programWeek, activeProgram.durationWeeks)
    }
  }

  // Fetch this week's workouts for the user — exclude Strava.
  // programDayId distinguishes program-scheduled sessions from ad-hoc ones.
  // Only program sessions count toward adherence; ad-hoc sessions are included
  // in set summaries for progression tracking but not as "missed" days.
  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      source:        { not: 'strava' },
      scheduledDate: { gte: weekStart, lte: weekEnd },
      status:        { in: ['completed', 'planned', 'skipped'] },
    },
    include: {
      exercises: {
        include: {
          sets: {
            where: {
              OR: [
                { completed: true },
                { actualReps: { not: null } },
                { actualDurationSeconds: { not: null } },
              ],
            },
            select: {
              setType:              true,
              targetWeightKg:       true,
              actualWeightKg:       true,
              targetReps:           true,
              targetRepsMin:        true,
              actualReps:           true,
              rpe:                  true,
            },
          },
        },
      },
    },
    orderBy: { scheduledDate: 'asc' },
  }).catch(() => [])

  const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const summaries: CompletedWorkoutSummary[] = workouts.map(w => {
    const scheduledDay = w.scheduledDate ? DAY_ABBR[new Date(w.scheduledDate).getDay()] : 'TBD'
    const sets = w.exercises.flatMap(we => {
      const ex = getExerciseById(we.exerciseId)
      const name = ex?.name ?? we.exerciseId
      return we.sets
        .filter(s => s.setType === 'working')
        .map(s => ({
          exerciseName:       name,
          prescribedWeightKg: s.targetWeightKg != null ? Number(s.targetWeightKg) : undefined,
          actualWeightKg:     s.actualWeightKg != null ? Number(s.actualWeightKg) : undefined,
          prescribedReps:     s.targetReps ?? s.targetRepsMin ?? undefined,
          actualReps:         s.actualReps  ?? undefined,
          rpe:                s.rpe         ?? undefined,
          targetRpe:          undefined,
        }))
    })

    return {
      date:      (w.completedAt ?? w.scheduledDate ?? w.createdAt).toISOString().slice(0, 10),
      dayName:   scheduledDay,
      completed: w.status === 'completed',
      sets,
    } satisfies CompletedWorkoutSummary
  })

  // Adherence denominator: only workouts linked to the active program via
  // programDayId. Ad-hoc manual sessions don't count as "missed" program days.
  const scheduledDays = activeProgram
    ? workouts.filter(w => w.programDayId != null).length
    : workouts.length

  const review = buildWeeklyReview(
    summaries,
    scheduledDays,
    programWeek,
    activeProgram?.name ?? 'Current Program',
  )

  return NextResponse.json(review)
}
