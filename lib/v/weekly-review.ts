/**
 * Weekly review builder — deterministic, no AI call required.
 * Summarises a week of training from structured workout data.
 * The caller decides whether to invoke V based on needsAdaptation or user request.
 */

export interface CompletedWorkoutSummary {
  date: string
  dayName: string
  completed: boolean
  sets: Array<{
    exerciseName: string
    prescribedWeightKg?: number
    actualWeightKg?: number
    prescribedReps?: number
    actualReps?: number
    rpe?: number
    targetRpe?: number
  }>
}

export interface WeeklyReviewSummary {
  weekNumber: number
  programName: string
  workoutsCompleted: number
  workoutsScheduled: number
  adherencePercent: number
  progressionSuccesses: Array<{ exerciseName: string; detail: string }>
  missedSessions: number
  rpeFlag: boolean
  needsAdaptation: boolean
  adaptationReason?: string
  coachingSummary?: string  // populated only when AI is explicitly invoked
}

const RPE_OVERREACH_THRESHOLD = 1.5  // actual RPE exceeds target by this much

export function buildWeeklyReview(
  workouts: CompletedWorkoutSummary[],
  scheduledDays: number,
  programWeek: number,
  programName: string,
): WeeklyReviewSummary {
  const completed = workouts.filter(w => w.completed)
  const workoutsCompleted = completed.length
  const workoutsScheduled = Math.max(scheduledDays, workouts.length)
  const adherencePercent = workoutsScheduled > 0
    ? Math.round((workoutsCompleted / workoutsScheduled) * 100)
    : 0
  const missedSessions = workoutsScheduled - workoutsCompleted

  // Progression successes: actual weight > prescribed weight for same exercise
  const progressionMap = new Map<string, { prescribed: number; actual: number }>()
  for (const workout of completed) {
    for (const set of workout.sets) {
      if (
        set.prescribedWeightKg != null &&
        set.actualWeightKg != null &&
        set.actualWeightKg > set.prescribedWeightKg
      ) {
        const existing = progressionMap.get(set.exerciseName)
        if (!existing || set.actualWeightKg > existing.actual) {
          progressionMap.set(set.exerciseName, {
            prescribed: set.prescribedWeightKg,
            actual: set.actualWeightKg,
          })
        }
      }
    }
  }
  const progressionSuccesses = Array.from(progressionMap.entries()).map(([name, vals]) => {
    const diff = Math.round((vals.actual - vals.prescribed) * 2.20462) / 2.20462
    const diffLb = Math.round(diff * 2.20462)
    return {
      exerciseName: name,
      detail: `lifted ${vals.actual} kg (prescribed ${vals.prescribed} kg, +${diffLb} lb)`,
    }
  })

  // RPE flag: any set where actual RPE exceeds targetRpe by threshold
  let rpeFlag = false
  for (const workout of completed) {
    for (const set of workout.sets) {
      if (
        set.rpe != null &&
        set.targetRpe != null &&
        set.rpe - set.targetRpe >= RPE_OVERREACH_THRESHOLD
      ) {
        rpeFlag = true
        break
      }
    }
    if (rpeFlag) break
  }

  // Needs adaptation
  let needsAdaptation = false
  let adaptationReason: string | undefined

  if (adherencePercent < 60) {
    needsAdaptation = true
    adaptationReason = `Low adherence: completed ${workoutsCompleted} of ${workoutsScheduled} sessions (${adherencePercent}%)`
  } else if (rpeFlag) {
    needsAdaptation = true
    adaptationReason = 'RPE significantly above target — possible accumulated fatigue or load is too high'
  } else if (workoutsCompleted === 0 && workoutsScheduled > 0) {
    needsAdaptation = true
    adaptationReason = 'No sessions completed this week'
  }

  return {
    weekNumber: programWeek,
    programName,
    workoutsCompleted,
    workoutsScheduled,
    adherencePercent,
    progressionSuccesses,
    missedSessions,
    rpeFlag,
    needsAdaptation,
    adaptationReason,
    coachingSummary: undefined,
  }
}
