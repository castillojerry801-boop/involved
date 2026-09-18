import { validateExerciseId } from './exercises'
import type { WorkoutExercise } from './workout'
import type { Exercise } from '@/lib/exercises'

export interface ProgramDayDraft {
  name: string
  estimated_duration_minutes: number
  exercises: WorkoutExercise[]
}

export interface ProgramDraft {
  program_name: string
  description?: string
  days: ProgramDayDraft[]
}

export interface ValidatedProgramDay {
  name: string
  estimated_duration_minutes: number
  exercises: Array<WorkoutExercise & { exercise: Exercise }>
}

export interface ValidatedProgram {
  program_name: string
  description?: string
  days: ValidatedProgramDay[]
}

export interface ProgramValidationResult {
  valid: boolean
  program?: ValidatedProgram
  errors: string[]
}

export function validateProgramDraft(draft: ProgramDraft): ProgramValidationResult {
  const errors: string[] = []

  if (!draft.program_name?.trim()) errors.push('Program name is required')
  if (!Array.isArray(draft.days) || draft.days.length === 0) {
    errors.push('Program must have at least one day')
  }
  if (draft.days.length > 7) errors.push('Program cannot have more than 7 days')

  const validatedDays: ValidatedProgramDay[] = []

  for (const [di, day] of (draft.days ?? []).entries()) {
    if (!day.name?.trim()) {
      errors.push(`Day ${di + 1}: name is required`)
      continue
    }
    if (!Array.isArray(day.exercises) || day.exercises.length === 0) {
      errors.push(`Day "${day.name}": must include at least one exercise`)
      continue
    }

    const validatedExercises: Array<WorkoutExercise & { exercise: Exercise }> = []

    for (const ex of day.exercises) {
      const record = validateExerciseId(ex.exercise_id)
      if (!record) {
        errors.push(`Day "${day.name}": exercise ID "${ex.exercise_id}" does not exist in library`)
        continue
      }
      if (ex.sets < 1 || ex.sets > 20) errors.push(`${record.name}: sets must be 1–20`)
      if (ex.reps !== undefined && (ex.reps < 1 || ex.reps > 100)) errors.push(`${record.name}: reps must be 1–100`)
      if (ex.rest_seconds < 0 || ex.rest_seconds > 600) errors.push(`${record.name}: rest must be 0–600s`)
      if (errors.length === 0) validatedExercises.push({ ...ex, exercise: record })
    }

    if (errors.length === 0) {
      validatedDays.push({
        name: day.name.trim(),
        estimated_duration_minutes: day.estimated_duration_minutes ?? 45,
        exercises: validatedExercises,
      })
    }
  }

  if (errors.length > 0) return { valid: false, errors }

  return {
    valid: true,
    errors: [],
    program: {
      program_name: draft.program_name.trim(),
      description: draft.description?.trim(),
      days: validatedDays,
    },
  }
}

export const PROPOSE_PROGRAM_TOOL = {
  type: 'function' as const,
  function: {
    name: 'propose_program',
    description:
      'Propose a multi-day training program using only exercise IDs found via search_exercises. The server will validate every ID. Do not invent IDs — only use IDs returned by search_exercises. Each day should target different muscle groups for proper recovery.',
    parameters: {
      type: 'object',
      properties: {
        program_name: {
          type: 'string',
          description: 'Name for the program, e.g. "3-Day Push Pull Legs"',
        },
        description: {
          type: 'string',
          description: 'Brief description of the program structure and goals',
        },
        days: {
          type: 'array',
          description: 'Training days in order (max 7)',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Day name, e.g. "Push Day", "Upper Body Strength"',
              },
              estimated_duration_minutes: {
                type: 'number',
                description: 'Estimated duration of this day in minutes',
              },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    exercise_id:      { type: 'string', description: 'ID from search_exercises result' },
                    sets:             { type: 'number', description: 'Number of sets (1–20)' },
                    reps:             { type: 'number', description: 'Reps per set (omit for time-based)' },
                    duration_seconds: { type: 'number', description: 'Duration per set in seconds (omit for rep-based)' },
                    rest_seconds:     { type: 'number', description: 'Rest between sets in seconds' },
                    notes:            { type: 'string', description: 'Optional coaching note' },
                  },
                  required: ['exercise_id', 'sets', 'rest_seconds'],
                },
              },
            },
            required: ['name', 'exercises'],
          },
        },
      },
      required: ['program_name', 'days'],
    },
  },
}
