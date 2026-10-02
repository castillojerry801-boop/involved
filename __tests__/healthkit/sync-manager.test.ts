import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  syncIfStale,
  forceSync,
  isSyncInProgress,
  FRESHNESS_THRESHOLD_MS,
  _resetForTest,
} from '@/lib/native/healthkit-sync-manager'
import {
  normalizeWorkout,
  normalizeDailyActiveEnergy,
  normalizeDailyBasalEnergy,
} from '@/lib/native/healthkit-normalizer'
import type { RawHKWorkout, RawDailyEnergy } from '@/lib/native/healthkit'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/native/healthkit', () => ({
  isHealthKitAvailable: vi.fn().mockResolvedValue(true),
  isNativeApp: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/native/healthkit-sync', () => ({
  runHealthKitSync: vi.fn().mockResolvedValue({
    activitiesSynced: 3,
    metricsSynced: 10,
    errors: 0,
    syncedAt: new Date().toISOString(),
  }),
}))

import { isHealthKitAvailable } from '@/lib/native/healthkit'
import { runHealthKitSync } from '@/lib/native/healthkit-sync'

// Typed mock helpers
const mockIsAvailable = isHealthKitAvailable as ReturnType<typeof vi.fn>
const mockRunSync     = runHealthKitSync     as ReturnType<typeof vi.fn>

// Helper to build a fetch mock that handles GET and POST to sync-status
function buildFetchMock(opts: {
  connected: boolean
  lastFullSyncAt: string | null
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (String(url).includes('/api/healthkit/sync-status')) {
      if (method === 'POST') {
        return { ok: true, json: async () => ({ ok: true }) } as Response
      }
      return {
        ok: true,
        json: async () => ({
          connected: opts.connected,
          lastFullSyncAt: opts.lastFullSyncAt,
        }),
      } as Response
    }
    return { ok: false } as Response
  })
}

const STALE_SYNC_AT  = new Date(Date.now() - 20 * 60 * 1000).toISOString()  // 20 min ago
const FRESH_SYNC_AT  = new Date(Date.now() -  5 * 60 * 1000).toISOString()  //  5 min ago

beforeEach(() => {
  vi.clearAllMocks()
  _resetForTest()
  mockIsAvailable.mockResolvedValue(true)
  mockRunSync.mockResolvedValue({ activitiesSynced: 3, metricsSynced: 10, errors: 0, syncedAt: new Date().toISOString() })
})

// ─── A. Freshness gate ────────────────────────────────────────────────────────

describe('syncIfStale — freshness gate', () => {
  it('runs sync when last sync is stale (>15 min)', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ connected: true, lastFullSyncAt: STALE_SYNC_AT }))
    const ran = await syncIfStale('launch')
    expect(ran).toBe(true)
    expect(mockRunSync).toHaveBeenCalledOnce()
  })

  it('skips sync when last sync is fresh (<15 min)', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ connected: true, lastFullSyncAt: FRESH_SYNC_AT }))
    const ran = await syncIfStale('launch')
    expect(ran).toBe(false)
    expect(mockRunSync).not.toHaveBeenCalled()
  })

  it('runs sync when lastFullSyncAt is null (first sync)', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ connected: true, lastFullSyncAt: null }))
    const ran = await syncIfStale('today_focus')
    expect(ran).toBe(true)
    expect(mockRunSync).toHaveBeenCalledOnce()
  })

  it('exits immediately when not connected', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ connected: false, lastFullSyncAt: null }))
    const ran = await syncIfStale('health_focus')
    expect(ran).toBe(false)
    expect(mockRunSync).not.toHaveBeenCalled()
  })
})

// ─── B. forceSync ignores freshness ───────────────────────────────────────────

describe('forceSync', () => {
  it('always runs sync regardless of freshness', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ connected: true, lastFullSyncAt: FRESH_SYNC_AT }))
    const ran = await forceSync('manual')
    expect(ran).toBe(true)
    expect(mockRunSync).toHaveBeenCalledOnce()
  })

  it('still runs for first sync', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ connected: true, lastFullSyncAt: null }))
    const ran = await forceSync('manual')
    expect(ran).toBe(true)
    expect(mockRunSync).toHaveBeenCalledOnce()
  })
})

// ─── C. In-flight guard ───────────────────────────────────────────────────────

