'use client'

import { useRouter } from 'next/navigation'
import ProgramBuilder, { type ProgramDay } from '@/components/training/ProgramBuilder'

export default function NewProgramPage() {
  const router = useRouter()

  const handleSave = async (name: string, description: string, days: ProgramDay[]) => {
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      days: days.map((d, di) => ({
        name: d.name.trim() || `Day ${di + 1}`,
        weekday: d.weekday ?? undefined,
        focus: d.focus?.trim() || undefined,
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
            targetDurationSeconds: s.targetDurationSeconds ?? undefined,
            restSeconds: s.restSeconds ?? undefined,
          })),
        })),
      })),
    }
    const res = await fetch('/api/programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      throw new Error(data.error ?? 'Failed to save program')
    }
    const data = await res.json() as { program: { id: string } }
    router.push(`/training/programs/${data.program.id}`)
  }

  return (
    <ProgramBuilder
      title="New program"
      backHref="/training/programs"
      saveLabel="Save program"
      onSave={handleSave}
    />
  )
}
