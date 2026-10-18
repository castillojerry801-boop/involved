/**
 * Reference-capture script — calls real provider APIs to produce verified fixture records.
 *
 * Run: npx tsx --env-file=.env.local __tests__/nutrition/eval/capture-records.ts
 *
 * Outputs:
 *   __tests__/nutrition/eval/fixtures/capture-results.json  (raw provider data)
 *   Console summary per food
 *
 * Provider credentials used:
 *   FATSECRET_CLIENT_ID + FATSECRET_CLIENT_SECRET  (OAuth2)
 *   USDA_API_KEY                                    (URL param)
 *
 * NEVER exposes credentials in output files.
 * NEVER modifies production code.
 * NEVER hard-codes expected macros into production prompts or matchers.
 *
 * What this captures:
 *   - Provider name, exact external food ID
 *   - Food description as returned by provider
 *   - Actual serving size/unit from provider (not approximated)
 *   - Calories, protein, carbs, fat per 100g as provider reports
 *   - Timestamp of capture
 *
 * Capture status meanings:
 *   verified   — provider actually returned this record during THIS run
 *   failed     — provider returned an error or no matching record
 *   skipped    — provider unreachable (network block, 503, etc.)
 */

import * as fs from 'fs'
import * as path from 'path'

interface CaptureAttempt {
  label: string
  searchQuery: string
  preferGeneric: boolean
  targetServingNote: string
}

interface CapturedNutrition {
  caloriesPer100g: number
  proteinPer100g:  number
  carbsPer100g:    number
  fatPer100g:      number
}

interface CaptureRecord {
  label: string
  searchQuery: string
  captureStatus: 'verified' | 'failed' | 'skipped'
  capturedAt: string
  provider: string
  externalId?: string
  foodName?: string
  servingSizeG?: number
  nutritionPer100g?: CapturedNutrition
  referenceServingNote: string
  note?: string
  rawServings?: unknown
}

// Foods to capture — diverse categories, no food-specific production changes
const FOODS_TO_CAPTURE: CaptureAttempt[] = [
  { label: 'Chicken breast (raw)',         searchQuery: 'chicken breast raw',           preferGeneric: true,  targetServingNote: '100g' },
  { label: 'Salmon (raw)',                 searchQuery: 'salmon raw',                    preferGeneric: true,  targetServingNote: '100g' },
  { label: 'Egg (1 large)',                searchQuery: 'egg whole raw',                 preferGeneric: true,  targetServingNote: '1 large egg (~50g)' },
  { label: 'Broccoli (raw)',               searchQuery: 'broccoli raw',                  preferGeneric: true,  targetServingNote: '100g' },
  { label: 'Spinach (raw)',                searchQuery: 'spinach raw',                   preferGeneric: true,  targetServingNote: '100g' },
  { label: 'Sweet potato (raw)',           searchQuery: 'sweet potato raw',              preferGeneric: true,  targetServingNote: '100g' },
  { label: 'Brown rice (cooked)',          searchQuery: 'brown rice cooked',             preferGeneric: true,  targetServingNote: '100g cooked' },
  { label: 'Oats (raw)',                   searchQuery: 'oats raw rolled',               preferGeneric: true,  targetServingNote: '100g dry' },
  { label: 'Whole milk',                   searchQuery: 'whole milk',                    preferGeneric: true,  targetServingNote: '1 cup (244ml)' },
  { label: 'Greek yogurt (plain)',         searchQuery: 'greek yogurt plain',            preferGeneric: true,  targetServingNote: '100g' },
  { label: 'Olive oil',                    searchQuery: 'olive oil',                     preferGeneric: true,  targetServingNote: '1 tbsp (~13.5g)' },
  { label: 'Cheddar cheese',              searchQuery: 'cheddar cheese',               preferGeneric: true,  targetServingNote: '100g' },
  { label: 'Peanut butter',               searchQuery: 'peanut butter',                preferGeneric: true,  targetServingNote: '2 tbsp (~32g)' },
  { label: 'Banana',                       searchQuery: 'banana raw',                    preferGeneric: true,  targetServingNote: '1 medium (~118g)' },
  { label: 'Almonds (raw)',               searchQuery: 'almonds raw',                  preferGeneric: true,  targetServingNote: '1 oz (28g)' },
  { label: 'White rice (cooked)',          searchQuery: 'white rice cooked',             preferGeneric: true,  targetServingNote: '100g cooked' },
  { label: 'Turkey breast (deli)',         searchQuery: 'turkey breast deli',            preferGeneric: false, targetServingNote: '1 slice (~28g)' },
  { label: 'Orange juice',                searchQuery: 'orange juice',                 preferGeneric: true,  targetServingNote: '1 cup (248ml)' },
  { label: 'Avocado',                     searchQuery: 'avocado raw',                  preferGeneric: true,  targetServingNote: '100g' },
  { label: 'Cottage cheese (low fat)',    searchQuery: 'cottage cheese low fat',       preferGeneric: true,  targetServingNote: '100g' },
]

