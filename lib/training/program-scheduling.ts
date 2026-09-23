export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export function jsToWeekday(jsDay: number): Weekday {
  return ((jsDay + 6) % 7) as Weekday
}

export function todayWeekday(): Weekday {
  return jsToWeekday(new Date().getDay())
}

export interface SchedulableProgramDay {
  id: string
  name: string
  weekday: number | null
  exerciseCount: number
}

export function resolveScheduledDay<T extends SchedulableProgramDay>(
  days: T[],
  weekday: Weekday,
): T | null {
  return days.find(d => d.weekday === weekday) ?? null
}

export function upcomingSchedule<T extends SchedulableProgramDay>(
  days: T[],
  today: Weekday,
  count = 6,
): Array<{ weekday: Weekday; label: string; day: T | null }> {
  return Array.from({ length: count }, (_, i) => {
    const wd = ((today + i + 1) % 7) as Weekday
    return { weekday: wd, label: WEEKDAY_SHORT[wd], day: resolveScheduledDay(days, wd) }
  })
}

export interface QuickPrescription {
  sets: number
  repsMin: number | null
  repsMax: number | null
  duration: number | null
  rest: number
  progressionMode: 'same' | 'increase' | 'decrease' | 'custom'
  progressionStep: number | null
  baseWeightKg: number | null
}

export interface ProgramSetInput {
  setNumber: number
  setType: 'working' | 'warmup' | 'amrap'
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetWeightKg: number | null
  targetDurationSeconds: number | null
  targetDistanceM: number | null
  restSeconds: number | null
}

export function quickEntryToSets(p: QuickPrescription): ProgramSetInput[] {
  return Array.from({ length: p.sets }, (_, i) => {
    let weight: number | null = p.baseWeightKg ?? null
    if (weight !== null) {
      if (p.progressionMode === 'increase' && p.progressionStep != null) {
        weight = Math.max(0, weight + p.progressionStep * i)
      } else if (p.progressionMode === 'decrease' && p.progressionStep != null) {
        weight = Math.max(0, weight - p.progressionStep * i)
      }
    }
    return {
      setNumber: i + 1,
      setType: 'working',
      targetRepsMin: p.repsMin,
      targetRepsMax: p.repsMax,
      targetWeightKg: weight,
      targetDurationSeconds: p.duration,
      targetDistanceM: null,
      restSeconds: p.rest,
    }
  })
}

export function defaultPrescription(trackingType: string): QuickPrescription {
  const isTimed = trackingType === 'cardio' || trackingType === 'isometric' || trackingType === 'intervals'
  return {
    sets: 3,
    repsMin: isTimed ? null : 8,
    repsMax: isTimed ? null : 12,
    duration: isTimed ? 30 : null,
    rest: 90,
    progressionMode: 'same',
    progressionStep: null,
    baseWeightKg: null,
  }
}

export function prescriptionFromSets(
  sets: ProgramSetInput[],
): { prescription: QuickPrescription; mode: 'quick' | 'advanced' } {
  if (sets.length === 0) {
    return { prescription: defaultPrescription('strength'), mode: 'quick' }
  }
  const first = sets[0]
  const allSameReps = sets.every(s => s.targetRepsMin === first.targetRepsMin && s.targetRepsMax === first.targetRepsMax)
  const allSameRest = sets.every(s => s.restSeconds === first.restSeconds)
  const allWorking = sets.every(s => s.setType === 'working')

  if (!allSameReps || !allSameRest || !allWorking) {
    return {
      prescription: {
        sets: sets.length,
        repsMin: first.targetRepsMin,
        repsMax: first.targetRepsMax,
        duration: first.targetDurationSeconds,
        rest: first.restSeconds ?? 90,
        progressionMode: 'custom',
        progressionStep: null,
        baseWeightKg: first.targetWeightKg,
      },
      mode: 'advanced',
    }
  }

  const weights = sets.map(s => s.targetWeightKg)
  let progressionMode: QuickPrescription['progressionMode'] = 'same'
  let progressionStep: number | null = null

  if (sets.length >= 2 && weights.every(w => w != null)) {
    const deltas = weights.slice(1).map((w, i) => (w as number) - (weights[i] as number))
    if (deltas.every(d => d === deltas[0]) && deltas[0] !== 0) {
      progressionMode = deltas[0] > 0 ? 'increase' : 'decrease'
      progressionStep = Math.abs(deltas[0])
    }
  }

  return {
    prescription: {
      sets: sets.length,
      repsMin: first.targetRepsMin,
      repsMax: first.targetRepsMax,
      duration: first.targetDurationSeconds,
      rest: first.restSeconds ?? 90,
      progressionMode,
      progressionStep,
      baseWeightKg: weights[0],
    },
    mode: 'quick',
  }
}