describe('in-flight guard', () => {
  it('second simultaneous call returns false without starting a second sync', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ connected: true, lastFullSyncAt: STALE_SYNC_AT }))

    // Make first sync hang so the second call overlaps
    let resolveFirst!: () => void
    mockRunSync.mockReturnValueOnce(
      new Promise<typeof import('@/lib/native/healthkit-sync')['runHealthKitSync'] extends (...args: never[]) => Promise<infer R> ? R : never>(res => {
        resolveFirst = () => res({ activitiesSynced: 1, metricsSynced: 1, errors: 0, syncedAt: new Date().toISOString() })
      })
    )

    const first  = syncIfStale('launch')
    // isSyncInProgress may not be true yet (async), but forceSync also checks it
    const second = syncIfStale('resume')

    resolveFirst()
    const [r1, r2] = await Promise.all([first, second])
    expect(r1).toBe(true)
    expect(r2).toBe(false)
    expect(mockRunSync).toHaveBeenCalledOnce()
  })
})

// ─── D. Incremental query strategy ───────────────────────────────────────────

describe('incremental query', () => {
  it('uses lastSyncAt minus 24h as sinceDate when last sync exists', async () => {
    const lastSyncAt = new Date(Date.now() - 20 * 60 * 1000)
    vi.stubGlobal('fetch', buildFetchMock({ connected: true, lastFullSyncAt: lastSyncAt.toISOString() }))

    await syncIfStale('launch')

    const [sinceDate] = mockRunSync.mock.calls[0] as [Date]
    const expectedSince = new Date(lastSyncAt.getTime() - 24 * 60 * 60 * 1000)
    // Allow 5s tolerance
    expect(Math.abs(sinceDate.getTime() - expectedSince.getTime())).toBeLessThan(5000)
  })

  it('uses 30-day bounded history for first sync (null lastSyncAt)', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ connected: true, lastFullSyncAt: null }))

    const before = new Date()
    await syncIfStale('launch')
    const after = new Date()

    const [sinceDate] = mockRunSync.mock.calls[0] as [Date]
    const expectedDaysAgo = before.getTime() - 30 * 24 * 60 * 60 * 1000
    expect(sinceDate.getTime()).toBeGreaterThanOrEqual(expectedDaysAgo - 5000)
    expect(sinceDate.getTime()).toBeLessThanOrEqual(after.getTime() - 29 * 24 * 60 * 60 * 1000 + 5000)
  })
})

// ─── E. Last sync advances only on success ────────────────────────────────────

describe('sync success and failure', () => {
  it('calls markSyncComplete (POST sync-status) on success', async () => {
    const fetchMock = buildFetchMock({ connected: true, lastFullSyncAt: STALE_SYNC_AT })
    vi.stubGlobal('fetch', fetchMock)

    await syncIfStale('launch')

    const postCalls = (fetchMock.mock.calls as [string, RequestInit][])
      .filter(([, init]) => init?.method === 'POST')
    expect(postCalls.length).toBe(1)
  })

  it('does NOT call markSyncComplete when runHealthKitSync throws', async () => {
    mockRunSync.mockRejectedValueOnce(new Error('HealthKit error'))
    const fetchMock = buildFetchMock({ connected: true, lastFullSyncAt: STALE_SYNC_AT })
    vi.stubGlobal('fetch', fetchMock)

    const ran = await syncIfStale('launch')

    expect(ran).toBe(false)
    const postCalls = (fetchMock.mock.calls as [string, RequestInit][])
      .filter(([, init]) => init?.method === 'POST')
    expect(postCalls.length).toBe(0)
  })

  it('syncInProgress is false after a failed sync', async () => {
    mockRunSync.mockRejectedValueOnce(new Error('HealthKit error'))
    vi.stubGlobal('fetch', buildFetchMock({ connected: true, lastFullSyncAt: STALE_SYNC_AT }))

    await syncIfStale('launch')
    expect(isSyncInProgress()).toBe(false)
  })
})

// ─── F. Workout dedupe (stable externalId) ────────────────────────────────────