const TIMEOUT_MS = 8000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms),
    ),
  ])
}

// ── FatSecret OAuth helper ─────────────────────────────────────────────────────

async function getFatSecretToken(clientId: string, clientSecret: string): Promise<string | null> {
  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await withTimeout(
      fetch('https://oauth.fatsecret.com/connect/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=basic',
      }),
      TIMEOUT_MS,
    )
    if (!res.ok) return null
    const data = await res.json() as { access_token?: string }
    return data.access_token ?? null
  } catch {
    return null
  }
}

interface FatSecretFood {
  food_id: string
  food_name: string
  food_type: string
  food_description: string
  brand_name?: string
}

interface FatSecretServing {
  serving_id: string
  serving_description: string
  metric_serving_amount?: string
  metric_serving_unit?: string
  calories: string
  protein: string
  carbohydrate: string
  fat: string
}

async function fatSecretSearch(
  token: string,
  query: string,
  maxResults = 10,
): Promise<FatSecretFood[]> {
  const url = new URL('https://platform.fatsecret.com/rest/server.api')
  url.searchParams.set('method', 'foods.search')
  url.searchParams.set('search_expression', query)
  url.searchParams.set('max_results', String(maxResults))
  url.searchParams.set('format', 'json')

  try {
    const res = await withTimeout(
      fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }),
      TIMEOUT_MS,
    )
    if (!res.ok) return []
    const data = await res.json() as { foods?: { food?: FatSecretFood[] | FatSecretFood }; error?: unknown }
    if (data.error) return []
    const foods = data.foods?.food
    if (!foods) return []
    return Array.isArray(foods) ? foods : [foods]
  } catch {
    return []
  }
}

async function fatSecretGetDetail(
  token: string,
  foodId: string,
): Promise<FatSecretServing[] | null> {
  const url = new URL('https://platform.fatsecret.com/rest/server.api')
  url.searchParams.set('method', 'food.get.v4')
  url.searchParams.set('food_id', foodId)
  url.searchParams.set('format', 'json')

  try {
    const res = await withTimeout(
      fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }),
      TIMEOUT_MS,
    )
    if (!res.ok) return null
    const data = await res.json() as {
      food?: { servings?: { serving?: FatSecretServing[] | FatSecretServing } }
      error?: unknown
    }
    if (data.error || !data.food?.servings) return null
    const s = data.food.servings.serving
    return Array.isArray(s) ? s : (s ? [s] : null)
  } catch {
    return null
  }
}

function per100g(serving: FatSecretServing): CapturedNutrition | null {
  const metricAmount = parseFloat(serving.metric_serving_amount ?? '')
  const unit = (serving.metric_serving_unit ?? '').toLowerCase()

  let scaleFactor: number
  if (unit === 'g') {
    scaleFactor = 100 / metricAmount
  } else if (unit === 'ml') {
    // Use 1:1 g≈ml approximation for normalization
    scaleFactor = 100 / metricAmount
  } else {
    return null
  }

  if (!isFinite(scaleFactor) || scaleFactor <= 0 || metricAmount <= 0) return null

  return {
    caloriesPer100g: parseFloat(serving.calories) * scaleFactor,
    proteinPer100g:  parseFloat(serving.protein)  * scaleFactor,
    carbsPer100g:    parseFloat(serving.carbohydrate) * scaleFactor,
    fatPer100g:      parseFloat(serving.fat) * scaleFactor,
  }
}

function round1(n: number): number { return Math.round(n * 10) / 10 }

// Checks that a returned food name is plausibly relevant to the query.
// Guards against FatSecret returning generic catches like "Raw Vegetable"
// for specific food queries.
// Rule: the FIRST word of the search query (the primary food noun) MUST appear
// in the food name. Secondary words ("raw", "cooked", "plain") are not required.
function isRelevantMatch(foodName: string, searchQuery: string): boolean {
  const nameLower  = foodName.toLowerCase()
  // Stop words that describe preparation/state, not the food itself
  const STOP = new Set(['raw', 'cooked', 'rolled', 'plain', 'whole', 'long', 'grain', 'curd', 'small', 'low', 'fat', 'nonfat'])
  const queryWords = searchQuery.toLowerCase().split(/\s+/)
  // Find the first non-stop word (the primary food noun)
  const primaryWord = queryWords.find(w => !STOP.has(w) && w.length >= 2)
  if (!primaryWord) return true
  return nameLower.includes(primaryWord)
}

