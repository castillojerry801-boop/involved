/**
 * Unit tests for workout activity classification.
 *
 * classifyWorkoutActivity must:
 *  - Match workout title keywords before falling back to tracking types
 *  - Correctly handle strength, cardio, interval, and mixed workouts
 *  - Default to 'other', NOT 'strength_training', when the type is uncertain
 *
 * activityTypesCompatible must:
 *  - Allow strength_training ↔ functional_strength merges
 *  - Reject all other cross-type pairings
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { classifyWorkoutActivity, activityTypesCompatible } from '@/lib/health/classify'

// ─── classifyWorkoutActivity ─────────────────────────────────────────────────

describe('classifyWorkoutActivity — title keyword priority', () => {
  it('returns running for "Morning Run"', () => {
    expect(classifyWorkoutActivity({ title: 'Morning Run', exercises: [] })).toBe('running')
  })

  it('returns running for "5K race prep"', () => {
    expect(classifyWorkoutActivity({ title: '5K race prep', exercises: [] })).toBe('running')
  })

  it('returns walking for "Evening Walk"', () => {
    expect(classifyWorkoutActivity({ title: 'Evening Walk', exercises: [] })).toBe('walking')
  })

  it('returns hiking for "Trail Hike"', () => {
    expect(classifyWorkoutActivity({ title: 'Trail Hike', exercises: [] })).toBe('hiking')
  })

  it('returns cycling for "Spin Class"', () => {
    expect(classifyWorkoutActivity({ title: 'Spin Class', exercises: [] })).toBe('cycling')
  })

  it('returns cycling for "Bike Ride"', () => {
    expect(classifyWorkoutActivity({ title: 'Bike Ride', exercises: [] })).toBe('cycling')
  })

  it('returns swimming for "Pool Swim"', () => {
    expect(classifyWorkoutActivity({ title: 'Pool Swim', exercises: [] })).toBe('swimming')
  })

  it('returns rowing for "Erg Session"', () => {
    expect(classifyWorkoutActivity({ title: 'Erg Session', exercises: [] })).toBe('rowing')
  })

  it('returns yoga for "Yoga Flow"', () => {
    expect(classifyWorkoutActivity({ title: 'Yoga Flow', exercises: [] })).toBe('yoga')
  })

  it('returns yoga for "Pilates"', () => {
    expect(classifyWorkoutActivity({ title: 'Pilates', exercises: [] })).toBe('yoga')
  })

  it('returns hiit for "HIIT Blast"', () => {
    expect(classifyWorkoutActivity({ title: 'HIIT Blast', exercises: [] })).toBe('hiit')
  })

  it('returns hiit for "Interval Training"', () => {
    expect(classifyWorkoutActivity({ title: 'Interval Training', exercises: [] })).toBe('hiit')
  })

  it('returns hiit for "Tabata"', () => {
    expect(classifyWorkoutActivity({ title: 'Tabata', exercises: [] })).toBe('hiit')
  })

  it('returns elliptical for "Elliptical"', () => {
    expect(classifyWorkoutActivity({ title: 'Elliptical', exercises: [] })).toBe('elliptical')
  })

  it('returns stair_climbing for "Stairmaster"', () => {
    expect(classifyWorkoutActivity({ title: 'Stairmaster', exercises: [] })).toBe('stair_climbing')
  })

  it('returns cross_training for "Cross Training"', () => {
    expect(classifyWorkoutActivity({ title: 'Cross Training', exercises: [] })).toBe('cross_training')
  })

  it('returns other for "Leg Day" with no exercises (no classifiable signal)', () => {
    // "Leg Day" has no recognized keyword; classification requires exercises or a keyword.
    expect(classifyWorkoutActivity({ title: 'Leg Day', exercises: [] })).toBe('other')
  })

  it('returns strength_training for "Deadlift Day"', () => {
    expect(classifyWorkoutActivity({ title: 'Deadlift Day', exercises: [] })).toBe('strength_training')
  })

  it('returns strength_training for "Bench Press Focus"', () => {
    expect(classifyWorkoutActivity({ title: 'Bench Press Focus', exercises: [] })).toBe('strength_training')
  })

  it('returns strength_training for "Barbell Squats"', () => {
    expect(classifyWorkoutActivity({ title: 'Barbell Squats', exercises: [] })).toBe('strength_training')
  })

  it('title keyword is case-insensitive', () => {
    expect(classifyWorkoutActivity({ title: 'morning run', exercises: [] })).toBe('running')
    expect(classifyWorkoutActivity({ title: 'RUNNING INTERVALS', exercises: [] })).toBe('running')
  })
})

describe('classifyWorkoutActivity — tracking type fallback (no title keyword)', () => {
  it('returns strength_training for all-strength exercises', () => {
    expect(classifyWorkoutActivity({
      title: 'Workout A',
      exercises: [{ trackingType: 'strength' }, { trackingType: 'strength' }],
    })).toBe('strength_training')
  })

  it('returns strength_training for all-bodyweight exercises', () => {
    expect(classifyWorkoutActivity({
      title: 'Workout',
      exercises: [{ trackingType: 'bodyweight' }],
    })).toBe('strength_training')
  })

  it('returns strength_training for a mix of strength types', () => {
    expect(classifyWorkoutActivity({
      title: 'Workout',
      exercises: [
        { trackingType: 'strength' },
        { trackingType: 'bodyweight' },
        { trackingType: 'assisted' },
      ],
    })).toBe('strength_training')
  })

  it('returns cross_training for all-cardio exercises (no title)', () => {
    expect(classifyWorkoutActivity({
      title: 'Workout',
      exercises: [{ trackingType: 'cardio' }, { trackingType: 'cardio' }],
    })).toBe('cross_training')
  })

  it('returns hiit for all-intervals exercises', () => {
    expect(classifyWorkoutActivity({
      title: 'Workout',
      exercises: [{ trackingType: 'intervals' }, { trackingType: 'intervals' }],
    })).toBe('hiit')
  })

  it('returns strength_training when mixed strength + cardio', () => {
    // Strength wins as a stronger signal than "some cardio present"
    expect(classifyWorkoutActivity({
      title: 'Workout',
      exercises: [{ trackingType: 'strength' }, { trackingType: 'cardio' }],
    })).toBe('strength_training')
  })

  it('returns other when exercises are empty and no title keyword', () => {
    expect(classifyWorkoutActivity({ title: 'Monday Workout', exercises: [] })).toBe('other')
  })

  it('returns other for unrecognised tracking types with no title keyword', () => {
    expect(classifyWorkoutActivity({
      title: 'Workout',
      exercises: [{ trackingType: 'unknown_type' }],
    })).toBe('other')
  })
})

describe('classifyWorkoutActivity — title beats tracking type', () => {
  it('title "Running" beats all-strength tracking types', () => {
    // Unusual but possible — user renamed their workout
    expect(classifyWorkoutActivity({
      title: 'Running Form Drill',
      exercises: [{ trackingType: 'strength' }],
    })).toBe('running')
  })

  it('title "Yoga" beats all-bodyweight tracking types', () => {
    expect(classifyWorkoutActivity({
      title: 'Yoga Flow',
      exercises: [{ trackingType: 'bodyweight' }],
    })).toBe('yoga')
  })
})

// ─── activityTypesCompatible ─────────────────────────────────────────────────

describe('activityTypesCompatible', () => {
  it('exact match → compatible', () => {
    expect(activityTypesCompatible('strength_training', 'strength_training')).toBe(true)
    expect(activityTypesCompatible('running', 'running')).toBe(true)
    expect(activityTypesCompatible('other', 'other')).toBe(true)
  })

  it('strength_training + functional_strength → compatible', () => {
    expect(activityTypesCompatible('strength_training', 'functional_strength')).toBe(true)
    expect(activityTypesCompatible('functional_strength', 'strength_training')).toBe(true)
  })

  it('running + cycling → incompatible', () => {
    expect(activityTypesCompatible('running', 'cycling')).toBe(false)
  })

  it('strength_training + running → incompatible', () => {
    expect(activityTypesCompatible('strength_training', 'running')).toBe(false)
  })

  it('hiit + strength_training → incompatible', () => {
    expect(activityTypesCompatible('hiit', 'strength_training')).toBe(false)
  })

  it('other + strength_training → incompatible', () => {
    expect(activityTypesCompatible('other', 'strength_training')).toBe(false)
  })
})
