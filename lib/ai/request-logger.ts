import 'server-only'
import { prisma } from '@/lib/prisma'
import { estimateTokenCost, estimateAudioCost } from './pricing'
import type { AiFeature } from '@prisma/client'
import type OpenAI from 'openai'

export type OperationType =
  | 'chat_intake'
  | 'program_draft'
  | 'program_correction'
  | 'quality_escalation'
  | 'quality_escalation_correction'
  | 'workout_generation'
  | 'workout_modification'
  | 'workout_shortening'
  | 'substitution'
  | 'voice_transcription'
  | 'voice_intent'
  | 'photo_analysis'
  | 'trainer_query'
  | 'chat_prose'

export interface PendingRequestLog {
  userId: string
  billingPeriod: string
  feature: AiFeature
  operationType: OperationType
  model: string
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  audioBytes: number | null
  estimatedCostUsd: number | null
  pricingStatus: string
}

function currentBillingPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Build a pending log entry from an OpenAI chat completion response.
 * Call once per API round — not once per conversation.
 * Never logs message content or prompt text.
 */
export function buildTokenLog(
  userId: string,
  feature: AiFeature,
  operationType: OperationType,
  model: string,
  usage: OpenAI.CompletionUsage | undefined | null,
): PendingRequestLog {
  const inputTokens = usage?.prompt_tokens ?? 0
  const outputTokens = usage?.completion_tokens ?? 0
  // prompt_tokens_details.cached_tokens is the OpenAI SDK field for cached input
  const cachedInputTokens =
    (usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)
      ?.prompt_tokens_details?.cached_tokens ?? 0

  const { estimatedCostUsd, pricingStatus } = estimateTokenCost(
    model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
  )

  return {
    userId,
    billingPeriod: currentBillingPeriod(),
    feature,
    operationType,
    model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    audioBytes: null,
    estimatedCostUsd,
    pricingStatus,
  }
}

/**
 * Build a pending log entry for an audio (Whisper) call.
 * audioBytes is logged as a size proxy; exact duration is unavailable from the API.
 */
export function buildAudioLog(
  userId: string,
  feature: AiFeature,
  operationType: OperationType,
  model: string,
  audioBytes: number,
): PendingRequestLog {
  const { estimatedCostUsd, pricingStatus } = estimateAudioCost(model)
  return {
    userId,
    billingPeriod: currentBillingPeriod(),
    feature,
    operationType,
    model,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    audioBytes,
    estimatedCostUsd,
    pricingStatus,
  }
}

/**
 * Flush a batch of pending log entries to the database.
 * Runs as fire-and-forget from the caller — errors are logged but never re-thrown
 * so a logging failure never interrupts the user request.
 */
export async function flushRequestLogs(entries: PendingRequestLog[]): Promise<void> {
  if (entries.length === 0) return
  try {
    await prisma.aiRequestLog.createMany({
      data: entries.map(e => ({
        userId:           e.userId,
        billingPeriod:    e.billingPeriod,
        feature:          e.feature,
        operationType:    e.operationType,
        model:            e.model,
        inputTokens:      e.inputTokens,
        outputTokens:     e.outputTokens,
        cachedInputTokens: e.cachedInputTokens,
        audioBytes:       e.audioBytes,
        estimatedCostUsd: e.estimatedCostUsd !== null ? String(e.estimatedCostUsd) : null,
        pricingStatus:    e.pricingStatus,
      })),
      skipDuplicates: false,
    })
  } catch (err) {
    // Non-critical — never surface to the user
    console.error('[ai-request-logger] flush failed', { count: entries.length, error: err instanceof Error ? err.message : err })
  }
}
