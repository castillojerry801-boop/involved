import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSensitiveQuery, PRIVACY_REJECTION_MESSAGE } from '@/lib/nutrition/privacy-guard'
import { matchIngredient } from '@/lib/nutrition/matching/matcher'
import type { MatchRequest } from '@/lib/nutrition/matching/types'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { ingredientName, quantity, unit, preparationState } = body as Record<string, unknown>

  if (typeof ingredientName !== 'string' || ingredientName.trim().length < 2) {
    return NextResponse.json(
      { error: 'ingredientName must be a non-empty string of at least 2 characters' },
      { status: 400 },
    )
  }

  if (isSensitiveQuery(ingredientName)) {
    return NextResponse.json(
      { error: PRIVACY_REJECTION_MESSAGE },
      { status: 400 },
    )
  }

  const matchReq: MatchRequest = {
    ingredientName: ingredientName.trim(),
    quantity: typeof quantity === 'number' ? quantity : undefined,
    unit: typeof unit === 'string' ? unit : undefined,
    preparationState: typeof preparationState === 'string' ? preparationState : undefined,
  }

  try {
    const result = await matchIngredient(matchReq)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[nutrition/match] matchIngredient error:', err)
    // Graceful degradation — return no_match rather than 500
    return NextResponse.json({
      confidence: 'no_match',
      topMatch: null,
      alternatives: [],
    })
  }
}
