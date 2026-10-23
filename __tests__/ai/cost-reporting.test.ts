import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateAiUsageReport } from '../../lib/ai/cost-reporting'
import { Prisma, AiFeature } from '@prisma/client'

// ── Mock DB ───────────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiRequestLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    userSubscription: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}))

import { prisma } from '@/lib/prisma'
const mockFindMany = vi.mocked(prisma.aiRequestLog.findMany)
const mockSubCount = vi.mocked(prisma.userSubscription.count)

const TODAY = new Date('2026-10-23T10:00:00Z')

function makeLog(overrides: {
  userId?: string
  feature?: string
  operationType?: string
  model?: string
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  audioBytes?: number | null
  estimatedCostUsd?: string | null
  pricingStatus?: string
  profile?: { subscription: { tier: string; status: string } | null }
  createdAt?: Date
}) {
  const raw = {
    id: 'test-id',
    userId: 'user-a',
    billingPeriod: '2026-10',
    feature: 'coach_message',
    operationType: 'chat_intake',
    model: 'gpt-4o-mini',
    inputTokens: 10_000,
    outputTokens: 500,
    cachedInputTokens: 0,
    audioBytes: null,
    estimatedCostUsd: '0.001800',
    pricingStatus: 'confirmed',
    profile: { subscription: { tier: 'plus', status: 'active' } },
    createdAt: TODAY,
    ...overrides,
  }
  return {
    ...raw,
    feature: raw.feature as AiFeature,
    estimatedCostUsd: raw.estimatedCostUsd !== null ? new Prisma.Decimal(raw.estimatedCostUsd) : null,
  }
}

beforeEach(() => {
  mockFindMany.mockResolvedValue([])
  mockSubCount.mockResolvedValue(0)
})

describe('generateAiUsageReport — empty period', () => {
  it('returns zeros for an empty period', async () => {
    const report = await generateAiUsageReport('2026-11')
    expect(report.totalRequests).toBe(0)
    expect(report.totalInputTokens).toBe(0)
    expect(report.totalEstimatedCostUsd).toBe(0)
    expect(report.byFeature).toHaveLength(0)
    expect(report.byModel).toHaveLength(0)
  })
})

describe('generateAiUsageReport — single user, known pricing', () => {
  beforeEach(() => {
    mockFindMany.mockResolvedValue([
      makeLog({ inputTokens: 10_000, outputTokens: 500, estimatedCostUsd: '0.001800', pricingStatus: 'confirmed', model: 'gpt-4o-mini' }),
      makeLog({ inputTokens: 8_000,  outputTokens: 300, estimatedCostUsd: '0.001400', pricingStatus: 'confirmed', model: 'gpt-4o-mini', operationType: 'chat_prose' }),
    ])
    mockSubCount.mockResolvedValue(1)
  })

  it('aggregates total token counts', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.totalRequests).toBe(2)
    expect(report.totalInputTokens).toBe(18_000)
    expect(report.totalOutputTokens).toBe(800)
  })

  it('sums estimated costs', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.totalEstimatedCostUsd).toBeCloseTo(0.003200, 6)
  })

  it('groups by feature correctly', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.byFeature).toHaveLength(1)
    expect(report.byFeature[0].feature).toBe('coach_message')
    expect(report.byFeature[0].requestCount).toBe(2)
  })

  it('groups by model correctly', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.byModel).toHaveLength(1)
    expect(report.byModel[0].model).toBe('gpt-4o-mini')
  })

  it('computes estimated cost per subscriber', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.activeSubscriberCount).toBe(1)
    expect(report.estimatedCostPerSubscriberUsd).toBeCloseTo(0.003200, 6)
  })

  it('reserve utilization is < 1%', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.reserveUtilizationPercent).not.toBeNull()
    expect(report.reserveUtilizationPercent!).toBeLessThan(1)
  })
})

describe('generateAiUsageReport — unknown model pricing', () => {
  beforeEach(() => {
    mockFindMany.mockResolvedValue([
      makeLog({ model: 'gpt-4o-mini', estimatedCostUsd: '0.001800', pricingStatus: 'confirmed' }),
      makeLog({ model: 'gpt-6-luna',  estimatedCostUsd: null,       pricingStatus: 'unknown',  operationType: 'program_draft' }),
      makeLog({ model: 'gpt-6-sol',   estimatedCostUsd: null,       pricingStatus: 'unknown',  operationType: 'quality_escalation' }),
    ])
    mockSubCount.mockResolvedValue(1)
  })

  it('sets hasUnknownPricing=true when any model is unknown', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.hasUnknownPricing).toBe(true)
  })

  it('sets totalEstimatedCostUsd=null when pricing is unknown', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.totalEstimatedCostUsd).toBeNull()
  })

  it('still tracks token counts for unknown-priced models', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.totalRequests).toBe(3)
    expect(report.totalInputTokens).toBe(30_000) // 3 × 10_000
  })

  it('marks gpt-6-luna model row as unknown pricing', async () => {
    const report = await generateAiUsageReport('2026-10')
    const lunaRow = report.byModel.find(m => m.model === 'gpt-6-luna')
    expect(lunaRow).toBeDefined()
    expect(lunaRow!.pricingStatus).toBe('unknown')
    expect(lunaRow!.estimatedCostUsd).toBeNull()
  })

  it('includes billingNote describing the limitation', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.billingNote).toContain('gpt-6-luna')
    expect(report.billingNote).toContain('gpt-6-sol')
  })
})

