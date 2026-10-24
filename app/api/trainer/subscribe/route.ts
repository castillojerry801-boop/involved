import 'server-only'
import { timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { TRAINER_TIERS, type TrainerTierKey } from '@/lib/subscription/config'

/**
 * POST /api/trainer/subscribe
 *
 * Provisions a trainer subscription after payment is confirmed by the Apple
 * App Store or Google Play billing webhook. This endpoint is NOT a self-service
 * API — it must only be called with a valid INTERNAL_TRAINER_PROVISIONING_KEY.
 *
 * All unauthenticated or key-less requests are rejected with 403 regardless of
 * billing source. Self-service activation is blocked until verified billing
 * webhooks are integrated.
 *
 * TRAINER_USER_IDS env var grants trainer access without touching this route.
 */

function keyMatches(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  // Key guard — must precede auth check to prevent timing-based enumeration.
  // Self-service activation fails closed when INTERNAL_TRAINER_PROVISIONING_KEY is unset.
  const provisioningKey = process.env.INTERNAL_TRAINER_PROVISIONING_KEY
  const internalKey = req.headers.get('x-internal-key')
  if (!internalKey || !provisioningKey || !keyMatches(internalKey, provisioningKey)) {
    return Response.json(
      { error: 'Trainer activation requires verified billing. Self-service activation is not available.' },
      { status: 403 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    tierKey:                string
    externalSubscriptionId: string
    externalPriceId:        string
    billingSource:          'apple' | 'google' | 'manual'
    currentPeriodStart?:    string
    currentPeriodEnd?:      string
  }

  if (!body.tierKey || !(body.tierKey in TRAINER_TIERS)) {
    return Response.json({ error: 'Invalid tierKey' }, { status: 400 })
  }

  const tier = TRAINER_TIERS[body.tierKey as TrainerTierKey]

  try {
    // Create or update TrainerProfile
    await prisma.trainerProfile.upsert({
      where:  { userId: user.id },
      create: { userId: user.id },
      update: {},
    })

    // Upsert TrainerSubscription
    const sub = await prisma.trainerSubscription.upsert({
      where:  { userId: user.id },
      create: {
        userId:                 user.id,
        tierKey:                body.tierKey,
        maxClients:             tier.maxClients,
        status:                 'active',
        billingSource:          body.billingSource,
        externalSubscriptionId: body.externalSubscriptionId,
        externalPriceId:        body.externalPriceId,
        currentPeriodStart:     body.currentPeriodStart ? new Date(body.currentPeriodStart) : null,
        currentPeriodEnd:       body.currentPeriodEnd   ? new Date(body.currentPeriodEnd)   : null,
      },
      update: {
        tierKey:                body.tierKey,
        maxClients:             tier.maxClients,
        status:                 'active',
        billingSource:          body.billingSource,
        externalSubscriptionId: body.externalSubscriptionId,
        externalPriceId:        body.externalPriceId,
        currentPeriodStart:     body.currentPeriodStart ? new Date(body.currentPeriodStart) : null,
        currentPeriodEnd:       body.currentPeriodEnd   ? new Date(body.currentPeriodEnd)   : null,
      },
    })

    // Sync denormalized tier on Profile
    await prisma.profile.update({
      where: { id: user.id },
      data:  { subscriptionTier: 'trainer' },
    })

    return Response.json({ ok: true, subscription: sub })
  } catch {
    return Response.json({ error: 'Failed to create trainer subscription' }, { status: 500 })
  }
}
