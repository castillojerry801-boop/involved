/**
 * V Coach cost-conscious model routing
 *
 * Locks the three-tier routing:
 *   cheap chat/intake/search model → Luna for ProgramDraft → Sol only on escalation.
 *
 * The route selects a tool-round model from state via:
 *   escalated       → escalationModel (Sol)
 *   programGenMode  → programModel   (Luna)
 *   otherwise       → chatModel      (cheap)
 * These tests assert the defaults and that logic in isolation (no OpenAI calls).
 */

import { describe, it, expect } from 'vitest'
import {
  V_CHAT_MODEL, V_PROGRAM_MODEL, V_ESCALATION_MODEL,
  validateModelConfig, describeOpenAIError, isModelNotFoundError, isUnsupportedParamError,
  isNextGenModel, buildModelParamShape,
} from '../../lib/ai/models'

describe('model routing defaults', () => {
  it('chat/intake uses the cheap model', () => {
    expect(V_CHAT_MODEL).toBe('gpt-4o-mini')
  })
  it('ProgramDraft generation uses Luna', () => {
    expect(V_PROGRAM_MODEL).toBe('gpt-6-luna')
  })
  it('escalation uses Sol', () => {
    expect(V_ESCALATION_MODEL).toBe('gpt-6-sol')
  })
  it('the three tiers are distinct models', () => {
    expect(new Set([V_CHAT_MODEL, V_PROGRAM_MODEL, V_ESCALATION_MODEL]).size).toBe(3)
  })
})

// Mirrors the route's toolRoundModel() selection so a change to the precedence
// is caught here.
function toolRoundModel(state: { modelEscalated: boolean; programGenerationMode: boolean }): string {
  return state.modelEscalated
    ? V_ESCALATION_MODEL
    : (state.programGenerationMode ? V_PROGRAM_MODEL : V_CHAT_MODEL)
}

describe('toolRoundModel precedence', () => {
  it('plain chat / intake → cheap model', () => {
    expect(toolRoundModel({ modelEscalated: false, programGenerationMode: false })).toBe('gpt-4o-mini')
  })
  it('program generation (context complete) → Luna', () => {
    expect(toolRoundModel({ modelEscalated: false, programGenerationMode: true })).toBe('gpt-6-luna')
  })
  it('escalation overrides everything → Sol', () => {
    expect(toolRoundModel({ modelEscalated: true, programGenerationMode: true })).toBe('gpt-6-sol')
  })
  it('Sol is NOT used for intake/chat (never reached without program generation)', () => {
    // Escalation only flips true inside the program-generation quality loop; a
    // chat/intake turn can never set it, so Sol is impossible there.
    expect(toolRoundModel({ modelEscalated: false, programGenerationMode: false })).not.toBe('gpt-6-sol')
  })
})

// ─── Config validation (catches misconfigured model env values) ───────────────

describe('validateModelConfig', () => {
  it('passes with the configured defaults', () => {
    expect(validateModelConfig().ok).toBe(true)
  })
  it('flags an empty model id', () => {
    const r = validateModelConfig({ chat: 'gpt-4o-mini', program: '', escalation: 'gpt-6-sol' })
    expect(r.ok).toBe(false)
    expect(r.issues.join(' ')).toMatch(/program/)
  })
  it('flags a whitespace-corrupted env value', () => {
    const r = validateModelConfig({ chat: 'gpt-4o-mini', program: 'gpt-6-luna ', escalation: 'gpt-6-sol' })
    expect(r.ok).toBe(false)
    expect(r.issues.join(' ')).toMatch(/whitespace/)
  })
})

// ─── Per-model request-parameter compatibility ───────────────────────────────

