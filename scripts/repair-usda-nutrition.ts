/**
 * repair-usda-nutrition.ts
 *
 * Corrects stored nutrition for USDA branded foods where the USDA mapper previously
 * stored per-100g nutrient values with a non-100g manufacturer serving size.
 *
 * Root cause: USDA foodNutrients.value is always per 100g. The mapper (now fixed)
 * was storing these raw per-100g values directly, while the DB servingSize reflected
 * the manufacturer's actual serving size. Example: Oakdell Eggs stored 136 kcal with
 * a 44g serving — but 136 is the per-100g value; the correct per-serving value is ~60 kcal.
 *
 * This script re-fetches each affected record from the USDA FDC API, applies the
 * corrected nutritionFactor = servingSize/100 scaling, and reports old vs. new values.
 * In --apply mode it updates calories, proteinG, carbohydrateG, fatG, and nutrientsJson.
 *
 * Safety guarantees:
 *   - Never modifies FoodLogEntry snapshot calories (those are immutable log records)
 *   - Never modifies servingSize, servingUnit, or any household fields
 *   - Skips records that cannot be verified against the USDA API
 *   - Skips records where the DB nutrition already matches the corrected value (within 2 kcal)
 *   - All DB writes require explicit --apply flag
 *
 * Usage:
 *   npx tsx scripts/repair-usda-nutrition.ts              # dry run (default)
 *   npx tsx scripts/repair-usda-nutrition.ts --apply      # write corrections to DB
 */

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const applyMode = process.argv.includes('--apply')

const USDA_API_KEY = process.env.USDA_API_KEY ?? ''
const FETCH_TIMEOUT_MS = 8000

// USDA nutrient IDs
const NID = {
  calories:      [1008, 2047, 2048] as number[],
  protein:       1003,
  carbs:         1005,
  fat:           1004,
  fiber:         1079,
  sugar:         2000,
  sodium:        1093,
  saturatedFat:  1258,
  transFat:      1257,
  cholesterol:   1253,
  potassium:     1092,
  calcium:       1087,
  iron:          1089,
  vitaminD:      1110,
  vitaminC:      1162,
  vitaminA:      1104,
} as const

interface UsdaDetailFood {
  fdcId: number
  description: string
  dataType?: string
  servingSize?: number
  servingSizeUnit?: string
  foodNutrients: Array<{
    nutrientId?: number
    nutrient?: { id: number }
    value?: number
    amount?: number
  }>
}

function getNutrient(food: UsdaDetailFood, id: number | number[]): number {
  const ids = Array.isArray(id) ? id : [id]
  for (const nid of ids) {
    const row = food.foodNutrients.find(n => (n.nutrientId ?? n.nutrient?.id) === nid)
    const val = row?.value ?? row?.amount
    if (val != null && val > 0) return val
  }
  return 0
}

