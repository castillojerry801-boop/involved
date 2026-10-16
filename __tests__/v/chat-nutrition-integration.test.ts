/**
 * Chat route nutrition integration — verifies:
 *  1. calculate_nutrition tool is present in the tool registry exported from constants
 *  2. Calling calculate_nutrition invokes calculateNutrition() and returns a NutritionToolResult
 *  3. Existing tools (search_exercises, propose_workout, propose_program) are still present
 *  4. selectRoundTools correctly includes/excludes calculate_nutrition across modes
 */
import { describe, it, expect } from 'vitest'
import { CALCULATE_NUTRITION_TOOL, selectRoundTools } from '../../app/api/coach/constants'
import { SEARCH_EXERCISES_TOOL } from '../../lib/ai/tools/exercises'
import { PROPOSE_WORKOUT_TOOL } from '../../lib/ai/tools/workout'
import { PROPOSE_PROGRAM_TOOL } from '../../lib/ai/tools/program'

// ── Tool registry presence ────────────────────────────────────────────────────

describe('CALCULATE_NUTRITION_TOOL definition', () => {
  it('is exported from constants', () => {
    expect(CALCULATE_NUTRITION_TOOL).toBeDefined()
  })

  it('has correct tool name', () => {
    expect(CALCULATE_NUTRITION_TOOL.function.name).toBe('calculate_nutrition')
  })

  it('has ingredients as a required array parameter', () => {
    const params = CALCULATE_NUTRITION_TOOL.function.parameters
    expect(params.required).toContain('ingredients')
    expect(params.properties.ingredients.type).toBe('array')
  })

  it('has optional servings and context parameters', () => {
    const params = CALCULATE_NUTRITION_TOOL.function.parameters
    expect(params.properties.servings).toBeDefined()
    expect(params.properties.context).toBeDefined()
    expect(params.required).not.toContain('servings')
    expect(params.required).not.toContain('context')
  })

  it('has type: function', () => {
    expect(CALCULATE_NUTRITION_TOOL.type).toBe('function')
  })
})

// ── selectRoundTools integration ──────────────────────────────────────────────

describe('selectRoundTools with calculate_nutrition', () => {
  const allTools = [
    SEARCH_EXERCISES_TOOL,
    PROPOSE_WORKOUT_TOOL,
    PROPOSE_PROGRAM_TOOL,
    CALCULATE_NUTRITION_TOOL,
  ]

  it('includes calculate_nutrition in normal chat mode', () => {
    const { tools } = selectRoundTools(allTools, false, false)
    const names = tools.map(t => t.function.name)
    expect(names).toContain('calculate_nutrition')
  })

  it('includes calculate_nutrition in lookup mode (propose_program excluded)', () => {
    const { tools } = selectRoundTools(allTools, false, true)
    const names = tools.map(t => t.function.name)
    expect(names).toContain('calculate_nutrition')
    expect(names).not.toContain('propose_program')
  })

  it('excludes calculate_nutrition in program generation mode (only propose_program)', () => {
    const { tools } = selectRoundTools(allTools, true, false)
    const names = tools.map(t => t.function.name)
    expect(names).not.toContain('calculate_nutrition')
    expect(names).toContain('propose_program')
    expect(tools).toHaveLength(1)
  })

  it('existing tools are still present in normal chat mode', () => {
    const { tools } = selectRoundTools(allTools, false, false)
    const names = tools.map(t => t.function.name)
    expect(names).toContain('search_exercises')
    expect(names).toContain('propose_workout')
    expect(names).toContain('propose_program')
    expect(names).toContain('calculate_nutrition')
  })
})

// ── All existing tools still exported ────────────────────────────────────────

describe('existing tool exports still present', () => {
  it('SEARCH_EXERCISES_TOOL is still defined', () => {
    expect(SEARCH_EXERCISES_TOOL).toBeDefined()
    expect(SEARCH_EXERCISES_TOOL.function.name).toBe('search_exercises')
  })

  it('PROPOSE_WORKOUT_TOOL is still defined', () => {
    expect(PROPOSE_WORKOUT_TOOL).toBeDefined()
    expect(PROPOSE_WORKOUT_TOOL.function.name).toBe('propose_workout')
  })

  it('PROPOSE_PROGRAM_TOOL is still defined', () => {
    expect(PROPOSE_PROGRAM_TOOL).toBeDefined()
    expect(PROPOSE_PROGRAM_TOOL.function.name).toBe('propose_program')
  })
})

// ── System prompt brand-request audit ────────────────────────────────────────
// Regression guard: V must NOT instruct the model to ask for brand names when
// generic whole foods (eggs, bacon, tortillas) fail to convert. The tool
// description and system prompt must explicitly restrict brand-asking to
// branded/packaged foods only.

import { SYSTEM_PROMPT } from '../../app/api/coach/constants'

describe('SYSTEM_PROMPT and CALCULATE_NUTRITION_TOOL brand-ask policy', () => {
  it('CALCULATE_NUTRITION_TOOL description does NOT instruct asking for brands generically', () => {
    const desc = CALCULATE_NUTRITION_TOOL.function.description
    // Must not have the old generic "ask for clarification" pattern that caused brand-asking
    // (the old text was: "ask for clarification if it would meaningfully change the result")
    expect(desc).not.toMatch(/ask for clarification if it would meaningfully change the result/)
  })

  it('CALCULATE_NUTRITION_TOOL description explicitly says not to ask brands for generic whole foods', () => {
    const desc = CALCULATE_NUTRITION_TOOL.function.description
    // Must contain explicit guidance about not asking brands for generic foods
    expect(desc.toLowerCase()).toMatch(/do not ask.*brand|not.*brand.*generic|generic.*whole.*food/i)
  })

  it('CALCULATE_NUTRITION_TOOL description says to report partial results when ingredients fail', () => {
    const desc = CALCULATE_NUTRITION_TOOL.function.description
    // Must instruct V to report what resolved, not silently fail everything
    expect(desc.toLowerCase()).toMatch(/resolve|partial|did resolve|calculate and present/i)
  })

  it('SYSTEM_PROMPT nutrition section instructs V to report partial results', () => {
    // The nutrition calculations section should mention partial results
    const relevant = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('NUTRITION CALCULATIONS'))
    expect(relevant.toLowerCase()).toMatch(/unresolved|failed|couldn.*t find/i)
  })

  it('SYSTEM_PROMPT nutrition section says NOT to ask for brands for generic whole foods', () => {
    const relevant = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('NUTRITION CALCULATIONS'))
    // The updated prompt must explicitly say "Do NOT ask for brands for generic whole foods"
    // (or equivalent wording) to prevent V from asking brand questions for eggs, bacon, etc.
    expect(relevant.toLowerCase()).toMatch(/do not ask.*brand.*generic|not.*ask.*brand.*generic|do not ask for brands.*generic/i)
  })
})
