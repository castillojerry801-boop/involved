import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { TRIAL_DAYS } from '@/lib/subscription/config'

// ─── GET: current subscription entitlement ────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const entitlement = await getUserEntitlement(user.id)
  return Response.json(entitlement)
}

// ─── POST: start free trial ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { action?: string }
  if (body.action !== 'start_trial') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  // Check whether user is eligible (no prior trial or active subscription)
  const existing = await prisma.userSubscription.findUnique({
    where: { userId: user.id },
  })

  if (existing) {
    const alreadyUsedTrial = existing.trialStartedAt !== null
    const hasActiveSub = existing.status === 'active' && existing.tier === 'plus'

    if (alreadyUsedTrial) {
      return Response.json({ error: 'trial_already_used' }, { status: 409 })
    }
    if (hasActiveSub) {
      return Response.json({ error: 'already_subscribed' }, { status: 409 })
    }
  }

  const now = new Date()
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000)

  // Create or update the subscription record
  const sub = existing
    ? await prisma.userSubscription.update({
        where: { userId: user.id },
        data: {
          tier: 'plus',
          status: 'trialing',
          billingSource: 'manual',
          trialStartedAt: now,
          trialEndsAt,
        },
      })
    : await prisma.userSubscription.create({
        data: {
          userId: user.id,
          tier: 'plus',
          status: 'trialing',
          billingSource: 'manual',
          trialStartedAt: now,
          trialEndsAt,
        },
      })

  // Sync denormalized cache on Profile
  await prisma.profile.update({
    where: { id: user.id },
    data: { subscriptionTier: 'trial' },
  }).catch(() => null)

  return Response.json({
    success: true,
    trialEndsAt: sub.trialEndsAt,
    trialDaysRemaining: TRIAL_DAYS,
  })
}
