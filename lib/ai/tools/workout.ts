import { validateExerciseId } from './exercises'
import type { Exercise } from '@/lib/exercises'

export interface WorkoutExercise {
  exercise_id: string
  sets: number
  reps?: number
  duration_seconds?: number
  rest_seconds: number
  notes?: string
}

export interface WorkoutDraft {
  workout_name: string
  description?: string
  estimated_duration_minutes: number
  exercises: WorkoutExercise[]
}

export interface ValidatedWorkout {
  workout_name: string
  description?: string
  estimated_duration_minutes: number
  exercises: Array<WorkoutExercise & { exercise: Exercise }>
}

export interface WorkoutValidationResult {
  valid: boolean
  workout?: ValidatedWorkout
  errors: string[]
}

// Validate a workout draft from AI:
// - All exercise_ids must exist in our library
// - Sets/reps/rest must be within reasonable bounds
// - No AI-fabricated data makes it through
export function validateWorkoutDraft(draft: WorkoutDraft): WorkoutValidationResult {
  const errors: string[] = []

  if (!draft.workout_name?.trim()) errors.push('Workout name is required')
  if (!Array.isArray(draft.exercises) || draft.exercises.length === 0) {
    errors.push('Workout must include at least one exercise')
  }
  if (draft.estimated_duration_minutes < 5 || draft.estimated_duration_minutes > 240) {
    errors.push('Duration must be between 5 and 240 minutes')
  }

  const validatedExercises: Array<WorkoutExercise & { exercise: Exercise }> = []

  for (const ex of draft.exercises ?? []) {
    const record = validateExerciseId(ex.exercise_id)
    if (!record) {
      errors.push(`Exercise ID "${ex.exercise_id}" does not exist in the Involved library`)
      continue
    }
    if (ex.sets < 1 || ex.sets > 20) errors.push(`${record.name}: sets must be 1–20`)
    if (ex.reps !== undefined && (ex.reps < 1 || ex.reps > 100)) errors.push(`${record.name}: reps must be 1–100`)
    if (ex.rest_seconds < 0 || ex.rest_seconds > 600) errors.push(`${record.name}: rest must be 0–600 seconds`)
    if (errors.length === 0) {
      validatedExercises.push({ ...ex, exercise: record })
    }
  }

  if (errors.length > 0) return { valid: false, errors }

  return {
    valid: true,
    errors: [],
    workout: {
      workout_name: draft.workout_name.trim(),
      description: draft.description?.trim(),
      estimated_duration_minutes: draft.estimated_duration_minutes,
      exercises: validatedExercises,
    },
  }
}

// OpenAI tool definition for workout proposal
export const PROPOSE_WORKOUT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'propose_workout',
    description:
      'Propose a structured workout using only exercise IDs found via search_exercises. The server will validate every ID. Do not invent IDs — only use IDs returned by search_exercises.',
    parameters: {
      type: 'object',
      properties: {
        workout_name: {
          type: 'string',
          description: 'Name for this workout, e.g. "Upper Body Strength"',
        },
        description: {
          type: 'string',
          description: 'Brief description of the workout focus and structure',
        },
        estimated_duration_minutes: {
          type: 'number',
          description: 'Estimated total workout duration in minutes',
        },
        exercises: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              exercise_id:       { type: 'string',  description: 'ID from search_exercises result' },
              sets:              { type: 'number',  description: 'Number of sets (1–20)' },
              reps:              { type: 'number',  description: 'Reps per set (omit for time-based)' },
              duration_seconds:  { type: 'number',  description: 'Duration per set in seconds (omit for rep-based)' },
              rest_seconds:      { type: 'number',  description: 'Rest between sets in seconds' },
              notes:             { type: 'string',  description: 'Optional coaching note' },
            },
            required: ['exercise_id', 'sets', 'rest_seconds'],
          },
        },
      },
      required: ['workout_name', 'estimated_duration_minutes', 'exercises'],
    },
  },
}
