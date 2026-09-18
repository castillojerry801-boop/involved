import type { Metadata } from 'next'
import { ChevronRight, Plus, ArrowRight, Bot, Dumbbell, PlayCircle, CheckCircle2, Calendar } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Today' }

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function pct(consumed: number, target: number) {
  if (!target) return 0
  return Math.min(Math.round((consumed / target) * 100), 100)
}

async function getTodayNutrition(userId: string) {
  const today = new Date().toISOString().slice(0, 10)

  const [entries, target] = await Promise.all([
    prisma.foodLogEntry.findMany({
      where: { userId, logDate: new Date(today) },
      select: {
        servingMultiplier: true,
        snapshotCaloriesPerServing: true,
        snapshotProteinGPerServing: true,
        snapshotCarbohydrateGPerServing: true,
        snapshotFatGPerServing: true,
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
  }
}

export default async function TodayPage() {
  const user = await getUser()
  if (!user) redirect('/login')
  // New users who haven't completed onboarding get redirected there first.
  // We check after fetching the profile below.

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const [nutrition, profile, todayWorkout] = await Promise.all([
    getTodayNutrition(user.id),
    prisma.profile.findUnique({ where: { id: user.id }, select: { displayName: true, fitnessLevel: true } }).catch(() => null),
    prisma.workout.findFirst({
      where: {
        userId: user.id,
        OR: [
          { status: 'in_progress' },
          {
            status: 'planned',
            scheduledDate: { gte: todayStart, lte: todayEnd },
          },
          {
            status: 'completed',
            completedAt: { gte: todayStart },
          },
        ],
      },
      orderBy: [
        { status: 'asc' },
        { scheduledDate: 'asc' },
      ],
      include: { exercises: { select: { exerciseId: true }, take: 5 } },
    }).catch(() => null),
  ])

  if (!profile?.fitnessLevel) redirect('/onboarding')

  const displayName =
    profile?.displayName ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'Athlete'

  const { totals, target, hasEntries } = nutrition
  const calRemaining = target ? target.calories - totals.calories : 0

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      {/* Header */}
      <div className="mb-6">
        <p className="text-sm font-medium text-zinc-500">{getGreeting()}, {displayName}</p>
        <p className="text-xs text-zinc-400 mt-0.5">{today}</p>
      </div>

      {/* ── NUTRITION ─────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Nutrition</p>
          <Link
            href="/nutrition"
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            Full log <ChevronRight className="size-3" />
          </Link>
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
              <span className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">
                {totals.calories.toLocaleString()}
              </span>
              <span className="text-sm text-zinc-400">
                / {target.calories.toLocaleString()} cal
              </span>
            </div>
            <p className="mb-4 text-sm text-zinc-500">
              {calRemaining > 0
                ? <><span className="font-semibold text-zinc-700 dark:text-zinc-300">{calRemaining.toLocaleString()}</span> calories remaining</>
                : totals.calories === 0
                  ? 'Nothing logged yet today'
                  : <span className="font-semibold text-amber-600">Goal reached</span>
              }
            </p>

            {/* Calorie bar */}
            <div className="mb-5 h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct(totals.calories, target.calories)}%` }}
              />
            </div>

            {/* Macro rows */}
            <div className="mb-5 flex flex-col gap-3">
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

            <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <Link href="/nutrition">
                <Button variant="secondary" size="sm" className="w-full">
                  <Plus className="size-4" />
                  {hasEntries ? 'Add more food' : 'Log your first meal'}
                </Button>
              </Link>
            </div>
          </>
        )}
      </Card>

      {/* ── TRAINING ──────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Training</p>
          <Link
            href="/training"
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            All <ChevronRight className="size-3" />
          </Link>
        </div>

        {todayWorkout ? (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${todayWorkout.status === 'in_progress' ? 'bg-emerald-50 dark:bg-emerald-900/30' : todayWorkout.status === 'completed' ? 'bg-zinc-50 dark:bg-zinc-800' : 'bg-sky-50 dark:bg-sky-900/30'}`}>
                {todayWorkout.status === 'in_progress' && <PlayCircle className="size-5 text-emerald-600 dark:text-emerald-400" />}
                {todayWorkout.status === 'completed' && <CheckCircle2 className="size-5 text-zinc-500" />}
                {todayWorkout.status === 'planned' && <Calendar className="size-5 text-sky-600 dark:text-sky-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-zinc-900 dark:text-white truncate">{todayWorkout.title}</p>
                <p className="text-xs text-zinc-400">{todayWorkout.exercises.length} exercise{todayWorkout.exercises.length !== 1 ? 's' : ''}</p>
              </div>
              {todayWorkout.status === 'completed' && (
                <span className="text-xs font-medium text-zinc-400">Done</span>
              )}
            </div>
            <Link href={`/training/workout/${todayWorkout.id}`} className="w-full block">
              <Button size="sm" className="w-full" variant={todayWorkout.status === 'completed' ? 'secondary' : 'primary'}>
                {todayWorkout.status === 'in_progress' && <><PlayCircle className="size-4" /> Resume</>}
                {todayWorkout.status === 'planned' && <><PlayCircle className="size-4" /> Start workout</>}
                {todayWorkout.status === 'completed' && 'View workout'}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <Dumbbell className="size-6 text-zinc-400" />
            </div>
            <p className="font-semibold text-zinc-900 dark:text-white mb-1">No workout today</p>
            <p className="text-sm text-zinc-400 mb-4">Log a workout or plan ahead.</p>
            <Link href="/training/log" className="w-full">
              <Button variant="secondary" size="sm" className="w-full">
                <Plus className="size-4" />
                Log workout
              </Button>
            </Link>
          </div>
        )}
      </Card>

      {/* ── COACH ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-4 py-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
              <Bot className="size-4" />
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
