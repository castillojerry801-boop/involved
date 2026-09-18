import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, ClipboardList, ChevronRight, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = { title: 'Programs' }

async function getPrograms(userId: string) {
  try {
    return prisma.program.findMany({
      where: { userId },
      include: {
        days: {
          orderBy: { sortOrder: 'asc' },
          include: { _count: { select: { exercises: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })
  } catch {
    return []
  }
}

export default async function ProgramsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const programs = await getPrograms(user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Programs</h1>
          <p className="text-sm text-zinc-500">Structured multi-day training plans</p>
        </div>
        <Link href="/training/programs/new">
          <Button size="sm">
            <Plus className="size-4" />
            New program
          </Button>
        </Link>
      </div>

      {programs.length === 0 ? (
        <Card className="flex flex-col items-center py-12 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <ClipboardList className="size-7 text-zinc-400" />
          </div>
          <p className="font-bold text-zinc-900 dark:text-white mb-1">No programs yet</p>
          <p className="text-sm text-zinc-400 max-w-xs mb-6">
            Build a structured plan with named days, exercises, sets, and rep targets.
          </p>
          <Link href="/training/programs/new">
            <Button size="sm">
              <Plus className="size-4" />
              Create first program
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {programs.map(program => (
            <Link key={program.id} href={`/training/programs/${program.id}`}>
              <div className="flex items-center gap-3 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${program.isActive ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-zinc-50 dark:bg-zinc-800'}`}>
                  {program.isActive
                    ? <Zap className="size-5 text-emerald-600 dark:text-emerald-400" />
                    : <ClipboardList className="size-5 text-zinc-400" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-zinc-900 dark:text-white truncate">{program.name}</p>
                    {program.isActive && (
                      <span className="shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">
                    {program.days.length} day{program.days.length !== 1 ? 's' : ''}
                    {program.days.length > 0 && (
                      <> · {program.days.map(d => d.name).join(', ')}</>
                    )}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-zinc-300 dark:text-zinc-600" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
