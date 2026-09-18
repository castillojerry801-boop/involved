'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import ProgramBuilder, { type ProgramDay, type ProgramExercise, defaultSet } from '@/components/training/ProgramBuilder'
import type { ExerciseMeta } from '@/lib/exercises'

interface LoadedSet {
  setNumber: number
  setType: string
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetWeightKg: number | null
  restSeconds: number | null
}

interface LoadedExercise {
  id: string
  exerciseId: string
  sortOrder: number
  trackingType: string
  notes: string | null
  restSeconds: number | null
  exercise: ExerciseMeta | null
  sets: LoadedSet[]
}

interface LoadedDay {
  id: string
  name: string
  sortOrder: number
  exercises: LoadedExercise[]
}

interface LoadedProgram {
  id: string
  name: string
  description: string | null
  days: LoadedDay[]
}

export default function EditProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [program, setProgram] = useState<LoadedProgram | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/programs/${id}`)
      .then(r => r.json() as Promise<{ program: LoadedProgram; error?: string }>)
      .then(data => {
        if (data.error) { setError(data.error); return }
        setProgram(data.program)
      })
      .catch(() => setError('Failed to load program'))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async (name: string, description: string, days: ProgramDay[]) => {
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      days: days.map((d, di) => ({
        name: d.name.trim() || `Day ${di + 1}`,
        sortOrder: di,
        exercises: d.exercises.map((ex, ei) => ({
          exerciseId: ex.exerciseId,
          sortOrder: ei,
          trackingType: ex.trackingType,
          notes: ex.notes || undefined,
          restSeconds: ex.restSeconds ?? undefined,
          sets: ex.sets.map(s => ({
            setNumber: s.setNumber,
            setType: s.setType,
            targetRepsMin: s.targetRepsMin ?? undefined,
            targetRepsMax: s.targetRepsMax ?? undefined,
            targetWeightKg: s.targetWeightKg ?? undefined,
            restSeconds: s.restSeconds ?? undefined,
          })),
        })),
      })),
    }
    const res = await fetch(`/api/programs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      throw new Error(data.error ?? 'Failed to save program')
    }
    router.push(`/training/programs/${id}`)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (error || !program) {
    return <div className="p-8 text-sm text-red-500">{error || 'Program not found'}</div>
  }

  const initialDays: ProgramDay[] = program.days.map(day => ({
    key: day.id,
    name: day.name,
    exercises: day.exercises.map(ex => ({
      key: ex.id,
      exerciseId: ex.exerciseId,
      exercise: ex.exercise,
      trackingType: ex.trackingType as ProgramExercise['trackingType'],
      notes: ex.notes ?? '',
      restSeconds: ex.restSeconds,
      sets: ex.sets.length > 0
        ? ex.sets.map(s => ({
            setNumber: s.setNumber,
            setType: s.setType as 'warmup' | 'working' | 'amrap',
            targetRepsMin: s.targetRepsMin,
            targetRepsMax: s.targetRepsMax,
            targetWeightKg: s.targetWeightKg,
            restSeconds: s.restSeconds,
          }))
        : [defaultSet(1), defaultSet(2), defaultSet(3)],
    })),
  }))

  return (
    <ProgramBuilder
      title="Edit program"
      backHref={`/training/programs/${id}`}
      initialName={program.name}
      initialDescription={program.description ?? ''}
      initialDays={initialDays}
      saveLabel="Save changes"
      onSave={handleSave}
    />
  )
}
