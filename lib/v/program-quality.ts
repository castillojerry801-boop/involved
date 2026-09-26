import 'server-only'
import type { ProgramDraft } from '@/lib/ai/tools/program'

export interface QualityIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface QualityContext {
  sport?: string
  fitnessLevel?: string | null
  weeks?: number
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

  // ── Sort: errors first, then warnings ─────────────────────────────────────
  return issues.sort((a, b) => {
    if (a.severity === b.severity) return 0
    return a.severity === 'error' ? -1 : 1
  })
}
