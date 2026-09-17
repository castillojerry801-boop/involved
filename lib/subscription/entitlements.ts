import 'server-only'
import { prisma } from '@/lib/prisma'
import type { EffectiveTier } from './config'

export interface Entitlement {
  tier: EffectiveTier
  status: 'active' | 'trialing' | 'expired' | 'canceled' | 'paused' | null
  trialEndsAt: Date | null
  trialDaysRemaining: number | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  isPlus: boolean
  isTrial: boolean
  isFree: boolean
}

const FREE_ENTITLEMENT: Entitlement = {
  tier: 'free',
  status: null,
  trialEndsAt: null,
  trialDaysRemaining: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  isPlus: false,
  isTrial: false,
  isFree: true,
}

const PLUS_ENTITLEMENT: Entitlement = {
  tier: 'plus',
  status: 'active',
  trialEndsAt: null,
  trialDaysRemaining: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  isPlus: true,
  isTrial: false,
  isFree: false,
}

/**
 * Authoritative server-side entitlement check.
 * Never trust client-supplied tier claims — always call this.
 */
export async function getUserEntitlement(userId: string): Promise<Entitlement> {
  // Owner/dev override — set PLUS_USER_IDS=uuid1,uuid2 in .env.local
  const overrides = (process.env.PLUS_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (overrides.includes(userId)) return PLUS_ENTITLEMENT

  const sub = await prisma.userSubscription.findUnique({
    where: { userId },
  }).catch(() => null)

  if (!sub) return FREE_ENTITLEMENT

  const now = new Date()

  // Trial in progress
  if (sub.status === 'trialing') {
    if (sub.trialEndsAt && sub.trialEndsAt <= now) {
      // Trial expired server-side — mark it and return free
      await prisma.userSubscription.update({
        where: { userId },
        data: {
          status: 'expired',
          // Sync the denormalized cache on Profile
        },
      }).catch(() => null)
      await prisma.profile.update({
        where: { id: userId },
        data: { subscriptionTier: 'free' },
      }).catch(() => null)
      return FREE_ENTITLEMENT
    }

    const msLeft = (sub.trialEndsAt?.getTime() ?? 0) - now.getTime()
    const daysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000))

    return {
      tier: 'trial',
      status: 'trialing',
      trialEndsAt: sub.trialEndsAt,
      trialDaysRemaining: daysLeft,
      currentPeriodEnd: sub.trialEndsAt,
      cancelAtPeriodEnd: false,
      isPlus: false,
      isTrial: true,
      isFree: false,
    }
  }

  // Active paid subscription
  if (sub.status === 'active' && sub.tier === 'plus') {
    return {
      tier: 'plus',
      status: 'active',
      trialEndsAt: null,
      trialDaysRemaining: null,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      isPlus: true,
      isTrial: false,
      isFree: false,
    }
  }

  return FREE_ENTITLEMENT
}

/**
 * Quick tier-only lookup — use when the full Entitlement isn't needed.
 */
export async function getEffectiveTier(userId: string): Promise<EffectiveTier> {
  return (await getUserEntitlement(userId)).tier
}
