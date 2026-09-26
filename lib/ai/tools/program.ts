import { validateExerciseId } from './exercises'
import { classifyExercise } from '@/lib/exercises'
import type { Exercise } from '@/lib/exercises'

export interface WeekProgression {
  week: number        // 1-based
  sets?: number
  reps_min?: number
  reps_max?: number
  rpe?: number
  load_note?: string  // e.g. "315 lb", "70% 1RM", "+5 lb", "same"
}

export interface ProgramPhase {
  name: string    // e.g. "Base", "Accumulation", "Build", "Intensification", "Peak", "Taper", "Deload"
  weeks: string   // e.g. "1-4", "5-8", "9-12"
  focus: string   // brief description of what this phase accomplishes
}

export type ProgressionModel =
  | 'linear'
  | 'double_progression'
  | 'rep_progression'
  | 'set_progression'
  | 'percentage_rpe'
  | 'duration_distance'
  | 'auto'

export type SequencingMode =
  | 'straight'
  | 'alternating'
  | 'superset'
  | 'antagonist_superset'
  | 'compound_set'
  | 'giant_set'

const VALID_PROGRESSION_MODELS: ProgressionModel[] = [
  'linear', 'double_progression', 'rep_progression', 'set_progression',
  'percentage_rpe', 'duration_distance', 'auto',
]
const VALID_SEQUENCING_MODES: SequencingMode[] = [
  'straight', 'alternating', 'superset', 'antagonist_superset', 'compound_set', 'giant_set',
]

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
  week_progressions?: WeekProgression[]      // per-week overrides for multi-week programs

  // Progression model fields
  progression_model?: ProgressionModel
  progression_increment?: number    // load increment per step (e.g. 5 = 5 lb)
  progression_condition?: string    // human-readable trigger (e.g. "all sets hit reps_max at target RIR")
  starting_load?: string            // e.g. "70% 1RM", "80 lb", "use warm-up weight"
  target_rir?: number               // reps in reserve target (0–5)
  failure_allowed?: boolean         // whether taking the set to muscular failure is permitted

  // Sequencing fields
  sequencing_mode?: SequencingMode
  sequencing_group?: number         // exercises with the same positive integer are grouped together
}

export type SessionType =
  | 'upper_push'           // push-focused upper (chest/shoulders/triceps)
  | 'upper_pull'           // pull-focused upper (back/biceps)
  | 'upper_full'           // balanced upper (push + pull)
  | 'lower_quad'           // quad-dominant lower (squat, leg press)
  | 'lower_posterior'      // posterior chain lower (deadlift, RDL, hip hinge)
  | 'lower_full'           // balanced lower (quad + posterior)
  | 'full_body'            // full body
  | 'push_pull_legs_push'  // PPL push day
  | 'push_pull_legs_pull'  // PPL pull day
  | 'push_pull_legs_legs'  // PPL legs day
  | 'conditioning'         // conditioning / metcon
  | 'endurance'            // steady-state cardio / endurance
  | 'sport_skill'          // sport-specific skill work
  | 'recovery'             // recovery / mobility
  | 'other'

export interface ProgramDayDraft {
  name: string
  focus?: string
  session_type?: SessionType    // explicit session type — drives role validation
  day_rationale?: string        // why this session is structured this way
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
  program_rationale?: string    // why this program structure was chosen for this user
  phases?: ProgramPhase[]    // required for programs ≥ 8 weeks
  session_sequencing?: string // overall sequencing note for the program (e.g. "Push-pull pairs alternating; accessories in supersets")
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
  phases?: ProgramPhase[]
  days: ValidatedProgramDay[]
}

export interface ProgramValidationResult {
  valid: boolean
  program?: ValidatedProgram
  errors: string[]
  warnings: string[]
}

export interface ValidationOptions {
  // When set, every exercise's equipment must appear in this list.
  // "body weight" is always allowed regardless of this list.
  allowedEquipment?: string[]
}

