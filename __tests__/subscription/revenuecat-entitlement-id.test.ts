/**
 * RC entitlement identifier alignment test.
 *
 * The RC Dashboard entitlement identifier is 'involved_pro'.
 * Involved's internal subscription tier ('plus') is a separate concept.
 * This test pins the constant so a drift between the two is caught immediately.
 */

import { describe, it, expect } from 'vitest'
import { RC_ENTITLEMENT_ID } from '../../lib/revenuecat/config'

describe('RC_ENTITLEMENT_ID constant', () => {
  it('equals the RevenueCat dashboard entitlement identifier "involved_pro"', () => {
    expect(RC_ENTITLEMENT_ID).toBe('involved_pro')
  })

  it('is not the internal tier name "plus"', () => {
    expect(RC_ENTITLEMENT_ID).not.toBe('plus')
  })

  it('is a string literal type (compile-time guard satisfied at runtime)', () => {
    expect(typeof RC_ENTITLEMENT_ID).toBe('string')
  })
})
