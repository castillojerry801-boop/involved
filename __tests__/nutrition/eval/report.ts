/**
 * Eval report generator.
 *
 * Run standalone: npx tsx __tests__/nutrition/eval/report.ts
 * Writes machine-readable JSON to eval-results.json at project root.
 * Prints human-readable summary to stdout.
 *
 * Report sections:
 *   1. SYNTHETIC PIPELINE — mechanics tests (layer-a.test.ts)
 *      Uniform placeholder macros, mocked providers. Validates unit-conversion paths,
 *      quality-gate pass, multi-ingredient assembly, provider-failure fallback.
 *      Does NOT validate nutritional accuracy.
 *
 *   2. REFERENCE ACCURACY — food-specific fixture tests (reference-accuracy.test.ts)
 *      Food-specific macros from published USDA FoodData Central tables.
 *      Validates that the pipeline produces macros within tolerance of
 *      documented reference values for diverse foods and units.
 *      captureStatus='needs_capture' until verified via live API run.
 *
 *   3. LIVE PROVIDER HEALTH — admin endpoint (GET /api/admin/nutrition-health?probe=true)
 *      Real HTTP calls to each provider. Reports: latency, status, Error 21 detection.
 *      Results are NOT available here — run the endpoint in a production or staging env.
 *      Provider status must NOT be assumed from key presence alone.
 *
 *   4. REAL-MODEL CONVERSATION — Layer B (layer-b.test.ts, EVAL_REAL_AI=true)
 *      Two modes:
 *        tool-decision: AI model + intercepted tool (checks call vs clarify)
 *        full workflow: AI model + real providers (checks food identity + macro plausibility)
 *      Never writes to customer diary data.
 *
 *   5. LOGGING INTEGRATION — telemetry firing (telemetry.test.ts)
 *      Confirms [nutrition-diag] JSON events emit, contain required fields,
 *      and do not expose credentials. Pipeline is never interrupted by telemetry errors.
 */

import { ALL_SCENARIOS, LAYER_A_SCENARIOS, LAYER_B_ONLY_SCENARIOS } from './scenarios'
import { CAPTURED_RECORDS } from './fixtures/captured-records'
import type { EvalSummary, ScenarioScore } from './scorer'

export interface EvalReport {
  meta: {
    generatedAt: string
    version: string
    note: string
  }
  sections: {
    syntheticPipeline: {
      label: string
      description: string
      scenarioCount: number
      byCategory: Array<{ name: string; count: number }>
    }
    referenceAccuracy: {
      label: string
      description: string
      fixtureCount: number
      captureStatus: { verified: number; needs_capture: number }
      fixtureCategories: string[]
      captureInstruction: string
    }
    liveProviderHealth: {
      label: string
      description: string
      howToRun: string
      providers: string[]
      providerStatusNote: string
    }
    realModelConversation: {
      label: string
      description: string
      howToRunToolDecision: string
      howToRunFullWorkflow: string
      scenarioCount: number
      assessmentAxes: string[]
    }
    loggingIntegration: {
      label: string
      description: string
      howToRun: string
      eventKindsCovered: string[]
    }
  }
  openIssues: string[]
  confirmedWeaknesses: string[]
  hypotheses: string[]
  results?: EvalSummary
}

