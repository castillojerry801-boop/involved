import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Dumbbell, Plus, ChevronRight, BookOpen, ClipboardList, Calendar, PlayCircle, CheckCircle2, Zap, LayoutTemplate, BarChart2, Calculator, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { jsToWeekday, resolveScheduledDay, upcomingSchedule } from '@/lib/training/program-scheduling'
import { formatDuration } from '@/lib/training/format'
import { getTrainingData } from '@/lib/training/training-data'

export const metadata: Metadata = { title: 'Training' }

const TOOLS = [
  { href: '/training/programs/new',     icon: ClipboardList, label: 'Build program'  },
  { href: '/training/weekly-targets',   icon: Target,        label: 'Weekly targets' },
  { href: '/training/equipment',        icon: Zap,           label: 'Equipment'      },
  { href: '/training/volume',           icon: BarChart2,     label: 'Volume'         },
  { href: '/training/plate-calculator', icon: Calculator,    label: 'Plate calc'     },
  { href: '/training/exercises/custom', icon: Plus,          label: 'Custom'         },
]

export default async function TrainingPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const [{ recent, planned, activeProgram, allPrograms, templateCount, inProgressWorkout }, ent] = await Promise.all([
    getTrainingData(user.id),
    getUserEntitlement(user.id),
  ])

  const todayWd = jsToWeekday(new Date().getDay())
  const schedulableDays = activeProgram
    ? activeProgram.days.map(d => ({
        id: d.id,
        name: d.name,
        weekday: (d as unknown as { weekday: number | null }).weekday,
        exerciseCount: d._count.exercises,
      }))
    : []
  const todayDay = activeProgram ? resolveScheduledDay(schedulableDays, todayWd) : null
  const upcoming = activeProgram ? upcomingSchedule(schedulableDays, todayWd) : []

  const trainerPrograms = ent.isTrainer
    ? await prisma.trainerProgram.findMany({
        where: { trainerId: user.id, isArchived: false },
        select: { id: true, name: true, days: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }).catch(() => [])
    : []

  // Active program is shown prominently near the top — exclude it from the programs list below
  const nonActivePrograms = allPrograms.filter(p => !p.isActive)

  // Empty-state links for templates and trainer programs fold into the tools grid
  const extraTools = [
    ...(templateCount === 0 ? [{ href: '/training/templates', icon: LayoutTemplate, label: 'Templates' }] : []),
    ...(ent.isTrainer && trainerPrograms.length === 0 ? [{ href: '/trainer/programs', icon: ClipboardList, label: 'Trainer progs' }] : []),
  ]
  const allTools = [...TOOLS, ...extraTools]

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Training</h1>
          <p className="text-sm text-zinc-500">Exercises, workouts & progress</p>
        </div>
        <div className="flex gap-2">
          <Link href="/training/log?mode=plan">
            <Button size="sm" variant="secondary">
              <Calendar className="size-4" />
              Plan
            </Button>
          </Link>
          <Link href="/training/log">
            <Button size="sm">
              <Plus className="size-4" />
              Log workout
            </Button>
          </Link>
        </div>
      </div>

      {/* Resume — pinned at top when a workout is in progress */}
      {inProgressWorkout && (
        <section className="mb-5">
          <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-900/10 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-0.5">
                  In progress
                </p>
                <p className="font-bold text-zinc-900 dark:text-white truncate">{inProgressWorkout.title}</p>
                <p className="text-xs text-zinc-500">
                  {inProgressWorkout.exercises.length} exercise{inProgressWorkout.exercises.length !== 1 ? 's' : ''}
                  {inProgressWorkout.durationSeconds && inProgressWorkout.durationSeconds >= 60 ? ` · ${formatDuration(inProgressWorkout.durationSeconds)}` : ''}
                </p>
              </div>
              <Link href={`/training/workout/${inProgressWorkout.id}`} className="shrink-0">
                <Button>
                  <PlayCircle className="size-4" />
                  Resume
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Today's scheduled workout */}
      {activeProgram && todayDay && (
        <section className="mb-5">
          <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-900/10 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-0.5">
                  Today · {activeProgram.name}
                </p>
                <p className="font-bold text-zinc-900 dark:text-white truncate">{todayDay.name}</p>
                <p className="text-xs text-zinc-500">{todayDay.exerciseCount} exercise{todayDay.exerciseCount !== 1 ? 's' : ''}</p>
              </div>
              <Link href={`/training/workout/new?programDayId=${todayDay.id}`} className="shrink-0">
                <Button>
                  <PlayCircle className="size-4" />
                  Start
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Active Program — prominent card linking to program detail */}
      {activeProgram && (
        <section className="mb-5">
          <Link href={`/training/programs/${activeProgram.id}`}>
            <div className="flex items-center gap-3 rounded-2xl border-2 border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-900/10 px-4 py-4 hover:border-emerald-200 dark:hover:border-emerald-800/60 transition-colors">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/40">
                <Zap className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-0.5">Active program</p>
                <p className="font-bold text-zinc-900 dark:text-white truncate">{activeProgram.name}</p>
                <p className="text-xs text-zinc-500">
                  {activeProgram.days.length} day{activeProgram.days.length !== 1 ? 's' : ''}
                  {' · '}
                  {activeProgram.days.reduce((n, d) => n + d._count.exercises, 0)} exercises
                </p>
              </div>
              <ChevronRight className="size-5 text-emerald-400 dark:text-emerald-600 shrink-0" />
            </div>
          </Link>
        </section>
      )}

      {/* This week — compact schedule strip */}
      {activeProgram && upcoming.some(u => u.day != null) && (
        <section className="mb-5">
          <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">This week</h2>
          <div className="grid grid-cols-6 gap-1.5">
            {upcoming.map(({ weekday, label, day }) => (
              <div
                key={weekday}
                className={cn(
                  'rounded-xl p-2 text-center',
                  day ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-100 dark:bg-zinc-800'
                )}
              >
                <p className={cn('text-[9px] font-bold uppercase tracking-wide', day ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-400')}>
                  {label}
                </p>
                {day ? (
                  <p className="text-[10px] font-semibold text-white dark:text-zinc-900 mt-0.5 truncate">{day.name}</p>
                ) : (
                  <p className="text-[10px] text-zinc-400 mt-0.5">–</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Exercise Library — prominent quick-link near top */}
      <section className="mb-5">
        <Link href="/training/exercises">
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 dark:bg-white">
              <BookOpen className="size-5 text-white dark:text-zinc-900" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-zinc-900 dark:text-white">Exercise Library</p>
              <p className="text-xs text-zinc-400">1,394 exercises with animated guides</p>
            </div>
            <ChevronRight className="size-5 text-zinc-300 dark:text-zinc-600 shrink-0" />
          </div>
        </Link>
      </section>

      {/* Planned workouts */}
      {planned.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Planned</h2>
          <div className="flex flex-col gap-2">
            {planned.map(w => {
              const date = w.scheduledDate
                ? new Date(w.scheduledDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : null
              return (
                <Link key={w.id} href={`/training/workout/${w.id}`}>
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-900/30">
                      <Calendar className="size-4 text-sky-600 dark:text-sky-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{w.title}</p>
                      <p className="text-xs text-zinc-400">{w.exercises.length} exercise{w.exercises.length !== 1 ? 's' : ''}{date ? ` · ${date}` : ''}</p>
                    </div>
                    <PlayCircle className="size-5 text-zinc-300 dark:text-zinc-600 shrink-0" />
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Recent workouts — 2 most recent, View All for full history */}
      <section className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-zinc-900 dark:text-white">Recent workouts</h2>
          {recent.length > 0 && (
            <Link href="/training/history" className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              View all
            </Link>
          )}
        </div>

        {recent.length === 0 ? (
          <Card className="flex flex-col items-center py-10 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <Dumbbell className="size-6 text-zinc-400" />
            </div>
            <p className="font-semibold text-zinc-900 dark:text-white mb-1">No workouts logged yet</p>
            <p className="text-sm text-zinc-400 max-w-xs mb-4">
              Tap &quot;Log workout&quot; to record your first session.
            </p>
            <Link href="/training/log">
              <Button size="sm">
                <Plus className="size-4" />
                Log first workout
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {recent.map(w => {
              const date = (w.completedAt ?? w.startedAt ?? w.scheduledDate)
                ? new Date((w.completedAt ?? w.startedAt ?? w.scheduledDate)!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : null
              return (
                <Link key={w.id} href={`/training/history/${w.id}`}>
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-50 dark:bg-zinc-800">
                      <CheckCircle2 className="size-5 text-zinc-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{w.title}</p>
                      <p className="text-xs text-zinc-400">
                        {w.exercises.length} exercise{w.exercises.length !== 1 ? 's' : ''}
                        {w.durationSeconds && w.durationSeconds >= 60 ? ` · ${formatDuration(w.durationSeconds)}` : ''}
                        {date ? ` · ${date}` : ''}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-zinc-300 dark:text-zinc-600 shrink-0" />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Programs — non-active only (active program shown prominently above) */}
      {nonActivePrograms.length > 0 && (
        <section className="mb-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-zinc-900 dark:text-white">Programs</h2>
            <Link href="/training/programs" className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {nonActivePrograms.map(program => (
              <Link key={program.id} href={`/training/programs/${program.id}`}>
                <div className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-50 dark:bg-zinc-800">
                    <ClipboardList className="size-4 text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{program.name}</p>
                    <p className="text-xs text-zinc-400">
                      {program.days.length} day{program.days.length !== 1 ? 's' : ''}
                      {' · '}
                      {program.days.reduce((n, d) => n + d._count.exercises, 0)} exercises
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-zinc-300 dark:text-zinc-600 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Trainer Programs — only when populated (empty state folds into tools) */}
      {ent.isTrainer && trainerPrograms.length > 0 && (
        <section className="mb-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-zinc-900 dark:text-white">Trainer Programs</h2>
            <Link href="/trainer/programs" className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {trainerPrograms.map(p => (
              <Link key={p.id} href={`/trainer/programs/${p.id}`}>
                <div className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-50 dark:bg-zinc-800">
                    <ClipboardList className="size-4 text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{p.name}</p>
                    <p className="text-xs text-zinc-400">{p.days.length} day{p.days.length !== 1 ? 's' : ''}</p>
                  </div>
                  <ChevronRight className="size-4 text-zinc-300 dark:text-zinc-600 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Templates — only when populated (empty state folds into tools) */}
      {templateCount > 0 && (
        <section className="mb-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-zinc-900 dark:text-white">Templates</h2>
            <Link href="/training/templates" className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
              View all
            </Link>
          </div>
          <Link href="/training/templates">
            <div className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-50 dark:bg-zinc-800">
                <LayoutTemplate className="size-4 text-zinc-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-zinc-900 dark:text-white">Saved templates</p>
                <p className="text-xs text-zinc-400">{templateCount} saved</p>
              </div>
              <ChevronRight className="size-4 text-zinc-300 shrink-0" />
            </div>
          </Link>
        </section>
      )}

      {/* Training tools — compact grid; empty-state template/trainer-prog links appended */}
      <section>
        <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Training tools</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {allTools.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href}>
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-3 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors text-center">
                <div className="flex size-8 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  <Icon className="size-4 text-zinc-500 dark:text-zinc-400" />
                </div>
                <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 leading-tight">{label}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

    </div>
  )
}
