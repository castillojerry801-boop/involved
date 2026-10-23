// AI model pricing catalog.
// All costs are estimates — NOT actual billed charges (OpenAI billing requires
// browser dashboard access; this API key lacks api.usage.read scope).
// Models not listed here have pricingStatus = "unknown" and no cost estimate.

export type PricingStatus = 'confirmed' | 'estimated' | 'unknown'

export interface TokenPricing {
  kind: 'token'
  /** USD per 1M input tokens */
  inputPer1M: number
  /** USD per 1M output tokens */
  outputPer1M: number
  /** USD per 1M cached input tokens (prompt cache discount) */
  cachedInputPer1M?: number
  status: PricingStatus
}

export interface AudioPricing {
  kind: 'audio'
  /** USD per second of audio */
  perSecond: number
  status: PricingStatus
}

export type ModelPricing = TokenPricing | AudioPricing

// Whisper: $0.006 / minute = $0.0001 / second
// gpt-4o: $2.50/$10.00 per 1M input/output (cached input: $1.25/1M) — confirmed
// gpt-4o-mini: $0.15/$0.60 per 1M (cached: $0.075/1M) — confirmed
// gpt-6-luna, gpt-6-sol: confirmed real models; pricing page returns 403 — UNKNOWN
const CATALOG: Record<string, ModelPricing> = {
  'gpt-4o': {
    kind: 'token',
    inputPer1M: 2.50,
    outputPer1M: 10.00,
    cachedInputPer1M: 1.25,
    status: 'confirmed',
  },
  'gpt-4o-mini': {
    kind: 'token',
    inputPer1M: 0.15,
    outputPer1M: 0.60,
    cachedInputPer1M: 0.075,
    status: 'confirmed',
  },
  'whisper-1': {
    kind: 'audio',
    perSecond: 0.006 / 60,
    status: 'confirmed',
  },
}

export function getModelPricing(model: string): ModelPricing | null {
  return CATALOG[model] ?? null
}

export interface TokenCostResult {
  estimatedCostUsd: number | null
  pricingStatus: PricingStatus
}

/**
 * Estimate the dollar cost of a text-model call.
 * Returns null cost when the model is not in the catalog.
 */
export function estimateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): TokenCostResult {
  const pricing = getModelPricing(model)
  if (!pricing || pricing.kind !== 'token') {
    return { estimatedCostUsd: null, pricingStatus: 'unknown' }
  }

  const effectiveInput = inputTokens - cachedInputTokens
  const inputCost  = (effectiveInput / 1_000_000) * pricing.inputPer1M
  const cachedCost = (cachedInputTokens / 1_000_000) * (pricing.cachedInputPer1M ?? pricing.inputPer1M)
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M

  return {
    estimatedCostUsd: inputCost + cachedCost + outputCost,
    pricingStatus: pricing.status,
  }
}

/**
 * Estimate the dollar cost of a Whisper transcription given audio file size.
 * We do not have exact duration from the API response, so we return null.
 * Callers should log audioBytes and leave estimatedCostUsd null for audio.
 */
export function estimateAudioCost(_model: string): TokenCostResult {
  // The Whisper transcription endpoint does not return a usage object with
  // duration seconds. Without exact duration we cannot compute cost.
  // File size alone is not a reliable proxy for duration.
  return { estimatedCostUsd: null, pricingStatus: 'confirmed' }
}

export const AI_MONTHLY_RESERVE_USD = 2.00