// ── Capture via FatSecret ──────────────────────────────────────────────────────

async function captureViaFatSecret(
  token: string,
  attempt: CaptureAttempt,
  now: string,
): Promise<CaptureRecord> {
  const foods = await fatSecretSearch(token, attempt.searchQuery)
  if (!foods.length) {
    return {
      label: attempt.label,
      searchQuery: attempt.searchQuery,
      captureStatus: 'failed',
      capturedAt: now,
      provider: 'fatsecret',
      referenceServingNote: attempt.targetServingNote,
      note: 'Search returned no results',
    }
  }

  // Prefer generic over branded, and require the food name to be relevant to query
  const ordered = attempt.preferGeneric
    ? [...foods.filter(f => f.food_type === 'Generic'), ...foods.filter(f => f.food_type !== 'Generic')]
    : foods

  // Filter to relevantly named foods only
  const relevant = ordered.filter(f => isRelevantMatch(f.food_name, attempt.searchQuery))
  if (!relevant.length) {
    return {
      label: attempt.label,
      searchQuery: attempt.searchQuery,
      captureStatus: 'failed',
      capturedAt: now,
      provider: 'fatsecret',
      referenceServingNote: attempt.targetServingNote,
      note: `No relevant match. Top result: "${foods[0]?.food_name}" (ID ${foods[0]?.food_id})`,
    }
  }

  for (const food of relevant) {
    const servings = await fatSecretGetDetail(token, food.food_id)
    if (!servings) continue

    // Find a serving with metric_serving_unit = 'g' or 'ml' for clean per-100g conversion
    const metricServing = servings.find(s =>
      s.metric_serving_unit?.toLowerCase() === 'g' ||
      s.metric_serving_unit?.toLowerCase() === 'ml',
    )

    const serving = metricServing ?? servings[0]
    if (!serving) continue

    const nutrition = per100g(serving)
    if (!nutrition) {
      // Return what we have without per-100g normalization
      return {
        label: attempt.label,
        searchQuery: attempt.searchQuery,
        captureStatus: 'verified',
        capturedAt: now,
        provider: 'fatsecret',
        externalId: food.food_id,
        foodName: food.food_name,
        referenceServingNote: attempt.targetServingNote,
        note: `No metric serving unit — raw serving: ${serving.serving_description}`,
        rawServings: servings.slice(0, 3),
      }
    }

    return {
      label: attempt.label,
      searchQuery: attempt.searchQuery,
      captureStatus: 'verified',
      capturedAt: now,
      provider: 'fatsecret',
      externalId: food.food_id,
      foodName: food.food_name,
      servingSizeG: 100,
      nutritionPer100g: {
        caloriesPer100g: round1(nutrition.caloriesPer100g),
        proteinPer100g:  round1(nutrition.proteinPer100g),
        carbsPer100g:    round1(nutrition.carbsPer100g),
        fatPer100g:      round1(nutrition.fatPer100g),
      },
      referenceServingNote: attempt.targetServingNote,
      rawServings: servings.slice(0, 3),
    }
  }

  return {
    label: attempt.label,
    searchQuery: attempt.searchQuery,
    captureStatus: 'failed',
    capturedAt: now,
    provider: 'fatsecret',
    referenceServingNote: attempt.targetServingNote,
    note: 'Found foods but none had usable metric serving data',
  }
}

// ── USDA probe ────────────────────────────────────────────────────────────────