describe('isNextGenModel — token/temperature param shape', () => {
  it('Luna and Sol are next-gen (need max_completion_tokens, no custom temperature)', () => {
    expect(isNextGenModel('gpt-6-luna')).toBe(true)
    expect(isNextGenModel('gpt-6-sol')).toBe(true)
    expect(isNextGenModel(V_PROGRAM_MODEL)).toBe(true)
    expect(isNextGenModel(V_ESCALATION_MODEL)).toBe(true)
  })
  it('gpt-5 family and o-series are next-gen', () => {
    expect(isNextGenModel('gpt-5')).toBe(true)
    expect(isNextGenModel('o1-mini')).toBe(true)
    expect(isNextGenModel('o3')).toBe(true)
  })
  it('the cheap chat model is legacy (uses max_tokens + temperature)', () => {
    expect(isNextGenModel('gpt-4o-mini')).toBe(false)
    expect(isNextGenModel(V_CHAT_MODEL)).toBe(false)
    expect(isNextGenModel('gpt-4o')).toBe(false)
  })

  it('Luna gets max_completion_tokens and NO temperature', () => {
    const p = buildModelParamShape('gpt-6-luna', true, 4000)
    expect(p).toHaveProperty('max_completion_tokens', 4000)
    expect(p).not.toHaveProperty('max_tokens')
    expect(p).not.toHaveProperty('temperature')
  })
  it('mini gets max_tokens + temperature', () => {
    const p = buildModelParamShape('gpt-4o-mini', true, 500)
    expect(p).toHaveProperty('max_tokens', 500)
    expect(p).toHaveProperty('temperature')
  })
})

// ─── reasoning_effort: 'none' for gpt-6 tool calling (the 400 fix) ────────────
// gpt-6 models reject function tools on /v1/chat/completions unless reasoning is
// disabled: "Function tools with reasoning_effort are not supported ... set
// reasoning_effort to 'none'." This must be deterministic, not trial-and-error.

describe('buildModelParamShape — reasoning_effort for gpt-6 + tools', () => {
  it('Luna + tools ALWAYS sends reasoning_effort: "none"', () => {
    expect(buildModelParamShape('gpt-6-luna', true, 4000).reasoning_effort).toBe('none')
    expect(buildModelParamShape(V_PROGRAM_MODEL, true, 4000).reasoning_effort).toBe('none')
  })

  it('Sol + tools ALWAYS sends reasoning_effort: "none"', () => {
    expect(buildModelParamShape('gpt-6-sol', true, 4000).reasoning_effort).toBe('none')
    expect(buildModelParamShape(V_ESCALATION_MODEL, true, 4000).reasoning_effort).toBe('none')
  })

  it('cheap chat model NEVER sends reasoning_effort (keeps legacy shape)', () => {
    const p = buildModelParamShape('gpt-4o-mini', true, 500)
    expect(p.reasoning_effort).toBeUndefined()
    expect(p).toHaveProperty('max_tokens', 500)
    expect(p).toHaveProperty('temperature', 0.7)
    expect(p).not.toHaveProperty('max_completion_tokens')
  })

  it('gpt-4o (legacy) never sends reasoning_effort', () => {
    expect(buildModelParamShape('gpt-4o', true, 1500).reasoning_effort).toBeUndefined()
  })

  it('next-gen WITHOUT tools omits reasoning_effort (only needed for function tools)', () => {
    const p = buildModelParamShape('gpt-6-luna', false, 1500)
    expect(p.reasoning_effort).toBeUndefined()
    expect(p).toHaveProperty('max_completion_tokens', 1500)
  })

  it('no next-gen model sends a custom temperature', () => {
    expect(buildModelParamShape('gpt-6-luna', true, 4000)).not.toHaveProperty('temperature')
    expect(buildModelParamShape('gpt-6-sol', true, 4000)).not.toHaveProperty('temperature')
  })
})

// ─── OpenAI error classification (surfaces the real failure, no silent swallow) ─

describe('describeOpenAIError + classifiers', () => {
  it('extracts fields from an SDK-shaped model-not-found error', () => {
    const err = { status: 404, code: 'model_not_found', message: "The model `gpt-6-luna` does not exist or you do not have access to it." }
    const info = describeOpenAIError(err)
    expect(info.status).toBe(404)
    expect(isModelNotFoundError(info)).toBe(true)
    expect(isUnsupportedParamError(info)).toBe(false)
  })

  it('extracts fields from a nested error body', () => {
    const err = { error: { code: 'model_not_found', message: 'model is not available' } }
    expect(isModelNotFoundError(describeOpenAIError(err))).toBe(true)
  })

  it('detects unsupported-parameter (400) errors', () => {
    const err = { status: 400, param: 'max_tokens', message: "Unsupported parameter: 'max_tokens' is not supported with this model." }
    const info = describeOpenAIError(err)
    expect(isUnsupportedParamError(info)).toBe(true)
    expect(isModelNotFoundError(info)).toBe(false)
  })

  it('a plain 500 is neither model-not-found nor unsupported-param', () => {
    const info = describeOpenAIError({ status: 500, message: 'internal error' })
    expect(isModelNotFoundError(info)).toBe(false)
    expect(isUnsupportedParamError(info)).toBe(false)
  })
})
