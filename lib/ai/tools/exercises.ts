import 'server-only'
import { searchExercises, getExerciseById, deriveMovementPattern } from '@/lib/exercises'
import type { Exercise, MovementPattern } from '@/lib/exercises'

// Compact exercise summary sent to V — structured metadata only, never GIF URLs.
export interface ExerciseSummary {
  id: string
  name: string
  bodyPart: string
  equipment: string
  target: string
  secondaryMuscles: string[]
  movementPattern: MovementPattern
}

function toSummary(e: Exercise): ExerciseSummary {
  return {
    id: e.id,
    name: e.name,
    bodyPart: e.bodyPart,
    equipment: e.equipment,
    target: e.target,
    secondaryMuscles: e.secondaryMuscles,
    movementPattern: deriveMovementPattern(e),
  }
}

export interface ExerciseSearchParams {
  query?: string
  bodyPart?: string
  equipment?: string
  muscle?: string
  movementPattern?: string
  limit?: number
}

export function executeExerciseSearch(params: ExerciseSearchParams): ExerciseSummary[] {
  const { query = '', bodyPart = 'all', equipment, muscle, movementPattern, limit = 15 } = params

  // Get a broad result set first (up to 300 so downstream filters have room)
  let results = searchExercises(query, bodyPart, 300)

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
  if (movementPattern) {
    results = results.filter(e => deriveMovementPattern(e) === movementPattern)
  }

  return results.slice(0, limit).map(toSummary)
}

// Validate that an exercise ID exists in our library.
export function validateExerciseId(id: string): Exercise | null {
  return getExerciseById(id) ?? null
}

export const SEARCH_EXERCISES_TOOL = {
  type: 'function' as const,
  function: {
    name: 'search_exercises',
    description:
      'Search the Involved exercise library. Returns exercises with their movementPattern — use movementPattern filter to find exercises for a specific training role (e.g. "hinge" for hip-dominant work, "vertical_pull" for pulldowns/pull-ups). Always search before selecting exercise IDs. Never invent IDs.',
    parameters: {
      type: 'object',
      properties: {
        query:          { type: 'string', description: 'Exercise name or keyword search' },
        bodyPart:       { type: 'string', description: 'Body part: back, chest, shoulders, upper arms, lower arms, upper legs, lower legs, waist, neck, cardio' },
        equipment:      { type: 'string', description: 'Equipment type, e.g. barbell, dumbbell, cable, body weight, machine, kettlebell' },
        muscle:         { type: 'string', description: 'Target or secondary muscle to filter by, e.g. glutes, hamstrings, lats, quads' },
        movementPattern: {
          type: 'string',
          description: 'Filter by training role. Values: squat, hinge, lunge, calf, horizontal_push, incline_push, fly, vertical_push, shoulder_isolation, vertical_pull, horizontal_pull, bicep, tricep, forearm, core_antiextension, core_flexion, core_rotation, core_lateral, carry, cardio, other',
        },
        limit: { type: 'number', description: 'Max results (default 15, max 20)' },
      },
      required: [],
    },
  },
}
