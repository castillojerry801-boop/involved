import exercisesRaw from '@/data/exercises.json'

export interface Exercise {
  id: string
  name: string
  bodyPart: string
  equipment: string
  target: string
  secondaryMuscles: string[]
  instructions: string[]
  description: string
}

export const exercises = exercisesRaw as Exercise[]

export const BODY_PARTS = [
  'all',
  'back',
  'cardio',
  'chest',
  'lower arms',
  'lower legs',
  'neck',
  'shoulders',
  'upper arms',
  'upper legs',
  'waist',
] as const

export function getGifUrl(id: string) {
  const base = process.env.NEXT_PUBLIC_EXERCISE_GIF_BASE_URL ?? '/exercises'
  return `${base}/${id}.gif`
}

export function searchExercises(query: string, bodyPart: string, limit = 30, offset = 0): Exercise[] {
  let results = exercises

  if (bodyPart && bodyPart !== 'all') {
    results = results.filter(e => e.bodyPart === bodyPart)
  }

  if (query.trim()) {
    const q = query.toLowerCase()
    results = results.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.target.toLowerCase().includes(q) ||
      e.equipment.toLowerCase().includes(q) ||
      e.bodyPart.toLowerCase().includes(q)
    )
  }

  return results.slice(offset, offset + limit)
}

export function getExerciseById(id: string): Exercise | undefined {
  return exercises.find(e => e.id === id)
}
