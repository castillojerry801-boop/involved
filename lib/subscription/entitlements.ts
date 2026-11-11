import 'server-only'
import { prisma } from '@/lib/prisma'
import type { UserSubscription } from '@prisma/client'
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
  // True if Plus access was granted manually by an admin
  isAdminGrant: boolean
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
  isAdminGrant: false,
}

/**
 * Authoritative server-side entitlement check.
 *
 * Resolution order (highest wins):
 *   1. trainer tier    — active TrainerSubscription
 *   2. plus tier       — active personal UserSubscription (any billing source)
 *   3. trial tier      — active UserSubscription in trial (manual source)
 *   4. trainer_sponsored — active UserEntitlement from a trainer
 *   5. admin_grant     — active UserEntitlement from an admin
 *   6. free            — fallback
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
      isAdminGrant: false,
    }
  }
  const plusOverrides = (process.env.PLUS_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (plusOverrides.includes(userId)) {
    return { ...FREE_ENTITLEMENT, tier: 'plus', isPlus: true, isFree: false, status: 'active' }
  }

  const now = new Date()

  const testStoreEnabled =
    process.env.REVENUECAT_ACCEPT_TEST_STORE === 'true' &&
    process.env.VERCEL_ENV !== 'production'

  const [rawSubs, trainerSub, sponsoredEntitlements, adminEntitlements] = await Promise.all([
    prisma.userSubscription.findMany({ where: { userId } }).catch((): UserSubscription[] => []),
    prisma.trainerSubscription.findUnique({ where: { userId } }).catch(() => null),
    prisma.userEntitlement.findMany({
      where: {
        userId,
        source: 'trainer_sponsored',
        status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }).catch(() => []),
    prisma.userEntitlement.findMany({
      where: {
        userId,
        source: 'admin_grant',
        status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }).catch(() => []),
  ])

  // rc_test rows only count when Test Store is explicitly enabled in a non-production environment.
  // This prevents stale test rows from granting Plus after the flag is removed or the app is promoted.
  const subs = testStoreEnabled ? rawSubs : rawSubs.filter(s => s.billingSource !== 'rc_test')

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
      isAdminGrant: false,
    }
  }

  // 2. Active paid Plus subscription — check all billing sources
  const activePlus = subs.find(s => s.status === 'active' && s.tier === 'plus')
  if (activePlus) {
    return {
      tier: 'plus',
      status: 'active',
      trialEndsAt: null,
      trialDaysRemaining: null,
      currentPeriodEnd: activePlus.currentPeriodEnd,
      cancelAtPeriodEnd: activePlus.cancelAtPeriodEnd,
      isPlus: true,
      isTrial: false,
      isFree: false,
      isTrainer: false,
      isTrainerSponsored: false,
      isAdminGrant: false,
    }
  }

  // 3. Trial in progress — always from manual billing source
  const trialSub = subs.find(s => s.billingSource === 'manual' && s.status === 'trialing')
  if (trialSub) {
    if (trialSub.trialEndsAt && trialSub.trialEndsAt <= now) {
      // Expire server-side
      await Promise.all([
        prisma.userSubscription.updateMany({
          where: { userId, billingSource: 'manual', status: 'trialing' },
          data: { status: 'expired' },
        }).catch(() => null),
        prisma.profile.update({ where: { id: userId }, data: { subscriptionTier: 'free' } }).catch(() => null),
      ])
    } else {
      const msLeft = (trialSub.trialEndsAt?.getTime() ?? 0) - now.getTime()
      const daysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000))
      return {
        tier: 'trial',
        status: 'trialing',
        trialEndsAt: trialSub.trialEndsAt,
        trialDaysRemaining: daysLeft,
        currentPeriodEnd: trialSub.trialEndsAt,
        cancelAtPeriodEnd: false,
        isPlus: false,
        isTrial: true,
        isFree: false,
        isTrainer: false,
        isTrainerSponsored: false,
        isAdminGrant: false,
      }
    }
  }

  // 4. Active trainer-sponsored entitlement — dual-validated
  // Both the trainer's subscription AND the TrainerClientRelationship must be
  // currently active. An orphaned UserEntitlement row alone is not sufficient.
  if (sponsoredEntitlements.length > 0) {
    const trainerIds = [...new Set(
      sponsoredEntitlements
        .map(e => e.sourceRef)
        .filter((r): r is string => typeof r === 'string' && r.length > 0),
    )]

    if (trainerIds.length > 0) {
      const bypassIds = (process.env.TRAINER_USER_IDS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean)

      const [activeTrainerSubs, activeRels] = await Promise.all([
        prisma.trainerSubscription.findMany({
          where:  { userId: { in: trainerIds }, status: 'active' },
          select: { userId: true },
        }).catch(() => [] as Array<{ userId: string }>),
        prisma.trainerClientRelationship.findMany({
          where: {
            clientId:  userId,
            trainerId: { in: trainerIds },
            status:    'active',
            revokedAt: null,
          },
          select: { trainerId: true },
        }).catch(() => [] as Array<{ trainerId: string }>),
      ])

      const subEligible = new Set<string>([
        ...activeTrainerSubs.map(s => s.userId),
        ...bypassIds.filter(id => trainerIds.includes(id)),
      ])
      const relActive = new Set<string>(activeRels.map(r => r.trainerId))

      if (trainerIds.some(id => subEligible.has(id) && relActive.has(id))) {
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
          isAdminGrant: false,
        }
      }
    }
  }

  // 5. Admin grant
  if (adminEntitlements.length > 0) {
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
      isTrainerSponsored: false,
      isAdminGrant: true,
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
