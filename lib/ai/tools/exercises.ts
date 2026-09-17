import 'server-only'
import { searchExercises, getExerciseById } from '@/lib/exercises'
import type { Exercise } from '@/lib/exercises'

// Compact exercise summary — only structured metadata, never GIF URLs.
// GIFs are served from our own storage and never sent to OpenAI.
export interface ExerciseSummary {
  id: string
  name: string
  bodyPart: string
  equipment: string
  target: string
  secondaryMuscles: string[]
}

function toSummary(e: Exercise): ExerciseSummary {
  return {
    id: e.id,
    name: e.name,
    bodyPart: e.bodyPart,
    equipment: e.equipment,
    target: e.target,
    secondaryMuscles: e.secondaryMuscles,
  }
}

export interface ExerciseSearchParams {
  query?: string
  bodyPart?: string
  equipment?: string
  muscle?: string
  limit?: number
}

export function executeExerciseSearch(params: ExerciseSearchParams): ExerciseSummary[] {
  const { query = '', bodyPart = 'all', equipment, muscle, limit = 15 } = params

  let results = searchExercises(query, bodyPart, 200)

  if (equipment) {
    const eq = equipment.toLowerCase()
    results = results.filter(e => e.equipment.toLowerCase().includes(eq))
  }
  if (muscle) {
    const m = muscle.toLowerCase()
    results = results.filter(
      e => e.target.toLowerCase().includes(m) || e.secondaryMuscles.some(s => s.toLowerCase().includes(m))
    )
  }

  return results.slice(0, limit).map(toSummary)
}

// Validate that an exercise ID exists in our library.
// Used to reject AI-fabricated IDs before saving any workout.
export function validateExerciseId(id: string): Exercise | null {
  return getExerciseById(id) ?? null
}

// OpenAI tool definition for exercise search
export const SEARCH_EXERCISES_TOOL = {
  type: 'function' as const,
  function: {
    name: 'search_exercises',
    description:
      'Search the Involved exercise library for exercises matching the given criteria. Only returns exercises that exist in the library. Use this before selecting exercise IDs for a workout.',
    parameters: {
      type: 'object',
      properties: {
        query:     { type: 'string',  description: 'Search term (exercise name, muscle, etc.)' },
        bodyPart:  { type: 'string',  description: 'Body part: back, chest, shoulders, upper arms, lower arms, upper legs, lower legs, waist, neck, cardio' },
        equipment: { type: 'string',  description: 'Equipment type, e.g. barbell, dumbbell, cable, body weight, machine' },
        muscle:    { type: 'string',  description: 'Target or secondary muscle to filter by' },
        limit:     { type: 'number',  description: 'Max results to return (default 15, max 20)' },
      },
      required: [],
    },
  },
}