export function buildReport(results?: EvalSummary): EvalReport {
  const categoryMap = new Map<string, number>()
  for (const s of ALL_SCENARIOS) {
    categoryMap.set(s.category, (categoryMap.get(s.category) ?? 0) + 1)
  }
  const byCategory = [...categoryMap.entries()].map(([name, count]) => ({ name, count }))

  const captureVerified   = CAPTURED_RECORDS.filter(r => r.captureStatus === 'verified').length
  const captureNeeds      = CAPTURED_RECORDS.filter(r => r.captureStatus === 'needs_capture').length

  // Unique food categories in captured records (inferred from label prefixes)
  const fixtureCategories = [
    'whole protein (chicken, salmon)',
    'egg (count unit)',
    'vegetable (broccoli, spinach, sweet potato)',
    'grain (brown rice, oats)',
    'dairy / volume unit (whole milk cup)',
    'dairy (greek yogurt)',
    'oil / tbsp unit (olive oil)',
    'cheese (cheddar)',
    'nut butter / tbsp unit (peanut butter)',
    'fruit (banana)',
    'nut / oz unit (almonds)',
  ]

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      version: '0.2.0-phase0',
      note: 'Phase 0 evaluation — Coach V Nutrition Discovery.',
    },
    sections: {
      syntheticPipeline: {
        label: '1. SYNTHETIC PIPELINE — mechanics (layer-a.test.ts)',
        description:
          'Providers mocked. Fixture macros are uniform placeholders (120/10/15/5 for every food). ' +
          'Tests that the unit-conversion pipeline resolves diverse input units correctly. ' +
          'A resolved=true result here confirms the pipeline mechanics worked, NOT that the ' +
          'macros are nutritionally correct. Do not interpret pipeline pass rate as accuracy.',
        scenarioCount: LAYER_A_SCENARIOS.length,
        byCategory,
      },
      referenceAccuracy: {
        label: '2. REFERENCE ACCURACY — food-specific fixtures (reference-accuracy.test.ts)',
        description:
          'Uses food-specific macros from published USDA FoodData Central Foundation dataset. ' +
          'Tests that the factor engine produces macros within tolerance of documented reference ' +
          'values for real foods and diverse units. ' +
          'A non-resolving result (resolved=false) is counted as a FAILURE, not a graceful pass. ' +
          `All ${captureNeeds} fixture(s) are captureStatus=needs_capture — values sourced from ` +
          'published USDA tables, not from a live API call. Tighten tolerances after capture verification.',
        fixtureCount: CAPTURED_RECORDS.length,
        captureStatus: { verified: captureVerified, needs_capture: captureNeeds },
        fixtureCategories,
        captureInstruction:
          'To verify fixtures: npx tsx --env-file=.env.local __tests__/nutrition/eval/capture-records.ts ' +
          '(implemented — uses FatSecret; USDA blocked locally). Results in fixtures/capture-results.json.',
      },
      liveProviderHealth: {
        label: '3. LIVE PROVIDER HEALTH — admin endpoint',
        description:
          'Runs real HTTP calls to each configured provider using the probe endpoint. ' +
          'Reports per-provider: HTTP status, latency, result count, error code (incl. Error 21). ' +
          'Results are not available from this report — they require a running app instance with admin auth. ' +
          'Provider status MUST NOT be assumed from key presence. Keys can exist for non-functional providers. ' +
          'FatSecret and USDA status are UNCONFIRMED until the probe runs and returns results.',
        howToRun: 'GET /api/admin/nutrition-health?probe=true (admin auth required, respects rate limit)',
        providers: ['usda_fooddata', 'fatsecret', 'open_food_facts'],
        providerStatusNote:
          'Do not report FatSecret as "IP-restricted" or USDA as "functional" without evidence ' +
          'from an actual probe run. Key presence ≠ provider functional.',
      },
      realModelConversation: {
        label: '4. REAL-MODEL CONVERSATION — Layer B (layer-b.test.ts)',
        description:
          'Tests Coach V (real AI model) against natural-language food inputs. ' +
          'Mode 1 (tool-decision): checks whether V calls calculate_nutrition vs asks for clarification. ' +
          'Mode 2 (full workflow): actually executes calculate_nutrition with real providers, then ' +
          'checks: food identity (what did the pipeline match?), macro plausibility (are values reasonable?), ' +
          'resolution success (were ingredients resolved?), and V\'s conversational response coherence. ' +
          'Never writes to real customer diary data. DB mocked to empty.',
        howToRunToolDecision:
          'EVAL_REAL_AI=true pnpm vitest __tests__/nutrition/eval/layer-b',
        howToRunFullWorkflow:
          'EVAL_REAL_AI=true EVAL_REAL_PROVIDERS=true pnpm vitest __tests__/nutrition/eval/layer-b',
        scenarioCount: ALL_SCENARIOS.length,
        assessmentAxes: [
          'tool-call decision (called tool vs asked for clarification)',
          'clarification necessity (asked when needed, silent when not)',
          'ingredient extraction (name, quantity, unit in tool call)',
          'food identity (matched food name from provider)',
          'macro plausibility (calories/protein/carb/fat in plausible range)',
          'resolution success (all ingredients resolved, not just gracefully skipped)',
          'conversational response (V mentions numbers from tool result)',
        ],
      },
      loggingIntegration: {
        label: '5. LOGGING INTEGRATION — telemetry events (telemetry.test.ts)',
        description:
          'Confirms that [nutrition-diag] JSON events fire during real pipeline runs. ' +
          'Does not test live provider behavior. Tests: event emission, required fields, ' +
          'no credential leakage in events, pipeline resilience when telemetry throws.',
        howToRun: 'pnpm vitest __tests__/nutrition/eval/telemetry',
        eventKindsCovered: [
          'provider_search (status, query, durationMs, resultCount)',
          'match_selected (query, provider, confidence, score)',
          'match_no_result (query, reason)',
        ],
      },
    },
    openIssues: [
      'OI-1: Reference accuracy fixtures are captureStatus=needs_capture (USDA FDC IDs unverified). ' +
        'USDA is network-blocked locally (HTTP 000 in <2ms). Requires a network with USDA access or ' +
        'Vercel deployment to verify FDC IDs. FatSecret captures are verified ' +
        '(see __tests__/nutrition/eval/fixtures/capture-results.json).',
      'OI-2: Layer B full-workflow mode not yet run. ' +
        'Requires EVAL_REAL_AI=true EVAL_REAL_PROVIDERS=true and real API keys.',
      'OI-3: CONFIRMED locally — FatSecret: OK (559ms, 5 results, detail fetch functional). ' +
        'USDA: network-blocked locally (connection refused; unrelated to API key). ' +
        'Open Food Facts: 503 (temporary). Vercel runtime status still unconfirmed — ' +
        'run GET /api/admin/nutrition-health?probe=true from a live instance.',
      'OI-4: FatSecret enrichment path (getByIdForEnrichment) not covered by reference-accuracy tests. ' +
        'Need FatSecret-specific fixture captures to test that path.',
      'OI-6: FatSecret search returns wrong food for 8/20 common whole-food queries locally. ' +
        '"egg whole raw" → "Steak Tartare (Raw Ground Beef and Egg)". ' +
        '"broccoli raw" → "Raw Stuffed Chicken Breast Broccoli & Cheese". ' +
        'This is a production search-quality risk when FatSecret is used as fallback. ' +
        'USDA must be functional to mask this. Confirmed by capture-records.ts run.',
    ],
    confirmedWeaknesses: [
      'C1: Provider failure mode ambiguity — no distinction between "food not found" ' +
        'and "provider unavailable" in the matcher output. Confirmed from code inspection.',
      'C2: FatSecret enrichment is a single 4000ms call with no retry. If it fails, ' +
        'strip/slice/piece units fall through to portion_not_found. Confirmed from code.',
      'C3: No query reformulation. Pipeline issues one literal search per provider. ' +
        'Misspellings and prefix-reorder variants get one shot. Confirmed from code.',
      'C4: Step 7 (USDA portion fetch) only fires for Foundation/SR Legacy data types. ' +
        'Prepared-dish count units (pizza slice, taco, etc.) cannot use this path. Confirmed from code.',
      'C5: Ranking ignores serving-unit compatibility. Top name-similarity match may lack ' +
        'serving data for the requested unit. Confirmed from code.',
      'C6: Sequential per-ingredient resolution compounds latency for multi-ingredient meals. ' +
        'No maxDuration on the coach route. Confirmed from code.',
      'C7: Nutritionix is dead code — keys absent and not registered in FOOD_PROVIDERS. ' +
        'Confirmed from code inspection.',
      'C8 (CONFIRMED by capture run 2026-10-18): FatSecret search returns wrong food for common ' +
        'whole-food queries. 8/20 foods returned wrong matches: egg, broccoli, spinach, sweet potato, ' +
        'oats, banana, avocado, and others. Root cause: FatSecret ranks compound dishes that mention ' +
        'the ingredient over the pure ingredient itself. Production safety depends on USDA being primary.',
    ],
    hypotheses: [
      'H1 (UNCONFIRMED): FatSecret may be returning Error 21 in production because Vercel ' +
        'functions egress from rotating IPs not covered by the FatSecret IP allowlist. ' +
        'Local probe showed FatSecret working (status: ok, 559ms). Vercel IP behavior is separate. ' +
        'Confirm by running GET /api/admin/nutrition-health?probe=true on the live Vercel deployment.',
      'H2 (PARTIALLY CONFIRMED): USDA FoodData Central is unreachable from the development machine ' +
        '(connection refused, <2ms). This is a local network restriction, not an API key issue. ' +
        'USDA reachability from Vercel is still unconfirmed — run the health probe from Vercel runtime.',
    ],
    results,
  }
}

