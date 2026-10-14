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
 *   - USDA: free tier, ~300ms delay between calls
 *   - FatSecret: throttled to ~1 req/sec
 *   - Open Food Facts: 200ms delay between calls
 */

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())
import { PrismaClient } from '@prisma/client'
import { parseHouseholdText, enrichWithFoodNoun } from '../lib/nutrition/providers/household-parser'

const prisma = new PrismaClient()
const applyMode = process.argv.includes('--apply')

// ── Provider-specific fetchers ────────────────────────────────────────────────

const USDA_API_KEY = process.env.USDA_API_KEY ?? ''
const FS_CLIENT_ID = process.env.FATSECRET_CLIENT_ID ?? ''
const FS_CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET ?? ''

interface HouseholdResult {
  householdServingText: string | undefined
  householdUnit: string
  unitsPerServing: number
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchUsda(fdcId: string): Promise<HouseholdResult | null> {
  if (!USDA_API_KEY) return null
  try {
    const res = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${USDA_API_KEY}`)
    if (!res.ok) return null
    const food = await res.json() as {
      dataType?: string
      description?: string
      householdServingFullText?: string
      servingSize?: number
    }
    // Only branded foods have a manufacturer-defined serving that matches householdServingFullText
    if (food.dataType !== 'Branded') return null
    const raw = food.householdServingFullText?.trim()
    if (!raw) return null
    const parsed = parseHouseholdText(raw)
    if (!parsed) return null
    const householdUnit = enrichWithFoodNoun(parsed.householdUnit, food.description ?? '')
    return {
      householdServingText: raw,
      householdUnit,
      unitsPerServing: parsed.unitsPerServing,
    }
  } catch {
    return null
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

async function fetchFatSecret(foodId: string): Promise<HouseholdResult | null> {
  const token = await getFsToken()
  if (!token) return null
  try {
    const url = new URL('https://platform.fatsecret.com/rest/server.api')
    url.searchParams.set('method', 'food.get.v4')
    url.searchParams.set('food_id', foodId)
    url.searchParams.set('format', 'json')
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
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
    if (!data.food?.servings?.serving) return null

    const servings = Array.isArray(data.food.servings.serving)
      ? data.food.servings.serving
      : [data.food.servings.serving]

    // Prefer natural (non-100g) serving
    const serving = servings.find(s => parseFloat(s.metric_serving_amount ?? '0') !== 100)
      ?? servings[0]

    if (!serving) return null

    // measurement_description + number_of_units is the most reliable path
    if (serving.measurement_description?.trim()) {
      const noun = serving.measurement_description.trim()
      const n = parseFloat(serving.number_of_units ?? '1')
      if (noun && n > 0 && Number.isFinite(n)) {
        return {
          householdServingText: serving.serving_description ?? undefined,
          householdUnit: noun,
          unitsPerServing: n,
        }
      }
    }

    // Fallback: parse serving_description text
    const desc = serving.serving_description?.trim()
    if (desc) {
      const parsed = parseHouseholdText(desc)
      if (parsed) {
        return {
          householdServingText: desc,
          householdUnit: parsed.householdUnit,
          unitsPerServing: parsed.unitsPerServing,
        }
      }
    }

    return null
  } catch {
    return null
  }
}

async function fetchOpenFoodFacts(barcode: string): Promise<HouseholdResult | null> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?fields=serving_size,serving_quantity`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'InvolvedApp/1.0 (https://involvedfit.com; support@involvedfit.com)' },
    })
    if (!res.ok) return null
    const data = await res.json() as { status: number; product?: { serving_size?: string } }
    if (data.status !== 1 || !data.product) return null

    const servingText = data.product.serving_size?.trim() ?? ''
    if (!servingText) return null

    // Extract label from "1 tortilla (47g)" → "1 tortilla"
    const labelMatch = servingText.match(/^(.+?)\s*\(\s*[\d.]+\s*(?:g|ml)\s*\)/i)
    if (!labelMatch) return null
    const label = labelMatch[1].trim()
    if (!label || /^\d+\s*g$/i.test(label)) return null

    const parsed = parseHouseholdText(label)
    if (!parsed) return null

    return {
      householdServingText: label,
      householdUnit: parsed.householdUnit,
      unitsPerServing: parsed.unitsPerServing,
    }
  } catch {
    return null
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
  // servingSize/calories used to detect USDA per-100g/per-serving mismatch and corrupted data
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

  // Spotlight foods for specific examination
  const SPOTLIGHT_NAMES = [
    'oakdell', 'egg whites', 'tortilla land', 'flour tortilla', 'shredded cheese',
  ]

  const byProvider: Record<string, FoodRecord[]> = {}
  for (const f of foods) {
    const p = f.sourceProvider ?? 'unknown'
    byProvider[p] = [...(byProvider[p] ?? []), f]
  }

  let totalEnriched = 0
  let totalSkipped  = 0
  let totalFailed   = 0

  for (const [provider, records] of Object.entries(byProvider)) {
    console.log(`\n── Provider: ${provider} (${records.length} records) ──`)

    for (const food of records) {
      const isSpotlight = SPOTLIGHT_NAMES.some(s =>
        food.name.toLowerCase().includes(s) || (food.brand?.toLowerCase().includes(s) ?? false)
      )
      const label = `${food.name}${food.brand ? ` (${food.brand})` : ''}`

      let result: HouseholdResult | null = null

      // Reject records with physically impossible nutrition (corrupted source data).
      // Pure fat has ~9 kcal/g — nothing real exceeds that. Use 10 kcal/g as the ceiling.
      const srv = food.servingSize?.toNumber() ?? 0
      const cal = food.calories?.toNumber() ?? 0
      if (srv > 0 && cal > 0 && cal / srv > 10) {
        totalSkipped++
        console.log(`  ⚠️  ${label.slice(0, 50)} — skipped: impossible nutrition (${Math.round(cal)}kcal for ${srv}g = ${Math.round(cal/srv*100)}kcal/100g)`)
        continue
      }

      // USDA branded foods: the search endpoint returns nutrients per 100g.
      // The mapper stores those per-100g values with the manufacturer's serving size — a known
      // mismatch. Until the USDA mapper is fixed to scale by servingSize/100, household units
      // must NOT be applied to records where servingSize ≠ 100g (i.e., non-100g branded foods),
      // because computeIngredientFactor would multiply against the wrong nutrition basis.
      // Example: Oakdell Eggs stores 136 kcal (per 100g) with 44g serving → "1 egg = 136 kcal"
      // is wrong. labelNutrients shows the correct value: 59.8 kcal per egg.
      if (provider === 'usda_fooddata') {
        if (Math.abs(srv - 100) > 2) {
          totalSkipped++
          const reason = `USDA nutrition basis mismatch: servingSize=${srv}${food.servingUnit ?? 'g'} ≠ 100g (per-100g nutrients stored with non-100g serving)`
          if (isSpotlight) {
            console.log(`  ⚠️  [SPOTLIGHT][NUTRITION MISMATCH] ${label}`)
            console.log(`      ID: ${food.id} | ${reason}`)
          } else {
            console.log(`  ⚠️  ${label.slice(0, 50)} — skipped: ${reason}`)
          }
          continue
        }
      }

      if (provider === 'usda_fooddata' && food.externalId) {
        result = await fetchUsda(food.externalId)
        await sleep(300)
      } else if (provider === 'fatsecret' && food.externalId && /^\d+$/.test(food.externalId)) {
        result = await fetchFatSecret(food.externalId)
        await sleep(1000)
      } else if (provider === 'open_food_facts' && food.externalId && /^\d{8,14}$/.test(food.externalId)) {
        result = await fetchOpenFoodFacts(food.externalId)
        await sleep(200)
      } else {
        if (isSpotlight) {
          console.log(`  ⚠️  [SPOTLIGHT] ${label}`)
          console.log(`      ID: ${food.id} | externalId: ${food.externalId} | provider: ${provider}`)
          console.log(`      Skipped: no supported enrichment path for this provider/ID combination.`)
        }
        totalSkipped++
        continue
      }

      // Skip householdUnit="serving" — it adds no information over the existing default behavior.
      // SERVING_ALIASES already handles "serving" in computeIngredientFactor; storing it explicitly
      // provides no UX improvement (dropdown already has "serving") and clutters the data.
      if (result && result.householdUnit === 'serving') {
        totalSkipped++
        continue
      }

      // Skip compound/overlong or symbol-laden unit labels that would be unusable as dropdown options.
      // Examples rejected: "cup dry mix (50g) (1 cup prepared)", 'medium (7" to 7-7/8" long)'
      const unitIsUnusable = result && (
        result.householdUnit.length > 30 ||
        /[()"]/.test(result.householdUnit)
      )
      if (unitIsUnusable) {
        totalSkipped++
        if (isSpotlight) {
          console.log(`  ⚠️  [SPOTLIGHT] ${label}`)
          console.log(`      Skipped: unusable unit label: "${result!.householdUnit}"`)
        } else {
          console.log(`  ⚠️  ${label} — skipped: unusable unit label ("${result!.householdUnit.slice(0, 40)}")`)
        }
        continue
      }

      if (result) {
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
          console.log(`      ✅ Updated.`)
        }
      } else {
        totalFailed++
        if (isSpotlight) {
          console.log(`  ✗ [SPOTLIGHT] ${label}`)
          console.log(`      ID: ${food.id} | externalId: ${food.externalId}`)
          console.log(`      Provider returned no usable household data.`)
        }
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Summary:`)
  console.log(`  Enrichable:  ${totalEnriched} records`)
  console.log(`  No data:     ${totalFailed} records`)
  console.log(`  Skipped:     ${totalSkipped} records (unsupported provider/ID)`)
  console.log(`  Already set: ${(await prisma.foodItem.count({ where: { householdUnit: { not: null } } }))} records`)

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
