import 'server-only'
import { searchExercises, getExerciseById, classifyExercise } from '@/lib/exercises'
import type { Exercise, MovementPattern, MovementFamily, ExerciseRole, Laterality, ClassificationConfidence } from '@/lib/exercises'

// Compact exercise summary sent to V — structured metadata only, never GIF URLs.
export interface ExerciseSummary {
  id: string
  name: string
  bodyPart: string
  equipment: string
  target: string
  secondaryMuscles: string[]
  // Involved classification layer — derived from name + metadata, NOT raw ExerciseDB fields
  movementPattern: MovementPattern
  secondaryMovementPatterns: MovementPattern[]
  movementFamily: MovementFamily
  exerciseRole: ExerciseRole
  laterality: Laterality
  classificationConfidence: ClassificationConfidence
}

function toSummary(e: Exercise): ExerciseSummary {
  const c = classifyExercise(e)
  return {
    id: e.id,
    name: e.name,
    bodyPart: e.bodyPart,
    equipment: e.equipment,
    target: e.target,
    secondaryMuscles: e.secondaryMuscles,
    movementPattern: c.primaryMovementPattern,
    secondaryMovementPatterns: c.secondaryMovementPatterns,
    movementFamily: c.movementFamily,
    exerciseRole: c.exerciseRole,
    laterality: c.laterality,
    classificationConfidence: c.classificationConfidence,
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
    results = results.filter(e => classifyExercise(e).primaryMovementPattern === movementPattern)
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
      'Search the Involved exercise library. Each result includes movementPattern, movementFamily, exerciseRole, and laterality from the Involved classification layer — these are derived from the exercise name, NOT blindly from ExerciseDB bodyPart/target. Use movementPattern filter when filling a specific training role. Use movementFamily to detect redundancy across variations. Always search before selecting exercise IDs. Never invent IDs.',
    parameters: {
      type: 'object',
      properties: {
        query:     { type: 'string', description: 'Exercise name or keyword search' },
        bodyPart:  { type: 'string', description: 'Body part: back, chest, shoulders, upper arms, lower arms, upper legs, lower legs, waist, neck, cardio' },
        equipment: { type: 'string', description: 'Equipment type, e.g. barbell, dumbbell, cable, body weight, machine, kettlebell' },
        muscle:    { type: 'string', description: 'Target or secondary muscle to filter by, e.g. glutes, hamstrings, lats, quads' },
        movementPattern: {
          type: 'string',
          description: 'PREFERRED filter for role-based search. Values: squat, hinge, lunge, calf, horizontal_push, incline_push, fly, vertical_push, shoulder_isolation, vertical_pull, horizontal_pull, bicep, tricep, forearm, core_antiextension, core_flexion, core_rotation, core_lateral, carry, cardio, olympic_power, other. Use this instead of bodyPart when you have a specific training role to fill.',
        },
        limit: { type: 'number', description: 'Max results (default 15, max 20)' },
      },
      required: [],
    },
  },
}
