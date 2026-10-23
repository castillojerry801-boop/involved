import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'
import type { IngredientResult, UnresolvedIngredient } from './tools/calculate-nutrition'

// MEAL_LOG_SIGNING_KEY is a server-only secret (32-byte hex, i.e. 64 hex chars).
// Generate with: openssl rand -hex 32
// If absent the token functions return null / false; callers must surface a
// "meal logging unavailable" message to the user — never expose the absence to the AI.
// Read lazily so that test stubs set with vi.stubEnv are picked up correctly.
function getSigningKey() { return process.env.MEAL_LOG_SIGNING_KEY ?? '' }

// 2-hour window — enough for a realistic coaching conversation.
// Exported so MealCalculationRef rows use the same expiry.
export const TOKEN_TTL_SECONDS = 7200

export interface MealLogTokenPayload {
  calculationId: string
  userId: string
  issuedAt: number   // unix timestamp (seconds)
  expiresAt: number  // issuedAt + TOKEN_TTL_SECONDS
  ingredients: IngredientResult[]
  totals: {
    calories: number
    proteinG: number
    carbG: number
    fatG: number
  }
  completeness: 'complete' | 'estimated' | 'incomplete'
  unresolvedIngredients: UnresolvedIngredient[]
}

// ─── Sign ────────────────────────────────────────────────────────────────────

export function signMealLogToken(payload: MealLogTokenPayload): string | null {
  if (!getSigningKey()) return null
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig  = createHmac('sha256', getSigningKey()).update(body).digest('hex')
  return `${body}.${sig}`
}

// ─── Verify ──────────────────────────────────────────────────────────────────

export type VerifyResult =
  | { ok: true;  payload: MealLogTokenPayload }
  | { ok: false; reason: 'no_key' | 'malformed' | 'invalid_signature' | 'expired' | 'wrong_user' }

export function verifyMealLogToken(token: string, userId: string): VerifyResult {
  if (!getSigningKey()) return { ok: false, reason: 'no_key' }

  const dot = token.lastIndexOf('.')
  if (dot < 1) return { ok: false, reason: 'malformed' }

  const body = token.slice(0, dot)
  const sig  = token.slice(dot + 1)

  // Constant-time comparison to prevent timing attacks
  const expected = createHmac('sha256', getSigningKey()).update(body).digest('hex')
  try {
    const match = timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
    if (!match) return { ok: false, reason: 'invalid_signature' }
  } catch {
    return { ok: false, reason: 'invalid_signature' }
  }

  let payload: MealLogTokenPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as MealLogTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (Math.floor(Date.now() / 1000) > payload.expiresAt) {
    return { ok: false, reason: 'expired' }
  }

  if (payload.userId !== userId) {
    return { ok: false, reason: 'wrong_user' }
  }

  return { ok: true, payload }
}

// ─── Build ───────────────────────────────────────────────────────────────────
// Convenience factory used by the calculate_nutrition dispatch.

export function buildMealLogToken(
  userId: string,
  result: {
    ingredients: IngredientResult[]
    totals: MealLogTokenPayload['totals']
    completeness: MealLogTokenPayload['completeness']
    unresolvedIngredients: UnresolvedIngredient[]
  },
): string | null {
  const now = Math.floor(Date.now() / 1000)
  const payload: MealLogTokenPayload = {
    calculationId: crypto.randomUUID(),
    userId,
    issuedAt:  now,
    expiresAt: now + TOKEN_TTL_SECONDS,
    ingredients:          result.ingredients,
    totals:               result.totals,
    completeness:         result.completeness,
    unresolvedIngredients: result.unresolvedIngredients,
  }
  return signMealLogToken(payload)
}

// ─── Ingredient selection ──────────────────────────────────────────────────────
// Server-authoritative selection over a verified token payload. The AI may only
// supply WHICH ingredients to include, by their stable original index in
// payload.ingredients. Every macro value is read from the signed token here —
// nothing the AI or client sends can introduce or alter nutrition data.
//
// Semantics:
//   includeIndexes === undefined  → select ALL resolved ingredients (the default:
//                                    "log that" / "log the meal" / "log resolved only").
//   includeIndexes is an array    → select resolved ingredients whose ORIGINAL index
//                                    is in the (range-checked, integer-only) set. An
//                                    empty array, or one naming only unresolved /
//                                    out-of-range indexes, yields an empty selection —
//                                    the caller must reject, never fall back to all.

export interface SelectedIngredient {
  ingredient: IngredientResult
  originalIndex: number
}

export interface IngredientSelection {
  selected: SelectedIngredient[]
  totals: { calories: number; proteinG: number; carbG: number; fatG: number }
  /** true when includeIndexes was explicitly provided (vs. the all-resolved default) */
  requestedSelection: boolean
  /** number of resolved ingredients in the token (selected or not) */
  resolvedCount: number
}

export function selectTokenIngredients(
  payload: MealLogTokenPayload,
  includeIndexes?: number[] | null,
): IngredientSelection {
  const requestedSelection = Array.isArray(includeIndexes)
  const allowed: Set<number> | null = requestedSelection
    ? new Set(
        includeIndexes!.filter(
          n => Number.isInteger(n) && n >= 0 && n < payload.ingredients.length,
        ),
      )
    : null

  const selected: SelectedIngredient[] = []
  let resolvedCount = 0
  payload.ingredients.forEach((ingredient, originalIndex) => {
    if (!ingredient.resolved) return
    resolvedCount++
    if (allowed && !allowed.has(originalIndex)) return
    selected.push({ ingredient, originalIndex })
  })

  // Totals are summed from the token's own per-ingredient values — never recomputed
  // from anything the AI/client supplied.
  const totals = selected.reduce(
    (acc, { ingredient }) => ({
      calories: acc.calories + ingredient.calories,
      proteinG: acc.proteinG + ingredient.proteinG,
      carbG:    acc.carbG    + ingredient.carbG,
      fatG:     acc.fatG     + ingredient.fatG,
    }),
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  )
  totals.calories = Math.round(totals.calories)
  totals.proteinG = Math.round(totals.proteinG * 10) / 10
  totals.carbG    = Math.round(totals.carbG    * 10) / 10
  totals.fatG     = Math.round(totals.fatG     * 10) / 10

  return { selected, totals, requestedSelection, resolvedCount }
}
