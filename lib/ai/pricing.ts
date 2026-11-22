// AI model pricing catalog.
// All costs are estimates — NOT actual billed charges (OpenAI billing requires
// browser dashboard access; this API key lacks api.usage.read scope).
// Models not listed here have pricingStatus = "unknown" and no cost estimate.

export type PricingStatus = 'confirmed' | 'estimated' | 'unknown'

export interface TokenPricing {
  kind: 'token'
  /** USD per 1M input tokens (short-context tier, or the only tier if longContext absent) */
  inputPer1M: number
  /** USD per 1M output tokens */
  outputPer1M: number
  /** USD per 1M cached input tokens (prompt cache discount) */
  cachedInputPer1M?: number
  /**
   * When present, requests whose inputTokens exceed thresholdInputTokens use these
   * rates instead. Requests at or below the threshold use the base rates above.
   */
  longContext?: {
    thresholdInputTokens: number
    inputPer1M: number
    outputPer1M: number
    cachedInputPer1M?: number
  }
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
// gpt-6-luna: short ctx ≤272K: $0.10/$0.50 per 1M in/out (cached: $0.01/1M) — confirmed 2026-11-21
//             long ctx  >272K: $0.20/$0.75 per 1M in/out (cached: $0.02/1M)
// gpt-6-sol:  short ctx ≤272K: $2.00/$10.00 per 1M in/out (cached: $0.20/1M) — confirmed 2026-11-21
//             long ctx  >272K: $4.00/$15.00 per 1M in/out (cached: $0.40/1M)
// Source: developers.openai.com/api/docs/pricing (Standard tier, Chat Completions)
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
  'gpt-6-luna': {
    kind: 'token',
    inputPer1M: 0.10,
    outputPer1M: 0.50,
    cachedInputPer1M: 0.01,
    longContext: {
      thresholdInputTokens: 272_000,
      inputPer1M: 0.20,
      outputPer1M: 0.75,
      cachedInputPer1M: 0.02,
    },
    status: 'confirmed',
  },
  'gpt-6-sol': {
    kind: 'token',
    inputPer1M: 2.00,
    outputPer1M: 10.00,
    cachedInputPer1M: 0.20,
    longContext: {
      thresholdInputTokens: 272_000,
      inputPer1M: 4.00,
      outputPer1M: 15.00,
      cachedInputPer1M: 0.40,
    },
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

  // Select the correct context tier — long context applies when inputTokens exceeds the threshold.
  const useLongContext = pricing.longContext != null && inputTokens > pricing.longContext.thresholdInputTokens
  const inputPer1M = useLongContext ? pricing.longContext!.inputPer1M : pricing.inputPer1M
  const outputPer1M = useLongContext ? pricing.longContext!.outputPer1M : pricing.outputPer1M
  const cachedPer1M = useLongContext
    ? (pricing.longContext!.cachedInputPer1M ?? pricing.longContext!.inputPer1M)
    : (pricing.cachedInputPer1M ?? pricing.inputPer1M)

  const effectiveInput = inputTokens - cachedInputTokens
  const inputCost  = (effectiveInput / 1_000_000) * inputPer1M
  const cachedCost = (cachedInputTokens / 1_000_000) * cachedPer1M
  const outputCost = (outputTokens / 1_000_000) * outputPer1M

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
