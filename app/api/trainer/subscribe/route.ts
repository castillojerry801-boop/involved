import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { TRAINER_TIERS, type TrainerTierKey } from '@/lib/subscription/config'

/**
 * POST /api/trainer/subscribe
 *
 * Provisions a trainer subscription record after payment is confirmed
 * by the payment provider webhook. This endpoint is called by the webhook
 * handler (or internally after Stripe checkout completion).
 *
 * Payment provider webhook configuration is required before this flow
 * is live. See /docs/NATIVE_BRIDGE.md — Payment section.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    tierKey:                string
    externalSubscriptionId: string
    externalPriceId:        string
    billingSource:          'stripe' | 'apple' | 'google' | 'manual'
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
