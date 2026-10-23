import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildTokenLog, buildAudioLog, flushRequestLogs } from '../../lib/ai/request-logger'

// ── Mock DB ───────────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiRequestLog: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

import { prisma } from '@/lib/prisma'
const mockCreateMany = vi.mocked(prisma.aiRequestLog.createMany)

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateMany.mockResolvedValue({ count: 0 })
})

const USER_A = 'user-a-uuid'
const USER_B = 'user-b-uuid'

describe('buildTokenLog', () => {
  it('captures input and output tokens from API usage', () => {
    const log = buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', {
      prompt_tokens: 12_000,
      completion_tokens: 300,
      total_tokens: 12_300,
    })
    expect(log.inputTokens).toBe(12_000)
    expect(log.outputTokens).toBe(300)
    expect(log.model).toBe('gpt-4o-mini')
    expect(log.feature).toBe('coach_message')
    expect(log.operationType).toBe('chat_intake')
  })

  it('extracts cached input tokens from prompt_tokens_details', () => {
    const usage = {
      prompt_tokens: 15_000,
      completion_tokens: 500,
      total_tokens: 15_500,
      prompt_tokens_details: { cached_tokens: 8_000 },
    }
    const log = buildTokenLog(USER_A, 'coach_message', 'program_draft', 'gpt-6-luna', usage as never)
    expect(log.cachedInputTokens).toBe(8_000)
  })

  it('defaults cached tokens to 0 when not present in usage', () => {
    const log = buildTokenLog(USER_A, 'coach_message', 'chat_prose', 'gpt-4o-mini', {
      prompt_tokens: 5_000,
      completion_tokens: 200,
      total_tokens: 5_200,
    })
    expect(log.cachedInputTokens).toBe(0)
  })

  it('handles null usage gracefully (zeros all token counts)', () => {
    const log = buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', null)
    expect(log.inputTokens).toBe(0)
    expect(log.outputTokens).toBe(0)
    expect(log.cachedInputTokens).toBe(0)
  })

  it('handles undefined usage gracefully', () => {
    const log = buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', undefined)
    expect(log.inputTokens).toBe(0)
    expect(log.outputTokens).toBe(0)
  })

  it('computes estimated cost for gpt-4o-mini', () => {
    const log = buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      total_tokens: 2_000_000,
    })
    expect(log.estimatedCostUsd).not.toBeNull()
    expect(log.estimatedCostUsd!).toBeCloseTo(0.75, 4)
    expect(log.pricingStatus).toBe('confirmed')
  })

  it('sets cost to null and pricingStatus=unknown for gpt-6-luna', () => {
    const log = buildTokenLog(USER_A, 'coach_message', 'program_draft', 'gpt-6-luna', {
      prompt_tokens: 22_000,
      completion_tokens: 4_000,
      total_tokens: 26_000,
    })
    expect(log.estimatedCostUsd).toBeNull()
    expect(log.pricingStatus).toBe('unknown')
  })

  it('sets cost to null and pricingStatus=unknown for gpt-6-sol', () => {
    const log = buildTokenLog(USER_A, 'coach_message', 'quality_escalation', 'gpt-6-sol', {
      prompt_tokens: 30_000,
      completion_tokens: 4_000,
      total_tokens: 34_000,
    })
    expect(log.estimatedCostUsd).toBeNull()
    expect(log.pricingStatus).toBe('unknown')
  })

  it('does not include userId of another user (cross-user isolation)', () => {
    const logA = buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })
    const logB = buildTokenLog(USER_B, 'coach_message', 'chat_intake', 'gpt-4o-mini', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })
    expect(logA.userId).toBe(USER_A)
    expect(logB.userId).toBe(USER_B)
    expect(logA.userId).not.toBe(logB.userId)
  })

  it('sets audioBytes to null for text logs', () => {
    const log = buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })
    expect(log.audioBytes).toBeNull()
  })
})

describe('buildAudioLog — multi-round tool call scenario', () => {
  it('logs audio file bytes for whisper transcription', () => {
    const log = buildAudioLog(USER_A, 'voice_transcription', 'voice_transcription', 'whisper-1', 48_000)
    expect(log.audioBytes).toBe(48_000)
    expect(log.inputTokens).toBeNull()
    expect(log.outputTokens).toBeNull()
    expect(log.model).toBe('whisper-1')
  })

  it('sets token fields to null for audio logs', () => {
    const log = buildAudioLog(USER_A, 'voice_transcription', 'voice_transcription', 'whisper-1', 12_000)
    expect(log.inputTokens).toBeNull()
    expect(log.outputTokens).toBeNull()
    expect(log.cachedInputTokens).toBeNull()
  })

  it('sets estimatedCostUsd to null (duration unknown from API)', () => {
    const log = buildAudioLog(USER_A, 'voice_transcription', 'voice_transcription', 'whisper-1', 64_000)
    expect(log.estimatedCostUsd).toBeNull()
  })
})

