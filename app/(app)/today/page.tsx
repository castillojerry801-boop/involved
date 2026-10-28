import type { Metadata } from 'next'
import { ChevronRight, Plus, ArrowRight, Dumbbell, PlayCircle } from 'lucide-react'
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
import { NutritionRingsSummary } from '@/components/nutrition/nutrition-rings-summary'

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

  const totalActivitySeconds = health.activities.reduce((sum, a) => sum + (a.durationSeconds ?? 0), 0)
  const activeMinutes = totalActivitySeconds > 0 ? Math.round(totalActivitySeconds / 60) : null

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 md:px-8 md:py-8">
      <HealthSyncTrigger />

      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-500">{greeting}, {displayName}</p>
          <p className="text-xs text-zinc-400 mt-0.5">{displayDate}</p>
        </div>

        {/* Next workout pill */}
        {nextWorkout ? (
          <Link href={`/training/workout/${nextWorkout.id}`} className="shrink-0">
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-100 bg-zinc-50 px-2 py-1.5 dark:border-zinc-700/50 dark:bg-zinc-800/60">
              <div className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-md',
                nextWorkout.status === 'in_progress' ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-sky-100 dark:bg-sky-900/40',
              )}>
                {nextWorkout.status === 'in_progress'
                  ? <PlayCircle className="size-3 text-emerald-600 dark:text-emerald-400" />
                  : <Dumbbell className="size-3 text-sky-600 dark:text-sky-400" />}
              </div>
              <p className="max-w-[110px] truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                {nextWorkout.title}
              </p>
              <ChevronRight className="size-3 shrink-0 text-zinc-400" />
            </div>
          </Link>
        ) : (
          <Link href="/training" className="shrink-0">
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-100 bg-zinc-50 px-2 py-1.5 dark:border-zinc-700/50 dark:bg-zinc-800/60">
              <Dumbbell className="size-3 shrink-0 text-zinc-400" />
              <p className="text-[11px] text-zinc-400">No workouts</p>
              <ChevronRight className="size-3 shrink-0 text-zinc-400" />
            </div>
          </Link>
        )}
      </div>

      {/* ── NUTRITION ─────────────────────────────────────────────────── */}
      <Card className="mb-3 p-4 md:p-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Nutrition</p>
          <div className="flex items-center gap-3">
            <Link
              href="/nutrition?add=true"
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
            <NutritionRingsSummary
              calories={{ consumed: totals.calories,  target: target.calories  }}
              protein={{ consumed: totals.proteinG,   target: target.proteinG  }}
              carbs={{ consumed: totals.carbsG,       target: target.carbsG    }}
              fat={{ consumed: totals.fatG,           target: target.fatG      }}
            />
            {hasPartialEstimate && (
              <p className="mt-2 text-xs text-amber-500">
                Includes a partial estimate — some ingredients were not resolved.
              </p>
            )}
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
