import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Capacitor mock ────────────────────────────────────────────────────────────

const mockCapacitor = {
  isNativePlatform: vi.fn<() => boolean>(),
  getPlatform:      vi.fn<() => string>(),
}

vi.mock('@capacitor/core', () => ({ Capacitor: mockCapacitor }))

// ─── RevenueCat SDK mock ───────────────────────────────────────────────────────

const mockPurchases = {
  configure:        vi.fn(),
  getOfferings:     vi.fn(),
  purchasePackage:  vi.fn(),
  restorePurchases: vi.fn(),
}

// isPurchasesError is a type guard — default implementation checks the schema
const mockIsPurchasesError = vi.fn((err: unknown): err is { code: string; message: string } => {
  return typeof err === 'object' && err !== null && 'code' in err && 'message' in err
})

vi.mock('@revenuecat/purchases-capacitor', () => ({
  Purchases: mockPurchases,
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' },
  PACKAGE_TYPE: { ANNUAL: 'ANNUAL', MONTHLY: 'MONTHLY' },
  isPurchasesError: mockIsPurchasesError,
}))

// ─── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ─── Module under test ─────────────────────────────────────────────────────────

const {
  fetchOfferings,
  getPackageForPlan,
  purchasePackage,
  restorePurchases,
  syncSubscriptionWithServer,
} = await import('@/lib/revenuecat/purchases')

const { getRevenueCatKey } = await import('@/lib/revenuecat/config')

// ─── Helpers ───────────────────────────────────────────────────────────────────

function setNative(platform: 'ios' | 'android' = 'ios') {
  mockCapacitor.isNativePlatform.mockReturnValue(true)
  mockCapacitor.getPlatform.mockReturnValue(platform)
  process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY     = 'test_ios_key'
  process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY = 'test_android_key'
}

function setWeb() {
  mockCapacitor.isNativePlatform.mockReturnValue(false)
  mockCapacitor.getPlatform.mockReturnValue('web')
}

