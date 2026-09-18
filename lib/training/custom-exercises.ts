import 'server-only'
import { prisma } from '@/lib/prisma'
import type { ExerciseMeta } from '@/lib/exercises'

export interface CustomExerciseRow {
  id: string
  userId: string
  name: string
  bodyPart: string | null
  targetMuscle: string | null
  equipment: string | null
  trackingType: string
  instructions: string | null
  createdAt: Date
  updatedAt: Date
}

export function customToMeta(c: CustomExerciseRow): ExerciseMeta {
  return {
    id: c.id,
    name: c.name,
    bodyPart: c.bodyPart ?? 'other',
    equipment: c.equipment ?? 'bodyweight',
    target: c.targetMuscle ?? 'other',
    secondaryMuscles: [],
    instructions: c.instructions ? [c.instructions] : [],
    description: '',
    isCustom: true,
    trackingType: c.trackingType,
  }
}

export async function getUserCustomExercises(userId: string): Promise<ExerciseMeta[]> {
  const rows = await prisma.customExercise.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
  })
  return rows.map(customToMeta)
}

export async function verifyCustomExerciseOwner(id: string, userId: string): Promise<boolean> {
  const row = await prisma.customExercise.findFirst({ where: { id, userId } })
  return row !== null
}

// Given a list of exercise IDs, verify any custom IDs belong to userId.
// Returns false if any custom ID is not owned by the user.
export async function verifyCustomExerciseIds(ids: string[], userId: string): Promise<boolean> {
  const { isCustomExerciseId } = await import('@/lib/exercises')
  const customIds = ids.filter(isCustomExerciseId)
  if (customIds.length === 0) return true
  const found = await prisma.customExercise.findMany({
    where: { id: { in: customIds }, userId },
    select: { id: true },
  })
  return found.length === customIds.length
}
