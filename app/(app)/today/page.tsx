import type { Metadata } from 'next'
import { ChevronRight, Plus, ArrowRight, Dumbbell, PlayCircle, Calendar } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { headers, cookies } from 'next/headers'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ActivityDetailSheet } from '@/components/today/ActivityDetailSheet'
import { WaterWidget } from '@/components/today/WaterWidget'
import { HealthSyncTrigger } from '@/components/today/HealthSyncTrigger'
import { getNextWorkout, formatWorkoutDate } from '@/lib/today/next-workout'

export const metadata: Metadata = { title: 'Today' }

// Returns the user's local date as YYYY-MM-DD and the start/end of that day in UTC.
// Uses x-vercel-ip-timezone (auto-set by Vercel per request) so the server always
// operates in the visitor's actual timezone rather than UTC.
function getLocalDayInfo(tz: string) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz }) // "YYYY-MM-DD"

  // Compute UTC times that bound midnight→midnight in the user's timezone.
  // Trick: parse UTC midnight, then adjust by the timezone's offset at that moment.
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`)
  const offsetMs =
    new Date(utcMidnight.toLocaleString('en-US', { timeZone: 'UTC' })).getTime() -
    new Date(utcMidnight.toLocaleString('en-US', { timeZone: tz })).getTime()

  const start = new Date(utcMidnight.getTime() + offsetMs)
  const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)

  const hour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const displayDate = now.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return { dateStr, start, end, greeting, displayDate }
}

function pct(consumed: number, target: number) {
  if (!target) return 0
  return Math.min(Math.round((consumed / target) * 100), 100)
}

// ─── Calorie status ───────────────────────────────────────────────────────────
// All thresholds and copy live here — nowhere else in this file.
const CALORIE_THRESHOLDS = {
  approaching: 0.90,  // >= 90%  of target → amber
  over:        1.00,  // >= 100% of target → orange
  wellOver:    1.15,  // >= 115% of target → red
} as const

type CalorieStatus = 'under' | 'approaching' | 'over' | 'wellOver'

const CALORIE_STATUS_CFG: Record<CalorieStatus, { bar: string; text: string; message: string }> = {
  under:       { bar: 'bg-emerald-500', text: 'text-emerald-500', message: 'Plenty of room left today.' },
  approaching: { bar: 'bg-amber-400',   text: 'text-amber-400',   message: 'Getting close — choose the next meal wisely.' },
  over:        { bar: 'bg-orange-500',  text: 'text-orange-500',  message: "You're over today's target. Keep the rest of the day light." },
  wellOver:    { bar: 'bg-red-500',     text: 'text-red-500',     message: 'Today ran high. Reset tomorrow and keep moving.' },
}

function getCalorieStatus(consumed: number, target: number): CalorieStatus {
  if (!target) return 'under'
  const r = consumed / target
  if (r >= CALORIE_THRESHOLDS.wellOver)    return 'wellOver'
  if (r >= CALORIE_THRESHOLDS.over)        return 'over'
  if (r >= CALORIE_THRESHOLDS.approaching) return 'approaching'
  return 'under'
}

async function getTodayNutrition(userId: string, dateStr: string) {
  const today = dateStr

  const [entries, target] = await Promise.all([
    prisma.foodLogEntry.findMany({
      where: { userId, logDate: new Date(today) },
      select: {
        servingMultiplier: true,
        snapshotCaloriesPerServing: true,
        snapshotProteinGPerServing: true,
        snapshotCarbohydrateGPerServing: true,
        snapshotFatGPerServing: true,
        estimateSourceNote: true,
      },
    }),
    prisma.nutritionTarget.findFirst({
      where: { userId },
      orderBy: { effectiveDate: 'desc' },
    }),
  ])

  const totals = entries.reduce(
    (acc, e) => {
      const m = Number(e.servingMultiplier)
      return {
        calories: acc.calories + Math.round(Number(e.snapshotCaloriesPerServing) * m),
        proteinG: acc.proteinG + Math.round(Number(e.snapshotProteinGPerServing) * m * 10) / 10,
        carbsG: acc.carbsG + Math.round(Number(e.snapshotCarbohydrateGPerServing) * m * 10) / 10,
        fatG: acc.fatG + Math.round(Number(e.snapshotFatGPerServing) * m * 10) / 10,
      }
    },
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )

  return {
    totals,
    target: target
      ? {
          calories: Number(target.calories),
          proteinG: Number(target.proteinG),
          carbsG: Number(target.carbohydrateG),
          fatG: Number(target.fatG),
        }
      : null,
    hasEntries: entries.length > 0,
    hasPartialEstimate: entries.some(e => e.estimateSourceNote?.startsWith('Coach V (partial')),
  }
}

async function getTodayHealth(userId: string, start: Date, end: Date) {
  const [activities, cursor, stepsAgg, activeEnergyAgg, basalEnergyAgg] = await Promise.all([
    prisma.healthActivity.findMany({
      where: { userId, startedAt: { gte: start, lte: end } },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        activityType: true,
        title: true,
        startedAt: true,
        durationSeconds: true,
        activeEnergyKcal: true,
        avgHeartRateBpm: true,
        distanceM: true,
      },
    }),
    prisma.healthSyncCursor.findFirst({
      where: { userId },
      orderBy: { lastSyncedAt: 'desc' },
      select: { lastSyncedAt: true, provider: true },
    }),
    prisma.healthMetric.aggregate({
      where: { userId, metricType: 'steps', recordedAt: { gte: start, lte: end } },
      _sum: { value: true },
    }),
    prisma.healthMetric.aggregate({
      where: { userId, metricType: 'active_energy_kcal', recordedAt: { gte: start, lte: end } },
      _sum: { value: true },
    }),
    prisma.healthMetric.aggregate({
      where: { userId, metricType: 'resting_energy_kcal', recordedAt: { gte: start, lte: end } },
      _sum: { value: true },
    }),
  ])

  const toKcal = (agg: { _sum: { value: { toString(): string } | null } }) => {
    const v = agg._sum.value
    return v != null && Number(v) > 0 ? Math.round(Number(v)) : null
  }

  const stepCount      = toKcal(stepsAgg)
  const allDayActiveKcal = toKcal(activeEnergyAgg)
  const basalKcal        = toKcal(basalEnergyAgg)
  const totalBurnKcal    = allDayActiveKcal != null && basalKcal != null
    ? allDayActiveKcal + basalKcal
    : null

  return {
    connected: !!cursor,
    lastSyncedAt: cursor?.lastSyncedAt?.toISOString() ?? null,
    provider: cursor?.provider ?? null,
    activities: activities.map(a => ({
      id: a.id,
      activityType: a.activityType as string,
      title: a.title,
      startedAt: a.startedAt.toISOString(),
      durationSeconds: a.durationSeconds,
      activeEnergyKcal: a.activeEnergyKcal != null ? Math.round(Number(a.activeEnergyKcal)) : null,
      avgHeartRateBpm: a.avgHeartRateBpm,
      distanceM: a.distanceM != null ? Math.round(Number(a.distanceM)) : null,
    })),
    stepCount,
    allDayActiveKcal,
    basalKcal,
    totalBurnKcal,
  }
}

export default async function TodayPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const [headersList, cookieStore] = await Promise.all([headers(), cookies()])
  const tz =
    headersList.get('x-tz') ||                                      // set by middleware from cookie or Vercel header
    decodeURIComponent(cookieStore.get('tz')?.value ?? '') ||
    headersList.get('x-vercel-ip-timezone') ||
    'America/New_York'
  const { dateStr, start: todayStart, end: todayEnd, greeting, displayDate } = getLocalDayInfo(tz)

  const [nutrition, profile, nextWorkout, health, waterAgg] = await Promise.all([
    getTodayNutrition(user.id, dateStr),
    prisma.profile.findUnique({ where: { id: user.id }, select: { displayName: true, fitnessLevel: true, biologicalSex: true, waterTargetOz: true } }).catch(() => null),
    getNextWorkout(user.id, dateStr).catch(() => null),
    getTodayHealth(user.id, todayStart, todayEnd),
    prisma.healthMetric.aggregate({
      where: { userId: user.id, metricType: 'water_ml', recordedAt: { gte: todayStart, lte: todayEnd } },
      _sum: { value: true },
    }),
  ])

  if (!profile?.fitnessLevel) redirect('/onboarding')

  const displayName =
    profile?.displayName ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'Athlete'

  const { totals, target, hasEntries, hasPartialEstimate } = nutrition
  const totalWaterMl = waterAgg._sum.value != null ? Number(waterAgg._sum.value) : 0
  const waterGoalOz = profile?.waterTargetOz
    ?? (profile?.biologicalSex === 'female' ? 80 : 100)
  const calRemaining = target ? target.calories - totals.calories : 0
  const calorieStatus = target ? getCalorieStatus(totals.calories, target.calories) : 'under'
  const statusCfg = CALORIE_STATUS_CFG[calorieStatus]

  const totalActivitySeconds = health.activities.reduce((sum, a) => sum + (a.durationSeconds ?? 0), 0)
  const activeMinutes = totalActivitySeconds > 0 ? Math.round(totalActivitySeconds / 60) : null

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 md:px-8 md:py-8">
      <HealthSyncTrigger />

      {/* Header */}
      <div className="mb-3">
        <p className="text-sm font-medium text-zinc-500">{greeting}, {displayName}</p>
        <p className="text-xs text-zinc-400 mt-0.5">{displayDate}</p>
      </div>

      {/* ── NUTRITION ─────────────────────────────────────────────────── */}
      <Card className="mb-3 p-4 md:p-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Nutrition</p>
          <div className="flex items-center gap-3">
            <Link
              href="/nutrition"
              className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              <Plus className="size-3" />
              Add food
            </Link>
            <Link
              href="/nutrition"
              className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              Full log <ChevronRight className="size-3" />
            </Link>
          </div>
        </div>

        {!target ? (
          /* No goals set yet */
          <div className="py-2">
            <p className="text-sm text-zinc-500 mb-3">Set your daily nutrition goals to start tracking calories and macros.</p>
            <Link href="/nutrition">
              <Button size="sm" variant="secondary" className="w-full">
                Set my goals
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white">
                {totals.calories.toLocaleString()}
              </span>
              <span className="text-sm text-zinc-400">
                / {target.calories.toLocaleString()} cal
              </span>
            </div>

            <p className="mb-2 text-sm text-zinc-500">
              {calRemaining > 0
                ? <><span className="font-semibold text-zinc-700 dark:text-zinc-300">{calRemaining.toLocaleString()}</span> calories remaining</>
                : totals.calories === 0
                  ? 'Nothing logged yet today'
                  : <span className={cn('font-semibold', statusCfg.text)}>Goal exceeded</span>
              }
            </p>

            {/* Calorie bar — color reflects status */}
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className={cn('h-full rounded-full transition-all', statusCfg.bar)}
                style={{ width: `${pct(totals.calories, target.calories)}%` }}
              />
            </div>

            {/* Partial estimate notice */}
            {hasPartialEstimate && (
              <p className="mb-2 text-xs text-amber-500">Includes a partial estimate — some ingredients were not resolved.</p>
            )}

            {/* Macro rows */}
            <div className="flex flex-col gap-2">
              {[
                { label: 'Protein', consumed: totals.proteinG,  target: target.proteinG, color: 'bg-sky-400' },
                { label: 'Carbs',   consumed: totals.carbsG,    target: target.carbsG,   color: 'bg-amber-400' },
                { label: 'Fat',     consumed: totals.fatG,      target: target.fatG,     color: 'bg-orange-400' },
              ].map(({ label, consumed, target: t, color }) => (
                <div key={label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
                    <span className="text-zinc-400">
                      {consumed}g <span className="text-zinc-300 dark:text-zinc-600">/</span> {t}g
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct(consumed, t)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ── ACTIVITY + TRAINING ───────────────────────────────────────── */}
      <Card className="mb-3 p-4 md:p-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Activity</p>
          <Link
            href="/health"
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            Health <ChevronRight className="size-3" />
          </Link>
        </div>
        <ActivityDetailSheet
          connected={health.connected}
          lastSyncedAt={health.lastSyncedAt}
          provider={health.provider}
          activities={health.activities}
          allDayActiveKcal={health.allDayActiveKcal}
          basalKcal={health.basalKcal}
          totalBurnKcal={health.totalBurnKcal}
          stepCount={health.stepCount}
          activeMinutes={activeMinutes}
        />

        {/* Up next — next scheduled or in-progress workout */}
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-2">Up next</p>
          {nextWorkout ? (
            <div className="flex items-center gap-3">
              <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl',
                nextWorkout.status === 'in_progress' ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-sky-50 dark:bg-sky-900/30'
              )}>
                {nextWorkout.status === 'in_progress'
                  ? <PlayCircle className="size-4 text-emerald-600 dark:text-emerald-400" />
                  : <Calendar className="size-4 text-sky-600 dark:text-sky-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{nextWorkout.title}</p>
                <p className="text-xs text-zinc-400">
                  {nextWorkout.status === 'planned' && nextWorkout.scheduledDate
                    ? (() => {
                        const label = formatWorkoutDate(nextWorkout.scheduledDate, dateStr)
                        return label !== 'Today'
                          ? `${label} · ${nextWorkout.exercises.length} exercise${nextWorkout.exercises.length !== 1 ? 's' : ''}`
                          : `${nextWorkout.exercises.length} exercise${nextWorkout.exercises.length !== 1 ? 's' : ''}`
                      })()
                    : `${nextWorkout.exercises.length} exercise${nextWorkout.exercises.length !== 1 ? 's' : ''}`
                  }
                </p>
              </div>
              <Link href={`/training/workout/${nextWorkout.id}`}>
                <Button size="sm" variant="primary">
                  {nextWorkout.status === 'in_progress'
                    ? <><PlayCircle className="size-3.5" /> Resume</>
                    : <><PlayCircle className="size-3.5" /> Start</>}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
                <Dumbbell className="size-4 text-zinc-400" />
              </div>
              <p className="flex-1 text-sm text-zinc-500">No upcoming workouts</p>
              <Link
                href="/training"
                className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                Training <ChevronRight className="size-3" />
              </Link>
            </div>
          )}
        </div>
      </Card>

      {/* ── WATER ─────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <WaterWidget initialTotalMl={totalWaterMl} goalOz={waterGoalOz} />
      </Card>

      {/* ── COACH ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 shrink-0 rounded-lg overflow-hidden">
              <Image src="/icon.jpg" alt="Coach" width={32} height={32} className="size-8 object-cover" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">Involved Coach</p>
              <p className="text-xs text-zinc-400">Ask about training or nutrition</p>
            </div>
          </div>
          <Link href="/coach">
            <button className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
              Open <ArrowRight className="size-3" />
            </button>
          </Link>
        </div>
      </div>

    </div>
  )
}