function makeOffering(packages: { packageType: string; priceString?: string }[]) {
  return {
    identifier: 'default',
    availablePackages: packages.map((p, i) => ({
      identifier: `pkg_${i}`,
      packageType: p.packageType,
      product: { priceString: p.priceString ?? '$6.99' },
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  delete process.env.NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE
  delete process.env.NEXT_PUBLIC_REVENUECAT_TEST_STORE_KEY
})

// ─── getRevenueCatKey — test store flag ────────────────────────────────────────
// getRevenueCatKey reads process.env at call time, so env changes take effect immediately.

describe('getRevenueCatKey — test store flag', () => {
  it('returns test store key when NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE=true', () => {
    process.env.NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE = 'true'
    process.env.NEXT_PUBLIC_REVENUECAT_TEST_STORE_KEY = 'test_store_sdk_key'
    expect(getRevenueCatKey()).toBe('test_store_sdk_key')
  })

  it('throws when USE_TEST_STORE=true but TEST_STORE_KEY is missing', () => {
    process.env.NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE = 'true'
    expect(() => getRevenueCatKey()).toThrow('NEXT_PUBLIC_REVENUECAT_TEST_STORE_KEY is not set')
  })

  it('returns iOS key on iOS when USE_TEST_STORE is not set', () => {
    process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY = 'ios_sdk_key'
    mockCapacitor.getPlatform.mockReturnValue('ios')
    expect(getRevenueCatKey()).toBe('ios_sdk_key')
  })
})

// ─── fetchOfferings ────────────────────────────────────────────────────────────

describe('fetchOfferings', () => {
  it('returns null on web', async () => {
    setWeb()
    expect(await fetchOfferings()).toBeNull()
    expect(mockPurchases.getOfferings).not.toHaveBeenCalled()
  })

  it('returns current offering on native', async () => {
    setNative()
    const offering = makeOffering([{ packageType: 'ANNUAL' }])
    mockPurchases.getOfferings.mockResolvedValue({ current: offering })
    expect(await fetchOfferings()).toBe(offering)
  })

  it('returns null when getOfferings throws', async () => {
    setNative()
    mockPurchases.getOfferings.mockRejectedValue(new Error('network error'))
    expect(await fetchOfferings()).toBeNull()
  })

  it('returns null when current offering is null', async () => {
    setNative()
    mockPurchases.getOfferings.mockResolvedValue({ current: null })
    expect(await fetchOfferings()).toBeNull()
  })
})

// ─── getPackageForPlan ─────────────────────────────────────────────────────────

describe('getPackageForPlan', () => {
  it('returns annual package for annual plan', () => {
    const offering = makeOffering([{ packageType: 'ANNUAL' }, { packageType: 'MONTHLY' }])
    const pkg = getPackageForPlan(offering as never, 'annual')
    expect(pkg?.packageType).toBe('ANNUAL')
  })

  it('returns monthly package for monthly plan', () => {
    const offering = makeOffering([{ packageType: 'ANNUAL' }, { packageType: 'MONTHLY' }])
    const pkg = getPackageForPlan(offering as never, 'monthly')
    expect(pkg?.packageType).toBe('MONTHLY')
  })

  it('returns undefined when no matching package', () => {
    const offering = makeOffering([{ packageType: 'ANNUAL' }])
    expect(getPackageForPlan(offering as never, 'monthly')).toBeUndefined()
  })
})

// ─── purchasePackage ───────────────────────────────────────────────────────────

describe('purchasePackage', () => {
  const fakePackage = { identifier: 'annual', packageType: 'ANNUAL' } as never

  it('returns native_only on web', async () => {
    setWeb()
    const result = await purchasePackage(fakePackage)
    expect(result).toEqual({ ok: false, cancelled: false, message: 'native_only' })
    expect(mockPurchases.purchasePackage).not.toHaveBeenCalled()
  })

  it('returns ok:true and calls sync on successful purchase', async () => {
    setNative()
    mockPurchases.purchasePackage.mockResolvedValue({ customerInfo: {} })
    const result = await purchasePackage(fakePackage)
    expect(result).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledWith('/api/subscription/sync', { method: 'POST' })
  })

  it('returns cancelled:true when user cancels (error code "1")', async () => {
    setNative()
    const cancelError = { code: '1', message: 'cancelled', readableErrorCode: '', userInfo: { readableErrorCode: '' }, underlyingErrorMessage: '', userCancelled: true }
    mockPurchases.purchasePackage.mockRejectedValue(cancelError)
    mockIsPurchasesError.mockReturnValue(true)
    const result = await purchasePackage(fakePackage)
    expect(result).toEqual({ ok: false, cancelled: true })
  })

  it('returns error message on non-cancel purchase failure', async () => {
    setNative()
    const purchaseErr = { code: '2', message: 'store problem', readableErrorCode: '', userInfo: { readableErrorCode: '' }, underlyingErrorMessage: '', userCancelled: null }
    mockPurchases.purchasePackage.mockRejectedValue(purchaseErr)
    mockIsPurchasesError.mockReturnValue(true)
    const result = await purchasePackage(fakePackage)
    expect(result).toEqual({ ok: false, cancelled: false, message: 'store problem' })
  })

  it('returns generic error message for unexpected throws', async () => {
    setNative()
    mockPurchases.purchasePackage.mockRejectedValue(new Error('unexpected'))
    mockIsPurchasesError.mockReturnValue(false)
    const result = await purchasePackage(fakePackage)
    expect(result).toEqual({ ok: false, cancelled: false, message: 'Purchase failed' })
  })
})

// ─── restorePurchases ─────────────────────────────────────────────────────────

describe('restorePurchases', () => {
  it('returns native_only on web', async () => {
    setWeb()
    const result = await restorePurchases()
    expect(result).toEqual({ ok: false, message: 'native_only' })
    expect(mockPurchases.restorePurchases).not.toHaveBeenCalled()
  })

  it('returns ok:true with hadActiveSubscription:true when entitled', async () => {
    setNative()
    mockPurchases.restorePurchases.mockResolvedValue({
      customerInfo: { entitlements: { active: { involved_pro: {} } } },
    })
    const result = await restorePurchases()
    expect(result).toEqual({ ok: true, hadActiveSubscription: true })
    expect(mockFetch).toHaveBeenCalledWith('/api/subscription/sync', { method: 'POST' })
  })

  it('returns ok:true with hadActiveSubscription:false when not entitled', async () => {
    setNative()
    mockPurchases.restorePurchases.mockResolvedValue({
      customerInfo: { entitlements: { active: {} } },
    })
    const result = await restorePurchases()
    expect(result).toEqual({ ok: true, hadActiveSubscription: false })
  })

  it('returns error on RC failure', async () => {
    setNative()
    const rcErr = { code: '5', message: 'network error', readableErrorCode: '', userInfo: { readableErrorCode: '' }, underlyingErrorMessage: '', userCancelled: null }
    mockPurchases.restorePurchases.mockRejectedValue(rcErr)
    mockIsPurchasesError.mockReturnValue(true)
    const result = await restorePurchases()
    expect(result).toEqual({ ok: false, message: 'network error' })
  })
})

// ─── syncSubscriptionWithServer ───────────────────────────────────────────────

describe('syncSubscriptionWithServer', () => {
  it('POSTs to /api/subscription/sync', async () => {
    await syncSubscriptionWithServer()
    expect(mockFetch).toHaveBeenCalledWith('/api/subscription/sync', { method: 'POST' })
  })

  it('does not throw when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('offline'))
    await expect(syncSubscriptionWithServer()).resolves.toBeUndefined()
  })
})
