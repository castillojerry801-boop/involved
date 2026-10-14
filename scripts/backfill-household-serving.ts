/**
 * backfill-household-serving.ts
 *
 * Enriches existing FoodItem records with householdUnit + unitsPerServing by
 * re-querying their original provider. Runs in DRY RUN mode by default.
 *
 * Usage:
 *   npx tsx scripts/backfill-household-serving.ts              # dry run
 *   npx tsx scripts/backfill-household-serving.ts --apply      # write to DB
 *
 * Safety guarantees:
 *   - Never modifies calories, proteinG, carbohydrateG, fatG, servingSize, servingUnit
 *   - Skips any record that already has a non-null household_unit
 *   - Skips records where the provider returns ambiguous or unsupported data
 *   - Never merges or deletes duplicate FoodItems
 *   - All DB writes require explicit --apply flag
 *
 * Rate limiting:
 *   - USDA: free tier, 300ms between calls, 3 retries with backoff
 *   - FatSecret: 1100ms between calls, 3 retries with backoff
 *   - Open Food Facts: 1100ms between calls (≥1 req/sec per OFF guidelines), 3 retries with backoff
 *
 * USDA eligibility (non-100g records):
 *   USDA foodNutrients.value is always per 100g. For branded foods where servingSize ≠ 100g,
 *   the stored nutrition was historically wrong (stored as per-100g with manufacturer serving).
 *   Only records on USDA_NUTRITION_VERIFIED_IDS — whose nutrition was corrected by
 *   repair-usda-nutrition.ts on 2026-10-14 — are eligible for household unit enrichment.
 *   Records with servingSize ≈ 100g are always safe (factor=1 was never misapplied).
 */

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())
import { PrismaClient } from '@prisma/client'
import { parseHouseholdText, enrichWithFoodNoun } from '../lib/nutrition/providers/household-parser'

const prisma = new PrismaClient()
const applyMode = process.argv.includes('--apply')

// ── Types ─────────────────────────────────────────────────────────────────────

interface HouseholdResult {
  householdServingText: string | undefined
  householdUnit: string
  unitsPerServing: number
}

/** Typed outcome from a provider fetch. Distinguishes "no measurement" from "request failed". */
type FetchOutcome =
  | { kind: 'ok';      result: HouseholdResult }
  | { kind: 'no_data'; reason: string }               // request succeeded, product has no parseable unit
  | { kind: 'error';   reason: string; retryable: boolean } // HTTP/network failure

// ── Credentials ───────────────────────────────────────────────────────────────

const USDA_API_KEY    = process.env.USDA_API_KEY ?? ''
const FS_CLIENT_ID    = process.env.FATSECRET_CLIENT_ID ?? ''
const FS_CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET ?? ''

// ── USDA eligibility allowlist ────────────────────────────────────────────────
//
// Non-100g USDA branded records whose nutrition has been verified as per-serving.
// These are the 6 records corrected by repair-usda-nutrition.ts on 2026-10-14.
// Any future USDA record added with the fixed mapper (commit 26202a9+) is also
// safe, but those will be looked up fresh and won't appear in this backfill
// (which only processes records with null household_unit).
//
// A numeric FDC externalId alone is insufficient — it only proves the record
// can be API-looked-up; it does NOT prove the stored calories/macros are per-serving.
const USDA_NUTRITION_VERIFIED_IDS = new Set([
  '80b3810d-347a-490e-879a-332ad11769ce', // EGGS (OAKDELL EGG FARMS)        — corrected 2026-10-14
  'c4cf5f87-21a1-4242-bd37-089ca002351d', // AVOCADO CHUNKS (365 WFM)        — corrected 2026-10-14
  'd09e5891-644a-4a1a-99cf-b7c8ce28286e', // Chicken Nuggets (TYSON)         — corrected 2026-10-14
  '5da7470c-e9c4-4872-b4ed-6953d3a592dc', // Red Beans & Rice (ZATARAIN'S)   — corrected 2026-10-14
  '1c9e6495-d5cd-4360-ab42-df45c7953fb3', // Emergen-C Smoothie Mix          — corrected 2026-10-14
  'e4979139-3ba6-4326-b501-765a86a20148', // Sprite, Lemon-Lime Soda         — corrected 2026-10-14
])

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