describe('flushRequestLogs', () => {
  it('writes all accumulated entries to DB in a single createMany call', async () => {
    const entries = [
      buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
      buildTokenLog(USER_A, 'coach_message', 'program_draft', 'gpt-6-luna', { prompt_tokens: 20_000, completion_tokens: 4_000, total_tokens: 24_000 }),
      buildTokenLog(USER_A, 'coach_message', 'quality_escalation', 'gpt-6-sol', { prompt_tokens: 28_000, completion_tokens: 4_000, total_tokens: 32_000 }),
    ]
    await flushRequestLogs(entries)
    expect(mockCreateMany).toHaveBeenCalledOnce()
    const call = mockCreateMany.mock.calls[0]!
    const callArg = call[0] as { data: unknown[] }
    expect(callArg.data).toHaveLength(3)
  })

  it('does not call createMany when entries array is empty', async () => {
    await flushRequestLogs([])
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('never throws when DB write fails (fire-and-forget)', async () => {
    mockCreateMany.mockRejectedValueOnce(new Error('DB unavailable'))
    const entries = [
      buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
    ]
    await expect(flushRequestLogs(entries)).resolves.toBeUndefined()
  })

  it('includes correct fields in createMany payload', async () => {
    const entries = [
      buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', {
        prompt_tokens: 5_000,
        completion_tokens: 200,
        total_tokens: 5_200,
      }),
    ]
    await flushRequestLogs(entries)
    const callArg = mockCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }
    const data = callArg.data[0]!
    expect(data['userId']).toBe(USER_A)
    expect(data['feature']).toBe('coach_message')
    expect(data['operationType']).toBe('chat_intake')
    expect(data['model']).toBe('gpt-4o-mini')
    expect(data['inputTokens']).toBe(5_000)
    expect(data['outputTokens']).toBe(200)
  })

  it('preserves cross-user isolation — entries from different users are written separately', async () => {
    const entries = [
      buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
      buildTokenLog(USER_B, 'coach_message', 'chat_intake', 'gpt-4o-mini', { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }),
    ]
    await flushRequestLogs(entries)
    const callArg = mockCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }
    const userIds = callArg.data.map(r => r['userId'])
    expect(userIds).toContain(USER_A)
    expect(userIds).toContain(USER_B)
  })
})

describe('multi-round V coach token accounting', () => {
  it('accumulates tokens across 4 rounds (Luna x2 + Sol x2) without cross-contamination', () => {
    const rounds = [
      buildTokenLog(USER_A, 'coach_message', 'program_draft',               'gpt-6-luna', { prompt_tokens: 18_000, completion_tokens: 4_000, total_tokens: 22_000 }),
      buildTokenLog(USER_A, 'coach_message', 'program_correction',           'gpt-6-luna', { prompt_tokens: 22_000, completion_tokens: 4_000, total_tokens: 26_000 }),
      buildTokenLog(USER_A, 'coach_message', 'quality_escalation',           'gpt-6-sol',  { prompt_tokens: 26_000, completion_tokens: 4_000, total_tokens: 30_000 }),
      buildTokenLog(USER_A, 'coach_message', 'quality_escalation_correction','gpt-6-sol',  { prompt_tokens: 30_000, completion_tokens: 4_000, total_tokens: 34_000 }),
    ]
    const totalInput  = rounds.reduce((s, r) => s + (r.inputTokens ?? 0),  0)
    const totalOutput = rounds.reduce((s, r) => s + (r.outputTokens ?? 0), 0)
    expect(totalInput).toBe(96_000)
    expect(totalOutput).toBe(16_000)
    // All four rounds use unknown-priced models → cost should remain null
    for (const r of rounds) {
      expect(r.estimatedCostUsd).toBeNull()
      expect(r.pricingStatus).toBe('unknown')
    }
    // Operation types are distinct
    const opTypes = rounds.map(r => r.operationType)
    expect(new Set(opTypes).size).toBe(4)
  })

  it('correctly attributes chat_intake rounds to gpt-4o-mini (cheap model)', () => {
    const chatLog = buildTokenLog(USER_A, 'coach_message', 'chat_intake', 'gpt-4o-mini', {
      prompt_tokens: 12_000,
      completion_tokens: 150,
      total_tokens: 12_150,
    })
    expect(chatLog.model).toBe('gpt-4o-mini')
    expect(chatLog.estimatedCostUsd).not.toBeNull()
    // 12k input * $0.15/1M + 150 output * $0.60/1M
    const expected = (12_000 / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
    expect(chatLog.estimatedCostUsd!).toBeCloseTo(expected, 6)
  })
})