function mineral(val: number): number | undefined {
  return val > 0 ? val : undefined
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchUsdaDetail(fdcId: string): Promise<UsdaDetailFood | null> {
  if (!USDA_API_KEY) return null
  try {
    const res = await fetchWithTimeout(
      `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${USDA_API_KEY}`
    )
    if (!res.ok) return null
    return await res.json() as UsdaDetailFood
  } catch {
    return null
  }
}

type DbRecord = {
  id: string
  name: string
  brand: string | null
  externalId: string | null
  servingSize: { toNumber: () => number } | null
  servingUnit: string
  calories: { toNumber: () => number } | null
  proteinG: { toNumber: () => number } | null
  carbohydrateG: { toNumber: () => number } | null
  fatG: { toNumber: () => number } | null
}

async function main() {
  if (!USDA_API_KEY) {
    console.error('❌  USDA_API_KEY not set. Cannot fetch from FDC API.')
    process.exit(1)
  }

  console.log(applyMode
    ? '⚠️  APPLY MODE — nutrition corrections will be written to the database.\n'
    : '🔍 DRY RUN — no database changes (pass --apply to write).\n'
  )
  console.log('NOTE: FoodLogEntry snapshot calories are never modified by this script.\n')

  // Find all USDA branded foods with non-100g servings (the affected population).
  // servingSize is stored as Decimal in Prisma so we do the >2 filter in JS.
  const allUsda = await prisma.foodItem.findMany({
    where: { sourceProvider: 'usda_fooddata' },
    select: {
      id: true,
      name: true,
      brand: true,
      externalId: true,
      servingSize: true,
      servingUnit: true,
      calories: true,
      proteinG: true,
      carbohydrateG: true,
      fatG: true,
    },
  }) as DbRecord[]

  const affected = allUsda.filter(f => {
    const srv = f.servingSize?.toNumber() ?? 100
    return Math.abs(srv - 100) > 2
  })

  console.log(`USDA foods in DB: ${allUsda.length}`)
  console.log(`Non-100g serving (potentially wrong nutrition): ${affected.length}\n`)

  if (affected.length === 0) {
    console.log('Nothing to repair.')
    await prisma.$disconnect()
    return
  }

  let totalVerified = 0
  let totalAlreadyCorrect = 0
  let totalFailed = 0
  let totalApplied = 0

  for (const food of affected) {
    const label = `${food.name}${food.brand ? ` (${food.brand})` : ''}`
    const srv = food.servingSize?.toNumber() ?? 100
    const dbCal = food.calories?.toNumber() ?? 0

    console.log(`─── ${label}`)
    console.log(`    ID: ${food.id} | FDC: ${food.externalId}`)

    if (!food.externalId || !/^\d+$/.test(food.externalId)) {
      console.log(`    ⚠️  Skipped: no numeric externalId — cannot look up on USDA FDC\n`)
      totalFailed++
      await sleep(300)
      continue
    }

    const detail = await fetchUsdaDetail(food.externalId)
    await sleep(350)  // respect USDA rate limit

    if (!detail) {
      console.log(`    ✗  FDC API returned no data\n`)
      totalFailed++
      continue
    }

    if (detail.dataType !== 'Branded') {
      console.log(`    ⚠️  Skipped: dataType="${detail.dataType}" (only Branded foods need scaling)\n`)
      totalFailed++
      continue
    }

    const apiServingSize = detail.servingSize ?? 100
    if (Math.abs(apiServingSize - srv) > 5) {
      console.log(`    ⚠️  Skipped: DB servingSize=${srv}g but API servingSize=${apiServingSize}g (>${5}g mismatch — cannot safely correct)\n`)
      totalFailed++
      continue
    }

    const factor = srv / 100

    const newCal  = Math.round(getNutrient(detail, NID.calories) * factor)
    const newProt = Math.round(getNutrient(detail, NID.protein) * factor * 10) / 10
    const newCarb = Math.round(getNutrient(detail, NID.carbs) * factor * 10) / 10
    const newFat  = Math.round(getNutrient(detail, NID.fat) * factor * 10) / 10

    if (newCal === 0 && newProt === 0 && newCarb === 0 && newFat === 0) {
      console.log(`    ⚠️  Skipped: API returned no usable nutrient data after scaling\n`)
      totalFailed++
      continue
    }

    const oldCal  = dbCal
    const oldProt = food.proteinG?.toNumber() ?? 0
    const oldCarb = food.carbohydrateG?.toNumber() ?? 0
    const oldFat  = food.fatG?.toNumber() ?? 0

    // Already correct if within rounding tolerance
    if (Math.abs(newCal - oldCal) <= 2) {
      console.log(`    ✓  Already correct (${oldCal} kcal stored = ${newCal} kcal computed, within rounding)\n`)
      totalAlreadyCorrect++
      continue
    }

    console.log(`    servingSize: ${srv}${food.servingUnit} | nutritionFactor: ${factor.toFixed(3)}`)
    console.log(`    Current (WRONG — per 100g):  ${oldCal} kcal | P ${oldProt}g | C ${oldCarb}g | F ${oldFat}g`)
    console.log(`    Proposed (correct per ${srv}g): ${newCal} kcal | P ${newProt}g | C ${newCarb}g | F ${newFat}g`)

    const newNutrientsJson = {
      fiberG:        mineral(getNutrient(detail, NID.fiber) * factor),
      sugarG:        mineral(getNutrient(detail, NID.sugar) * factor),
      sodiumMg:      mineral(getNutrient(detail, NID.sodium) * factor),
      saturatedFatG: mineral(getNutrient(detail, NID.saturatedFat) * factor),
      transFatG:     mineral(getNutrient(detail, NID.transFat) * factor),
      cholesterolMg: mineral(getNutrient(detail, NID.cholesterol) * factor),
      potassiumMg:   mineral(getNutrient(detail, NID.potassium) * factor),
      calciumMg:     mineral(getNutrient(detail, NID.calcium) * factor),
      ironMg:        mineral(getNutrient(detail, NID.iron) * factor),
      vitaminDMcg:   mineral(getNutrient(detail, NID.vitaminD) * factor),
      vitaminCMg:    mineral(getNutrient(detail, NID.vitaminC) * factor),
      vitaminAMcg:   mineral(getNutrient(detail, NID.vitaminA) * factor),
    }
    const filteredNutrientsJson = Object.fromEntries(
      Object.entries(newNutrientsJson).filter(([, v]) => v !== undefined)
    )

    totalVerified++

    if (applyMode) {
      await prisma.foodItem.update({
        where: { id: food.id },
        data: {
          calories: newCal,
          proteinG: newProt,
          carbohydrateG: newCarb,
          fatG: newFat,
          nutrientsJson: Object.keys(filteredNutrientsJson).length > 0
            ? filteredNutrientsJson
            : undefined,
        },
      })
      console.log(`    ✅  Updated in DB`)
      totalApplied++
    }
    console.log()
  }

  console.log('─'.repeat(60))
  console.log('Summary:')
  console.log(`  Correctable (wrong nutrition confirmed): ${totalVerified}`)
  console.log(`  Already correct (within rounding):       ${totalAlreadyCorrect}`)
  console.log(`  Could not verify (API/mismatch/skip):    ${totalFailed}`)
  if (applyMode) console.log(`  Applied to DB:                           ${totalApplied}`)

  if (!applyMode && totalVerified > 0) {
    console.log(`\nRe-run with --apply to write ${totalVerified} correction(s) to the database.`)
    console.log('\n⚠️  FoodLogEntry snapshot calories are NOT modified.')
    console.log('    Historical logs will retain their original (incorrect) values.')
    console.log('    Only new logs after this correction will use the accurate nutrition.')
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
