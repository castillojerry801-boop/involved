import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Vercel Cron authentication: Vercel automatically attaches
//   Authorization: Bearer {CRON_SECRET}
// to all cron invocations. The same header is required for manual invocations
// (e.g. curl) to prevent unauthenticated sweeps.
//
// Fail-closed: any auth failure (missing secret in env OR wrong value in header)
// returns 401 — never 200. Distinguishing the two cases in the response would leak
// whether CRON_SECRET is configured; the difference is logged internally only.
// CRON_SECRET must be set as a Vercel environment variable before deploying.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')

  if (!cronSecret) {
    // Log internally so operators can detect the misconfiguration, but return 401
    // to avoid distinguishing "not configured" from "wrong secret" externally.
    console.error('[cron-cleanup-meal-refs] CRON_SECRET env var not set — all requests rejected')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await prisma.mealCalculationRef.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    console.log('[cron-cleanup-meal-refs] deleted', result.count, 'expired rows')
    return NextResponse.json({ deleted: result.count })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[cron-cleanup-meal-refs] failed:', msg)
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
