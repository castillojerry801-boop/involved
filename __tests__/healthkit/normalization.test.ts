import { describe, it, expect } from 'vitest'
import {
  normalizeActivityType,
  activityTitle,
  normalizeWorkout,
  normalizeBodyMass,
  normalizeRHR,
} from '@/lib/native/healthkit-normalizer'
import type { RawHKWorkout, RawBodyMassSample, RawRHRSample } from '@/lib/native/healthkit'

// ─── A. Activity type mapping ─────────────────────────────────────────────────

describe('normalizeActivityType', () => {
  it('maps running (41) to running', () => {
    expect(normalizeActivityType(41)).toBe('running')
  })

  it('maps traditional strength training (56) to strength_training', () => {
    expect(normalizeActivityType(56)).toBe('strength_training')
  })

  it('maps cycling (13) to cycling', () => {
    expect(normalizeActivityType(13)).toBe('cycling')
  })

  it('maps HIIT (69) to hiit', () => {
    expect(normalizeActivityType(69)).toBe('hiit')
  })

  it('maps elliptical (16) to elliptical', () => {
    expect(normalizeActivityType(16)).toBe('elliptical')
  })

  it('maps stair climbing (50) to stair_climbing', () => {
    expect(normalizeActivityType(50)).toBe('stair_climbing')
  })

  it('maps cross training (11) to cross_training', () => {
    expect(normalizeActivityType(11)).toBe('cross_training')
  })

  it('maps unknown type to other', () => {
    expect(normalizeActivityType(9999)).toBe('other')
  })
})

// ─── B. Display titles ─────────────────────────────────────────────────────

describe('activityTitle', () => {
  it('returns human title for running', () => {
    expect(activityTitle(41)).toBe('Running')
  })

  it('uses source name as fallback for unmapped type', () => {
    expect(activityTitle(9999, 'Nike Run Club')).toBe('Nike Run Club')
  })

  it('returns Workout as default when no source name', () => {
    expect(activityTitle(9999)).toBe('Workout')
  })
})

// ─── C. Workout normalization ─────────────────────────────────────────────────

describe('normalizeWorkout', () => {
  const raw: RawHKWorkout = {
    uuid: 'abc-123',
    workoutActivityType: 41,
    startDate: '2026-09-20T07:00:00Z',
    endDate: '2026-09-20T08:00:00Z',
    duration: 3600,
    sourceName: 'Apple Watch',
    sourceBundle: 'com.apple.health',
    activeEnergyKcal: 480,
    avgHeartRate: 155,
    maxHeartRate: 178,
  }

  it('maps all fields correctly', () => {
    const result = normalizeWorkout(raw)
    expect(result.externalId).toBe('abc-123')
    expect(result.provider).toBe('apple_health')
    expect(result.activityType).toBe('running')
    expect(result.title).toBe('Running')
    expect(result.durationSeconds).toBe(3600)
    expect(result.activeEnergyKcal).toBe(480)
    expect(result.avgHeartRate).toBe(155)
    expect(result.maxHeartRate).toBe(178)
    expect(result.distanceMeters).toBeNull()
    expect(result.totalEnergyKcal).toBeNull()
  })

  it('preserves ISO date strings', () => {
    const result = normalizeWorkout(raw)
    expect(result.startedAt).toBe('2026-09-20T07:00:00Z')
    expect(result.endedAt).toBe('2026-09-20T08:00:00Z')
  })
})

// ─── D. Body mass normalization ────────────────────────────────────────────

describe('normalizeBodyMass', () => {
  it('produces correct metric type and unit', () => {
    const raw: RawBodyMassSample = {
      uuid: 'bm-1',
      weightKg: 82.5,
      recordedAt: '2026-09-20T08:00:00Z',
      sourceName: 'Apple Health',
    }
    const result = normalizeBodyMass(raw)
    expect(result.metricType).toBe('body_weight_kg')
    expect(result.value).toBe(82.5)
    expect(result.unit).toBe('kg')
    expect(result.provider).toBe('apple_health')
  })
})

// ─── E. Resting heart rate normalization ──────────────────────────────────

describe('normalizeRHR', () => {
  it('produces correct metric type and unit', () => {
    const raw: RawRHRSample = {
      uuid: 'rhr-1',
      bpm: 52,
      recordedAt: '2026-09-20T06:30:00Z',
    }
    const result = normalizeRHR(raw)
    expect(result.metricType).toBe('heart_rate_resting_bpm')
    expect(result.value).toBe(52)
    expect(result.unit).toBe('bpm')
    expect(result.provider).toBe('apple_health')
  })
})

// ─── F. Functional strength (new enum value) ──────────────────────────────

describe('new activity types', () => {
  it('maps functional strength (20) to functional_strength', () => {
    expect(normalizeActivityType(20)).toBe('functional_strength')
  })
})
