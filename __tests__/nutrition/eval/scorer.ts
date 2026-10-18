/**
 * Eval scorer — produces per-axis scores for a single scenario result.
 *
 * Axes (each 0–100):
 *   foodIdentity      — did the matched food name contain the expected tokens?
 *   macroAccuracy     — are the calculated macros within the expected range?
 *   clarificationBehavior — did V ask when needed and not ask when not needed?
 *   resolutionSuccess — did the ingredient resolve (factor found)?
 *   providerUsed      — was a real provider used (not a no_match)?
 *
 * An overall pass/fail (0 or 1) is also computed.
 */

import type { EvalScenario, MacroRange } from './scenarios'
import type { NutritionToolResult } from '../../../lib/v/tools/calculate-nutrition'

export interface ScenarioScore {
  scenarioId: string
  label: string
  category: string
  foodIdentity: number       // 0 | 100
  macroAccuracy: number      // 0–100 (per-nutrient bands)
  resolutionSuccess: number  // 0 | 100
  pass: boolean
  failReasons: string[]
  notes?: string
}

export interface EvalSummary {
  totalScenarios: number
  executed: number
  passed: number
  passRate: number
  byCategory: Record<string, { total: number; passed: number; passRate: number }>
  scores: ScenarioScore[]
  generatedAt: string
}

function tokensMatch(foodName: string, tokens: string[]): boolean {
  const lower = foodName.toLowerCase()
  return tokens.some(t => lower.includes(t.toLowerCase()))
}

function macroScore(result: NutritionToolResult, range: MacroRange): { score: number; reasons: string[] } {
  const totals = result.totals
  const reasons: string[] = []
  let pass = true

  const checks: Array<[keyof typeof totals, keyof MacroRange]> = [
    ['calories', 'calories'],
    ['proteinG', 'proteinG'],
    ['carbG', 'carbG'],
    ['fatG', 'fatG'],
  ]

  for (const [resultKey, rangeKey] of checks) {
    const val = totals[resultKey]
    const [min, max] = range[rangeKey]
    if (val < min || val > max) {
      reasons.push(`${resultKey}: ${val} outside [${min}, ${max}]`)
      pass = false
    }
  }

  return { score: pass ? 100 : 0, reasons }
}

export function scoreScenario(
  scenario: EvalScenario,
  result: NutritionToolResult | null,
  error?: string,
): ScenarioScore {
  const failReasons: string[] = []

  if (error || result === null) {
    failReasons.push(error ?? 'Pipeline returned null result')
    return {
      scenarioId: scenario.id,
      label: scenario.label,
      category: scenario.category,
      foodIdentity: 0,
      macroAccuracy: 0,
      resolutionSuccess: 0,
      pass: false,
      failReasons,
    }
  }

  const spec = scenario.layerA!

  // Resolution check
  const anyResolved = result.ingredients.some(i => i.resolved)
  const resolutionSuccess = (spec.expectedResolved ? anyResolved : true) ? 100 : 0
  if (spec.expectedResolved && !anyResolved) {
    failReasons.push('Expected at least one resolved ingredient but all failed')
  }

  // Food identity — at least the first resolved ingredient must match expected tokens
  const firstResolved = result.ingredients.find(i => i.resolved)
  let foodIdentity = 0
  if (firstResolved && spec.expectedNameTokens.length > 0) {
    foodIdentity = tokensMatch(firstResolved.matchedFoodName, spec.expectedNameTokens) ? 100 : 0
    if (foodIdentity === 0) {
      failReasons.push(
        `Food identity mismatch: matched "${firstResolved.matchedFoodName}", ` +
        `expected tokens [${spec.expectedNameTokens.join(', ')}]`
      )
    }
  } else if (!spec.expectedResolved) {
    // expected failure — identity check not meaningful
    foodIdentity = 100
  }

  // Macro accuracy — only if we expected resolution
  let macroAccuracy = 100
  if (spec.expectedResolved && anyResolved) {
    const { score, reasons } = macroScore(result, spec.macroRanges)
    macroAccuracy = score
    failReasons.push(...reasons)
  } else if (!spec.expectedResolved) {
    macroAccuracy = 100
  }

  const pass = resolutionSuccess === 100 && foodIdentity === 100 && macroAccuracy === 100

  return {
    scenarioId: scenario.id,
    label: scenario.label,
    category: scenario.category,
    foodIdentity,
    macroAccuracy,
    resolutionSuccess,
    pass,
    failReasons,
    notes: scenario.notes,
  }
}

export function buildSummary(scores: ScenarioScore[]): EvalSummary {
  const executed = scores.length
  const passed = scores.filter(s => s.pass).length

  const byCategory: EvalSummary['byCategory'] = {}
  for (const score of scores) {
    if (!byCategory[score.category]) {
      byCategory[score.category] = { total: 0, passed: 0, passRate: 0 }
    }
    byCategory[score.category].total++
    if (score.pass) byCategory[score.category].passed++
  }
  for (const cat of Object.values(byCategory)) {
    cat.passRate = cat.total > 0 ? Math.round((cat.passed / cat.total) * 100) : 0
  }

  return {
    totalScenarios: scores.length,
    executed,
    passed,
    passRate: executed > 0 ? Math.round((passed / executed) * 100) : 0,
    byCategory,
    scores,
    generatedAt: new Date().toISOString(),
  }
}

export function printSummary(summary: EvalSummary): void {
  console.log('\n' + '═'.repeat(60))
  console.log('  Coach V Nutrition Eval — Baseline Results')
  console.log('═'.repeat(60))
  console.log(`  Generated:  ${summary.generatedAt}`)
  console.log(`  Executed:   ${summary.executed} scenarios`)
  console.log(`  Passed:     ${summary.passed} / ${summary.executed}  (${summary.passRate}%)`)
  console.log('\n  By category:')

  const categoryPad = 28
  for (const [cat, data] of Object.entries(summary.byCategory)) {
    const bar = '█'.repeat(Math.round(data.passRate / 5))
    const pct = `${data.passRate}%`.padStart(4)
    console.log(`    ${cat.padEnd(categoryPad)} ${pct}  ${bar}  (${data.passed}/${data.total})`)
  }

  const failures = summary.scores.filter(s => !s.pass)
  if (failures.length > 0) {
    console.log('\n  Failures:')
    for (const f of failures) {
      console.log(`    [${f.scenarioId}] ${f.label}`)
      for (const r of f.failReasons) {
        console.log(`      • ${r}`)
      }
    }
  }
  console.log('═'.repeat(60) + '\n')
}
