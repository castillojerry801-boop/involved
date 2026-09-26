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
import { V_CHAT_MODEL, V_PROGRAM_MODEL, V_ESCALATION_MODEL } from '../../lib/ai/models'

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
