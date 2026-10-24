import 'server-only'
import { prisma } from '@/lib/prisma'
import { getAiLimit } from '@/lib/subscription/config'
import type { EffectiveTier, AiFeatureKey } from '@/lib/subscription/config'

function billingPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Atomically reserve one usage credit for a limited-tier user, or track
 * usage for an unlimited-tier user without ever blocking them.
 *
 * For limited tiers the operation is a single SQL statement:
 *
 *   INSERT ... ON CONFLICT DO UPDATE SET count = count + 1
 *   WHERE count < :limit
 *   RETURNING count
 *
 * If the WHERE condition is false (count is already at the limit), Postgres
 * does not update the row and returns 0 rows. This eliminates the
 * increment-check-decrement pattern and its failure mode (decrement error
 * after an over-limit increment causing a spurious allowed=true return).
 *
 * For unlimited tiers the WHERE clause is omitted — the row is always
 * incremented and the function always returns allowed=true.
 *
 * Calendar-month rollover is automatic: billing period is "YYYY-MM"; a new
 * period means a new row, so old counts are never carried forward.
 */
export async function checkAndConsumeVUsage(
  userId:  string,
  tier:    EffectiveTier,
  feature: AiFeatureKey,
): Promise<{ allowed: boolean; count: number; limit: number | null }> {
  const limit  = getAiLimit(tier, feature)
  const period = billingPeriod()

  try {
    if (limit === null) {
      // Unlimited tier — track usage, never block.
      const rows = await prisma.$queryRaw<Array<{ n: number }>>`
        INSERT INTO "ai_usage_logs"
          ("user_id", "billing_period", "feature", "interaction_count", "created_at", "updated_at")
        VALUES
          (${userId}::uuid, ${period}, ${feature}::"AiFeature", 1, NOW(), NOW())
        ON CONFLICT ("user_id", "billing_period", "feature")
        DO UPDATE SET
          "interaction_count" = "ai_usage_logs"."interaction_count" + 1,
          "updated_at"        = NOW()
        RETURNING "interaction_count"::int AS n
      `
      return { allowed: true, count: rows[0]?.n ?? 1, limit: null }
    }

    // Limited tier — conditional atomic increment.
    // Returns 1 row (new count) if under limit; 0 rows if at or over limit.
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      INSERT INTO "ai_usage_logs"
        ("user_id", "billing_period", "feature", "interaction_count", "created_at", "updated_at")
      VALUES
        (${userId}::uuid, ${period}, ${feature}::"AiFeature", 1, NOW(), NOW())
      ON CONFLICT ("user_id", "billing_period", "feature")
      DO UPDATE SET
        "interaction_count" = "ai_usage_logs"."interaction_count" + 1,
        "updated_at"        = NOW()
      WHERE "ai_usage_logs"."interaction_count" < ${limit}
      RETURNING "interaction_count"::int AS n
    `

    if (rows.length > 0) {
      return { allowed: true, count: rows[0].n, limit }
    }

    // Blocked — read current count for accurate client-side display.
    const existing = await prisma.aiUsageLog.findUnique({
      where:  { userId_billingPeriod_feature: { userId, billingPeriod: period, feature: feature as never } },
      select: { interactionCount: true },
    })
    return { allowed: false, count: existing?.interactionCount ?? limit, limit }
  } catch {
    // Fail open: a DB error must not silently block users.
    return { allowed: true, count: 0, limit }
  }
}

/**
 * Refund a previously consumed credit when the AI call fails before
 * producing any output (OpenAI error, generation loop failure, etc.).
 *
 * Not called for validation failures caused by bad user input — those
 * should consume a credit to deter abuse.
 *
 * Non-critical: the gt:0 guard prevents negative counters; errors are
 * swallowed to avoid compounding an already-failing request.
 */
export async function decrementVUsage(
  userId:  string,
  feature: AiFeatureKey,
): Promise<void> {
  const period = billingPeriod()
  try {
    await prisma.aiUsageLog.updateMany({
      where: {
        userId,
        billingPeriod: period,
        feature:       feature as never,
        interactionCount: { gt: 0 },
      },
      data: { interactionCount: { decrement: 1 } },
    })
  } catch { /* non-critical */ }
}
