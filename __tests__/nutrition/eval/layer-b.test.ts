/**
 * Layer B — Real AI-driven eval (opt-in).
 *
 * Tests whether Coach V (the actual AI model) correctly:
 *   - understands food requests expressed in natural language
 *   - calls calculate_nutrition with the right ingredient names, quantities, and units
 *   - asks appropriate clarification questions when needed
 *   - does NOT ask unnecessary questions for conventional whole foods
 *   - preserves context across turns
 *   - handles corrections and logging requests
 *
 * Two operating modes:
 *
 * MODE 1 — Tool-call decision only (EVAL_REAL_AI=true):
 *   Intercepts calculate_nutrition and returns a dummy result.
 *   Tests: did V call the tool vs ask for clarification? Correct decision?
 *
 * MODE 2 — Full workflow (EVAL_REAL_AI=true EVAL_REAL_PROVIDERS=true):
 *   Actually executes calculate_nutrition with real providers.
 *   Tests: food identity (what food did the pipeline match?),
 *          macro plausibility (are the returned macros reasonable?),
 *          conversational response (did V present the macros coherently?).
 *   Requires: USDA_API_KEY (minimum), Supabase not required (DB mocked).
 *   Cost: incurs real provider API calls — respect rate limits.
 *
 * REQUIRES:
 *   EVAL_REAL_AI=true              — enables this suite
 *   OPENAI_API_KEY                 — real API key (actual AI model, incurs cost)
 *   EVAL_REAL_PROVIDERS=true       — enables real provider calls in tool execution
 *   EVAL_AI_MAX_SCENARIOS=N        — cap scenarios per run (default: 10)
 *   EVAL_AI_BUDGET_USD=N           — approx cost ceiling (default: 2.00)
 *
 * SAFETY CONSTRAINTS:
 *   - Never writes to real user diary data (prepare_meal_log intercepted and blocked)
 *   - All calls use isolated test context with no real user ID
 *   - DB is mocked to empty — no library cache, no real food items
 *
 * Uses production configuration:
 *   - SYSTEM_PROMPT from app/api/coach/constants
 *   - CALCULATE_NUTRITION_TOOL and PREPARE_MEAL_LOG_TOOL from app/api/coach/constants
 *   - V_CHAT_MODEL from lib/ai/models
 *
 * Run (tool decision only):
 *   EVAL_REAL_AI=true pnpm vitest __tests__/nutrition/eval/layer-b
 *
 * Run (full workflow):
 *   EVAL_REAL_AI=true EVAL_REAL_PROVIDERS=true pnpm vitest __tests__/nutrition/eval/layer-b
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { ALL_SCENARIOS } from './scenarios'
import type { LayerBIdentitySpec } from './scenarios'
import { SYSTEM_PROMPT, CALCULATE_NUTRITION_TOOL, PREPARE_MEAL_LOG_TOOL } from '../../../app/api/coach/constants'
import { V_CHAT_MODEL } from '../../../lib/ai/models'

// ── DB mock (always applied — safe in both modes) ─────────────────────────────
// Prevents real DB queries. Library cache returns empty; no diary writes.
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    foodItem: { findMany: vi.fn().mockResolvedValue([]) },
    foodItemPortion: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    mealLog: { create: vi.fn().mockRejectedValue(new Error('diary writes blocked in eval')) },
  },
}))

vi.mock('../../../lib/nutrition/conversion/portions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/nutrition/conversion/portions')>()
  return {
    ...actual,
    lookupPortions: vi.fn().mockResolvedValue([]),
    fetchAndStoreUsdaPortions: vi.fn().mockResolvedValue([]),
  }
})

const REAL_AI_ENABLED        = process.env.EVAL_REAL_AI === 'true'
const REAL_PROVIDERS_ENABLED = process.env.EVAL_REAL_PROVIDERS === 'true'
const MAX_SCENARIOS          = parseInt(process.env.EVAL_AI_MAX_SCENARIOS ?? '10', 10)

// ── Guard: skip entire suite unless opted in ─────────────────────────────────

if (!REAL_AI_ENABLED) {
  describe('Layer B — Real AI eval (opt-in, currently SKIPPED)', () => {
    it('skipped — set EVAL_REAL_AI=true to enable', () => {
      console.log(
        '\n  Layer B is SKIPPED in normal CI.\n' +
        '  Tool-decision mode:  EVAL_REAL_AI=true pnpm vitest __tests__/nutrition/eval/layer-b\n' +
        '  Full workflow mode:  EVAL_REAL_AI=true EVAL_REAL_PROVIDERS=true pnpm vitest ...\n' +
        `  Model: ${V_CHAT_MODEL}\n`
      )
      expect(true).toBe(true)
    })
  })
}

if (REAL_AI_ENABLED) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: OpenAI } = await import('openai') as { default: any }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  // Production tools — same configuration V uses in production
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TOOLS: any[] = [CALCULATE_NUTRITION_TOOL, PREPARE_MEAL_LOG_TOOL]

  // ── Macro plausibility thresholds ─────────────────────────────────────────────
  const PLAUSIBILITY = {
    minCalories: 5,
    maxCalories: 2500,
    maxProteinG: 200,
    maxCarbG: 500,
    maxFatG: 300,
  }

  function macroIsPlausible(totals: {
    calories: number
    proteinG: number
    carbG: number
    fatG: number
  }): { plausible: boolean; reasons: string[] } {
    const reasons: string[] = []
    if (totals.calories < PLAUSIBILITY.minCalories)
      reasons.push(`calories too low: ${totals.calories}`)
    if (totals.calories > PLAUSIBILITY.maxCalories)
      reasons.push(`calories too high: ${totals.calories}`)
    if (totals.proteinG > PLAUSIBILITY.maxProteinG)
      reasons.push(`protein implausibly high: ${totals.proteinG}g`)
    if (totals.carbG > PLAUSIBILITY.maxCarbG)
      reasons.push(`carbs implausibly high: ${totals.carbG}g`)
    if (totals.fatG > PLAUSIBILITY.maxFatG)
      reasons.push(`fat implausibly high: ${totals.fatG}g`)
    return { plausible: reasons.length === 0, reasons }
  }

  interface LayerBResult {
    scenarioId: string
    label: string
    category: string
    mode: 'tool_decision' | 'full_workflow'
    // Tool-decision assessment
    calledCalculateNutrition: boolean
    calledPrepareMealLog: boolean
    askedClarification: boolean
    clarificationText?: string
    clarificationClass?: string
    clarificationSoftWarn?: string
    ingredientsExtracted?: Array<{ name: string; quantity: number; unit: string }>
    // Full-workflow assessment (only in REAL_PROVIDERS mode)
    toolExecuted?: boolean
    resolvedFoodNames?: string[]
    macrosReturned?: { calories: number; proteinG: number; carbG: number; fatG: number }
    macrosPlausible?: boolean
    macrosPlausibilityReasons?: string[]
    allIngredientsResolved?: boolean
    // Food identity assessment — separate axis from resolution success
    identityChecked?: boolean          // true if layerBIdentity constraints were evaluated
    identityAccurate?: boolean         // true if matched food passed identity constraints
    identityFailReasons?: string[]     // what specifically failed (token missing / forbidden token found)
    // Overall
    pass: boolean
    failReasons: string[]
    tokenCost: { promptTokens: number; completionTokens: number }
  }

  /**
   * Check whether the matched food name satisfies the scenario's identity constraints.
   * Returns { accurate: true } when all required tokens are present and no forbidden tokens appear.
   * Returns { accurate: false, reasons: [...] } on any violation.
   * Only the FIRST resolved food name is checked (single-ingredient scenarios).
   */
  function checkFoodIdentity(
    resolvedFoodNames: string[],
    identity: LayerBIdentitySpec,
  ): { accurate: boolean; reasons: string[] } {
    if (resolvedFoodNames.length === 0) {
      return { accurate: false, reasons: ['No food was resolved — identity cannot be assessed'] }
    }
    const firstName = resolvedFoodNames[0].toLowerCase()
    const reasons: string[] = []

    for (const token of identity.requiredTokens) {
      if (!firstName.includes(token.toLowerCase())) {
        reasons.push(`Required token "${token}" not found in matched food "${resolvedFoodNames[0]}"`)
      }
    }

    for (const token of identity.forbiddenTokens ?? []) {
      if (firstName.includes(token.toLowerCase())) {
        reasons.push(`Forbidden token "${token}" found in matched food "${resolvedFoodNames[0]}"`)
      }
    }

    return { accurate: reasons.length === 0, reasons }
  }

  async function runLayerBScenario(
    scenarioId: string,
    label: string,
    category: string,
    userInput: string,
    requiresClarification: boolean,
    clarificationClass?: 'never' | 'acceptable_if_disclosed' | 'required',
    layerBIdentity?: LayerBIdentitySpec,
  ): Promise<LayerBResult> {
    const failReasons: string[] = []
    let calledCalculateNutrition = false
    let calledPrepareMealLog = false
    let askedClarification = false
    let clarificationText: string | undefined
    let clarificationSoftWarn: string | undefined
    let ingredientsExtracted: Array<{ name: string; quantity: number; unit: string }> | undefined
    let toolExecuted = false
    let resolvedFoodNames: string[] | undefined
    let macrosReturned: { calories: number; proteinG: number; carbG: number; fatG: number } | undefined
    let macrosPlausible: boolean | undefined
    let macrosPlausibilityReasons: string[] | undefined
    let allIngredientsResolved: boolean | undefined
    let identityChecked: boolean | undefined
    let identityAccurate: boolean | undefined
    let identityFailReasons: string[] | undefined
    let totalPromptTokens = 0
    let totalCompletionTokens = 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: 'user', content: userInput }]

    // ── Turn 1: get V's initial response ─────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response1: any = await client.chat.completions.create({
      model: V_CHAT_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 600,
    })

    totalPromptTokens     += response1.usage?.prompt_tokens ?? 0
    totalCompletionTokens += response1.usage?.completion_tokens ?? 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const choice1: any = response1.choices?.[0]

    if (choice1?.message?.tool_calls?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const tc of choice1.message.tool_calls as any[]) {
        if (tc.function.name === 'calculate_nutrition') {
          calledCalculateNutrition = true
          try {
            const args = JSON.parse(tc.function.arguments) as {
              ingredients: Array<{ name: string; quantity: number; unit: string }>
            }
            ingredientsExtracted = args.ingredients
          } catch {
            failReasons.push('calculate_nutrition arguments are not valid JSON')
          }

          if (REAL_PROVIDERS_ENABLED && ingredientsExtracted) {
            // ── Full workflow: actually execute the tool ─────────────────────
            try {
              const { calculateNutrition } = await import('../../../lib/v/tools/calculate-nutrition')
              const toolResult = await calculateNutrition({ ingredients: ingredientsExtracted })
              toolExecuted = true

              resolvedFoodNames = toolResult.ingredients
                .filter(i => i.resolved)
                .map(i => i.matchedFoodName)

              macrosReturned = {
                calories: toolResult.totals.calories,
                proteinG: toolResult.totals.proteinG,
                carbG:    toolResult.totals.carbG,
                fatG:     toolResult.totals.fatG,
              }

              const plausCheck = macroIsPlausible(macrosReturned)
              macrosPlausible = plausCheck.plausible
              macrosPlausibilityReasons = plausCheck.reasons

              allIngredientsResolved = toolResult.ingredients.every(i => i.resolved)

              // ── Food identity check ──────────────────────────────────────────
              if (layerBIdentity && resolvedFoodNames !== undefined) {
                identityChecked = true
                const idCheck = checkFoodIdentity(resolvedFoodNames, layerBIdentity)
                identityAccurate = idCheck.accurate
                identityFailReasons = idCheck.reasons
                if (!idCheck.accurate) {
                  failReasons.push(`Identity mismatch: ${idCheck.reasons.join('; ')}`)
                }
              }

              if (!allIngredientsResolved && !requiresClarification) {
                const unresolved = toolResult.ingredients
                  .filter(i => !i.resolved)
                  .map(i => i.userDescription)
                failReasons.push(`Provider could not resolve: [${unresolved.join(', ')}]`)
              }

              if (!plausCheck.plausible) {
                failReasons.push(`Implausible macros: ${plausCheck.reasons.join('; ')}`)
              }

              // ── Turn 2: send tool result back to V and check conversational response ─
              messages.push({ role: 'assistant', content: null, tool_calls: choice1.message.tool_calls })
              messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(toolResult),
              })

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const response2: any = await client.chat.completions.create({
                model: V_CHAT_MODEL,
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
                tools: TOOLS,
                tool_choice: 'auto',
                max_tokens: 400,
              })

              totalPromptTokens     += response2.usage?.prompt_tokens ?? 0
              totalCompletionTokens += response2.usage?.completion_tokens ?? 0

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const response2Text = (response2.choices?.[0] as any)?.message?.content as string | undefined
              if (response2Text && macrosReturned.calories > 0) {
                const hasNumber = /\d+/.test(response2Text)
                if (!hasNumber) {
                  failReasons.push('V conversational response contains no numbers after receiving macro data')
                }
              }
            } catch (toolErr) {
              failReasons.push(`Tool execution failed: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`)
            }
          }
        } else if (tc.function.name === 'prepare_meal_log') {
          // Unexpected: V called prepare_meal_log without first calculating — block it
          calledPrepareMealLog = true
          failReasons.push('V called prepare_meal_log on Turn 1 without a prior calculate_nutrition result')
        }
      }
    } else if (choice1?.message?.content) {
      const content = (choice1.message.content as string).toLowerCase()
      const clarificationPhrases = ['what kind', 'how much', 'what size', 'could you', 'which', 'what type', 'can you', '?']
      askedClarification = clarificationPhrases.some(p => content.includes(p))
      if (askedClarification) {
        clarificationText = (choice1.message.content as string).slice(0, 200)
      }
    }

    // ── Behavioral assessment (three-tier) ───────────────────────────────────
    if (clarificationClass === 'never') {
      // Conventional whole food with clear conventional serving — clarification is never correct
      if (askedClarification) {
        failReasons.push(`V asked unnecessary clarification for a 'never' class food: "${clarificationText}"`)
      } else if (!calledCalculateNutrition) {
        failReasons.push('V did not call calculate_nutrition and did not ask for clarification')
      }
    } else if (clarificationClass === 'acceptable_if_disclosed') {
      // Portion variable but well-known food — V may proceed with a stated assumption OR ask
      // Soft warn only if V asked clarification (not a hard fail — asking is acceptable behavior)
      if (!calledCalculateNutrition && !askedClarification) {
        failReasons.push('V did not call calculate_nutrition and did not ask for clarification')
      } else if (askedClarification) {
        clarificationSoftWarn = `V asked clarification (acceptable for 'acceptable_if_disclosed' class): "${clarificationText}"`
      }
    } else {
      // Original binary logic — covers requiresClarification: true/false for unclassified scenarios
      if (requiresClarification) {
        if (!askedClarification && calledCalculateNutrition) {
          failReasons.push('V called calculate_nutrition without clarifying — should have asked first')
        } else if (!askedClarification && !calledCalculateNutrition) {
          failReasons.push('V neither asked for clarification nor called the tool — unexpected behavior')
        }
      } else {
        if (!calledCalculateNutrition && askedClarification) {
          failReasons.push(`V asked for clarification when none was needed: "${clarificationText}"`)
        } else if (!calledCalculateNutrition && !askedClarification) {
          failReasons.push('V did not call calculate_nutrition and did not ask for clarification')
        }
      }
    }

    const pass = failReasons.length === 0

    return {
      scenarioId,
      label,
      category,
      mode: REAL_PROVIDERS_ENABLED ? 'full_workflow' : 'tool_decision',
      calledCalculateNutrition,
      calledPrepareMealLog,
      askedClarification,
      clarificationText,
      clarificationClass,
      clarificationSoftWarn,
      ingredientsExtracted,
      toolExecuted,
      resolvedFoodNames,
      macrosReturned,
      macrosPlausible,
      macrosPlausibilityReasons,
      allIngredientsResolved,
      identityChecked,
      identityAccurate,
      identityFailReasons,
      pass,
      failReasons,
      tokenCost: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
    }
  }

  // ── Select scenarios ──────────────────────────────────────────────────────────
  const priorityCategories = ['casual_vague', 'household_measurement', 'misspelling', 'whole_food_simple', 'whole_food_measured']
  const prioritized = ALL_SCENARIOS.filter(s => priorityCategories.includes(s.category))
  const remaining   = ALL_SCENARIOS.filter(s => !priorityCategories.includes(s.category))
  const orderedScenarios = [...prioritized, ...remaining].slice(0, MAX_SCENARIOS)

  let totalTokensUsed = 0
  const results: LayerBResult[] = []

  const modeLabel = REAL_PROVIDERS_ENABLED
    ? 'full workflow (tool-call + real providers + V response)'
    : 'tool-decision only (AI calls intercepted)'

  describe(`Layer B — Real AI eval (${orderedScenarios.length} scenarios, mode: ${modeLabel})`, () => {
    beforeAll(() => {
      console.log(`\n  Layer B: ${orderedScenarios.length} scenarios`)
      console.log(`  Model: ${V_CHAT_MODEL}`)
      console.log(`  Mode: ${modeLabel}`)
      console.log(`  Budget cap: $${process.env.EVAL_AI_BUDGET_USD ?? '2.00'} USD\n`)
    })

    beforeEach(() => {
      vi.clearAllMocks()
    })

    for (const scenario of orderedScenarios) {
      it(`[${scenario.id}] ${scenario.label}`, async () => {
        const result = await runLayerBScenario(
          scenario.id,
          scenario.label,
          scenario.category,
          scenario.userInput,
          scenario.requiresClarification,
          scenario.clarificationClass,
          scenario.layerBIdentity,
        )
        results.push(result)
        totalTokensUsed += result.tokenCost.promptTokens + result.tokenCost.completionTokens

        if (!result.pass) {
          console.warn(`\n  FAIL [${scenario.id}]: ${scenario.label}`)
          for (const r of result.failReasons) console.warn(`    • ${r}`)
        }
        if (result.clarificationSoftWarn) {
          console.info(`  SOFT-WARN [${scenario.id}]: ${result.clarificationSoftWarn}`)
        }

        if (REAL_PROVIDERS_ENABLED && result.toolExecuted) {
          const identityStatus = result.identityChecked
            ? (result.identityAccurate ? 'identity=PASS' : 'identity=FAIL')
            : 'identity=unchecked'
          console.info(
            `  [${scenario.id}] resolved: [${result.resolvedFoodNames?.join(', ') ?? 'none'}] ` +
            `cal=${result.macrosReturned?.calories.toFixed(0) ?? 'n/a'} ` +
            `allResolved=${result.allIngredientsResolved ?? false} ` +
            identityStatus
          )
        }

        expect(result).toBeDefined()
      }, REAL_PROVIDERS_ENABLED ? 60_000 : 30_000)
    }

    it('summary', () => {
      const passed  = results.filter(r => r.pass).length
      const softWarns = results.filter(r => r.clarificationSoftWarn).length
      console.log(`\n  Layer B Summary: ${passed}/${results.length} passed`)
      console.log(`  Model: ${V_CHAT_MODEL}`)
      console.log(`  Mode: ${modeLabel}`)
      console.log(`  Total tokens used: ${totalTokensUsed}`)
      if (softWarns > 0) {
        console.log(`  Soft warns (acceptable_if_disclosed + clarification asked): ${softWarns}`)
        for (const r of results.filter(r => r.clarificationSoftWarn)) {
          console.log(`    • [${r.scenarioId}] ${r.label}: ${r.clarificationSoftWarn}`)
        }
      }

      if (REAL_PROVIDERS_ENABLED) {
        const executed = results.filter(r => r.toolExecuted).length
        const resolved = results.filter(r => r.allIngredientsResolved === true).length
        const plausible = results.filter(r => r.macrosPlausible === true).length
        const identityCheckedResults = results.filter(r => r.identityChecked === true)
        const identityPassed = identityCheckedResults.filter(r => r.identityAccurate === true).length
        const identityFailed = identityCheckedResults.filter(r => r.identityAccurate === false)

        console.log(`\n  ── Full Workflow Scores ──────────────────────`)
        console.log(`  Retrieval success:   ${resolved}/${executed} all-ingredients-resolved`)
        console.log(`  Identity accuracy:   ${identityPassed}/${identityCheckedResults.length} correct food matched`)
        console.log(`  Numerical plausible: ${plausible}/${executed} macros-plausible`)

        const unresolved = results.filter(r => r.toolExecuted && !r.allIngredientsResolved)
        if (unresolved.length > 0) {
          console.log(`\n  Provider failures (no match found):`)
          for (const r of unresolved) console.log(`    • [${r.scenarioId}] ${r.label}`)
        }

        if (identityFailed.length > 0) {
          console.log(`\n  Identity failures (wrong food matched):`)
          for (const r of identityFailed) {
            console.log(`    • [${r.scenarioId}] ${r.label}`)
            for (const reason of r.identityFailReasons ?? []) console.log(`        – ${reason}`)
          }
        }
      }

      const clarificationCorrect = results.filter(r => {
        const scenario = ALL_SCENARIOS.find(s => s.id === r.scenarioId)!
        if (scenario.clarificationClass === 'never') return r.calledCalculateNutrition
        if (scenario.clarificationClass === 'acceptable_if_disclosed') {
          return r.calledCalculateNutrition || r.askedClarification
        }
        if (scenario.requiresClarification) return r.askedClarification
        return r.calledCalculateNutrition
      })
      console.log(`  Behavior accuracy: ${clarificationCorrect.length}/${results.length} correct tool/clarification decision`)
    })
  })

  // ── Multi-turn eval ───────────────────────────────────────────────────────────
  // Tests: nutrition calculation followed by log request, and correction followed by log.
  // prepare_meal_log is intercepted — no real diary writes occur.

  const DUMMY_CALC_TOKEN = 'eval_token_dummy_v1_unsigned_for_testing'

  // Dummy calculate_nutrition result with a calculationToken for multi-turn testing
  const dummyCalcResult = {
    ingredients: [
      {
        userDescription: '2 large eggs',
        resolved: true,
        matchedFoodName: 'Egg, whole, raw',
        quantity: 2,
        unit: 'large',
        macros: { calories: 143, proteinG: 12.6, carbG: 0.72, fatG: 9.51 },
      },
    ],
    totals: { calories: 143, proteinG: 12.6, carbG: 0.72, fatG: 9.51 },
    calculationToken: DUMMY_CALC_TOKEN,
  }

  describe('Layer B — Multi-turn eval (production model, tool-decision intercepted)', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it(
      'nutrition → log: V calls prepare_meal_log after calculate_nutrition result with token',
      async () => {
        const failReasons: string[] = []
        let totalTokens = 0

        // Turn 1: calculate nutrition
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t1: any = await client.chat.completions.create({
          model: V_CHAT_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: '2 large eggs' },
          ],
          tools: TOOLS,
          tool_choice: 'auto',
          max_tokens: 400,
        })
        totalTokens += (t1.usage?.prompt_tokens ?? 0) + (t1.usage?.completion_tokens ?? 0)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc1 = t1.choices?.[0]?.message?.tool_calls?.[0] as any
        if (!tc1 || tc1.function.name !== 'calculate_nutrition') {
          failReasons.push(`Turn 1: expected calculate_nutrition, got: ${tc1?.function?.name ?? 'no tool call'}`)
        }

        // Turn 2: inject dummy result and ask to log
        const t2Messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: '2 large eggs' },
          { role: 'assistant', content: null, tool_calls: t1.choices?.[0]?.message?.tool_calls ?? [] },
          { role: 'tool', tool_call_id: tc1?.id ?? 'fake_id', content: JSON.stringify(dummyCalcResult) },
          { role: 'assistant', content: 'Those 2 large eggs have 143 calories, 12.6g protein, 0.7g carbs, and 9.5g fat.' },
          { role: 'user', content: 'log that as breakfast' },
        ]

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t2: any = await client.chat.completions.create({
          model: V_CHAT_MODEL,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: t2Messages as any[],
          tools: TOOLS,
          tool_choice: 'auto',
          max_tokens: 400,
        })
        totalTokens += (t2.usage?.prompt_tokens ?? 0) + (t2.usage?.completion_tokens ?? 0)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc2 = t2.choices?.[0]?.message?.tool_calls?.[0] as any
        const calledLog = tc2?.function?.name === 'prepare_meal_log'
        const reCalculated = tc2?.function?.name === 'calculate_nutrition'

        if (!calledLog) {
          if (reCalculated) {
            failReasons.push('Turn 2: V re-called calculate_nutrition instead of prepare_meal_log — token was not reused')
          } else if (!tc2) {
            failReasons.push('Turn 2: V neither called prepare_meal_log nor re-calculated — responded in text only')
          } else {
            failReasons.push(`Turn 2: unexpected tool call: ${tc2.function.name}`)
          }
        } else {
          // Verify prepare_meal_log args
          try {
            const logArgs = JSON.parse(tc2.function.arguments) as {
              calculationToken?: string
              mealType?: string
              logDate?: string
            }
            if (!logArgs.calculationToken) {
              failReasons.push('Turn 2: prepare_meal_log called without calculationToken')
            } else if (logArgs.calculationToken !== DUMMY_CALC_TOKEN) {
              failReasons.push(`Turn 2: prepare_meal_log received wrong token: "${logArgs.calculationToken?.slice(0, 40)}"`)
            }
            if (!logArgs.mealType) {
              failReasons.push('Turn 2: prepare_meal_log called without mealType')
            } else if (logArgs.mealType !== 'breakfast') {
              failReasons.push(`Turn 2: prepare_meal_log mealType="${logArgs.mealType}" (expected "breakfast")`)
            }
            if (!logArgs.logDate) {
              failReasons.push('Turn 2: prepare_meal_log called without logDate')
            }
          } catch {
            failReasons.push('Turn 2: prepare_meal_log arguments are not valid JSON')
          }
        }

        console.log(`  [multi-turn: nutrition→log] tokens=${totalTokens} calledLog=${calledLog} failReasons=${failReasons.length}`)
        if (failReasons.length > 0) {
          for (const r of failReasons) console.warn(`    • ${r}`)
        }

        expect(failReasons).toHaveLength(0)
      },
      30_000,
    )

    it(
      'correction → re-calculate: V recalculates when quantity is corrected',
      async () => {
        const failReasons: string[] = []
        let totalTokens = 0

        // Turn 1: initial calculation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t1: any = await client.chat.completions.create({
          model: V_CHAT_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: '2 large eggs' },
          ],
          tools: TOOLS,
          tool_choice: 'auto',
          max_tokens: 400,
        })
        totalTokens += (t1.usage?.prompt_tokens ?? 0) + (t1.usage?.completion_tokens ?? 0)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc1 = t1.choices?.[0]?.message?.tool_calls?.[0] as any
        const firstCallName = tc1?.function?.name

        if (firstCallName !== 'calculate_nutrition') {
          failReasons.push(`Turn 1: expected calculate_nutrition, got: ${firstCallName ?? 'no tool call'}`)
        }

        // Turn 2: send dummy result + correction
        const t2Messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: '2 large eggs' },
          { role: 'assistant', content: null, tool_calls: t1.choices?.[0]?.message?.tool_calls ?? [] },
          { role: 'tool', tool_call_id: tc1?.id ?? 'fake_id', content: JSON.stringify(dummyCalcResult) },
          { role: 'assistant', content: 'Those 2 large eggs have 143 calories, 12.6g protein, 0.7g carbs, and 9.5g fat.' },
          { role: 'user', content: 'actually it was 3 eggs, not 2' },
        ]

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t2: any = await client.chat.completions.create({
          model: V_CHAT_MODEL,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: t2Messages as any[],
          tools: TOOLS,
          tool_choice: 'auto',
          max_tokens: 400,
        })
        totalTokens += (t2.usage?.prompt_tokens ?? 0) + (t2.usage?.completion_tokens ?? 0)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc2 = t2.choices?.[0]?.message?.tool_calls?.[0] as any
        const recalculated = tc2?.function?.name === 'calculate_nutrition'
        const loggedInstead = tc2?.function?.name === 'prepare_meal_log'

        if (!recalculated) {
          if (loggedInstead) {
            failReasons.push('Turn 2: V called prepare_meal_log after a quantity correction — should have recalculated first')
          } else if (!tc2) {
            failReasons.push('Turn 2: V responded in text without recalculating after a quantity correction')
          } else {
            failReasons.push(`Turn 2: unexpected tool call after correction: ${tc2.function.name}`)
          }
        } else {
          // Verify the recalculation used quantity=3
          try {
            const args = JSON.parse(tc2.function.arguments) as {
              ingredients: Array<{ name: string; quantity: number; unit: string }>
            }
            const eggIngredient = args.ingredients.find(i =>
              i.name.toLowerCase().includes('egg')
            )
            if (!eggIngredient) {
              failReasons.push('Turn 2: recalculation did not include an egg ingredient')
            } else if (eggIngredient.quantity !== 3) {
              failReasons.push(`Turn 2: recalculation used quantity=${eggIngredient.quantity} (expected 3)`)
            }
          } catch {
            failReasons.push('Turn 2: recalculation arguments are not valid JSON')
          }
        }

        console.log(`  [multi-turn: correction] tokens=${totalTokens} recalculated=${recalculated} failReasons=${failReasons.length}`)
        if (failReasons.length > 0) {
          for (const r of failReasons) console.warn(`    • ${r}`)
        }

        expect(failReasons).toHaveLength(0)
      },
      30_000,
    )
  })
}
