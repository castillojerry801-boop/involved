import 'server-only'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'

const INVITATION_EXPIRY_DAYS = 7

/**
 * Send a trainer invitation by email.
 * Creates a TrainerInvitation row. Does NOT grant data access — access
 * is only granted when the client accepts via the token link.
 */
export async function createInvitation(
  trainerId:    string,
  invitedEmail: string,
): Promise<{ token: string; expiresAt: Date }> {
  // Check seat availability before sending
  await assertSeatAvailable(trainerId)

  // Cancel any existing pending invitation for this email from this trainer
  await prisma.trainerInvitation.updateMany({
    where:  { trainerId, invitedEmail, status: 'pending' },
    data:   { status: 'canceled' },
  })

  const token     = randomBytes(32).toString('hex')
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS)

  await prisma.trainerInvitation.create({
    data: { trainerId, invitedEmail, token, expiresAt },
  })

  return { token, expiresAt }
}

/**
 * Accept a trainer invitation. The authenticated user (clientId) accepts
 * an invitation by its token.
 *
 * On success:
 *   - TrainerInvitation → accepted
 *   - TrainerClientRelationship created (status=active)
 *   - UserEntitlement created (source=trainer_sponsored)
 */
export async function acceptInvitation(
  token:    string,
  clientId: string,
): Promise<void> {
  const invitation = await prisma.trainerInvitation.findUnique({ where: { token } })

  if (!invitation)                    throw new Error('Invitation not found')
  if (invitation.status !== 'pending') throw new Error('Invitation is no longer valid')
  if (invitation.expiresAt < new Date()) throw new Error('Invitation has expired')

  const trainerId = invitation.trainerId

  // Ensure no existing active relationship
  const existing = await prisma.trainerClientRelationship.findUnique({
    where: { trainerId_clientId: { trainerId, clientId } },
  })
  if (existing && existing.status === 'active' && !existing.revokedAt) {
    throw new Error('Relationship already active')
  }

  await assertSeatAvailable(trainerId)

  // Transactional: create entitlement + relationship + update invitation
  await prisma.$transaction(async tx => {
    const entitlement = await tx.userEntitlement.create({
      data: {
        userId:    clientId,
        source:    'trainer_sponsored',
        status:    'active',
        sourceRef: trainerId,
        grantedAt: new Date(),
      },
    })

    if (existing) {
      // Reactivate a previously ended relationship
      await tx.trainerClientRelationship.update({
        where: { id: existing.id },
        data: {
          status:                'active',
          sponsoredEntitlementId: entitlement.id,
          acceptedAt:            new Date(),
          revokedAt:             null,
        },
      })
    } else {
      await tx.trainerClientRelationship.create({
        data: {
          trainerId,
          clientId,
          status:                'active',
          sponsoredEntitlementId: entitlement.id,
          acceptedAt:            new Date(),
        },
      })
    }

    await tx.trainerInvitation.update({
      where: { id: invitation.id },
      data: {
        status:          'accepted',
        acceptedByUserId: clientId,
        acceptedAt:       new Date(),
      },
    })

    // Sync denormalized tier on Profile
    await tx.profile.update({
      where: { id: clientId },
      data:  { subscriptionTier: 'plus' },
    })
  })
}

/**
 * Remove a client from a trainer's roster.
 *
 * Critical rules:
 * - Trainer loses access immediately (revokedAt set, status=ended)
 * - Client's history is NEVER deleted
 * - Sponsored entitlement is revoked
 * - Client falls back to free unless they have an independent Plus sub
 */
export async function revokeClientRelationship(
  trainerId: string,
  clientId:  string,
): Promise<void> {
  const rel = await prisma.trainerClientRelationship.findUnique({
    where: { trainerId_clientId: { trainerId, clientId } },
  })
  if (!rel || rel.status === 'ended') throw new Error('Relationship not found or already ended')

  await prisma.$transaction(async tx => {
    const now = new Date()

    // End the relationship — access cut immediately
    await tx.trainerClientRelationship.update({
      where: { id: rel.id },
      data:  { status: 'ended', revokedAt: now },
    })

    // Revoke the sponsored entitlement
    if (rel.sponsoredEntitlementId) {
      await tx.userEntitlement.update({
        where: { id: rel.sponsoredEntitlementId },
        data:  { status: 'revoked', revokedAt: now },
      })
    }

    // Also revoke any other active trainer_sponsored entitlements from this trainer
    await tx.userEntitlement.updateMany({
      where: {
        userId:    clientId,
        source:    'trainer_sponsored',
        status:    'active',
        sourceRef: trainerId,
      },
      data: { status: 'revoked', revokedAt: now },
    })

    // Determine effective tier after revocation
    const personalSub = await tx.userSubscription.findUnique({
      where: { userId: clientId },
    })
    const hasPersistentPlus = personalSub?.status === 'active' && personalSub.tier === 'plus'
    const hasActiveTrial    = personalSub?.status === 'trialing' && (personalSub.trialEndsAt ?? now) > now

    const newTier = hasPersistentPlus ? 'plus'
                  : hasActiveTrial    ? 'trial'
                  : 'free'

    await tx.profile.update({
      where: { id: clientId },
      data:  { subscriptionTier: newTier },
    })
  })
}

/**
 * Enforce seat limit — throws if the trainer is at capacity.
 */
async function assertSeatAvailable(trainerId: string): Promise<void> {
  const [trainerSub, activeCount] = await Promise.all([
    prisma.trainerSubscription.findUnique({ where: { userId: trainerId } }),
    prisma.trainerClientRelationship.count({
      where: { trainerId, status: 'active', revokedAt: null },
    }),
  ])

  if (!trainerSub || trainerSub.status !== 'active') {
    throw new Error('Trainer subscription required')
  }
  if (activeCount >= trainerSub.maxClients) {
    throw new Error(`Seat limit reached (${trainerSub.maxClients} clients)`)
  }
}
