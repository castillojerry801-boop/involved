// Model routing — all model names configurable via env vars.
// No model names are ever exposed to the client.

export const MODELS = {
  coach: {
    free: process.env.AI_MODEL_COACH_FREE ?? 'gpt-4o-mini',
    plus: process.env.AI_MODEL_COACH_PLUS ?? 'gpt-4o',
  },
  workout: {
    free: process.env.AI_MODEL_WORKOUT_FREE ?? 'gpt-4o-mini',
    plus: process.env.AI_MODEL_WORKOUT_PLUS ?? 'gpt-4o',
  },
  vision: {
    default: process.env.AI_MODEL_VISION ?? 'gpt-4o',
  },
  extraction: {
    default: process.env.AI_MODEL_EXTRACTION ?? 'gpt-4o-mini',
  },
  voice: {
    transcription: process.env.AI_MODEL_VOICE_TRANSCRIPTION ?? 'whisper-1',
    intent:        process.env.AI_MODEL_VOICE_INTENT        ?? 'gpt-4o-mini',
  },
} as const

// ── V Coach routing ───────────────────────────────────────────────────────────
// Cost-conscious split: a cheap model handles chat / intake / clarification /
// exercise-search orchestration; a stronger-but-still-low-cost model drafts the
// full structured multi-week program; the strongest model is used ONLY as the
// final recovery attempt when the program still has hard validation errors.
export const V_CHAT_MODEL       = process.env.AI_MODEL_V_CHAT       ?? 'gpt-4o-mini'
export const V_PROGRAM_MODEL    = process.env.AI_MODEL_V_PROGRAM    ?? 'gpt-6-luna'
export const V_ESCALATION_MODEL = process.env.AI_MODEL_V_ESCALATION ?? 'gpt-6-sol'

export const V_MODELS = {
  chat:       V_CHAT_MODEL,
  program:    V_PROGRAM_MODEL,
  escalation: V_ESCALATION_MODEL,
} as const

/**
 * Shallow config check — verifies each configured model ID is a plausible,
 * non-empty token. It cannot confirm the API actually serves the model (that
 * requires a live call), but it catches unset/whitespace/typo env values at
 * startup so a misconfiguration surfaces as a clear log line, not a user crash.
 */
export function validateModelConfig(models: Record<string, string> = V_MODELS): {
  ok: boolean
  issues: string[]
} {
  const issues: string[] = []
  for (const [stage, id] of Object.entries(models)) {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      issues.push(`Model for stage "${stage}" is empty or unset.`)
    } else if (/\s/.test(id)) {
      issues.push(`Model for stage "${stage}" ("${id}") contains whitespace — likely a malformed env value.`)
    }
  }
  return { ok: issues.length === 0, issues }
}

/**
 * Next-generation OpenAI models (gpt-5 / gpt-6 families and the o-series) renamed
 * `max_tokens` → `max_completion_tokens` and reject a custom `temperature`. Callers
 * must send the correct parameter shape per model instead of forwarding legacy
 * chat-model params.
 */
export function isNextGenModel(model: string): boolean {
  return /^(?:gpt-[56]|o[1-9])/i.test(model)
}

export interface ModelParamShape {
  max_tokens?: number
  max_completion_tokens?: number
  temperature?: number
  reasoning_effort?: 'none'
}

/**
 * Deterministic per-model request-parameter shape for /v1/chat/completions.
 *
 * - Legacy chat models (gpt-4o / gpt-4o-mini): max_tokens + temperature.
 * - Next-gen models (gpt-5 / gpt-6 families, o-series): max_completion_tokens,
 *   no custom temperature, and — when function tools are used — reasoning_effort
 *   'none'. gpt-6 models reject function tools on chat/completions otherwise
 *   ("Function tools with reasoning_effort are not supported … set
 *   reasoning_effort to 'none'"). This is a known condition, resolved directly
 *   rather than by trial-and-error mutation.
 */
export function buildModelParamShape(model: string, useTools: boolean, maxTokens: number): ModelParamShape {
  if (isNextGenModel(model)) {
    return {
      max_completion_tokens: maxTokens,
      ...(useTools ? { reasoning_effort: 'none' as const } : {}),
    }
  }
  return { max_tokens: maxTokens, temperature: 0.7 }
}

export interface OpenAIErrorInfo {
  status?: number
  code?: string
  type?: string
  param?: string
  message?: string
}

/** Normalize an unknown thrown value into the fields the OpenAI SDK exposes. */
export function describeOpenAIError(err: unknown): OpenAIErrorInfo {
  const e = err as {
    status?: number
    code?: string
    type?: string
    param?: string
    message?: string
    error?: { code?: string; type?: string; param?: string; message?: string }
  }
  return {
    status:  e?.status,
    code:    e?.code    ?? e?.error?.code,
    type:    e?.type    ?? e?.error?.type,
    param:   e?.param   ?? e?.error?.param,
    message: e?.message ?? e?.error?.message,
  }
}

/** True when the error means the requested model ID isn't available to the project. */
export function isModelNotFoundError(info: OpenAIErrorInfo): boolean {
  if (info.status === 404) return true
  const code = (info.code ?? '').toLowerCase()
  const msg = (info.message ?? '').toLowerCase()
  return (
    code === 'model_not_found' ||
    /model.*(does not exist|not found|is not available|unknown)/.test(msg) ||
    /the model `[^`]+` does not exist/.test(msg)
  )
}

/** True when the error means a request parameter is invalid for that model. */
export function isUnsupportedParamError(info: OpenAIErrorInfo): boolean {
  if (info.status !== 400) return false
  const msg = (info.message ?? '').toLowerCase()
  return (
    !!info.param ||
    /unsupported|not supported|unknown parameter|invalid.*(parameter|value)|max_tokens|max_completion_tokens|temperature/.test(msg)
  )
}

export type SubscriptionTier = 'free' | 'plus'

export function coachModel(tier: SubscriptionTier): string {
  return MODELS.coach[tier]
}

export function workoutModel(tier: SubscriptionTier): string {
  return MODELS.workout[tier]
}
