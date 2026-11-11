import { Capacitor } from '@capacitor/core'
import {
  Purchases,
  PURCHASES_ERROR_CODE,
  PACKAGE_TYPE,
  isPurchasesError,
} from '@revenuecat/purchases-capacitor'
import type { PurchasesOffering, PurchasesPackage } from '@revenuecat/purchases-capacitor'
import { getRevenueCatKey, RC_ENTITLEMENT_ID } from './config'

let initialized = false

export async function initializePurchases(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  if (initialized) return
  const apiKey = getRevenueCatKey()
  await Purchases.configure({ apiKey, appUserID: userId })
  initialized = true
}

export async function fetchOfferings(): Promise<PurchasesOffering | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { current } = await Purchases.getOfferings()
    return current
  } catch {
    return null
  }
}

export function getPackageForPlan(
  offering: PurchasesOffering,
  plan: 'annual' | 'monthly',
): PurchasesPackage | undefined {
  const targetType = plan === 'annual' ? PACKAGE_TYPE.ANNUAL : PACKAGE_TYPE.MONTHLY
  return offering.availablePackages.find(p => p.packageType === targetType)
}

export type PurchaseResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string }

export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseResult> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, cancelled: false, message: 'native_only' }
  }
  try {
    await Purchases.purchasePackage({ aPackage: pkg })
    await syncSubscriptionWithServer()
    return { ok: true }
  } catch (err) {
    if (isPurchasesError(err) && err.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { ok: false, cancelled: true }
    }
    const message = isPurchasesError(err) ? err.message : 'Purchase failed'
    return { ok: false, cancelled: false, message }
  }
}

export type RestoreResult =
  | { ok: true; hadActiveSubscription: boolean }
  | { ok: false; message: string }

export async function restorePurchases(): Promise<RestoreResult> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, message: 'native_only' }
  }
  try {
    const { customerInfo } = await Purchases.restorePurchases()
    const hadActiveSubscription = !!customerInfo.entitlements.active[RC_ENTITLEMENT_ID]
    await syncSubscriptionWithServer()
    return { ok: true, hadActiveSubscription }
  } catch (err) {
    const message = isPurchasesError(err) ? err.message : 'Restore failed'
    return { ok: false, message }
  }
}

export async function syncSubscriptionWithServer(): Promise<void> {
  try {
    await fetch('/api/subscription/sync', { method: 'POST' })
  } catch {
    // Non-fatal — the webhook handles reconciliation independently
  }
}