export function printReport(report: EvalReport): void {
  const hr = '═'.repeat(72)
  const sec = '─'.repeat(72)
  console.log('\n' + hr)
  console.log('  Coach V Nutrition Discovery — Phase 0 Evaluation Report')
  console.log(hr)
  console.log(`  Generated: ${report.meta.generatedAt}`)
  console.log(`  Version:   ${report.meta.version}`)
  console.log()

  const { sections: s } = report

  // Section 1: Synthetic Pipeline
  console.log(s.syntheticPipeline.label)
  console.log(sec)
  console.log(`  Scenarios: ${s.syntheticPipeline.scenarioCount}`)
  console.log(`  ${s.syntheticPipeline.description.replace(/\s+/g, ' ')}`)
  console.log()
  console.log('  Run: pnpm vitest __tests__/nutrition/eval/layer-a')
  console.log()
  for (const { name, count } of s.syntheticPipeline.byCategory) {
    console.log(`    ${name.padEnd(30)} ${String(count).padStart(3)}  ${'▪'.repeat(count)}`)
  }
  console.log()

  // Section 2: Reference Accuracy
  console.log(s.referenceAccuracy.label)
  console.log(sec)
  console.log(`  Fixtures: ${s.referenceAccuracy.fixtureCount}`)
  console.log(`  Verified: ${s.referenceAccuracy.captureStatus.verified}  |  Needs capture: ${s.referenceAccuracy.captureStatus.needs_capture}`)
  console.log(`  Run: pnpm vitest __tests__/nutrition/eval/reference-accuracy`)
  console.log(`  ${s.referenceAccuracy.captureInstruction}`)
  console.log()

  // Section 3: Live Provider Health
  console.log(s.liveProviderHealth.label)
  console.log(sec)
  console.log(`  How to run: ${s.liveProviderHealth.howToRun}`)
  console.log(`  ⚠ ${s.liveProviderHealth.providerStatusNote}`)
  console.log()

  // Section 4: Real-Model Conversation
  console.log(s.realModelConversation.label)
  console.log(sec)
  console.log(`  Scenarios: ${s.realModelConversation.scenarioCount}`)
  console.log(`  Tool decision: ${s.realModelConversation.howToRunToolDecision}`)
  console.log(`  Full workflow: ${s.realModelConversation.howToRunFullWorkflow}`)
  console.log()

  // Section 5: Logging Integration
  console.log(s.loggingIntegration.label)
  console.log(sec)
  console.log(`  Run: ${s.loggingIntegration.howToRun}`)
  console.log()

  // Open issues
  console.log('  OPEN ISSUES (required to establish a real-world accuracy baseline)')
  console.log(sec)
  for (const issue of report.openIssues) {
    console.log(`  ${issue.slice(0, 72)}`)
    if (issue.length > 72) console.log(`    ${issue.slice(72, 144)}`)
  }
  console.log()

  // Confirmed weaknesses
  console.log('  CONFIRMED WEAKNESSES (from code inspection)')
  console.log(sec)
  for (const w of report.confirmedWeaknesses) {
    console.log(`  ${w.slice(0, 72)}`)
    if (w.length > 72) console.log(`    ${w.slice(72)}`)
    console.log()
  }

  // Hypotheses
  console.log('  HYPOTHESES (unconfirmed — require probe or production log evidence)')
  console.log(sec)
  for (const h of report.hypotheses) {
    console.log(`  ${h.slice(0, 72)}`)
    console.log()
  }

  console.log(hr + '\n')
}

// Standalone usage
const isMain = process.argv[1]?.endsWith('report.ts')
if (isMain) {
  const report = buildReport()
  printReport(report)

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs   = require('fs')   as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    const outPath = path.resolve(process.cwd(), 'eval-results.json')
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
    console.log(`  Machine-readable report written to: ${outPath}`)
  } catch (err) {
    console.error('Failed to write eval-results.json:', err)
  }
}
