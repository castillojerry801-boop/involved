import 'server-only'
import type { ProgramDraft, ProgressionModel } from '@/lib/ai/tools/program'
import { getSessionRoles } from '@/lib/v/session-composition'

export interface QualityIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface QualityContext {
  sport?: string
  fitnessLevel?: string | null
  weeks?: number
  readinessState?: string | null
}

const PROGRESSION_KEYWORDS = /\badd\b|\bincrease\b|\bprogress\b|\bweek\b|\bphase\b|\b\d+%\b|\bload\b|\bbuilding\b|\bescalat/i

function normalizeSport(s: string): string {
  const lower = s.toLowerCase()
  if (/ocr|spartan|obstacle/.test(lower)) return 'ocr'
  if (/powerlifting|power.?lift/.test(lower)) return 'powerlifting'
  if (/running|marathon|5k|10k|road.?race/.test(lower)) return 'running'
  if (/bjj|jiu.?jitsu|grappling|wrestling/.test(lower)) return 'bjj'
  return lower
}

function isRunningOrOCR(sport: string): boolean {
  const s = normalizeSport(sport)
  return s === 'running' || s === 'ocr'
}

function isPowerliftingSport(sport: string): boolean {
  return normalizeSport(sport) === 'powerlifting'
}

function isOCR(sport: string): boolean {
  return normalizeSport(sport) === 'ocr'
}

function toExperienceLevel(fitnessLevel: string): 'beginner' | 'intermediate' | 'advanced' | null {
  const lvl = fitnessLevel.toLowerCase()
  if (lvl.includes('advanced') || lvl.includes('expert')) return 'advanced'
  if (lvl.includes('intermediate')) return 'intermediate'
  if (lvl.includes('beginner') || lvl.includes('novice')) return 'beginner'
  return null
}

function inferSessionType(name: string, focus?: string | null): string | null {
  const text = (name + ' ' + (focus ?? '')).toLowerCase()

  if (/full.?body|total.?body/i.test(text)) return 'full_body'

  // Upper specifics before generic "upper"
  if (/upper.*push|push.*upper|chest.*(shoulder|tri)|shoulder.*chest/i.test(text)) return 'upper_push'
  if (/upper.*pull|pull.*upper|back.*bi|lat.*bi/i.test(text)) return 'upper_pull'

  // PPL — simple push/pull/legs day labels (starts with the word)
  if (/^push\b/i.test(name.trim())) return 'push_pull_legs_push'
  if (/^pull\b/i.test(name.trim())) return 'push_pull_legs_pull'
  if (/^legs?\b/i.test(name.trim())) return 'push_pull_legs_legs'

  // Generic upper
  if (/\bupper\b/i.test(text)) return 'upper_full'

  // Lower specifics before generic "lower"
  if (/quad.?dominant|squat.?focus|quad.?day/i.test(text)) return 'lower_quad'
  if (/hinge.?dominant|posterior.?chain.?focus|deadlift.?day/i.test(text)) return 'lower_posterior'
  if (/lower.?body|lower.?strength|lower.?day|\blegs?\b/i.test(text)) return 'lower_full'

  if (/\bcondition|metcon|\bcardio\b|\baerob/i.test(text)) return 'conditioning'

  return null
}

function allExercises(draft: ProgramDraft) {
  return draft.days.flatMap(d => d.exercises)
}

