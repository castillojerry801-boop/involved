'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface TrainerProgram {
  id:              string
  name:            string
  description:     string | null
  level:           string | null
  durationWeeks:   number | null
  sessionsPerWeek: number | null
  isArchived:      boolean
  _count:          { assignments: number }
  days:            Array<{ id: string; name: string }>
}

export default function TrainerProgramsPage() {
  const [programs, setPrograms] = useState<TrainerProgram[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch('/api/trainer/programs')
      .then(r => r.json())
      .then(d => setPrograms(d.programs ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-6 text-sm text-zinc-500">Loading…</div>

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Program Library</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Reusable templates you can assign to any client</p>
        </div>
        <Link href="/trainer/programs/new">
          <Button size="sm">New Program</Button>
        </Link>
      </div>

      {programs.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-500 mb-3">
            No programs yet. Create your first template — you can assign it to multiple clients
            and customize each client&apos;s copy independently.
          </p>
          <Link href="/trainer/programs/new">
            <Button size="sm">Create Program</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map(p => (
            <Link key={p.id} href={`/trainer/programs/${p.id}`}>
              <Card className="hover:border-emerald-500 transition-colors cursor-pointer h-full">
                <CardHeader>
                  <CardTitle>{p.name}</CardTitle>
                  {p.level && (
                    <Badge className="text-xs capitalize">{p.level}</Badge>
                  )}
                </CardHeader>
                <div className="text-sm space-y-2">
                  {p.description && <p className="text-xs text-zinc-500">{p.description}</p>}
                  <div className="flex gap-3 text-xs text-zinc-500">
                    {p.durationWeeks && <span>{p.durationWeeks}w</span>}
                    {p.sessionsPerWeek && <span>{p.sessionsPerWeek}x/week</span>}
                    <span>{p.days.length} days</span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-zinc-400">
                      {p._count.assignments} assignment{p._count.assignments !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
