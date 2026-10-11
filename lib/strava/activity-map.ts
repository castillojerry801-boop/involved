import type { HealthActivityType } from '@/lib/health/types'

const TYPE_MAP: Record<string, HealthActivityType> = {
  // Running
  Run:          'running',
  VirtualRun:   'running',
  TrailRun:     'running',

  // Cycling
  Ride:             'cycling',
  VirtualRide:      'cycling',
  EBikeRide:        'cycling',
  MountainBikeRide: 'cycling',
  GravelRide:       'cycling',

  // Walking / hiking
  Walk: 'walking',
  Hike: 'hiking',

  // Swim
  Swim:            'swimming',
  OpenWaterSwim:   'swimming',

  // Strength
  WeightTraining: 'strength_training',

  // HIIT
  Crossfit:                       'hiit',
  HighIntensityIntervalTraining:  'hiit',

  // Yoga / flexibility
  Yoga:    'yoga',
  Pilates: 'yoga',

  // Rowing
  Rowing:   'rowing',
  Kayaking: 'rowing',
  Canoeing: 'rowing',

  // Cardio machines
  Elliptical:   'elliptical',
  StairStepper: 'stair_climbing',
}

export function mapStravaType(stravaType: string): HealthActivityType {
  return TYPE_MAP[stravaType] ?? 'other'
}
