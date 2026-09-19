'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Users, Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface ProgramSet {
  setNumber:      number
  targetRepsMin?: number
  targetRepsMax?: number
  targetWeightKg?: number
  restSeconds?:   number
}

interface ProgramExercise {
  id:            string
  exerciseId:    string
  exerciseName?: string | null
  sortOrder:     number
  trackingType:  string
  notes?:        string | null
  restSeconds?:  number | null
  sets:          ProgramSet[]
}

interface ProgramDay {
  id:        string
  name:      string
  sortOrder: number
  exercises: ProgramExercise[]
}

interface TrainerProgram {
  id:              string
  name:            string
  description?:    string | null
  level?:          string | null
  durationWeeks?:  number | null
  sessionsPerWeek?: number | null
  isArchived:      boolean
  createdAt:       string
  days:            ProgramDay[]
  _count:          { assignments: number }
}

interface Client {
  clientId:    string
  displayName: string | null
}

export default function TrainerProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }   = use(params)
  const router   = useRouter()
  const [program, setProgram]       = useState<TrainerProgram | null>(null)
  const [clients, setClients]       = useState<Client[]>([])
  const [loading, setLoading]       = useState(true)
  const [expanded, setExpanded]     = useState<Record<string, boolean>>({})
  const [assigning, setAssigning]   = useState(false)
  const [assignTarget, setAssignTarget] = useState('')
  const [assignError, setAssignError]   = useState<string | null>(null)
  const [deleting, setDeleting]     = useState(false)

  useEffect(() => {
    async function load() {
      const [pRes, cRes] = await Promise.all([
        fetch(`/api/trainer/programs/${id}`),
        fetch('/api/trainer/clients'),
      ])
      if (pRes.ok) {
        const d = await pRes.json() as { program: TrainerProgram }
        setProgram(d.program)
        const init: Record<string, boolean> = {}
        d.program.days.forEach(day => { init[day.id] = true })
        setExpanded(init)
      }
      if (cRes.ok) {
        const d = await cRes.json() as { clients: Client[] }
        setClients(d.clients ?? [])
      }
      setLoading(false)
    }
    void load()
  }, [id])

  async function handleAssign() {
    if (!assignTarget) return
    setAssigning(true)
    setAssignError(null)
    const r = await fetch(`/api/trainer/programs/${id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: assignTarget }),
    })
    const d = await r.json() as { error?: string }
    if (!r.ok) { setAssignError(d.error ?? 'Failed to assign.'); setAssigning(false); return }
    setAssignTarget('')
    setAssigning(false)
  }

  async function handleDelete() {
    if (!confirm(`Delete "${program?.name}"? This cannot be undone.`)) return
    setDeleting(true)
    await fetch(`/api/trainer/programs/${id}`, { method: 'DELETE' })
    router.push('/trainer/programs')
  }

  if (loading) return <div className="p-6 text-sm text-zinc-500">Loading…</div>
  if (!program) return <div className="p-6 text-sm text-red-500">Program not found.</div>

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {/* Header */}
      <div className="mb-6 flex items-start gap-3">
        <Link
          href="/trainer/programs"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">{program.name}</h1>
          <div className="flex flex-wrap gap-2 mt-1">
            {program.level && <Badge className="text-xs capitalize">{program.level}</Badge>}
            {program.durationWeeks && <Badge variant="info" className="text-xs">{program.durationWeeks}w</Badge>}
            {program.sessionsPerWeek && <Badge variant="info" className="text-xs">{program.sessionsPerWeek}x/wk</Badge>}
          </div>
          {program.description && (
            <p className="text-sm text-zinc-500 mt-1">{program.description}</p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Link
            href={`/trainer/programs/${id}/edit`}
            className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Edit
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1 rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-red-500 hover:border-red-200 transition-colors"
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Delete
          </button>
        </div>
      </div>

      {/* Assign to client */}
      {clients.length > 0 && (
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-6">
          <p className="text-xs font-semibold text-zinc-500 mb-2 flex items-center gap-1.5">
            <Users className="size-3.5" />
            Assign to a client
            <span className="text-zinc-300 font-normal">({program._count.assignments} assignment{program._count.assignments !== 1 ? 's' : ''})</span>
          </p>
          <div className="flex gap-2">
            <select
              value={assignTarget}
              onChange={e => setAssignTarget(e.target.value)}
              className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none"
            >
              <option value="">Select client…</option>
              {clients.map(c => (
                <option key={c.clientId} value={c.clientId}>
                  {c.displayName ?? c.clientId}
                </option>
              ))}
            </select>
            <button
              onClick={handleAssign}
              disabled={assigning || !assignTarget}
              className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {assigning ? <Loader2 className="size-4 animate-spin" /> : null}
              Assign
            </button>
          </div>
          {assignError && <p className="text-xs text-red-500 mt-2">{assignError}</p>}
        </div>
      )}

      {/* Days */}
      <div className="space-y-4">
        {program.days.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-8">No days in this program.</p>
        )}
        {program.days.map(day => (
          <div key={day.id} className="rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
            <button
              onClick={() => setExpanded(prev => ({ ...prev, [day.id]: !prev[day.id] }))}
              className="flex w-full items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <span className="font-semibold text-sm text-zinc-900 dark:text-white">{day.name}</span>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span>{day.exercises.length} exercise{day.exercises.length !== 1 ? 's' : ''}</span>
                {expanded[day.id] ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </div>
            </button>

            {expanded[day.id] && (
              <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
                {day.exercises.length === 0 && (
                  <p className="px-4 py-3 text-sm text-zinc-400">No exercises.</p>
                )}
                {day.exercises.map((ex, i) => (
                  <div key={ex.id} className="px-4 py-3">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                          {i + 1}. {ex.exerciseName ?? ex.exerciseId}
                        </p>
                        {ex.notes && <p className="text-xs text-zinc-400 mt-0.5">{ex.notes}</p>}
                      </div>
                      <span className="text-xs text-zinc-400">{ex.sets.length} sets</span>
                    </div>
                    <div className="space-y-1">
                      {ex.sets.map(s => (
                        <div key={s.setNumber} className="flex gap-4 text-xs text-zinc-500">
                          <span className="text-zinc-400 w-5">#{s.setNumber}</span>
                          {(s.targetRepsMin || s.targetRepsMax) && (
                            <span>
                              {s.targetRepsMin ?? '?'}–{s.targetRepsMax ?? '?'} reps
                            </span>
                          )}
                          {s.targetWeightKg && <span>{s.targetWeightKg} kg</span>}
                          {s.restSeconds && <span>{s.restSeconds}s rest</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
