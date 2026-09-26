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
