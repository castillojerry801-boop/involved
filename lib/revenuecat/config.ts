import { Capacitor } from '@capacitor/core'

/**
 * RevenueCat entitlement identifier as configured in the RC Dashboard.
 * Use this constant (not the string literal) for all SDK entitlement lookups:
 *   customerInfo.entitlements.active[RC_ENTITLEMENT_ID]
 *
 * Involved's internal subscription tier ('plus') is a separate concept and
 * must not be used as the RC identifier.
 */
export const RC_ENTITLEMENT_ID = 'involved_pro' as const

/**
 * RevenueCat public SDK keys.
 *
 * These are NOT secret — they are meant to be shipped in the app bundle.
 * Set them as environment variables in Vercel (or .env.local for development):
 *
 *   NEXT_PUBLIC_REVENUECAT_IOS_KEY     — from RevenueCat dashboard → Apps → iOS app → Public SDK key
 *   NEXT_PUBLIC_REVENUECAT_ANDROID_KEY — from RevenueCat dashboard → Apps → Android app → Public SDK key
 *
 * Both keys must be present before Purchases.configure() is called in the
 * subscription integration phase. getRevenueCatKey() throws if the key for
 * the current platform is not set, preventing silent misconfiguration.
 */
export function getRevenueCatKey(): string {
  // Explicit test/dev builds opt in to the RC Test Store via this flag.
  // Production iOS and Android must never use the test store key.
  if (process.env.NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE === 'true') {
    const key = process.env.NEXT_PUBLIC_REVENUECAT_TEST_STORE_KEY
    if (!key) throw new Error('NEXT_PUBLIC_REVENUECAT_TEST_STORE_KEY is not set (required when NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE=true)')
    return key
  }

  const platform = Capacitor.getPlatform() // 'ios' | 'android' | 'web'

  if (platform === 'ios') {
    const key = process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY
    if (!key) throw new Error('NEXT_PUBLIC_REVENUECAT_IOS_KEY is not set')
    return key
  }

  if (platform === 'android') {
    const key = process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY
    if (!key) throw new Error('NEXT_PUBLIC_REVENUECAT_ANDROID_KEY is not set')
    return key
  }

  // Web platform — RevenueCat does not support web; return empty string.
  // Callers must guard with Capacitor.isNativePlatform() before configuring.
  return ''
}

export function isRevenueCatSupported(): boolean {
  return Capacitor.isNativePlatform()
}
