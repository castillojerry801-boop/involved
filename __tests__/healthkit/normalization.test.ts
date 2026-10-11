import { describe, it, expect } from 'vitest'
import {
  normalizeActivityType,
  activityTitle,
  normalizeWorkout,
  normalizeBodyMass,
  normalizeRHR,
  normalizeStepDay,
  normalizeDailyActiveEnergy,
  normalizeDailyBasalEnergy,
} from '@/lib/native/healthkit-normalizer'
import type { RawHKWorkout, RawBodyMassSample, RawRHRSample, RawStepDay, RawDailyEnergy } from '@/lib/native/healthkit'

// ─── A. Activity type mapping ─────────────────────────────────────────────────

describe('normalizeActivityType', () => {
  it('maps running (37) to running', () => {
    expect(normalizeActivityType(37)).toBe('running')
  })

  it('maps traditionalStrengthTraining (50) to strength_training', () => {
    expect(normalizeActivityType(50)).toBe('strength_training')
  })

  it('maps cycling (13) to cycling', () => {
    expect(normalizeActivityType(13)).toBe('cycling')
  })

  it('maps HIIT (63) to hiit', () => {
    expect(normalizeActivityType(63)).toBe('hiit')
  })

  it('maps elliptical (16) to elliptical', () => {
    expect(normalizeActivityType(16)).toBe('elliptical')
  })

  it('maps stairClimbing (44) to stair_climbing', () => {
    expect(normalizeActivityType(44)).toBe('stair_climbing')
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
  it('returns human title for running (37)', () => {
    expect(activityTitle(37)).toBe('Running')
  })

  it('returns Workout for unmapped type', () => {
    expect(activityTitle(9999)).toBe('Workout')
  })
})

// ─── C. Workout normalization ─────────────────────────────────────────────────

describe('normalizeWorkout', () => {
  const raw: RawHKWorkout = {
    uuid: 'abc-123',
    workoutActivityType: 37,
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

// ─── G. Daily energy normalization ────────────────────────────────────────

describe('normalizeDailyActiveEnergy', () => {
  const raw: RawDailyEnergy = {
    date: '2026-09-25T04:00:00Z',
    activeEnergyKcal: 512.3,
    basalEnergyKcal: 1820.0,
  }

  it('produces correct metric type, value, and unit', () => {
    const result = normalizeDailyActiveEnergy(raw)!
    expect(result.metricType).toBe('active_energy_kcal')
    expect(result.value).toBe(512.3)
    expect(result.unit).toBe('kcal')
    expect(result.provider).toBe('apple_health')
  })

  it('uses recordedAt from raw.date', () => {
    const result = normalizeDailyActiveEnergy(raw)!
    expect(result.recordedAt).toBe('2026-09-25T04:00:00Z')
  })

  it('builds externalId from the date slug', () => {
    const result = normalizeDailyActiveEnergy(raw)!
    expect(result.externalId).toBe('active_energy:2026-09-25')
  })

  it('returns null when activeEnergyKcal is missing', () => {
    expect(normalizeDailyActiveEnergy({ date: '2026-09-25T04:00:00Z' })).toBeNull()
  })

  it('produces a stable externalId for re-synced days', () => {
    const resync: RawDailyEnergy = { date: '2026-09-25T04:00:00Z', activeEnergyKcal: 600 }
    expect(normalizeDailyActiveEnergy(resync)!.externalId).toBe(normalizeDailyActiveEnergy(raw)!.externalId)
  })
})

describe('normalizeDailyBasalEnergy', () => {
  const raw: RawDailyEnergy = {
    date: '2026-09-25T04:00:00Z',
    activeEnergyKcal: 512.3,
    basalEnergyKcal: 1820.0,
  }

  it('produces correct metric type, value, and unit', () => {
    const result = normalizeDailyBasalEnergy(raw)!
    expect(result.metricType).toBe('resting_energy_kcal')
    expect(result.value).toBe(1820.0)
    expect(result.unit).toBe('kcal')
    expect(result.provider).toBe('apple_health')
  })

  it('builds externalId from the date slug', () => {
    const result = normalizeDailyBasalEnergy(raw)!
    expect(result.externalId).toBe('basal_energy:2026-09-25')
  })

  it('returns null when basalEnergyKcal is missing', () => {
    expect(normalizeDailyBasalEnergy({ date: '2026-09-25T04:00:00Z' })).toBeNull()
  })

  it('active and basal externalIds are distinct for the same day', () => {
    expect(normalizeDailyActiveEnergy(raw)!.externalId).not.toBe(normalizeDailyBasalEnergy(raw)!.externalId)
  })
})

// ─── I. Step day normalization ─────────────────────────────────────────────

describe('normalizeStepDay', () => {
  const raw: RawStepDay = {
    date: '2026-09-25T04:00:00Z',
    steps: 8432,
  }

  it('produces correct metric type, value, and unit', () => {
    const result = normalizeStepDay(raw)
    expect(result.metricType).toBe('steps')
    expect(result.value).toBe(8432)
    expect(result.unit).toBe('count')
    expect(result.provider).toBe('apple_health')
  })

  it('uses recordedAt from raw.date', () => {
    const result = normalizeStepDay(raw)
    expect(result.recordedAt).toBe('2026-09-25T04:00:00Z')
  })

  it('builds externalId from the date slug', () => {
    const result = normalizeStepDay(raw)
    expect(result.externalId).toBe('steps:2026-09-25')
  })

  it('produces a stable externalId for re-synced days', () => {
    const resync: RawStepDay = { date: '2026-09-25T04:00:00Z', steps: 9100 }
    expect(normalizeStepDay(resync).externalId).toBe(normalizeStepDay(raw).externalId)
  })

  it('sets periodStart to UTC midnight of the date slug', () => {
    const result = normalizeStepDay(raw)
    expect(result.periodStart).toBe('2026-09-25T00:00:00.000Z')
  })

  it('sets periodEnd to UTC end-of-day of the date slug', () => {
    const result = normalizeStepDay(raw)
    expect(result.periodEnd).toBe('2026-09-25T23:59:59.999Z')
  })

  it('periodStart date slug matches externalId date slug', () => {
    const result = normalizeStepDay(raw)
    const slugFromExternalId = result.externalId.replace('steps:', '')
    const slugFromPeriodStart = result.periodStart!.slice(0, 10)
    expect(slugFromExternalId).toBe(slugFromPeriodStart)
  })

  it('partial-day update: re-syncing same day with higher count produces same externalId', () => {
    // Morning: 2200 steps. Evening: 11796 steps. Same upsert key → update, not insert.
    const morning = normalizeStepDay({ date: '2026-10-10T07:00:00Z', steps: 2200 })
    const evening = normalizeStepDay({ date: '2026-10-10T07:00:00Z', steps: 11796 })
    expect(morning.externalId).toBe(evening.externalId)
    expect(morning.recordedAt).toBe(evening.recordedAt)
    expect(evening.value).toBe(11796)
  })
})

// ─── J. Daily step aggregation logic ─────────────────────────────────────────
// Tests the MAX-per-day aggregation used in buildHealthVSummary and the health
// dashboard step log — ensures repeated syncs and partial-day snapshots aggregate
// correctly without double-counting.

describe('daily step MAX aggregation', () => {
  function aggregateByMax(rows: Array<{ recordedAt: string; value: number; periodStart?: string | null }>): Map<string, number> {
    const map = new Map<string, number>()
    for (const row of rows) {
      const d = (row.periodStart ?? row.recordedAt).slice(0, 10)
      map.set(d, Math.max(map.get(d) ?? 0, Number(row.value)))
    }
    return map
  }

  it('takes the higher value when two records share the same periodStart date', () => {
    const rows = [
      { recordedAt: '2026-10-10T07:00:00Z', value: 2200,  periodStart: '2026-10-10T00:00:00.000Z' },
      { recordedAt: '2026-10-10T07:00:00Z', value: 11796, periodStart: '2026-10-10T00:00:00.000Z' },
    ]
    const result = aggregateByMax(rows)
    expect(result.get('2026-10-10')).toBe(11796)
  })

  it('does not double-count re-synced records for the same day', () => {
    const rows = [
      { recordedAt: '2026-10-08T07:00:00Z', value: 9000,  periodStart: '2026-10-08T00:00:00.000Z' },
      { recordedAt: '2026-10-08T07:00:00Z', value: 9000,  periodStart: '2026-10-08T00:00:00.000Z' },
      { recordedAt: '2026-10-09T07:00:00Z', value: 7500,  periodStart: '2026-10-09T00:00:00.000Z' },
    ]
    const result = aggregateByMax(rows)
    expect(result.get('2026-10-08')).toBe(9000)
    expect(result.get('2026-10-09')).toBe(7500)
    expect(result.size).toBe(2)
  })

  it('handles missing days without treating them as zero in average', () => {
    // Only 3 of 7 days have data — average should divide by 3, not 7
    const rows = [
      { recordedAt: '2026-10-05T07:00:00Z', value: 8000, periodStart: '2026-10-05T00:00:00.000Z' },
      { recordedAt: '2026-10-07T07:00:00Z', value: 9000, periodStart: '2026-10-07T00:00:00.000Z' },
      { recordedAt: '2026-10-10T07:00:00Z', value: 7000, periodStart: '2026-10-10T00:00:00.000Z' },
    ]
    const map = aggregateByMax(rows)
    const values = [...map.values()]
    const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length)
    expect(map.size).toBe(3)
    expect(avg).toBe(8000)  // (8000+9000+7000)/3
  })

  it('falls back to recordedAt for date bucketing when periodStart is null', () => {
    const rows = [
      { recordedAt: '2026-10-10T07:00:00Z', value: 5000, periodStart: null },
    ]
    const result = aggregateByMax(rows)
    expect(result.get('2026-10-10')).toBe(5000)
  })
})
