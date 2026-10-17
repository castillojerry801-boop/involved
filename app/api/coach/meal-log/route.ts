import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { verifyMealLogToken } from '@/lib/v/meal-log-token'
import { Prisma } from '@prisma/client'

const VALID_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'other'])
const LOG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Reject dates more than 30 days in the past or any date in the future.
const MAX_PAST_DAYS = 30

function isValidLogDate(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00Z')
  if (isNaN(d.getTime())) return false
  const now = Date.now()
  const diffMs = now - d.getTime()
  // Future dates (> 1 day ahead of UTC) are rejected
  if (diffMs < -(24 * 60 * 60 * 1000)) return false
  // Dates more than 30 days ago are rejected
  if (diffMs > MAX_PAST_DAYS * 24 * 60 * 60 * 1000) return false
  return true
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    calculationToken: string
    mealType: string
    logDate: string
  }

  // Structural validation
  if (!body.calculationToken || typeof body.calculationToken !== 'string') {
    return NextResponse.json({ error: 'Missing calculationToken' }, { status: 400 })
  }
  if (body.calculationToken.length > 50_000) {
    return NextResponse.json({ error: 'calculationToken too large' }, { status: 400 })
  }
  if (!VALID_MEAL_TYPES.has(body.mealType)) {
    return NextResponse.json({ error: 'Invalid mealType' }, { status: 400 })
  }
  if (!LOG_DATE_RE.test(body.logDate)) {
    return NextResponse.json({ error: 'Invalid logDate — expected YYYY-MM-DD' }, { status: 400 })
  }
  if (!isValidLogDate(body.logDate)) {
    return NextResponse.json({ error: 'logDate out of range — must be within the past 30 days and not in the future' }, { status: 400 })
  }

  // Verify the server-signed token — this is the ONLY source of nutrition data
  const verified = verifyMealLogToken(body.calculationToken, user.id)
  if (!verified.ok) {
    const status = verified.reason === 'expired' || verified.reason === 'no_key' ? 400 : 403
    return NextResponse.json({ error: `Token ${verified.reason}` }, { status })
  }

  const { payload } = verified

  // Only log ingredients that actually resolved — never fabricate nutrition
  const resolvedIngredients = payload.ingredients.filter(i => i.resolved)
  if (resolvedIngredients.length === 0) {
    return NextResponse.json({ error: 'No resolved ingredients to log' }, { status: 400 })
  }

  const logDate   = new Date(body.logDate + 'T00:00:00Z')
  const mealType  = body.mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other'
  const isPartial = payload.completeness !== 'complete'

  // Build entries from the token's trusted snapshot — never from request body macros
  const entries = resolvedIngredients.map((ing, idx) => ({
    userId:             user.id,
    logDate,
    mealType,
    servingMultiplier:  new Prisma.Decimal(1),
    foodItemId:         null,
    idempotencyKey:     `${payload.calculationId}-${idx}`,
    estimateSourceNote: isPartial
      ? `Coach V (partial — ${payload.unresolvedIngredients.length} item(s) not logged) — ${ing.userDescription}`
      : `Coach V — ${ing.userDescription}`,
    snapshotFoodName:               ing.matchedFoodName,
    snapshotServingSize:            new Prisma.Decimal(1),
    snapshotServingUnit:            'serving',
    snapshotCaloriesPerServing:     new Prisma.Decimal(ing.calories),
    snapshotProteinGPerServing:     new Prisma.Decimal(ing.proteinG),
    snapshotCarbohydrateGPerServing: new Prisma.Decimal(ing.carbG),
    snapshotFatGPerServing:         new Prisma.Decimal(ing.fatG),
  }))

  // Atomic write — let the DB's unique constraint on idempotencyKey handle duplicates.
  // No findUnique-before-create: that pattern has a TOCTOU race condition.
  // P2002 = unique constraint violation → already confirmed → return success.
  try {
    await prisma.$transaction(entries.map(data => prisma.foodLogEntry.create({ data })))
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Already confirmed (idempotency key exists) — safe to acknowledge as success
      return NextResponse.json({ ok: true, alreadyLogged: true })
    }
    console.error('[meal-log-confirm] transaction error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, isPartial, loggedCount: resolvedIngredients.length })
}