export function validateProgramDraft(draft: ProgramDraft, options?: ValidationOptions): ProgramValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!draft.program_name?.trim()) errors.push('Program name is required')
  if (draft.program_name && draft.program_name.length > 200) {
    errors.push(`Program name must be 200 characters or fewer (got ${draft.program_name.length})`)
  }
  if (!Array.isArray(draft.days) || draft.days.length === 0) {
    errors.push('Program must have at least one day')
  }
  if ((draft.days?.length ?? 0) > 7) errors.push('Program cannot have more than 7 days')

  // Validate phases (optional, but required for ≥ 8 weeks)
  if (draft.weeks != null && draft.weeks >= 8 && !draft.phases?.length) {
    warnings.push(`Program is ${draft.weeks} weeks but has no phases defined. Add phases (e.g. "Base", "Build", "Peak") to describe the periodization structure.`)
  }
  if (Array.isArray(draft.phases)) {
    for (const phase of draft.phases) {
      if (!phase.name?.trim()) errors.push('Each phase must have a name')
      if (!phase.weeks?.trim()) errors.push(`Phase "${phase.name}": weeks range is required (e.g. "1-4")`)
      if (!phase.focus?.trim()) errors.push(`Phase "${phase.name}": focus description is required`)
    }
  }

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

      // Progression model fields
      if (ex.progression_model !== undefined && !VALID_PROGRESSION_MODELS.includes(ex.progression_model)) {
        errors.push(`${record.name}: progression_model "${ex.progression_model}" is not valid. Use one of: ${VALID_PROGRESSION_MODELS.join(', ')}`)
      }
      if (ex.progression_increment !== undefined && ex.progression_increment <= 0) {
        errors.push(`${record.name}: progression_increment must be greater than 0`)
      }
      if (ex.target_rir !== undefined && (ex.target_rir < 0 || ex.target_rir > 5)) {
        errors.push(`${record.name}: target_rir must be 0–5 (got ${ex.target_rir})`)
      }

      // Sequencing fields
      if (ex.sequencing_mode !== undefined && !VALID_SEQUENCING_MODES.includes(ex.sequencing_mode)) {
        errors.push(`${record.name}: sequencing_mode "${ex.sequencing_mode}" is not valid. Use one of: ${VALID_SEQUENCING_MODES.join(', ')}`)
      }
      if (ex.sequencing_group !== undefined) {
        if (!Number.isInteger(ex.sequencing_group) || ex.sequencing_group < 1) {
          errors.push(`${record.name}: sequencing_group must be a positive integer (got ${ex.sequencing_group})`)
        }
      }
      const groupedModes: SequencingMode[] = ['superset', 'antagonist_superset', 'compound_set', 'giant_set']
      if (ex.sequencing_mode && groupedModes.includes(ex.sequencing_mode) && ex.sequencing_group == null) {
        warnings.push(`${record.name}: sequencing_mode is "${ex.sequencing_mode}" but sequencing_group is not set. Set sequencing_group to an integer shared by all exercises in this group.`)
      }

      // Validate week_progressions
      if (Array.isArray(ex.week_progressions)) {
        const programWeeks = draft.weeks ?? Infinity
        for (const wp of ex.week_progressions) {
          if (!Number.isInteger(wp.week) || wp.week < 1) {
            errors.push(`${record.name}: week_progressions[].week must be a positive integer, got ${wp.week}`)
          } else if (wp.week > programWeeks) {
            errors.push(`${record.name}: week_progressions week ${wp.week} exceeds program duration (${programWeeks} weeks)`)
          }
          if (wp.rpe !== undefined && (wp.rpe < 1 || wp.rpe > 10)) {
            errors.push(`${record.name}: week_progressions week ${wp.week} RPE must be 1–10`)
          }
        }
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

  if (errors.length > 0) return { valid: false, errors, warnings }

  return {
    valid: true,
    errors: [],
    warnings,
    program: {
      program_name: draft.program_name.trim(),
      description: draft.description?.trim(),
      phases: draft.phases,
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
          description: 'Total program duration in weeks (e.g. 4, 8, 12). The days represent Week 1; week_progressions on exercises describe week-over-week changes.',
        },
        progression_strategy: {
          type: 'string',
          description: 'How the program progresses over weeks. Be specific — name actual percentages, rep ranges, or volume changes rather than generic phrases.',
        },
        program_rationale: {
          type: 'string',
          description: 'Why this program structure was chosen for this specific user. Reference their readiness state, goals, training history, and any key constraints that shaped the design. 2–4 sentences.',
        },
        session_sequencing: {
          type: 'string',
          description: 'Optional overall sequencing note: describe how exercises are grouped or sequenced across the program (e.g. "Main lifts as straight sets; accessories in antagonist supersets").',
        },
        phases: {
          type: 'array',
          description: 'REQUIRED for programs ≥ 8 weeks. Define the distinct training phases (e.g. Base → Build → Peak → Taper). Each phase must name the weeks it covers.',
          items: {
            type: 'object',
            properties: {
              name:  { type: 'string', description: 'Phase name, e.g. "Base", "Accumulation", "Intensification", "Peak", "Taper", "Deload"' },
              weeks: { type: 'string', description: 'Week range, e.g. "1-4", "5-8", "9-11", "12"' },
              focus: { type: 'string', description: 'What this phase accomplishes, e.g. "Build aerobic base and movement quality; higher reps, lower intensity"' },
            },
            required: ['name', 'weeks', 'focus'],
          },
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
              session_type: {
                type: 'string',
                enum: ['upper_push', 'upper_pull', 'upper_full', 'lower_quad', 'lower_posterior', 'lower_full', 'full_body', 'push_pull_legs_push', 'push_pull_legs_pull', 'push_pull_legs_legs', 'conditioning', 'endurance', 'sport_skill', 'recovery', 'other'],
                description: 'REQUIRED for every strength and conditioning day. Explicitly declares the session type so movement-pattern role coverage can be validated. "upper_full" = balanced upper (push + pull). Use "other" only for warm-up-only days.',
              },
              day_rationale: {
                type: 'string',
                description: 'Why this session is structured this way — the training intent, pattern priority, or recovery consideration that shaped it. 1–2 sentences.',
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
                    sets:              { type: 'number', description: 'Sets (1–20) — represents Week 1 baseline' },
                    reps_min:          { type: 'number', description: 'Minimum reps per set (omit for time-based) — Week 1 baseline' },
                    reps_max:          { type: 'number', description: 'Maximum reps per set (omit for time-based) — Week 1 baseline' },
                    duration_seconds:  { type: 'number', description: 'Duration per set in seconds (omit for rep-based)' },
                    rest_seconds:      { type: 'number', description: 'Rest between sets in seconds' },
                    notes:             { type: 'string', description: 'Coaching cue, progression instruction, or form note. For multi-week programs without week_progressions, describe the progression arc here.' },
                    rpe:               { type: 'number', description: 'Target RPE on the 1–10 scale (e.g. 7.5 = 2–3 reps left in tank). Omit if not applicable.' },
                    set_type:          { type: 'string', enum: ['working', 'warmup', 'amrap'], description: 'Set type: "working" (default), "warmup", or "amrap"' },
                    progression_model: {
                      type: 'string',
                      enum: ['linear', 'double_progression', 'rep_progression', 'set_progression', 'percentage_rpe', 'duration_distance', 'auto'],
                      description: 'Progression model for this exercise. "linear": add load when target reps achieved. "double_progression": hold weight until all sets hit reps_max, then increase. "rep_progression": add reps each week within range. "set_progression": add sets over weeks before increasing load. "percentage_rpe": % 1RM week_progressions. "duration_distance": for carries/conditioning. "auto": V chooses.',
                    },
                    progression_increment: {
                      type: 'number',
                      description: 'Load increment per progression step in lb (e.g. 5 for "add 5 lb"). Set for linear and double_progression models.',
                    },
                    progression_condition: {
                      type: 'string',
                      description: 'Human-readable trigger for progression. E.g. "increase load once all sets reach reps_max at target RIR." Required for double_progression.',
                    },
                    starting_load: {
                      type: 'string',
                      description: 'Starting load in Week 1. Use % 1RM when LOAD ANCHORS are available (e.g. "70% 1RM = 284 lb"), otherwise "moderate weight" or RPE-based description.',
                    },
                    target_rir: {
                      type: 'number',
                      description: 'Target reps in reserve (0–5). 0 = failure, 1 = 1 rep left, 2 = 2 reps left (≈ RPE 8), 3 = 3 reps left (≈ RPE 7). Prefer over rpe alone for clarity.',
                    },
                    failure_allowed: {
                      type: 'boolean',
                      description: 'Whether muscular failure is permitted on this exercise. Default false. Only set true for isolation work on intermediate/advanced trainees. Never true for beginners or compound lifts.',
                    },
                    sequencing_mode: {
                      type: 'string',
                      enum: ['straight', 'alternating', 'superset', 'antagonist_superset', 'compound_set', 'giant_set'],
                      description: '"straight": complete all sets before moving on. "alternating": rotate between exercises with FULL REST between each set. "superset": two exercises back-to-back with MINIMAL rest between them, then full rest. "antagonist_superset": superset of opposing muscle groups. "compound_set": superset of same muscle group. "giant_set": 3+ exercises in sequence.',
                    },
                    sequencing_group: {
                      type: 'integer',
                      description: 'Positive integer. Exercises sharing the same sequencing_group are performed as a unit (superset/alternating pair/giant set). Required when sequencing_mode is superset, antagonist_superset, compound_set, or giant_set.',
                    },
                    week_progressions: {
                      type: 'array',
                      description: 'Per-week overrides for this exercise. Use on main compound lifts to show explicit week-by-week progression (sets, reps, RPE, or load). The baseline fields (sets/reps_min/reps_max/rpe) represent Week 1; only include entries for weeks that differ from the previous week.',
                      items: {
                        type: 'object',
                        properties: {
                          week:      { type: 'integer', description: '1-based week number' },
                          sets:      { type: 'number', description: 'Override sets for this week' },
                          reps_min:  { type: 'number', description: 'Override reps_min for this week' },
                          reps_max:  { type: 'number', description: 'Override reps_max for this week' },
                          rpe:       { type: 'number', description: 'Override RPE for this week' },
                          load_note: { type: 'string', description: 'Human-readable load for this week, e.g. "315 lb", "70% 1RM", "+5 lb vs last week", "same as week 3"' },
                        },
                        required: ['week'],
                      },
                    },
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
