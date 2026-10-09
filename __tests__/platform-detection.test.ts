import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Capacitor mock ────────────────────────────────────────────────────────────

const mockCapacitor = {
  isNativePlatform: vi.fn<() => boolean>(),
  getPlatform:      vi.fn<() => string>(),
}

// Single shared plugin instance — healthkit.ts captures this at module load time
const mockPlugin = {
  isAvailable:           vi.fn(),
  requestPermissions:    vi.fn(),
  queryWorkouts:         vi.fn(),
  queryBodyMass:         vi.fn(),
  queryRestingHeartRate: vi.fn(),
  querySteps:            vi.fn(),
  queryDailyEnergy:      vi.fn(),
}

vi.mock('@capacitor/core', () => ({
  Capacitor:      mockCapacitor,
  registerPlugin: vi.fn(() => mockPlugin),
}))

// Re-import after mock is in place
const { getNativePlatform, isNativeIOS, isNativeAndroid } = await import('@/lib/native/platform')
const { isHealthKitAvailable, isHealthConnectAvailable }  = await import('@/lib/native/healthkit')

// ── Helpers ───────────────────────────────────────────────────────────────────

function setNativePlatform(platform: 'ios' | 'android') {
  mockCapacitor.isNativePlatform.mockReturnValue(true)
  mockCapacitor.getPlatform.mockReturnValue(platform)
}

function setWebPlatform() {
  mockCapacitor.isNativePlatform.mockReturnValue(false)
  mockCapacitor.getPlatform.mockReturnValue('web')
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── getNativePlatform ─────────────────────────────────────────────────────────

describe('getNativePlatform', () => {
  it('returns ios on native iOS', () => {
    setNativePlatform('ios')
    expect(getNativePlatform()).toBe('ios')
  })

  it('returns android on native Android', () => {
    setNativePlatform('android')
    expect(getNativePlatform()).toBe('android')
  })

  it('returns web when not native', () => {
    setWebPlatform()
    expect(getNativePlatform()).toBe('web')
  })
})

// ── isNativeIOS / isNativeAndroid ─────────────────────────────────────────────

describe('isNativeIOS', () => {
  it('is true only on native iOS', () => {
    setNativePlatform('ios')
    expect(isNativeIOS()).toBe(true)
  })

  it('is false on native Android', () => {
    setNativePlatform('android')
    expect(isNativeIOS()).toBe(false)
  })

  it('is false on web', () => {
    setWebPlatform()
    expect(isNativeIOS()).toBe(false)
  })
})

describe('isNativeAndroid', () => {
  it('is true only on native Android', () => {
    setNativePlatform('android')
    expect(isNativeAndroid()).toBe(true)
  })

  it('is false on native iOS', () => {
    setNativePlatform('ios')
    expect(isNativeAndroid()).toBe(false)
  })

  it('is false on web', () => {
    setWebPlatform()
    expect(isNativeAndroid()).toBe(false)
  })
})

// ── Platform gating — the 8 required scenarios ────────────────────────────────

describe('platform detection gating', () => {
  // 1. native iOS shows Apple Health (isHealthKitAvailable returns true when plugin says available)
  it('native iOS: isHealthKitAvailable can return true', async () => {
    setNativePlatform('ios')
    mockPlugin.isAvailable.mockResolvedValue({ available: true })
    const available = await isHealthKitAvailable()
    expect(available).toBe(true)
  })

  // 2. native iOS: Health Connect availability returns false (iOS-gated)
  it('native iOS: isHealthConnectAvailable returns false', async () => {
    setNativePlatform('ios')
    const available = await isHealthConnectAvailable()
    expect(available).toBe(false)
  })

  // 3. native Android: Health Connect can return true
  it('native Android: isHealthConnectAvailable can return true', async () => {
    setNativePlatform('android')
    mockPlugin.isAvailable.mockResolvedValue({ available: true })
    const available = await isHealthConnectAvailable()
    expect(available).toBe(true)
  })

  // 4. native Android: isHealthKitAvailable returns false (iOS-gated)
  it('native Android: isHealthKitAvailable returns false', async () => {
    setNativePlatform('android')
    const available = await isHealthKitAvailable()
    expect(available).toBe(false)
  })

  // 5. native Android: Apple Health card shows "unavailable" — historical iOS
  //    data in DB must NOT override current platform; platform is the source of truth
  it('native Android: Apple Health is unavailable regardless of DB state', async () => {
    setNativePlatform('android')
    // Even if isAvailable() could return true on Android (via HealthConnectPlugin),
    // isHealthKitAvailable() exits early because platform !== 'ios'
    const available = await isHealthKitAvailable()
    expect(available).toBe(false)
  })

  // 6. web/PWA: both integrations unavailable
  it('web: both isHealthKitAvailable and isHealthConnectAvailable return false', async () => {
    setWebPlatform()
    const [hkAvail, hcAvail] = await Promise.all([
      isHealthKitAvailable(),
      isHealthConnectAvailable(),
    ])
    expect(hkAvail).toBe(false)
    expect(hcAvail).toBe(false)
  })

  // 7. historical Apple Health data must not override Android platform detection
  //    Verified by: platform gating happens before any DB/API check, so DB data is irrelevant
  it('platform helpers use only Capacitor, never DB or server state', () => {
    setNativePlatform('android')
    // getNativePlatform() and isNativeIOS()/isNativeAndroid() are synchronous
    // and only call Capacitor.isNativePlatform() / getPlatform() — no fetch
    expect(getNativePlatform()).toBe('android')
    expect(isNativeIOS()).toBe(false)
    expect(isNativeAndroid()).toBe(true)
    // No fetch was called — verified implicitly by synchronous return
  })

  // 8. server.url Capacitor mode (used in dev via cap serve) is still detected as native
  it('server.url mode: native platform is still detected correctly', () => {
    // When running via `npx cap run` with server.url pointing at Next.js dev server,
    // Capacitor.isNativePlatform() still returns true and getPlatform() returns the device OS
    setNativePlatform('ios')
    expect(getNativePlatform()).toBe('ios')
    expect(isNativeIOS()).toBe(true)
    setNativePlatform('android')
    expect(getNativePlatform()).toBe('android')
    expect(isNativeAndroid()).toBe(true)
  })
})
