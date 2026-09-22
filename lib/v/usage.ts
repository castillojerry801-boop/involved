import 'server-only'
import { prisma } from '@/lib/prisma'
import { getAiLimit } from '@/lib/subscription/config'
import type { EffectiveTier, AiFeatureKey } from '@/lib/subscription/config'

function billingPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function checkAndConsumeVUsage(
  userId: string,
  tier: EffectiveTier,
  feature: AiFeatureKey,
): Promise<{ allowed: boolean; count: number; limit: number | null }> {
  const limit = getAiLimit(tier, feature)
  const period = billingPeriod()

  try {
    const record = await prisma.aiUsageLog.upsert({
      where: { userId_billingPeriod_feature: { userId, billingPeriod: period, feature: feature as never } },
      update: { interactionCount: { increment: 1 } },
      create: { userId, billingPeriod: period, feature: feature as never, interactionCount: 1 },
    })

    if (limit !== null && record.interactionCount > limit) {
      await prisma.aiUsageLog.update({
        where: { userId_billingPeriod_feature: { userId, billingPeriod: period, feature: feature as never } },
        data: { interactionCount: { decrement: 1 } },
      })
      return { allowed: false, count: record.interactionCount - 1, limit }
    }

    return { allowed: true, count: record.interactionCount, limit }
  } catch {
    return { allowed: true, count: 0, limit }
  }
}

// Reverses a previously consumed credit when the AI call fails due to a server
// or model error — not called on validation failures caused by bad user input.
// Called when: OpenAI throws, the generation loop exhausts MAX_ROUNDS without a
// valid program, or the modification loop fails the same way.
// Non-critical: if the decrement fails (e.g., the original record was never written),
// we swallow the error rather than adding noise to an already-failing request.
export async function decrementVUsage(
  userId: string,
  feature: AiFeatureKey,
): Promise<void> {
  const period = billingPeriod()
  try {
    await prisma.aiUsageLog.updateMany({
      where: {
        userId,
        billingPeriod: period,
        feature: feature as never,
        interactionCount: { gt: 0 },
      },
      data: { interactionCount: { decrement: 1 } },
    })
  } catch { /* non-critical */ }
}
