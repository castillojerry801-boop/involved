export interface ShorteningPlan {
  target_duration_minutes: number
  exercises_to_remove: string[]
  set_reductions: Array<{ exercise_id: string; new_set_count: number }>
  reasoning: string
}

export interface ShorteningResult {
  valid: boolean
  plan?: ShorteningPlan
  errors: string[]
}

export const PROPOSE_SHORTENING_TOOL = {
  type: 'function' as const,
  function: {
    name: 'propose_shortening',
    description:
      'Propose how to shorten a workout to a target duration. Preserve important compound movements. You may remove accessory exercises and reduce set counts. Never remove all exercises. Return exercise IDs exactly as provided.',
    parameters: {
      type: 'object',
      properties: {
        target_duration_minutes: {
          type: 'number',
          description: 'Target workout duration in minutes',
        },
        exercises_to_remove: {
          type: 'array',
          items: { type: 'string' },
          description: 'ExerciseDB IDs to remove entirely from the workout',
        },
        set_reductions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              exercise_id: { type: 'string', description: 'ExerciseDB ID of the exercise' },
              new_set_count: { type: 'number', description: 'New total number of sets (must be ≥ 1)' },
            },
            required: ['exercise_id', 'new_set_count'],
          },
          description: 'Exercises whose set count should be reduced (not removed)',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of what was removed/reduced and why',
        },
      },
      required: ['target_duration_minutes', 'exercises_to_remove', 'set_reductions', 'reasoning'],
    },
  },
}
