import 'server-only'
import { prisma } from '@/lib/prisma'
import { AI_MONTHLY_RESERVE_USD } from './pricing'
import type { Prisma } from '@prisma/client'

export interface FeatureSummary {
  feature: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  audioBytes: number
  estimatedCostUsd: number | null
  hasUnknownPricing: boolean
}

export interface ModelSummary {
  model: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  audioBytes: number
  estimatedCostUsd: number | null
  pricingStatus: string
}

export interface UserSummary {
  userId: string
  subscriptionTier: string | null
  requestCount: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number | null
  hasUnknownPricing: boolean
  percentOfReserve: number | null
}

export interface OperationSummary {
  operationType: string
  requestCount: number
  avgInputTokens: number
  avgOutputTokens: number
  estimatedCostUsd: number | null
  p95InputTokens: number
}

export interface AiUsageReport {
  billingPeriod: string
  generatedAt: string
  // Totals
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalAudioBytes: number
  totalEstimatedCostUsd: number | null
  hasUnknownPricing: boolean
  // Breakdowns
  byFeature: FeatureSummary[]
  byModel: ModelSummary[]
  byUser: UserSummary[]
  byOperation: OperationSummary[]
  // Subscriber economics
  activeSubscriberCount: number
  estimatedCostPerSubscriberUsd: number | null
  reserveUtilizationPercent: number | null
  // Flags
  expensiveOperations: Array<{
    userId: string
    operationType: string
    model: string
    inputTokens: number
    outputTokens: number
    estimatedCostUsd: number
    createdAt: string
  }>
  // Comparison reminder
  billingNote: string
}

function currentBillingPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function toNumber(v: Prisma.Decimal | null | undefined): number {
  if (v === null || v === undefined) return 0
  return parseFloat(v.toString())
}