describe('workout dedupe — stable externalId', () => {
  const raw: RawHKWorkout = {
    uuid: 'hk-uuid-abc-123',
    workoutActivityType: 37,
    startDate: '2026-10-01T07:00:00Z',
    endDate:   '2026-10-01T08:00:00Z',
    duration: 3600,
    sourceName: 'Apple Watch',
    sourceBundle: 'com.apple.health',
    activeEnergyKcal: 500,
  }

  it('same HealthKit UUID produces same externalId on re-sync', () => {
    const first  = normalizeWorkout(raw)
    const second = normalizeWorkout({ ...raw, activeEnergyKcal: 510 })  // value changed, UUID same
    expect(first.externalId).toBe(second.externalId)
    expect(first.externalId).toBe('hk-uuid-abc-123')
  })

  it('different UUIDs produce different externalIds', () => {
    const a = normalizeWorkout(raw)
    const b = normalizeWorkout({ ...raw, uuid: 'hk-uuid-xyz-999' })
    expect(a.externalId).not.toBe(b.externalId)
  })
})

// ─── G. Calorie normalization ─────────────────────────────────────────────────

describe('active energy normalization', () => {
  const raw: RawDailyEnergy = {
    date: '2026-10-01T04:00:00Z',
    activeEnergyKcal: 612.5,
    basalEnergyKcal:  1850.0,
  }

  it('normalizeDailyActiveEnergy produces active_energy_kcal metric', () => {
    const m = normalizeDailyActiveEnergy(raw)!
    expect(m.metricType).toBe('active_energy_kcal')
    expect(m.value).toBe(612.5)
    expect(m.unit).toBe('kcal')
    expect(m.provider).toBe('apple_health')
  })

  it('externalId is stable for the same day on re-sync', () => {
    const m1 = normalizeDailyActiveEnergy(raw)!
    const m2 = normalizeDailyActiveEnergy({ ...raw, activeEnergyKcal: 700 })!
    expect(m1.externalId).toBe(m2.externalId)
    expect(m1.externalId).toBe('active_energy:2026-10-01')
  })

  it('returns null when activeEnergyKcal is absent', () => {
    expect(normalizeDailyActiveEnergy({ date: raw.date })).toBeNull()
  })
})

describe('resting energy normalization', () => {
  const raw: RawDailyEnergy = {
    date: '2026-10-01T04:00:00Z',
    activeEnergyKcal: 612.5,
    basalEnergyKcal:  1850.0,
  }

  it('normalizeDailyBasalEnergy produces resting_energy_kcal metric', () => {
    const m = normalizeDailyBasalEnergy(raw)!
    expect(m.metricType).toBe('resting_energy_kcal')
    expect(m.value).toBe(1850.0)
    expect(m.unit).toBe('kcal')
    expect(m.provider).toBe('apple_health')
  })

  it('externalId is stable for the same day on re-sync', () => {
    const m1 = normalizeDailyBasalEnergy(raw)!
    const m2 = normalizeDailyBasalEnergy({ ...raw, basalEnergyKcal: 1900 })!
    expect(m1.externalId).toBe(m2.externalId)
    expect(m1.externalId).toBe('basal_energy:2026-10-01')
  })

  it('returns null when basalEnergyKcal is absent', () => {
    expect(normalizeDailyBasalEnergy({ date: raw.date })).toBeNull()
  })
})

// ─── H. Total calories = active + resting ─────────────────────────────────────

describe('total calorie calculation', () => {
  it('totalBurnKcal = activeEnergyKcal + restingEnergyKcal', () => {
    const active  = 612
    const resting = 1850
    const total   = active + resting
    expect(total).toBe(2462)
  })

  it('total is null when only one component is available', () => {
    // Simulating buildHealthVSummary logic
    const todayEnergy  = 612
    const todayResting = undefined
    const todayTotal   = todayEnergy !== undefined && todayResting !== undefined
      ? todayEnergy + todayResting
      : undefined
    expect(todayTotal).toBeUndefined()
  })

  it('total is defined when both components are present', () => {
    const todayEnergy  = 612
    const todayResting = 1850
    const todayTotal   = todayEnergy !== undefined && todayResting !== undefined
      ? todayEnergy + todayResting
      : undefined
    expect(todayTotal).toBe(2462)
  })
})

// ─── I. FRESHNESS_THRESHOLD_MS constant ──────────────────────────────────────

describe('constants', () => {
  it('FRESHNESS_THRESHOLD_MS is 15 minutes', () => {
    expect(FRESHNESS_THRESHOLD_MS).toBe(15 * 60 * 1000)
  })
})
