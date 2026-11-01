import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { syncYmoveCatalog } from '@/lib/ymove/catalog-sync'

// POST /api/admin/ymove-catalog/sync
//
// Body (all optional):
//   { dryRun?: boolean, maxPages?: number }
//
// dryRun=true fetches all pages but skips DB writes — useful to verify
// API connectivity and catalog size before the first real sync.
//
// maxPages caps how many of the 41 pages (at 50 exercises each) are
// fetched per run. Default is 50 (full catalog). Lower values are
// useful during testing.

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { dryRun?: unknown; maxPages?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    // empty body is fine — all params are optional
  }

  const dryRun  = body.dryRun  === true
  const maxPages = typeof body.maxPages === 'number'
    ? Math.min(Math.max(1, Math.floor(body.maxPages)), 50)
    : undefined

  try {
    const result = await syncYmoveCatalog({ dryRun, maxPages })
    return NextResponse.json({ ok: true, dryRun, ...result })
  } catch (err) {
    console.error('[ymove-catalog] sync error:', err)
    return NextResponse.json(
      { error: 'Sync failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