/** Retry a fetch function for retryable errors only. Non-retryable errors and no_data pass through immediately. */
async function withRetry(
  fn: () => Promise<FetchOutcome>,
  maxAttempts = 3,
  baseDelayMs = 2000,
): Promise<FetchOutcome> {
  let last: FetchOutcome = { kind: 'error', reason: 'not started', retryable: false }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await fn()
    if (last.kind !== 'error' || !last.retryable) return last
    if (attempt < maxAttempts) {
      const delay = baseDelayMs * (2 ** (attempt - 1))
      console.log(`      ↺ Attempt ${attempt} failed (${last.reason}), retrying in ${delay}ms...`)
      await sleep(delay)
    }
  }
  return { kind: 'error', reason: `${last.kind === 'error' ? last.reason : 'unknown'} (max retries exceeded)`, retryable: false }
}

// ── Provider fetchers ─────────────────────────────────────────────────────────

async function fetchUsda(fdcId: string): Promise<FetchOutcome> {
  if (!USDA_API_KEY) return { kind: 'error', reason: 'USDA_API_KEY not set', retryable: false }
  try {
    const res = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${USDA_API_KEY}`)
    if (res.status === 429) return { kind: 'error', reason: `HTTP 429 rate limited`, retryable: true }
    if (res.status >= 500) return { kind: 'error', reason: `HTTP ${res.status} server error`, retryable: true }
    if (!res.ok) return { kind: 'error', reason: `HTTP ${res.status}`, retryable: false }

    const food = await res.json() as {
      dataType?: string
      description?: string
      householdServingFullText?: string
      servingSize?: number
    }
    if (food.dataType !== 'Branded') {
      return { kind: 'no_data', reason: 'not a branded food (no manufacturer serving)' }
    }
    const raw = food.householdServingFullText?.trim()
    if (!raw) return { kind: 'no_data', reason: 'no householdServingFullText from USDA' }

    const parsed = parseHouseholdText(raw)
    if (!parsed) return { kind: 'no_data', reason: `householdServingFullText "${raw}" not parseable` }

    const householdUnit = enrichWithFoodNoun(parsed.householdUnit, food.description ?? '')
    return { kind: 'ok', result: { householdServingText: raw, householdUnit, unitsPerServing: parsed.unitsPerServing } }
  } catch (e) {
    return { kind: 'error', reason: `network error: ${e instanceof Error ? e.message : String(e)}`, retryable: true }
  }
}

let fsToken: { value: string; expiresAt: number } | null = null

async function getFsToken(): Promise<string | null> {
  if (!FS_CLIENT_ID || !FS_CLIENT_SECRET) return null
  if (fsToken && fsToken.expiresAt > Date.now() + 60_000) return fsToken.value
  try {
    const creds = Buffer.from(`${FS_CLIENT_ID}:${FS_CLIENT_SECRET}`).toString('base64')
    const res = await fetch('https://oauth.fatsecret.com/connect/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=basic',
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token: string; expires_in: number }
    fsToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
    return fsToken.value
  } catch {
    return null
  }
}

async function fetchFatSecret(foodId: string): Promise<FetchOutcome> {
  const token = await getFsToken()
  if (!token) return { kind: 'error', reason: 'FatSecret token unavailable', retryable: false }
  try {
    const url = new URL('https://platform.fatsecret.com/rest/server.api')
    url.searchParams.set('method', 'food.get.v4')
    url.searchParams.set('food_id', foodId)
    url.searchParams.set('format', 'json')
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 429) return { kind: 'error', reason: `HTTP 429 rate limited`, retryable: true }
    if (res.status >= 500) return { kind: 'error', reason: `HTTP ${res.status} server error`, retryable: true }
    if (!res.ok) return { kind: 'error', reason: `HTTP ${res.status}`, retryable: false }

    const data = await res.json() as {
      food?: {
        servings?: {
          serving: {
            serving_description?: string
            measurement_description?: string
            number_of_units?: string
            metric_serving_amount?: string
          } | Array<{
            serving_description?: string
            measurement_description?: string
            number_of_units?: string
            metric_serving_amount?: string
          }>
        }
      }
    }
    if (!data.food?.servings?.serving) {
      return { kind: 'no_data', reason: 'no serving data in FatSecret response' }
    }

    const servings = Array.isArray(data.food.servings.serving)
      ? data.food.servings.serving
      : [data.food.servings.serving]

    // Prefer natural (non-100g) serving
    const serving = servings.find(s => parseFloat(s.metric_serving_amount ?? '0') !== 100) ?? servings[0]
    if (!serving) return { kind: 'no_data', reason: 'no usable serving found' }

    // measurement_description + number_of_units is the most reliable path
    if (serving.measurement_description?.trim()) {
      const noun = serving.measurement_description.trim()
      const n = parseFloat(serving.number_of_units ?? '1')
      if (noun && n > 0 && Number.isFinite(n)) {
        return { kind: 'ok', result: { householdServingText: serving.serving_description ?? undefined, householdUnit: noun, unitsPerServing: n } }
      }
    }

    // Fallback: parse serving_description text
    const desc = serving.serving_description?.trim()
    if (desc) {
      const parsed = parseHouseholdText(desc)
      if (parsed) {
        return { kind: 'ok', result: { householdServingText: desc, householdUnit: parsed.householdUnit, unitsPerServing: parsed.unitsPerServing } }
      }
    }

    return { kind: 'no_data', reason: 'serving data present but not parseable' }
  } catch (e) {
    return { kind: 'error', reason: `network error: ${e instanceof Error ? e.message : String(e)}`, retryable: true }
  }
}

async function fetchOpenFoodFacts(barcode: string): Promise<FetchOutcome> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?fields=serving_size,serving_quantity`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'InvolvedApp/1.0 (https://involvedfit.com; support@involvedfit.com)' },
    })
    if (res.status === 429) return { kind: 'error', reason: `HTTP 429 rate limited`, retryable: true }
    if (res.status >= 500) return { kind: 'error', reason: `HTTP ${res.status} server error`, retryable: true }
    if (!res.ok) return { kind: 'error', reason: `HTTP ${res.status}`, retryable: false }

    const data = await res.json() as { status: number; product?: { serving_size?: string } }
    if (data.status !== 1 || !data.product) {
      return { kind: 'no_data', reason: 'product not found in OFF database' }
    }

    const servingText = data.product.serving_size?.trim() ?? ''
    if (!servingText) return { kind: 'no_data', reason: 'no serving_size in OFF product' }

    // Extract household label from "1 tortilla (47g)" → "1 tortilla"
    const labelMatch = servingText.match(/^(.+?)\s*\(\s*[\d.]+\s*(?:g|ml)\s*\)/i)
    if (!labelMatch) return { kind: 'no_data', reason: `serving_size "${servingText}" has no household label before weight` }

    const label = labelMatch[1].trim()
    if (!label) return { kind: 'no_data', reason: 'empty household label after extraction' }
    if (/^\d+\s*g$/i.test(label)) return { kind: 'no_data', reason: `label "${label}" is a pure weight (no noun)` }

    const parsed = parseHouseholdText(label)
    if (!parsed) return { kind: 'no_data', reason: `label "${label}" not parseable by household parser` }

    return { kind: 'ok', result: { householdServingText: label, householdUnit: parsed.householdUnit, unitsPerServing: parsed.unitsPerServing } }
  } catch (e) {
    return { kind: 'error', reason: `network error: ${e instanceof Error ? e.message : String(e)}`, retryable: true }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

type FoodRecord = {
  id: string
  name: string
  brand: string | null
  sourceProvider: string | null
  externalId: string | null
  householdUnit: string | null
  servingSize: { toNumber: () => number } | null
  servingUnit: string | null
  calories: { toNumber: () => number } | null
}

async function main() {
  console.log(applyMode
    ? '⚠️  APPLY MODE — changes will be written to the database.'
    : '🔍 DRY RUN — no database changes will be made (pass --apply to write).\n'
  )

  const foods = await prisma.foodItem.findMany({
    where: { householdUnit: null },
    select: {
      id: true,
      name: true,
      brand: true,
      sourceProvider: true,
      externalId: true,
      householdUnit: true,
      servingSize: true,
      servingUnit: true,
      calories: true,
    },
  }) as FoodRecord[]

  console.log(`Found ${foods.length} food items with null household_unit.\n`)

  const SPOTLIGHT_NAMES = [
    'oakdell', 'egg whites', 'tortilla land', 'flour tortilla', 'shredded cheese',
  ]

  const byProvider: Record<string, FoodRecord[]> = {}
  for (const f of foods) {
    const p = f.sourceProvider ?? 'unknown'
    byProvider[p] = [...(byProvider[p] ?? []), f]
  }

  let totalEnriched  = 0
  let totalNoData    = 0  // provider ok, but food has no household measurement
  let totalFailed    = 0  // HTTP/network error (after retries)
  let totalSkipped   = 0  // ineligible by our own rules
  let totalApplied   = 0  // actually written (apply mode only)

  for (const [provider, records] of Object.entries(byProvider)) {
    console.log(`\n── Provider: ${provider} (${records.length} records) ──`)

    for (const food of records) {
      const isSpotlight = SPOTLIGHT_NAMES.some(s =>
        food.name.toLowerCase().includes(s) || (food.brand?.toLowerCase().includes(s) ?? false)
      )
      const label = `${food.name}${food.brand ? ` (${food.brand})` : ''}`

      const srv = food.servingSize?.toNumber() ?? 0
      const cal = food.calories?.toNumber() ?? 0

      // ── Eligibility checks ─────────────────────────────────────────────────

      // Reject physically impossible nutrition (corrupted source data).
      // Pure fat ≈ 9 kcal/g. Use 10 kcal/g as the ceiling.
      if (srv > 0 && cal > 0 && cal / srv > 10) {
        totalSkipped++
        console.log(`  ⚠️  ${label.slice(0, 55)} — skipped: impossible nutrition (${Math.round(cal)} kcal for ${srv}g)`)
        continue
      }

      // USDA: non-100g records require verified nutrition.
      // Records with servingSize ≈ 100g always had factor=1 (safe).
      // Non-100g records needed the repair script — only those on USDA_NUTRITION_VERIFIED_IDS
      // can be trusted to have per-serving nutrition stored correctly.
      if (provider === 'usda_fooddata' && Math.abs(srv - 100) > 2) {
        if (!USDA_NUTRITION_VERIFIED_IDS.has(food.id)) {
          totalSkipped++
          const reason = food.externalId && !/^\d+$/.test(food.externalId)
            ? 'cascade duplicate — UUID externalId (nutrition uncorrected)'
            : 'USDA non-100g record not on nutrition-verified allowlist'
          if (isSpotlight) {
            console.log(`  ⚠️  [SPOTLIGHT] ${label}`)
            console.log(`      ID: ${food.id} | skipped: ${reason}`)
          } else {
            console.log(`  ⚠️  ${label.slice(0, 55)} — skipped: ${reason}`)
          }
          continue
        }
      }

      // ── Provider fetch ─────────────────────────────────────────────────────

      let outcome: FetchOutcome

      if (provider === 'usda_fooddata' && food.externalId && /^\d+$/.test(food.externalId)) {
        outcome = await withRetry(() => fetchUsda(food.externalId!))
        await sleep(300)
      } else if (provider === 'fatsecret' && food.externalId && /^\d+$/.test(food.externalId)) {
        outcome = await withRetry(() => fetchFatSecret(food.externalId!))
        await sleep(1100)
      } else if (provider === 'open_food_facts' && food.externalId && /^\d{8,14}$/.test(food.externalId)) {
        outcome = await withRetry(() => fetchOpenFoodFacts(food.externalId!))
        await sleep(1100)  // ≥1 req/sec per OFF guidelines
      } else {
        if (isSpotlight) {
          console.log(`  ⚠️  [SPOTLIGHT] ${label}`)
          console.log(`      ID: ${food.id} | externalId: ${food.externalId} | provider: ${provider}`)
          console.log(`      Skipped: no supported enrichment path for this provider/ID combination.`)
        }
        totalSkipped++
        continue
      }

      // ── Outcome handling ──────────────────────────────────────────────────

      if (outcome.kind === 'error') {
        totalFailed++
        // Always log provider errors — these are actionable failures, not just missing data
        console.log(`  ✗ ${isSpotlight ? '[SPOTLIGHT] ' : ''}${label.slice(0, 55)}`)
        console.log(`      ID: ${food.id} | externalId: ${food.externalId}`)
        console.log(`      Provider error: ${outcome.reason}`)
        continue
      }

      if (outcome.kind === 'no_data') {
        totalNoData++
        if (isSpotlight) {
          console.log(`  ○ [SPOTLIGHT] ${label}`)
          console.log(`      ID: ${food.id} | externalId: ${food.externalId}`)
          console.log(`      No household measurement: ${outcome.reason}`)
        }
        // Log all USDA no-data (only 19 records, all worth noting)
        if (provider === 'usda_fooddata' && !isSpotlight) {
          console.log(`  ○ ${label.slice(0, 55)} — no measurement: ${outcome.reason}`)
        }
        continue
      }

      // outcome.kind === 'ok'
      const result = outcome.result

      // Skip "serving" — SERVING_ALIASES already handles it in computeIngredientFactor
      if (result.householdUnit === 'serving') {
        totalSkipped++
        if (isSpotlight) console.log(`  ⚠️  [SPOTLIGHT] ${label} — skipped: householdUnit="serving" adds no value`)
        continue
      }

      // Skip compound/overlong or symbol-laden unit labels
      if (result.householdUnit.length > 30 || /[()"]/.test(result.householdUnit)) {
        totalSkipped++
        if (isSpotlight) {
          console.log(`  ⚠️  [SPOTLIGHT] ${label}`)
          console.log(`      Skipped: unusable unit label: "${result.householdUnit}"`)
        } else {
          console.log(`  ⚠️  ${label.slice(0, 55)} — skipped: unusable unit label ("${result.householdUnit.slice(0, 40)}")`)
        }
        continue
      }

      // Eligible — log and optionally write
      totalEnriched++
      const spotlight = isSpotlight ? ' [SPOTLIGHT]' : ''
      console.log(`  ✓${spotlight} ${label}`)
      console.log(`      ID: ${food.id}`)
      console.log(`      householdUnit="${result.householdUnit}", unitsPerServing=${result.unitsPerServing}`)
      if (result.householdServingText) {
        console.log(`      householdServingText="${result.householdServingText}"`)
      }

      if (applyMode) {
        await prisma.foodItem.update({
          where: { id: food.id },
          data: {
            householdUnit: result.householdUnit,
            unitsPerServing: result.unitsPerServing,
            householdServingText: result.householdServingText ?? undefined,
          },
        })
        totalApplied++
        console.log(`      ✅ Updated.`)
      }
    }
  }

  const alreadySet = await prisma.foodItem.count({ where: { householdUnit: { not: null } } })

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Summary:`)
  console.log(`  Enrichable:        ${totalEnriched} records${applyMode ? ` (${totalApplied} applied)` : ''}`)
  console.log(`  No data from API:  ${totalNoData} records (product exists, no parseable household unit)`)
  console.log(`  Provider errors:   ${totalFailed} records (HTTP/network failures after retries)`)
  console.log(`  Skipped:           ${totalSkipped} records (ineligible by eligibility rules)`)
  console.log(`  Already set:       ${alreadySet} records (existing household_unit preserved)`)

  if (!applyMode && totalEnriched > 0) {
    console.log(`\nRe-run with --apply to write ${totalEnriched} updates to the database.`)
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