export function validateProgramQuality(draft: ProgramDraft, ctx: QualityContext): QualityIssue[] {
  const issues: QualityIssue[] = []
  const weeks = ctx.weeks ?? draft.weeks ?? 0
  const sport = ctx.sport ?? ''
  const fitnessLevel = (ctx.fitnessLevel ?? '').toLowerCase()
  const isBeginnerFitness = fitnessLevel.includes('beginner') || fitnessLevel.includes('novice')

  // ── Multi-week progression ──────────────────────────────────────────────────

  // NO_PHASES: ≥ 8 weeks with no phases
  if (weeks >= 8 && !draft.phases?.length) {
    issues.push({
      severity: 'warning',
      code: 'NO_PHASES',
      message: `Program is ${weeks} weeks but has no phases defined. Add phases (Base, Build, Peak, etc.) to document the periodization structure.`,
    })
  }

  // NO_PROGRESSION: ≥ 4 weeks with no machine-readable progression AND no textual progression
  if (weeks >= 4) {
    const exercises = allExercises(draft)
    const hasWeekProgressions = exercises.some(ex => ex.week_progressions && ex.week_progressions.length > 0)
    const hasProgressionNotes = exercises.some(ex => ex.notes && PROGRESSION_KEYWORDS.test(ex.notes))
    const hasProgressionStrategy = draft.progression_strategy && PROGRESSION_KEYWORDS.test(draft.progression_strategy)
    if (!hasWeekProgressions && !hasProgressionNotes && !hasProgressionStrategy) {
      issues.push({
        severity: 'error',
        code: 'NO_PROGRESSION',
        message: `${weeks}-week program has no progression defined. Add week_progressions on main lifts or progression notes on exercises. A multi-week program must get harder week over week.`,
      })
    }
  }

  // NO_STRUCTURED_PROGRESSION: ≥ 6 weeks with no machine-readable progression structure
  // Unlike NO_PROGRESSION (which checks for any textual signal), this fires when there is
  // a progression_strategy but zero per-exercise week_progressions or progression_models.
  if (weeks >= 6) {
    const exercises = allExercises(draft)
    const hasWeekProgressions = exercises.some(ex => ex.week_progressions && ex.week_progressions.length > 0)
    const hasProgressionModel = exercises.some(ex => ex.progression_model && ex.progression_model !== 'auto')
    if (!hasWeekProgressions && !hasProgressionModel) {
      issues.push({
        severity: 'error',
        code: 'NO_STRUCTURED_PROGRESSION',
        message: `${weeks}-week program has no per-exercise progression structure: zero exercises have week_progressions or a progression_model assigned. Add progression_model ("linear", "double_progression", "percentage_rpe", etc.) to every main exercise, and populate week_progressions on compound lifts.`,
      })
    }
  }

  // ALTERNATING_NOT_IMPLEMENTED: alternating sequencing stated but no sequencing_group assigned
  if (draft.session_sequencing && /alternating/i.test(draft.session_sequencing)) {
    for (const day of draft.days) {
      if (day.exercises.length >= 4) {
        const hasAnyGroup = day.exercises.some(ex => ex.sequencing_group != null)
        if (!hasAnyGroup) {
          issues.push({
            severity: 'warning',
            code: 'ALTERNATING_NOT_IMPLEMENTED',
            message: `Program specifies alternating sequencing but day "${day.name}" has ${day.exercises.length} exercises with no sequencing_group assigned. Pair exercises that should alternate by assigning matching sequencing_group integers (e.g., group 1 and group 2).`,
          })
        }
      }
    }
  }

  // IDENTICAL_WEEK_NOTES: majority of exercises share the exact same non-empty note text
  // (empty notes are normal; repeated identical text is the copy-paste signal)
  {
    const exercises = allExercises(draft)
    const nonEmptyNotes = exercises.map(ex => ex.notes?.trim() ?? '').filter(Boolean)
    if (nonEmptyNotes.length >= 4) {
      const noteCounts = new Map<string, number>()
      for (const n of nonEmptyNotes) noteCounts.set(n, (noteCounts.get(n) ?? 0) + 1)
      const maxCount = Math.max(0, ...Array.from(noteCounts.values()))
      if (maxCount / nonEmptyNotes.length > 0.75) {
        issues.push({
          severity: 'warning',
          code: 'IDENTICAL_WEEK_NOTES',
          message: `More than 75% of exercise notes contain identical text, suggesting copy-pasted programming with no per-exercise progression differentiation.`,
        })
      }
    }
  }

  // ── Beginner running / endurance safety ────────────────────────────────────

  if (isBeginnerFitness && sport && isRunningOrOCR(sport)) {
    // BEGINNER_RUNNING_OVERLOAD: > 3 run days and weeks < 4
    const runDayCount = draft.days.filter(d => {
      const dayName = d.name.toLowerCase() + ' ' + (d.focus ?? '').toLowerCase()
      return /run|cardio|conditioning|endurance/.test(dayName)
    }).length
    if (runDayCount > 3 && weeks < 4) {
      issues.push({
        severity: 'error',
        code: 'BEGINNER_RUNNING_OVERLOAD',
        message: `Beginner runner has ${runDayCount} run/cardio days in a ${weeks}-week program. Start with ≤3 run days for the first month to avoid overuse injury.`,
      })
    }

    // BEGINNER_INTERVALS_TOO_SOON: intervals/tempo mentioned in early weeks
    const earlyIntervalPattern = /interval|tempo|threshold|lactate|400m|repeats/i
    for (const ex of allExercises(draft)) {
      const noteText = ex.notes ?? ''
      if (earlyIntervalPattern.test(noteText)) {
        // Check if the note references early weeks
        const weekRefs = noteText.match(/week\s*(\d+)/gi) ?? []
        const earlyWeekMentioned = weekRefs.some(ref => {
          const n = parseInt(ref.replace(/\D/g, ''), 10)
          return n >= 1 && n <= 3
        })
        if (earlyWeekMentioned || weekRefs.length === 0) {
          issues.push({
            severity: 'warning',
            code: 'BEGINNER_INTERVALS_TOO_SOON',
            message: `Interval/tempo work detected for a beginner runner. Do not introduce structured intervals until weeks 6–8 after base is established.`,
          })
          break
        }
      }
      // Also check week_progressions early weeks
      if (ex.week_progressions) {
        for (const wp of ex.week_progressions) {
          if (wp.week <= 3 && wp.load_note && earlyIntervalPattern.test(wp.load_note)) {
            issues.push({
              severity: 'warning',
              code: 'BEGINNER_INTERVALS_TOO_SOON',
              message: `Interval/tempo work prescribed in week ${wp.week} for a beginner runner. Delay until weeks 6–8.`,
            })
            break
          }
        }
      }
    }
  }

  // ── Powerlifting specific ───────────────────────────────────────────────────

  if (sport && isPowerliftingSport(sport)) {
    // POWERLIFTING_NO_MAIN_LIFTS: squat/bench/deadlift in < 3 days
    const mainLiftNames = /squat|bench\s*press|deadlift/i
    // Check via exercise notes/names — we don't have exercise names in draft, but check focus/day name
    const daysWithMainLifts = draft.days.filter(d => {
      const text = d.name + ' ' + (d.focus ?? '') + ' ' + d.exercises.map(e => e.notes ?? '').join(' ')
      return mainLiftNames.test(text)
    }).length
    if (daysWithMainLifts < 3) {
      issues.push({
        severity: 'error',
        code: 'POWERLIFTING_NO_MAIN_LIFTS',
        message: `Powerlifting program must program squat, bench press, and deadlift across at least 3 days. Found references in only ${daysWithMainLifts} day(s). Competition lifts must be the program centerpiece.`,
      })
    }

    // POWERLIFTING_NO_PHASES: ≥ 10 weeks with no phases
    if (weeks >= 10 && !draft.phases?.length) {
      issues.push({
        severity: 'error',
        code: 'POWERLIFTING_NO_PHASES',
        message: `Powerlifting program is ${weeks} weeks but has no phases defined. A peaking program must have structured phases (Hypertrophy → Strength → Peak → Taper).`,
      })
    }

    // POWERLIFTING_PEAK_DELOAD_CONFLICT: same week range labeled both peak and deload
    if (draft.phases) {
      const peakPhases = draft.phases.filter(p => /peak|peaking/i.test(p.name))
      const deloadPhases = draft.phases.filter(p => /deload|recovery|taper/i.test(p.name))
      for (const peak of peakPhases) {
        for (const deload of deloadPhases) {
          if (peak.weeks === deload.weeks) {
            issues.push({
              severity: 'error',
              code: 'POWERLIFTING_PEAK_DELOAD_CONFLICT',
              message: `Phase conflict: weeks "${peak.weeks}" is labeled both "${peak.name}" (peak) and "${deload.name}" (deload). These are mutually exclusive. A deload reduces volume; a peak increases intensity. Separate them.`,
            })
          }
        }
      }
    }
  }

  // ── OCR / Spartan specific ─────────────────────────────────────────────────

  if (sport && isOCR(sport)) {
    // OCR_MISSING_CARRIES
    const hasCarries = allExercises(draft).some(ex => ex.intended_pattern === 'carry')
    if (!hasCarries) {
      issues.push({
        severity: 'warning',
        code: 'OCR_MISSING_CARRIES',
        message: 'OCR/Spartan program has no carry exercises (intended_pattern: "carry"). Loaded carries are mandatory obstacles in OCR races — program farmer carries, sandbag carries, or similar.',
      })
    }

    // OCR_MISSING_PULLS
    const hasPulls = allExercises(draft).some(
      ex => ex.intended_pattern === 'vertical_pull' || ex.intended_pattern === 'horizontal_pull'
    )
    if (!hasPulls) {
      issues.push({
        severity: 'warning',
        code: 'OCR_MISSING_PULLS',
        message: 'OCR/Spartan program has no pulling exercises (vertical_pull or horizontal_pull). Pull-ups and rows are essential for obstacle walls, monkey bars, and rope climbs.',
      })
    }

    // OCR_CARDIO_ONLY_BIKE: all cardio notes mention bike/stationary
    const cardioExercises = allExercises(draft).filter(ex => ex.intended_pattern === 'cardio')
    if (cardioExercises.length > 0) {
      const bikePattern = /\bbike\b|\bstationary\b|\bcycle\b|\bcycling\b/i
      const allBike = cardioExercises.every(ex => bikePattern.test(ex.notes ?? ''))
      if (allBike) {
        issues.push({
          severity: 'warning',
          code: 'OCR_CARDIO_ONLY_BIKE',
          message: 'All cardio in this OCR program is stationary bike. OCR races require running and terrain-specific conditioning. Include running, rower, carries, or step-ups as primary conditioning.',
        })
      }
    }
  }

  // ── General quality ────────────────────────────────────────────────────────

  // EMPTY_DESCRIPTION: ≥ 4 weeks with missing or short description
  if (weeks >= 4) {
    const desc = draft.description?.trim() ?? ''
    if (desc.length < 50) {
      issues.push({
        severity: 'warning',
        code: 'EMPTY_DESCRIPTION',
        message: `${weeks}-week program has a short or missing description (${desc.length} chars). Add a description explaining the program structure, phases, and progression model.`,
      })
    }
  }

  // EXCESSIVE_CORE_REPETITION: same exercise_id in > 60% of days
  {
    const idCounts = new Map<string, number>()
    for (const day of draft.days) {
      const seenInDay = new Set<string>()
      for (const ex of day.exercises) {
        if (!seenInDay.has(ex.exercise_id)) {
          idCounts.set(ex.exercise_id, (idCounts.get(ex.exercise_id) ?? 0) + 1)
          seenInDay.add(ex.exercise_id)
        }
      }
    }
    const threshold = draft.days.length * 0.6
    for (const [id, count] of idCounts) {
      if (count > threshold && draft.days.length >= 3) {
        issues.push({
          severity: 'warning',
          code: 'EXCESSIVE_CORE_REPETITION',
          message: `Exercise ID "${id}" appears in ${count}/${draft.days.length} days (>${Math.round(threshold * 100 / draft.days.length)}% of sessions). Vary core and accessory exercises to prevent adaptation stagnation.`,
        })
      }
    }
  }

  // IMPLAUSIBLE_EXERCISE_COUNT_LOW: strength day with < 3 exercises
  for (const day of draft.days) {
    const isStrengthDay = /strength|weight|lift|power|push|pull|squat|deadlift|press/i.test(
      day.name + ' ' + (day.focus ?? '')
    )
    if (isStrengthDay && day.exercises.length < 3) {
      issues.push({
        severity: 'warning',
        code: 'IMPLAUSIBLE_EXERCISE_COUNT_LOW',
        message: `Day "${day.name}" appears to be a strength session but has only ${day.exercises.length} exercise(s). A strength session typically needs at least 3 exercises to be effective.`,
      })
    }
  }

  // DURATION_MISMATCH: any day with estimated_duration_minutes < 15
  for (const day of draft.days) {
    if (day.estimated_duration_minutes != null && day.estimated_duration_minutes < 15) {
      issues.push({
        severity: 'warning',
        code: 'DURATION_MISMATCH',
        message: `Day "${day.name}" has estimated_duration_minutes=${day.estimated_duration_minutes}, which seems too short for a training session. Check the duration.`,
      })
    }
  }

  // ── Session composition checks ─────────────────────────────────────────────

  const isAdvanced    = fitnessLevel.includes('advanced')   || fitnessLevel.includes('expert')
  const isIntermediate = fitnessLevel.includes('intermediate')

  // SPARSE_SESSION: intermediate/advanced strength day with < 4 exercises
  if (isIntermediate || isAdvanced) {
    for (const day of draft.days) {
      const isStrengthDay = /strength|push|pull|upper|lower|squat|deadlift|press|legs|chest|back/i.test(
        day.name + ' ' + (day.focus ?? '')
      )
      if (isStrengthDay && day.exercises.length < 4) {
        issues.push({
          severity: 'error',
          code: 'SPARSE_SESSION',
          message: `Day "${day.name}" is a ${isAdvanced ? 'advanced' : 'intermediate'} strength session with only ${day.exercises.length} exercise(s). Fill the required movement-pattern roles for this session type (minimum 4). Search for exercises to fill missing roles.`,
        })
      }
    }
  }

  // ADVANCED_SHALLOW_SESSION: advanced user with < 5 exercises in push/pull/full-body day
  if (isAdvanced) {
    for (const day of draft.days) {
      const isDeepDay = /push|pull|upper|full.?body|chest|back|shoulder/i.test(
        day.name + ' ' + (day.focus ?? '')
      )
      if (isDeepDay && day.exercises.length < 5) {
        issues.push({
          severity: 'error',
          code: 'ADVANCED_SHALLOW_SESSION',
          message: `Day "${day.name}" is an advanced ${day.name}-type session with only ${day.exercises.length} exercises. Advanced trainees need 5–8 exercises to fill all required roles (primary press, secondary press, isolation, shoulder work, arm accessories). Add missing roles.`,
        })
      }
    }
  }

  // MISSING_REQUIRED_ROLE: day is missing a required movement-pattern role for its type and experience level
  if (fitnessLevel) {
    const expLevel = toExperienceLevel(fitnessLevel)
    if (expLevel) {
      for (const day of draft.days) {
        const sessionType = inferSessionType(day.name, day.focus)
        if (!sessionType) continue

        const roles = getSessionRoles(sessionType, expLevel)
        const requiredPatterns = new Set(roles.filter(r => r.required).map(r => r.pattern))
        if (requiredPatterns.size === 0) continue

        const dayPatterns = new Set(day.exercises.map(ex => ex.intended_pattern))
        const missingPatterns = [...requiredPatterns].filter(p => !dayPatterns.has(p))

        if (missingPatterns.length > 0) {
          const missingRoleNames = roles
            .filter(r => r.required && missingPatterns.includes(r.pattern))
            .map(r => `${r.role} (${r.pattern})`)
          issues.push({
            severity: 'error',
            code: 'MISSING_REQUIRED_ROLE',
            message: `Day "${day.name}" (${sessionType}, ${expLevel}) is missing required movement-pattern roles: ${missingRoleNames.join(', ')}. Search for exercises with these movementPatterns and add them to this session.`,
          })
        }
      }
    }
  }

  // UNIPOLAR_UPPER_SESSION: upper full body day with only push OR only pull
  for (const day of draft.days) {
    const isUpperFull = /upper|full.?body/i.test(day.name + ' ' + (day.focus ?? ''))
    const isPushPullLegs = /^push|^pull|^legs/.test((day.name ?? '').toLowerCase())
    if (isUpperFull && !isPushPullLegs) {
      const hasPush = day.exercises.some(e =>
        /horizontal_push|incline_push|vertical_push|fly/.test(e.intended_pattern)
      )
      const hasPull = day.exercises.some(e =>
        /vertical_pull|horizontal_pull/.test(e.intended_pattern)
      )
      if (hasPush && !hasPull) {
        issues.push({
          severity: 'warning',
          code: 'UNIPOLAR_UPPER_SESSION',
          message: `Day "${day.name}" is an upper-body session with only push patterns and no pull (vertical_pull or horizontal_pull). Upper body sessions require both push and pull for balance.`,
        })
      } else if (hasPull && !hasPush) {
        issues.push({
          severity: 'warning',
          code: 'UNIPOLAR_UPPER_SESSION',
          message: `Day "${day.name}" is an upper-body session with only pull patterns and no push. Upper body sessions require both push and pull for balance.`,
        })
      }
    }
  }

  // BEGINNER_FAILURE_OVERUSE: beginner with failure_allowed on any exercise
  if (isBeginnerFitness) {
    const failureExercises = allExercises(draft).filter(ex => ex.failure_allowed === true)
    if (failureExercises.length > 0) {
      issues.push({
        severity: 'error',
        code: 'BEGINNER_FAILURE_OVERUSE',
        message: `Beginner program has ${failureExercises.length} exercise(s) with failure_allowed=true. Beginners should NEVER train to failure — it increases injury risk and provides no additional stimulus benefit at this level. Remove failure_allowed from all exercises.`,
      })
    }
  }

  // UNIFORM_PROGRESSION_MODEL: all exercises use identical non-null progression_model
  {
    const models = allExercises(draft)
      .map(ex => ex.progression_model)
      .filter((m): m is ProgressionModel => m != null && m !== 'auto')
    if (models.length >= 4) {
      const distinct = new Set(models)
      if (distinct.size === 1) {
        const theModel = [...distinct][0]
        issues.push({
          severity: 'warning',
          code: 'UNIFORM_PROGRESSION_MODEL',
          message: `Every exercise in this program uses the same progression_model ("${theModel}"). Real programs vary progression models: main lifts use "linear" or "percentage_rpe", accessories use "double_progression" or "rep_progression". Assign different models based on each exercise's role.`,
        })
      }
    }
  }

  // EXCESSIVE_FAILURE: intermediate/advanced with failure_allowed on > 50% of exercises
  if (!isBeginnerFitness) {
    const allEx = allExercises(draft)
    if (allEx.length >= 4) {
      const failureCount = allEx.filter(ex => ex.failure_allowed === true).length
      if (failureCount / allEx.length > 0.5) {
        issues.push({
          severity: 'warning',
          code: 'EXCESSIVE_FAILURE',
          message: `${failureCount}/${allEx.length} exercises have failure_allowed=true (>${Math.round(failureCount / allEx.length * 100)}%). Excessive failure training increases fatigue and injury risk. Limit to isolation exercises only, and only when the trainee is advanced. Compounds should never go to failure.`,
        })
      }
    }
  }

  // SUPERSET_MISSING_GROUP: superset/compound_set/giant_set mode without sequencing_group
  {
    const groupedModes = new Set(['superset', 'antagonist_superset', 'compound_set', 'giant_set'])
    const missingGroup = allExercises(draft).filter(ex =>
      ex.sequencing_mode && groupedModes.has(ex.sequencing_mode) && ex.sequencing_group == null
    )
    if (missingGroup.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'SUPERSET_MISSING_GROUP',
        message: `${missingGroup.length} exercise(s) have a superset/compound_set/giant_set sequencing_mode but no sequencing_group set. Exercises grouped in a superset must share the same sequencing_group integer so the app can pair them correctly.`,
      })
    }
  }

  // ── Sort: errors first, then warnings ─────────────────────────────────────
  return issues.sort((a, b) => {
    if (a.severity === b.severity) return 0
    return a.severity === 'error' ? -1 : 1
  })
}
