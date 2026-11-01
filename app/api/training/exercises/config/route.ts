import 'server-only'
import { NextResponse } from 'next/server'

/**
 * GET /api/training/exercises/config
 *
 * Returns the current exercise catalog configuration so client components can
 * determine which picker mode to use without requiring NEXT_PUBLIC_* env vars.
 *
 * Response: { ymove: boolean }
 */
export async function GET() {
  return NextResponse.json(
    { ymove: process.env.YMOVE_CATALOG_ENABLED === 'true' },
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=60' } },
  )
}
