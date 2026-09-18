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
