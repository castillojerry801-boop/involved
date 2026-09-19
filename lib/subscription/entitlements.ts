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
  isTrainer: boolean
  // True if Plus access comes from a trainer sponsoring this user (not personal sub)
  isTrainerSponsored: boolean
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
  isTrainer: false,
  isTrainerSponsored: false,
}

/**
 * Authoritative server-side entitlement check.
 *
 * Resolution order (highest wins):
 *   1. trainer tier    — active TrainerSubscription
 *   2. plus tier       — active personal UserSubscription
 *   3. trial tier      — active UserSubscription in trial
 *   4. trainer_sponsored — active UserEntitlement from a trainer
 *   5. free            — fallback
 *
 * Never trust client-supplied tier claims — always call this.
 */
export async function getUserEntitlement(userId: string): Promise<Entitlement> {
  // Dev overrides — set in .env.local or Vercel env vars
  const trainerOverrides = (process.env.TRAINER_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (trainerOverrides.includes(userId)) {
    return {
      tier: 'trainer',
      status: 'active',
      trialEndsAt: null,
      trialDaysRemaining: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      isPlus: true,
      isTrial: false,
      isFree: false,
      isTrainer: true,
      isTrainerSponsored: false,
    }
  }
  const plusOverrides = (process.env.PLUS_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (plusOverrides.includes(userId)) {
    return { ...FREE_ENTITLEMENT, tier: 'plus', isPlus: true, isFree: false, status: 'active' }
  }

  const now = new Date()

  const [sub, trainerSub, sponsoredEntitlements] = await Promise.all([
    prisma.userSubscription.findUnique({ where: { userId } }).catch(() => null),
    prisma.trainerSubscription.findUnique({ where: { userId } }).catch(() => null),
    prisma.userEntitlement.findMany({
      where: {
        userId,
        source: 'trainer_sponsored',
        status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }).catch(() => []),
  ])

  // 1. Trainer tier — has an active trainer subscription
  if (trainerSub && trainerSub.status === 'active') {
    return {
      tier: 'trainer',
      status: 'active',
      trialEndsAt: null,
      trialDaysRemaining: null,
      currentPeriodEnd: trainerSub.currentPeriodEnd,
      cancelAtPeriodEnd: trainerSub.cancelAtPeriodEnd,
      isPlus: true,
      isTrial: false,
      isFree: false,
      isTrainer: true,
      isTrainerSponsored: false,
    }
  }

  if (sub) {
    // 2. Active paid Plus subscription
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
        isTrainer: false,
        isTrainerSponsored: false,
      }
    }

    // 3. Trial in progress
    if (sub.status === 'trialing') {
      if (sub.trialEndsAt && sub.trialEndsAt <= now) {
        // Expire server-side
        await Promise.all([
          prisma.userSubscription.update({ where: { userId }, data: { status: 'expired' } }).catch(() => null),
          prisma.profile.update({ where: { id: userId }, data: { subscriptionTier: 'free' } }).catch(() => null),
        ])
      } else {
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
          isTrainer: false,
          isTrainerSponsored: false,
        }
      }
    }
  }

  // 4. Active trainer-sponsored entitlement
  if (sponsoredEntitlements.length > 0) {
    return {
      tier: 'plus',
      status: 'active',
      trialEndsAt: null,
      trialDaysRemaining: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      isPlus: true,
      isTrial: false,
      isFree: false,
      isTrainer: false,
      isTrainerSponsored: true,
    }
  }

  return FREE_ENTITLEMENT
}

export async function getEffectiveTier(userId: string): Promise<EffectiveTier> {
  return (await getUserEntitlement(userId)).tier
}

/**
 * Check whether a user has an active trainer relationship with the given trainer.
 * Used by API routes before allowing trainer access to client data.
 */
export async function assertTrainerClientAccess(trainerId: string, clientId: string): Promise<void> {
  const rel = await prisma.trainerClientRelationship.findUnique({
    where: { trainerId_clientId: { trainerId, clientId } },
  })
  if (!rel || rel.status !== 'active' || rel.revokedAt !== null) {
    throw new Error('UNAUTHORIZED')
  }
}
