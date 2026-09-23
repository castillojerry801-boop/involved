import { validateExerciseId } from './exercises'
import { classifyExercise } from '@/lib/exercises'
import type { Exercise } from '@/lib/exercises'

export interface ProgramExercise {
  exercise_id: string
  intended_pattern: string   // V must declare the movementPattern role this exercise fills; server validates it
  sets: number
  reps_min?: number
  reps_max?: number
  duration_seconds?: number
  rest_seconds: number
  notes?: string
  rpe?: number               // target RPE (6–10 scale), optional
  set_type?: 'warmup' | 'working' | 'amrap'  // defaults to working
}

export interface ProgramDayDraft {
  name: string
  focus?: string
  weekday?: number              // 0=Monday … 6=Sunday; omit if unscheduled
  estimated_duration_minutes: number
  exercises: ProgramExercise[]
}

export interface ProgramDraft {
  program_name: string
  description?: string
  primary_goal?: string
  weeks?: number
  progression_strategy?: string
  days: ProgramDayDraft[]
}

export interface ValidatedProgramDay {
  name: string
  focus?: string
  weekday?: number
  estimated_duration_minutes: number
  exercises: Array<ProgramExercise & { exercise: Exercise }>
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

export interface ValidationOptions {
  // When set, every exercise's equipment must appear in this list.
  // "body weight" is always allowed regardless of this list.
  allowedEquipment?: string[]
}

export function validateProgramDraft(draft: ProgramDraft, options?: ValidationOptions): ProgramValidationResult {
  const errors: string[] = []

  if (!draft.program_name?.trim()) errors.push('Program name is required')
  if (draft.program_name && draft.program_name.length > 200) {
    errors.push(`Program name must be 200 characters or fewer (got ${draft.program_name.length})`)
  }
  if (!Array.isArray(draft.days) || draft.days.length === 0) {
    errors.push('Program must have at least one day')
  }
  if (draft.days.length > 7) errors.push('Program cannot have more than 7 days')

  // Validate weekday assignments across all days (range + no duplicates)
  const seenWeekdays = new Set<number>()
  for (const day of draft.days ?? []) {
    if (day.weekday !== undefined && day.weekday !== null) {
      if (!Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6) {
        errors.push(`Day "${day.name}": weekday must be an integer 0–6 (0=Monday…6=Sunday), got ${day.weekday}`)
      } else if (seenWeekdays.has(day.weekday)) {
        const labels = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
        errors.push(`Duplicate weekday assignment: two days are both scheduled on ${labels[day.weekday]} (weekday ${day.weekday})`)
      } else {
        seenWeekdays.add(day.weekday)
      }
    }
  }

  const allowedEquipment = options?.allowedEquipment?.length
    ? new Set([...options.allowedEquipment.map(e => e.toLowerCase()), 'body weight'])
    : null

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
    if (day.exercises.length > 15) {
      errors.push(`Day "${day.name}": too many exercises (${day.exercises.length} > 15 max) — split into multiple days or remove accessories`)
    }
    if (day.estimated_duration_minutes !== undefined && day.estimated_duration_minutes <= 0) {
      errors.push(`Day "${day.name}": estimated_duration_minutes must be greater than 0`)
    }

    const seenIdsInDay = new Set<string>()
    const validatedExercises: Array<ProgramExercise & { exercise: Exercise }> = []

    for (const ex of day.exercises) {
      if (seenIdsInDay.has(ex.exercise_id)) {
        errors.push(`Day "${day.name}": exercise ID "${ex.exercise_id}" appears more than once — remove the duplicate`)
        continue
      }
      seenIdsInDay.add(ex.exercise_id)

      const record = validateExerciseId(ex.exercise_id)
      if (!record) {
        errors.push(`Day "${day.name}": exercise ID "${ex.exercise_id}" does not exist — only use IDs from search_exercises`)
        continue
      }

      // Validate intended_pattern against the Involved classification layer
      if (!ex.intended_pattern?.trim()) {
        errors.push(`Day "${day.name}", ${record.name}: intended_pattern is required — declare the movementPattern role this exercise fills`)
      } else {
        const classification = classifyExercise(record)

        if (classification.exerciseRole === 'mobility') {
          // Mobility/stretch exercises cannot fill strength or conditioning roles.
          // V may include them intentionally (warmup, cooldown) by setting intended_pattern to "other".
          if (ex.intended_pattern !== 'other') {
            errors.push(
              `Day "${day.name}", ${record.name}: exerciseRole is "mobility" (stretch / flexibility). ` +
              `It cannot fill a "${ex.intended_pattern}" strength role. ` +
              `Set intended_pattern to "other" to include it intentionally for warmup/cooldown, ` +
              `or choose a different exercise.`
            )
          }
        } else {
          const derived = classification.primaryMovementPattern
          const secondary = classification.secondaryMovementPatterns
          const intendedOk =
            ex.intended_pattern === derived ||
            secondary.includes(ex.intended_pattern as typeof derived)
          if (!intendedOk) {
            errors.push(
              `Day "${day.name}", ${record.name}: intended_pattern "${ex.intended_pattern}" does not match ` +
              `the Involved classification (derived: "${derived}"` +
              (secondary.length ? `, secondaryPatterns: [${secondary.join(', ')}]` : '') +
              `). Search for a different exercise or correct the intended_pattern.`
            )
          }
        }
      }

      if (ex.sets < 1 || ex.sets > 20) {
        errors.push(`${record.name}: sets must be 1–20`)
      }
      if (ex.reps_min !== undefined) {
        if (ex.reps_min < 1 || ex.reps_min > 100) errors.push(`${record.name}: reps_min must be 1–100`)
      }
      if (ex.reps_max !== undefined) {
        if (ex.reps_max < 1 || ex.reps_max > 100) errors.push(`${record.name}: reps_max must be 1–100`)
      }
      if (ex.reps_min !== undefined && ex.reps_max !== undefined && ex.reps_min > ex.reps_max) {
        errors.push(`${record.name}: reps_min (${ex.reps_min}) cannot be greater than reps_max (${ex.reps_max})`)
      }
      if (ex.rest_seconds < 0 || ex.rest_seconds > 600) {
        errors.push(`${record.name}: rest must be 0–600 seconds`)
      }
      if (ex.rpe !== undefined && (ex.rpe < 1 || ex.rpe > 10)) {
        errors.push(`${record.name}: RPE must be between 1 and 10 (got ${ex.rpe})`)
      }
      if (ex.notes && ex.notes.length > 500) {
        errors.push(`${record.name}: notes must be 500 characters or fewer`)
      }
      if (allowedEquipment) {
        const eq = record.equipment.toLowerCase()
        if (!allowedEquipment.has(eq)) {
          errors.push(
            `Day "${day.name}", ${record.name}: uses "${record.equipment}" which is not in the active equipment profile. ` +
            `Search with equipment filter to find an alternative.`
          )
        }
      }

      if (errors.length === 0) validatedExercises.push({ ...ex, exercise: record })
    }

    if (errors.length === 0) {
      validatedDays.push({
        name: day.name.trim(),
        focus: day.focus?.trim(),
        ...(day.weekday != null ? { weekday: day.weekday } : {}),
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
      'Propose a complete multi-day training program. Call this ONLY after: (1) planning the full program structure, (2) searching for exercises to fill each planned movement-pattern role, and (3) completing your mental Program Review Pass. All exercise IDs must come from search_exercises — never invent them. Each day must have a clear purpose and non-redundant exercise selection.',
    parameters: {
      type: 'object',
      properties: {
        program_name: {
          type: 'string',
          description: 'Name for the program, e.g. "3-Day Push / Pull / Legs"',
        },
        description: {
          type: 'string',
          description: 'Program overview: structure, goal, periodization model, and how progression works across weeks. This is where phases, loading schemes, and progression instructions live.',
        },
        primary_goal: {
          type: 'string',
          description: 'The single primary training goal, e.g. "Build strength", "Hypertrophy", "Athletic performance", "Fat loss + muscle retention"',
        },
        weeks: {
          type: 'number',
          description: 'Total program duration in weeks (e.g. 4, 8, 12). The days represent Week 1; notes describe week-over-week progression.',
        },
        progression_strategy: {
          type: 'string',
          description: 'How the program progresses over weeks (e.g. "Linear load increase of 5 lb/week on main lifts. Deload every 4th week.").',
        },
        days: {
          type: 'array',
          description: 'Training days in order (max 7). Each day should have a distinct purpose with exercises filling different movement pattern roles.',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Day name, e.g. "Push Day", "Lower Body Strength", "Monday"',
              },
              focus: {
                type: 'string',
                description: 'Session focus in one phrase, e.g. "Quad-dominant strength + posterior chain accessory"',
              },
              weekday: {
                type: 'integer',
                minimum: 0,
                maximum: 6,
                description: 'Weekday this training day is scheduled: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday. Omit if not scheduled on a specific weekday.',
              },
              estimated_duration_minutes: {
                type: 'number',
                description: 'Estimated session length in minutes',
              },
              exercises: {
                type: 'array',
                description: 'Exercises in intended training order. Each should fill a distinct movement pattern role.',
                items: {
                  type: 'object',
                  properties: {
                    exercise_id:       { type: 'string', description: 'ID from search_exercises — never invent' },
                    intended_pattern:  { type: 'string', description: 'REQUIRED: the movementPattern role this exercise fills in this session (e.g. "squat", "hinge", "vertical_pull"). Must match the exercise\'s movementPattern from search_exercises or the server will reject it.' },
                    sets:              { type: 'number', description: 'Sets (1–20)' },
                    reps_min:          { type: 'number', description: 'Minimum reps per set (omit for time-based)' },
                    reps_max:          { type: 'number', description: 'Maximum reps per set (omit for time-based)' },
                    duration_seconds:  { type: 'number', description: 'Duration per set in seconds (omit for rep-based)' },
                    rest_seconds:      { type: 'number', description: 'Rest between sets in seconds' },
                    notes:             { type: 'string', description: 'Coaching cue, progression instruction, or form note' },
                    rpe:               { type: 'number', description: 'Target RPE on the 1–10 scale (e.g. 7.5 = 2–3 reps left in tank). Omit if not applicable.' },
                    set_type:          { type: 'string', enum: ['working', 'warmup', 'amrap'], description: 'Set type: "working" (default), "warmup", or "amrap"' },
                  },
                  required: ['exercise_id', 'intended_pattern', 'sets', 'rest_seconds'],
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