describe('generateAiUsageReport — cross-user isolation', () => {
  beforeEach(() => {
    mockFindMany.mockResolvedValue([
      makeLog({ userId: 'user-a', inputTokens: 10_000, estimatedCostUsd: '0.001500', profile: { subscription: { tier: 'plus', status: 'active' } } }),
      makeLog({ userId: 'user-b', inputTokens: 50_000, estimatedCostUsd: '0.007500', profile: { subscription: { tier: 'free',  status: 'active' } } }),
      makeLog({ userId: 'user-a', inputTokens:  5_000, estimatedCostUsd: '0.000750', profile: { subscription: { tier: 'plus', status: 'active' } } }),
    ])
    mockSubCount.mockResolvedValue(1)
  })

  it('groups each user independently', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.byUser).toHaveLength(2)
  })

  it('does not mix token counts between users', async () => {
    const report = await generateAiUsageReport('2026-10')
    const a = report.byUser.find(u => u.userId === 'user-a')!
    const b = report.byUser.find(u => u.userId === 'user-b')!
    expect(a.inputTokens).toBe(15_000)
    expect(b.inputTokens).toBe(50_000)
  })

  it('assigns subscription tier per user', async () => {
    const report = await generateAiUsageReport('2026-10')
    const a = report.byUser.find(u => u.userId === 'user-a')!
    expect(a.subscriptionTier).toBe('plus')
  })
})

describe('generateAiUsageReport — audio logs', () => {
  beforeEach(() => {
    mockFindMany.mockResolvedValue([
      makeLog({
        feature: 'voice_transcription',
        operationType: 'voice_transcription',
        model: 'whisper-1',
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        audioBytes: 48_000,
        estimatedCostUsd: null,
        pricingStatus: 'confirmed',
      }),
    ])
    mockSubCount.mockResolvedValue(0)
  })

  it('accumulates audioBytes', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.totalAudioBytes).toBe(48_000)
  })

  it('counts voice_transcription as a request', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.totalRequests).toBe(1)
  })

  it('groups whisper-1 under byModel', async () => {
    const report = await generateAiUsageReport('2026-10')
    const row = report.byModel.find(m => m.model === 'whisper-1')
    expect(row).toBeDefined()
    expect(row!.audioBytes).toBe(48_000)
  })
})

describe('generateAiUsageReport — expensive operations flag', () => {
  beforeEach(() => {
    mockFindMany.mockResolvedValue([
      makeLog({ estimatedCostUsd: '0.001', pricingStatus: 'confirmed', operationType: 'chat_intake' }),
      makeLog({ estimatedCostUsd: '0.050', pricingStatus: 'confirmed', operationType: 'photo_analysis',  model: 'gpt-4o', feature: 'meal_photo' }),
      makeLog({ estimatedCostUsd: '0.200', pricingStatus: 'confirmed', operationType: 'workout_generation', model: 'gpt-4o', feature: 'workout_generation' }),
    ])
    mockSubCount.mockResolvedValue(1)
  })

  it('flags operations over $0.01 as expensive', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.expensiveOperations.length).toBeGreaterThanOrEqual(2)
    for (const op of report.expensiveOperations) {
      expect(op.estimatedCostUsd).toBeGreaterThan(0.01)
    }
  })

  it('sorts expensive operations descending by cost', async () => {
    const report = await generateAiUsageReport('2026-10')
    const costs = report.expensiveOperations.map(o => o.estimatedCostUsd)
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i - 1]).toBeGreaterThanOrEqual(costs[i])
    }
  })
})

describe('generateAiUsageReport — billing note and metadata', () => {
  it('includes generatedAt timestamp', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('includes billingPeriod in report', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.billingPeriod).toBe('2026-10')
  })

  it('billingNote mentions OpenAI dashboard', async () => {
    const report = await generateAiUsageReport('2026-10')
    expect(report.billingNote).toContain('platform.openai.com')
  })
})
