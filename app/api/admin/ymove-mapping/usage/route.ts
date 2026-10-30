import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'

const YMOVE_BASE = 'https://exercise-api.ymove.app/api/v2'

function apiKey(): string {
  const k = process.env.YMOVE_API_KEY
  if (!k) throw new Error('YMOVE_API_KEY not configured')
  return k
}

/**
 * GET /api/admin/ymove-mapping/usage
 *   Returns current YMove plan usage stats.
 *   Safe: the /usage endpoint does not consume video allowance.
 *   Credentials are never forwarded to the client.
 */
export async function GET(_req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const res = await fetch(`${YMOVE_BASE}/usage`, {
      headers: { 'X-API-Key': apiKey() },
      cache:   'no-store',
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: 'ymove /usage request failed', ymoveStatus: res.status },
        { status: 502 },
      )
    }
    const body = await res.json()
    // YMove wraps the payload in a `data` key; handle both shapes.
    const d = (body?.data ?? body) as Record<string, unknown>
    // Return only safe, non-sensitive fields — never echo the API key or auth tokens.
    return NextResponse.json({
      plan:                 d.plan                 ?? null,
      status:               d.status               ?? null,
      monthlyExercisesUsed: d.monthlyExercisesUsed ?? null,
      monthlyExerciseLimit: d.monthlyExerciseLimit ?? null,
      rateLimit:            d.rateLimit            ?? null,
      whiteVideoAccess:     d.whiteVideoAccess      ?? false,
      premiumVideoAccess:   d.premiumVideoAccess    ?? false,
      trialEndsAt:          d.trialEndsAt           ?? null,
    })
  } catch (err) {
    console.error('[ymove-usage]', err)
    return NextResponse.json({ error: 'ymove usage check failed' }, { status: 502 })
  }
}
