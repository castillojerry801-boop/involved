// DIAGNOSTIC — delete this test file when diagnostic.ts is removed.
import { describe, it, expect, vi } from 'vitest'
import { runRcDiagnostic, type RcDiagnosticDeps } from '@/lib/revenuecat/diagnostic'
import type { PurchasesOffering, PurchasesPackage } from '@revenuecat/purchases-capacitor'

const TEST_EMAIL = 'jerry@burtonbball.com'

function makePackage(packageType: string, productId: string): PurchasesPackage {
  return {
    identifier: packageType,
    packageType: packageType as PurchasesPackage['packageType'],
    product: { identifier: productId } as PurchasesPackage['product'],
    presentedOfferingContext: {} as PurchasesPackage['presentedOfferingContext'],
    offeringIdentifier: 'default',
    webCheckoutUrl: null,
  }
}

function makeOffering(id: string, pkgs: PurchasesPackage[]): PurchasesOffering {
  return {
    identifier: id,
    serverDescription: '',
    metadata: {},
    availablePackages: pkgs,
    lifetime: null,
    annual: pkgs.find(p => p.packageType === 'ANNUAL') ?? null,
    sixMonth: null,
    threeMonth: null,
    twoMonth: null,
    monthly: pkgs.find(p => p.packageType === 'MONTHLY') ?? null,
    weekly: null,
  } as PurchasesOffering
}

function makeDeps(overrides: Partial<RcDiagnosticDeps> = {}): RcDiagnosticDeps {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'uid-1', email: TEST_EMAIL }),
    initialize: vi.fn().mockResolvedValue(undefined),
    getOfferings: vi.fn().mockResolvedValue({
      current: makeOffering('default', [
        makePackage('ANNUAL', 'com.involved.plus.annual'),
        makePackage('MONTHLY', 'com.involved.plus.monthly'),
      ]),
    }),
    testEmail: TEST_EMAIL,
    ...overrides,
  }
}

describe('runRcDiagnostic', () => {
  it('returns null for a non-test-account user', async () => {
    const deps = makeDeps({
      getUser: vi.fn().mockResolvedValue({ id: 'uid-other', email: 'other@example.com' }),
    })
    expect(await runRcDiagnostic(deps)).toBeNull()
  })

  it('returns no-user message and stops chain when user is null', async () => {
    const deps = makeDeps({ getUser: vi.fn().mockResolvedValue(null) })
    const result = await runRcDiagnostic(deps)
    expect(result).toMatch(/^no-user:/)
    expect(deps.initialize).not.toHaveBeenCalled()
    expect(deps.getOfferings).not.toHaveBeenCalled()
  })

  it('returns init-failed message when initializePurchases throws', async () => {
    const deps = makeDeps({
      initialize: vi.fn().mockRejectedValue(new Error('SDK configure failed')),
    })
    const result = await runRcDiagnostic(deps)
    expect(result).toMatch(/^init-failed:/)
    expect(result).toContain('SDK configure failed')
    expect(deps.getOfferings).not.toHaveBeenCalled()
  })

  it('returns get-offerings-threw message when getOfferings throws', async () => {
    const deps = makeDeps({
      getOfferings: vi.fn().mockRejectedValue(new Error('network error')),
    })
    const result = await runRcDiagnostic(deps)
    expect(result).toMatch(/^get-offerings-threw:/)
    expect(result).toContain('network error')
  })

  it('returns null-current message when current offering is null', async () => {
    const deps = makeDeps({
      getOfferings: vi.fn().mockResolvedValue({ current: null }),
    })
    const result = await runRcDiagnostic(deps)
    expect(result).toMatch(/^null-current:/)
  })

  it('returns zero-pkgs message when offering has no available packages', async () => {
    const deps = makeDeps({
      getOfferings: vi.fn().mockResolvedValue({
        current: makeOffering('default', []),
      }),
    })
    const result = await runRcDiagnostic(deps)
    expect(result).toMatch(/^zero-pkgs:/)
    expect(result).toContain('"default"')
  })

  it('returns ok summary with package types and product identifiers when packages are present', async () => {
    const deps = makeDeps()
    const result = await runRcDiagnostic(deps)
    expect(result).toMatch(/^ok:/)
    expect(result).toContain('ANNUAL:com.involved.plus.annual')
    expect(result).toContain('MONTHLY:com.involved.plus.monthly')
  })
})
