import 'server-only'
import { prisma } from '@/lib/prisma'
import { buildMealLogToken } from '@/lib/v/meal-log-token'
import type { IngredientResult } from './calculate-nutrition'

const VALID_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'other'])
const LOG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Meals are retrievable up to 90 days back. Logging destination is still bound
// by the confirm route's 30-day limit; the retrieval window is deliberately wider.
const MAX_LOOKBACK_DAYS = 90

type MealTypeLiteral = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other'

export interface GetMealLogArgs {
  sourceDate: string           // YYYY-MM-DD or 'most_recent'
  sourceMealType: string
  scaleFactor?: number         // 0.5 = half, 2.0 = double, default 1.0
  // Only required when sourceDate === 'most_recent': the intended log date,
  // so the most-recently logged meal BEFORE that date is returned (avoids
  // returning a meal the user is in the middle of logging today).
  destinationDate?: string
}

export interface GetMealLogResult {
  status: 'found' | 'empty' | 'error'
  calculationToken?: string
  sourceDate?: string
  sourceMealType?: string
  itemCount?: number
  totals?: { calories: number; proteinG: number; carbG: number; fatG: number }
  scaleApplied?: number
  message: string
}

function isValidDateStr(s: string): boolean {
  if (!LOG_DATE_RE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !isNaN(d.getTime())
}

// Clamp scale to a safe range; silently correct nonsense values.
function clampScale(v: unknown): number {
  const n = typeof v === 'number' ? v : 1
  if (!isFinite(n) || n <= 0) return 1
  return Math.min(10, Math.max(0.01, n))
}

function roundMacro(v: number): number {
  return Math.round(v * 10) / 10
}

// Extract the user's original food description from the estimateSourceNote
// that was written at log time. Format: "Coach V — {description}" or
// "Coach V (partial — N item(s) not logged) — {description}".
function extractDescription(note: string | null, fallback: string): string {
  if (!note) return fallback
  const m = note.match(/ — (.+)$/)
  return m ? m[1] : fallback
}

export async function getMealLog(userId: string, args: GetMealLogArgs): Promise<GetMealLogResult> {
  if (!VALID_MEAL_TYPES.has(args.sourceMealType)) {
    return {
      status: 'error',
      message: `Invalid sourceMealType "${args.sourceMealType}". Use: breakfast, lunch, dinner, snack, or other.`,
    }
  }

  const scaleFactor    = clampScale(args.scaleFactor)
  const sourceMealType = args.sourceMealType as MealTypeLiteral

  let sourceDate: string
  let entries: Awaited<ReturnType<typeof prisma.foodLogEntry.findMany>>

  if (args.sourceDate === 'most_recent') {
    // Find the most recent instance of this meal type before the destination date.
    const destStr =
      args.destinationDate && isValidDateStr(args.destinationDate)
        ? args.destinationDate
        : new Date().toISOString().slice(0, 10)

    const excludeDate = new Date(destStr + 'T00:00:00Z')
    const cutoffDate  = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - MAX_LOOKBACK_DAYS)
    cutoffDate.setUTCHours(0, 0, 0, 0)

    const candidates = await prisma.foodLogEntry.findMany({
      where: {
        userId,
        mealType: sourceMealType,
        logDate: { lt: excludeDate, gte: cutoffDate },
      },
      orderBy: { logDate: 'desc' },
      take: 100,
    })

    if (candidates.length === 0) {
      return {
        status: 'empty',
        message: `No previous ${sourceMealType} found in the last ${MAX_LOOKBACK_DAYS} days.`,
      }
    }

    // Isolate all entries belonging to the single most-recent date.
    const mostRecentDateStr = candidates[0].logDate.toISOString().slice(0, 10)
    entries    = candidates.filter(e => e.logDate.toISOString().slice(0, 10) === mostRecentDateStr)
    sourceDate = mostRecentDateStr

  } else {
    if (!isValidDateStr(args.sourceDate)) {
      return {
        status: 'error',
        message: `Invalid sourceDate "${args.sourceDate}". Expected YYYY-MM-DD or "most_recent".`,
      }
    }

    const sourceDateObj = new Date(args.sourceDate + 'T00:00:00Z')
    const cutoffDate    = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - MAX_LOOKBACK_DAYS)
    cutoffDate.setUTCHours(0, 0, 0, 0)

    if (sourceDateObj < cutoffDate) {
      return {
        status: 'error',
        message: `Date too far in the past — meal history is available for the last ${MAX_LOOKBACK_DAYS} days.`,
      }
    }

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setUTCHours(0, 0, 0, 0)
    if (sourceDateObj >= tomorrow) {
      return { status: 'error', message: 'Cannot retrieve meals logged in the future.' }
    }

    sourceDate = args.sourceDate
    entries    = await prisma.foodLogEntry.findMany({
      where: {
        userId,
        mealType: sourceMealType,
        logDate:  new Date(sourceDate + 'T00:00:00Z'),
      },
      orderBy: { loggedAt: 'asc' },
    })
  }

  if (entries.length === 0) {
    return {
      status:         'empty',
      message:        `No ${sourceMealType} entries found for ${sourceDate}.`,
      sourceDate,
      sourceMealType,
    }
  }

  // Build IngredientResult[] from the saved FoodLogEntry snapshots.
  // servingMultiplier is almost always 1, but we apply it for correctness.
  // scaleFactor applies proportional scaling (half, double, etc.) before signing.
  const ingredients: IngredientResult[] = entries.map(entry => {
    const mult = Number(entry.servingMultiplier)
    const cal  = Number(entry.snapshotCaloriesPerServing)      * mult * scaleFactor
    const pro  = Number(entry.snapshotProteinGPerServing)      * mult * scaleFactor
    const carb = Number(entry.snapshotCarbohydrateGPerServing) * mult * scaleFactor
    const fat  = Number(entry.snapshotFatGPerServing)          * mult * scaleFactor

    const conversionNote = scaleFactor !== 1
      ? `${scaleFactor}× of ${sourceDate} logged serving`
      : `From ${sourceDate} ${sourceMealType} log`

    return {
      userDescription: extractDescription(entry.estimateSourceNote ?? null, entry.snapshotFoodName),
      matchedFoodName: entry.snapshotFoodName,
      matchConfidence: 'confident' as const,
      calories: roundMacro(cal),
      proteinG: roundMacro(pro),
      carbG:    roundMacro(carb),
      fatG:     roundMacro(fat),
      resolved: true,
      conversionNote,
    }
  })

  const totals = ingredients.reduce(
    (acc, ing) => ({
      calories: acc.calories + ing.calories,
      proteinG: acc.proteinG + ing.proteinG,
      carbG:    acc.carbG    + ing.carbG,
      fatG:     acc.fatG     + ing.fatG,
    }),
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  )
  totals.calories = Math.round(totals.calories)
  totals.proteinG = roundMacro(totals.proteinG)
  totals.carbG    = roundMacro(totals.carbG)
  totals.fatG     = roundMacro(totals.fatG)

  // A fresh calculationId per invocation means idempotency keys are unique to
  // this retrieval: double-click → P2002 (safe); deliberate re-log → new ID → allowed.
  const calculationToken = buildMealLogToken(userId, {
    ingredients,
    totals,
    completeness: 'complete',
    unresolvedIngredients: [],
  })

  if (!calculationToken) {
    return {
      status:  'error',
      message: 'Meal logging is temporarily unavailable (signing key missing). Please try again later.',
    }
  }

  const scaleLabel = scaleFactor !== 1 ? ` (${scaleFactor}× scale applied)` : ''
  return {
    status:         'found',
    calculationToken,
    sourceDate,
    sourceMealType,
    itemCount:      entries.length,
    totals,
    scaleApplied:   scaleFactor !== 1 ? scaleFactor : undefined,
    message:
      `Found ${entries.length} item(s) from ${sourceDate} ${sourceMealType}${scaleLabel}. ` +
      `Call prepare_meal_log with the calculationRefId, the DESTINATION logDate, and the DESTINATION mealType. ` +
      `Do not pass the source date or source meal type to prepare_meal_log.`,
  }
}
