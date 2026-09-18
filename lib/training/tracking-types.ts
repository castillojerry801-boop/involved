import type { Exercise } from '@/lib/exercises'

export type TrackingType =
  | 'strength'
  | 'bodyweight'
  | 'assisted'
  | 'cardio'
  | 'carry'
  | 'isometric'
  | 'intervals'

// Derive the most sensible default tracking type for an exercise.
// Users can override this per-exercise in programs and templates.
export function inferTrackingType(exercise: Exercise): TrackingType {
  const eq = exercise.equipment.toLowerCase()
  const bp = exercise.bodyPart.toLowerCase()

  if (bp === 'cardio') return 'cardio'
  if (eq === 'body weight') return 'bodyweight'
  if (eq.includes('assisted')) return 'assisted'
  return 'strength'
}

export const TRACKING_TYPE_LABELS: Record<TrackingType, string> = {
  strength:   'Weight × Reps',
  bodyweight: 'Reps only',
  assisted:   'Assisted × Reps',
  cardio:     'Time + Distance',
  carry:      'Weight + Distance',
  isometric:  'Time (hold)',
  intervals:  'Intervals',
}

export const TRACKING_TYPE_SHORT: Record<TrackingType, string> = {
  strength:   'Strength',
  bodyweight: 'Bodyweight',
  assisted:   'Assisted',
  cardio:     'Cardio',
  carry:      'Carry',
  isometric:  'Isometric',
  intervals:  'Intervals',
}

export const SET_TYPE_LABELS = {
  warmup:  'Warm-up',
  working: 'Working',
  amrap:   'AMRAP',
  drop:    'Drop',
  failure: 'Failure',
} as const

// Return the input fields needed for a given tracking type
export function getTrackingFields(type: TrackingType) {
  return {
    showWeight:   type === 'strength' || type === 'assisted' || type === 'carry',
    showReps:     type === 'strength' || type === 'bodyweight' || type === 'assisted',
    showDuration: type === 'cardio' || type === 'carry' || type === 'isometric' || type === 'intervals',
    showDistance: type === 'cardio' || type === 'carry',
    showRounds:   type === 'intervals',
  }
}