export async function generateAiUsageReport(
  billingPeriod?: string,
): Promise<AiUsageReport> {
  const period = billingPeriod ?? currentBillingPeriod()

  const [logs, activeSubscriberCount] = await Promise.all([
    prisma.aiRequestLog.findMany({
      where: { billingPeriod: period },
      select: {
        userId: true,
        feature: true,
        operationType: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cachedInputTokens: true,
        audioBytes: true,
        estimatedCostUsd: true,
        pricingStatus: true,
        createdAt: true,
        profile: {
          select: {
            subscription: { select: { tier: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.userSubscription.count({
      where: {
        status: 'active',
        tier: { in: ['plus', 'trial', 'trainer'] },
      },
    }),
  ])

  // ── Totals ────────────────────────────────────────────────────────────────
  let totalRequests = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalAudioBytes = 0
  let totalEstimatedCost = 0
  let hasAnyUnknown = false

  for (const log of logs) {
    totalRequests++
    totalInputTokens += log.inputTokens ?? 0
    totalOutputTokens += log.outputTokens ?? 0
    totalAudioBytes += log.audioBytes ?? 0
    if (log.estimatedCostUsd !== null) {
      totalEstimatedCost += toNumber(log.estimatedCostUsd)
    } else if (log.pricingStatus === 'unknown') {
      hasAnyUnknown = true
    }
  }

  // ── By feature ────────────────────────────────────────────────────────────
  const featureMap = new Map<string, FeatureSummary>()
  for (const log of logs) {
    const key = log.feature
    if (!featureMap.has(key)) {
      featureMap.set(key, { feature: key, requestCount: 0, inputTokens: 0, outputTokens: 0, audioBytes: 0, estimatedCostUsd: 0, hasUnknownPricing: false })
    }
    const f = featureMap.get(key)!
    f.requestCount++
    f.inputTokens += log.inputTokens ?? 0
    f.outputTokens += log.outputTokens ?? 0
    f.audioBytes += log.audioBytes ?? 0
    if (log.estimatedCostUsd !== null) {
      f.estimatedCostUsd = (f.estimatedCostUsd ?? 0) + toNumber(log.estimatedCostUsd)
    } else if (log.pricingStatus === 'unknown') {
      f.hasUnknownPricing = true
      f.estimatedCostUsd = null
    }
  }

  // ── By model ──────────────────────────────────────────────────────────────
  const modelMap = new Map<string, ModelSummary>()
  for (const log of logs) {
    const key = log.model
    if (!modelMap.has(key)) {
      modelMap.set(key, { model: key, requestCount: 0, inputTokens: 0, outputTokens: 0, audioBytes: 0, estimatedCostUsd: 0, pricingStatus: log.pricingStatus })
    }
    const m = modelMap.get(key)!
    m.requestCount++
    m.inputTokens += log.inputTokens ?? 0
    m.outputTokens += log.outputTokens ?? 0
    m.audioBytes += log.audioBytes ?? 0
    if (log.estimatedCostUsd !== null) {
      m.estimatedCostUsd = (m.estimatedCostUsd ?? 0) + toNumber(log.estimatedCostUsd)
    } else if (log.pricingStatus === 'unknown') {
      m.pricingStatus = 'unknown'
      m.estimatedCostUsd = null
    }
  }

  // ── By user ───────────────────────────────────────────────────────────────
  const userMap = new Map<string, UserSummary>()
  for (const log of logs) {
    const uid = log.userId
    if (!userMap.has(uid)) {
      const tier = log.profile.subscription?.status === 'active'
        ? (log.profile.subscription.tier as string)
        : 'free'
      userMap.set(uid, {
        userId: uid,
        subscriptionTier: tier,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        hasUnknownPricing: false,
        percentOfReserve: null,
      })
    }
    const u = userMap.get(uid)!
    u.requestCount++
    u.inputTokens += log.inputTokens ?? 0
    u.outputTokens += log.outputTokens ?? 0
    if (log.estimatedCostUsd !== null) {
      u.estimatedCostUsd = (u.estimatedCostUsd ?? 0) + toNumber(log.estimatedCostUsd)
    } else if (log.pricingStatus === 'unknown') {
      u.hasUnknownPricing = true
    }
  }
  // Compute reserve utilization per user (only meaningful when cost is known)
  for (const u of userMap.values()) {
    if (u.estimatedCostUsd !== null && !u.hasUnknownPricing) {
      u.percentOfReserve = (u.estimatedCostUsd / AI_MONTHLY_RESERVE_USD) * 100
    }
  }

  // ── By operation type ─────────────────────────────────────────────────────
  const opMap = new Map<string, { count: number; inputSum: number; outputSum: number; costSum: number; inputSamples: number[] }>()
  for (const log of logs) {
    const key = log.operationType
    if (!opMap.has(key)) opMap.set(key, { count: 0, inputSum: 0, outputSum: 0, costSum: 0, inputSamples: [] })
    const op = opMap.get(key)!
    op.count++
    op.inputSum += log.inputTokens ?? 0
    op.outputSum += log.outputTokens ?? 0
    if (log.estimatedCostUsd !== null) op.costSum += toNumber(log.estimatedCostUsd)
    if (log.inputTokens !== null) op.inputSamples.push(log.inputTokens)
  }
  const byOperation: OperationSummary[] = [...opMap.entries()].map(([opType, v]) => {
    const sorted = [...v.inputSamples].sort((a, b) => a - b)
    const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] : 0
    return {
      operationType: opType,
      requestCount: v.count,
      avgInputTokens: v.count > 0 ? Math.round(v.inputSum / v.count) : 0,
      avgOutputTokens: v.count > 0 ? Math.round(v.outputSum / v.count) : 0,
      estimatedCostUsd: v.costSum > 0 ? v.costSum : null,
      p95InputTokens: p95,
    }
  })

  // ── Expensive operations (top 10 by cost) ─────────────────────────────────
  const expensiveOps = logs
    .filter(l => l.estimatedCostUsd !== null && toNumber(l.estimatedCostUsd) > 0.01)
    .sort((a, b) => toNumber(b.estimatedCostUsd!) - toNumber(a.estimatedCostUsd!))
    .slice(0, 10)
    .map(l => ({
      userId: l.userId,
      operationType: l.operationType,
      model: l.model,
      inputTokens: l.inputTokens ?? 0,
      outputTokens: l.outputTokens ?? 0,
      estimatedCostUsd: toNumber(l.estimatedCostUsd!),
      createdAt: l.createdAt.toISOString(),
    }))

  // ── Subscriber economics ──────────────────────────────────────────────────
  const totalCostKnown = !hasAnyUnknown && [...modelMap.values()].every(m => m.pricingStatus !== 'unknown' || m.requestCount === 0)
  const estimatedCostPerSub = (activeSubscriberCount > 0 && totalCostKnown)
    ? totalEstimatedCost / activeSubscriberCount
    : null
  const reserveUtil = estimatedCostPerSub !== null
    ? (estimatedCostPerSub / AI_MONTHLY_RESERVE_USD) * 100
    : null

  return {
    billingPeriod: period,
    generatedAt: new Date().toISOString(),
    totalRequests,
    totalInputTokens,
    totalOutputTokens,
    totalAudioBytes,
    totalEstimatedCostUsd: hasAnyUnknown ? null : totalEstimatedCost,
    hasUnknownPricing: hasAnyUnknown,
    byFeature: [...featureMap.values()].sort((a, b) => (b.estimatedCostUsd ?? 0) - (a.estimatedCostUsd ?? 0)),
    byModel: [...modelMap.values()].sort((a, b) => (b.estimatedCostUsd ?? 0) - (a.estimatedCostUsd ?? 0)),
    byUser: [...userMap.values()].sort((a, b) => (b.estimatedCostUsd ?? 0) - (a.estimatedCostUsd ?? 0)),
    byOperation: byOperation.sort((a, b) => (b.estimatedCostUsd ?? 0) - (a.estimatedCostUsd ?? 0)),
    activeSubscriberCount,
    estimatedCostPerSubscriberUsd: estimatedCostPerSub,
    reserveUtilizationPercent: reserveUtil,
    expensiveOperations: expensiveOps,
    billingNote:
      'Estimated costs are computed from public OpenAI pricing and may differ from actual billed amounts. ' +
      'Actual charges require the OpenAI dashboard (platform.openai.com → Usage). ' +
      'Models marked "unknown" (gpt-6-luna, gpt-6-sol) have no confirmed pricing — their token counts are tracked but cost is omitted.',
  }
}
