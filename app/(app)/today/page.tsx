import type { Metadata } from 'next'
import { Flame, ChevronRight, Plus, Trophy, ArrowRight, Bot } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'Today' }

// Demo data — replaced by real queries once Supabase is connected
const DEMO = {
  displayName: 'Athlete',
  streak: 7,
  nutrition: {
    calories:  { consumed: 1640, target: 2200 },
    proteinG:  { consumed: 132,  target: 170 },
    carbsG:    { consumed: 180,  target: 220 },
    fatG:      { consumed: 52,   target: 70 },
    mealsLogged: 2,
  },
  training: {
    todayWorkout: {
      name: 'Upper Body Strength',
      duration: '45 min',
      type: 'Strength',
      completed: false,
    },
    lastWorkout: { name: 'Zone 2 Run', date: 'Sep 13', duration: '35 min' },
    weeklyWorkouts: { done: 3, total: 5 },
  },
  upcomingEvent: { name: 'Spartan Sprint', daysAway: 54 },
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function pct(consumed: number, target: number) {
  return Math.min(Math.round((consumed / target) * 100), 100)
}

function MacroRow({
  label,
  consumed,
  target,
  unit,
  color,
}: {
  label: string
  consumed: number
  target: number
  unit: string
  color: string
}) {
  const p = pct(consumed, target)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
        <span className="text-zinc-400">
          {consumed}{unit} <span className="text-zinc-300 dark:text-zinc-600">/</span> {target}{unit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

export default function TodayPage() {
  const { nutrition, training, upcomingEvent } = DEMO
  const calRemaining = nutrition.calories.target - nutrition.calories.consumed
  const calPct = pct(nutrition.calories.consumed, nutrition.calories.target)

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500">{getGreeting()}, {DEMO.displayName}</p>
          <p className="text-xs text-zinc-400 mt-0.5">{today}</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
          <Flame className="size-3.5 fill-orange-400 text-orange-400" />
          <span className="text-sm font-bold text-zinc-900 dark:text-white">{DEMO.streak}</span>
          <span className="text-xs text-zinc-400">streak</span>
        </div>
      </div>

      {/* ── NUTRITION ───────────────────────────────────────────────────── */}
      <Card className="mb-4">
        {/* Section header */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Nutrition</p>
          <Link
            href="/nutrition"
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            Full log <ChevronRight className="size-3" />
          </Link>
        </div>

        {/* Calorie count */}
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">
            {nutrition.calories.consumed.toLocaleString()}
          </span>
          <span className="text-sm text-zinc-400">
            / {nutrition.calories.target.toLocaleString()} cal
          </span>
        </div>
        <p className="mb-4 text-sm text-zinc-500">
          {calRemaining > 0
            ? <><span className="font-semibold text-zinc-700 dark:text-zinc-300">{calRemaining.toLocaleString()}</span> calories remaining</>
            : <span className="font-semibold text-amber-600">Target reached</span>
          }
        </p>

        {/* Calorie bar */}
        <div className="mb-5 h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${calPct}%` }}
          />
        </div>

        {/* Macro rows */}
        <div className="mb-5 flex flex-col gap-3">
          <MacroRow label="Protein" consumed={nutrition.proteinG.consumed}  target={nutrition.proteinG.target}  unit="g" color="bg-sky-400" />
          <MacroRow label="Carbs"   consumed={nutrition.carbsG.consumed}    target={nutrition.carbsG.target}    unit="g" color="bg-amber-400" />
          <MacroRow label="Fat"     consumed={nutrition.fatG.consumed}      target={nutrition.fatG.target}      unit="g" color="bg-orange-400" />
        </div>

        {/* Quick add */}
        <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Link href="/nutrition">
            <Button variant="secondary" size="sm" className="w-full">
              <Plus className="size-4" />
              Add food
            </Button>
          </Link>
        </div>
      </Card>

      {/* ── TRAINING ────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        {/* Section header */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Training</p>
          <Link
            href="/training"
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            History <ChevronRight className="size-3" />
          </Link>
        </div>

        {/* Today's workout */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="font-bold text-zinc-900 dark:text-white">
              {training.todayWorkout.name}
            </p>
            <p className="mt-0.5 text-sm text-zinc-500">
              {training.todayWorkout.duration} · {training.todayWorkout.type}
            </p>
          </div>
          {training.todayWorkout.completed && (
            <Badge variant="success" className="shrink-0">Done</Badge>
          )}
        </div>

        {/* CTAs */}
        <div className="mb-4 flex gap-2">
          <Link href="/training" className="flex-1">
            <Button size="sm" className="w-full">
              {training.todayWorkout.completed ? 'View workout' : 'Start workout'}
            </Button>
          </Link>
          <Link href="/training">
            <Button size="sm" variant="secondary">
              <Plus className="size-4" />
              Log activity
            </Button>
          </Link>
        </div>

        {/* Last workout */}
        <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <p className="text-xs text-zinc-400">Last workout</p>
          <p className="mt-0.5 text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {training.lastWorkout.name}
            <span className="text-zinc-400"> · {training.lastWorkout.date} · {training.lastWorkout.duration}</span>
          </p>
        </div>
      </Card>

      {/* ── SNAPSHOT ROW ────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {/* Event */}
        <Card className="flex flex-col gap-1 py-4">
          <div className="mb-1 flex size-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
            <Trophy className="size-4" />
          </div>
          <p className="text-xs text-zinc-400">Next event</p>
          <p className="font-bold text-sm text-zinc-900 dark:text-white leading-snug">
            {upcomingEvent.name}
          </p>
          <Badge variant="success" className="mt-1 w-fit text-[10px]">
            {upcomingEvent.daysAway} days out
          </Badge>
        </Card>

        {/* Weekly training */}
        <Card className="flex flex-col gap-1 py-4">
          <p className="text-xs text-zinc-400">This week</p>
          <p className="text-2xl font-black text-zinc-900 dark:text-white">
            {training.weeklyWorkouts.done}
            <span className="text-base font-normal text-zinc-400"> / {training.weeklyWorkouts.total}</span>
          </p>
          <p className="text-xs text-zinc-500">workouts done</p>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: training.weeklyWorkouts.total }, (_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full ${
                  i < training.weeklyWorkouts.done
                    ? 'bg-emerald-500'
                    : 'bg-zinc-100 dark:bg-zinc-800'
                }`}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* ── COACH — compact ─────────────────────────────────────────────── */}
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

      {/* Demo mode notice */}
      {!process.env.NEXT_PUBLIC_SUPABASE_URL && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700 dark:border-amber-800/30 dark:bg-amber-900/10 dark:text-amber-400">
          <strong>Demo mode:</strong> Add Supabase credentials to <code>.env.local</code> to enable real data.
        </div>
      )}
    </div>
  )
}