async function captureViaUsda(attempt: CaptureAttempt, apiKey: string, now: string): Promise<CaptureRecord> {
  try {
    const params = new URLSearchParams({
      query:    attempt.searchQuery,
      api_key:  apiKey,
      pageSize: '5',
    })
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?${params}&dataType=Foundation,SR%20Legacy`
    const res = await withTimeout(fetch(url), TIMEOUT_MS)

    if (!res.ok) {
      return { label: attempt.label, searchQuery: attempt.searchQuery, captureStatus: 'failed', capturedAt: now, provider: 'usda_fooddata', referenceServingNote: attempt.targetServingNote, note: `HTTP ${res.status}` }
    }

    const data = await res.json() as {
      foods?: Array<{
        fdcId: number
        description: string
        dataType: string
        foodNutrients?: Array<{ nutrientId: number; value: number }>
      }>
    }

    const food = data.foods?.[0]
    if (!food) {
      return { label: attempt.label, searchQuery: attempt.searchQuery, captureStatus: 'failed', capturedAt: now, provider: 'usda_fooddata', referenceServingNote: attempt.targetServingNote, note: 'No results' }
    }

    // nutrientId mapping (standard USDA FDC nutrient IDs)
    const n = (id: number) => food.foodNutrients?.find(fn => fn.nutrientId === id)?.value ?? 0
    const energy   = n(1008) || n(2047) // Energy (kcal)
    const protein  = n(1003)
    const carbs    = n(1005)
    const fat      = n(1004)

    return {
      label: attempt.label,
      searchQuery: attempt.searchQuery,
      captureStatus: 'verified',
      capturedAt: now,
      provider: 'usda_fooddata',
      externalId: String(food.fdcId),
      foodName: food.description,
      servingSizeG: 100,
      nutritionPer100g: {
        caloriesPer100g: round1(energy),
        proteinPer100g:  round1(protein),
        carbsPer100g:    round1(carbs),
        fatPer100g:      round1(fat),
      },
      referenceServingNote: attempt.targetServingNote,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      label: attempt.label,
      searchQuery: attempt.searchQuery,
      captureStatus: 'skipped',
      capturedAt: now,
      provider: 'usda_fooddata',
      referenceServingNote: attempt.targetServingNote,
      note: msg.includes('TIMEOUT') ? 'Network timeout' : `Network error: ${msg}`,
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date().toISOString()
  const fsClientId     = process.env.FATSECRET_CLIENT_ID
  const fsClientSecret = process.env.FATSECRET_CLIENT_SECRET
  const usdaKey        = process.env.USDA_API_KEY

  console.log(`\n${'═'.repeat(62)}`)
  console.log('  Coach V Nutrition — Reference Capture')
  console.log(`  ${now}`)
  console.log('═'.repeat(62))
  console.log(`  Foods to capture:  ${FOODS_TO_CAPTURE.length}`)
  console.log(`  FatSecret keys:    ${fsClientId && fsClientSecret ? '✓ present' : '✗ missing'}`)
  console.log(`  USDA key:          ${usdaKey ? '✓ present' : '✗ missing'}`)
  console.log()

  // Acquire FatSecret token once
  let fsToken: string | null = null
  if (fsClientId && fsClientSecret) {
    process.stdout.write('  Acquiring FatSecret token... ')
    fsToken = await getFatSecretToken(fsClientId, fsClientSecret)
    console.log(fsToken ? '✓' : '✗ failed')
  }

  const results: CaptureRecord[] = []
  let verified = 0, failed = 0, skipped = 0

  for (const attempt of FOODS_TO_CAPTURE) {
    process.stdout.write(`  Capturing: ${attempt.label.padEnd(32)} `)

    let record: CaptureRecord

    if (fsToken) {
      record = await captureViaFatSecret(fsToken, attempt, now)
    } else if (usdaKey) {
      record = await captureViaUsda(attempt, usdaKey, now)
    } else {
      record = {
        label: attempt.label,
        searchQuery: attempt.searchQuery,
        captureStatus: 'skipped',
        capturedAt: now,
        provider: 'none',
        referenceServingNote: attempt.targetServingNote,
        note: 'No provider credentials available',
      }
    }

    if (record.captureStatus === 'verified') {
      verified++
      const n = record.nutritionPer100g
      if (n) {
        console.log(`✓ ${record.foodName?.slice(0, 30).padEnd(30)} ${record.externalId?.padEnd(10)} cal=${round1(n.caloriesPer100g)} pro=${round1(n.proteinPer100g)} carb=${round1(n.carbsPer100g)} fat=${round1(n.fatPer100g)} /100g`)
      } else {
        console.log(`✓ ${record.foodName?.slice(0, 40)} (no per-100g data)`)
      }
    } else if (record.captureStatus === 'failed') {
      failed++
      console.log(`✗ ${record.note ?? 'failed'}`)
    } else {
      skipped++
      console.log(`- skipped: ${record.note ?? ''}`)
    }

    results.push(record)

    // Respect rate limits — brief pause between requests
    await new Promise(r => setTimeout(r, 150))
  }

  console.log()
  console.log(`  ─── Summary ───────────────────────────────────────────────`)
  console.log(`  verified: ${verified}  failed: ${failed}  skipped: ${skipped}`)
  console.log()

  const output = {
    capturedAt:   now,
    environment:  'local',
    note:         'Raw provider captures. Do not expose to V production prompts or matchers.',
    summary:      { total: FOODS_TO_CAPTURE.length, verified, failed, skipped },
    records:      results,
  }

  const outPath = path.resolve(process.cwd(), '__tests__/nutrition/eval/fixtures/capture-results.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`  Results written to: ${outPath}`)
  console.log('═'.repeat(62) + '\n')
}

main().catch(err => {
  console.error('Capture failed:', err)
  process.exit(1)
})
