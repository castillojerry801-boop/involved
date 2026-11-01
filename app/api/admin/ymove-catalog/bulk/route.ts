import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { applyBulkCuration, CurationValidationError } from '@/lib/ymove/catalog-curation'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * POST /api/admin/ymove-catalog/bulk
 *
 * Apply approve or reject to multiple catalog records at once.
 * Only approve and reject are supported in bulk — actions that require
 * per-record validation (mark_duplicate, link_exercise) must be applied
 * individually to prevent accidental identity merges.
 *
 * Body:
 *   { ymoveIds: string[], action: 'approve' | 'reject', confirm: true }
 *
 * `confirm: true` is required and prevents accidental bulk mutations.
 * Max 100 IDs per request.
 */
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      { error: 'confirm: true is required for bulk actions.' },
      { status: 400 },
    )
  }

  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject' for bulk operations." },
      { status: 400 },
    )
  }

  const ymoveIds = body.ymoveIds
  if (!Array.isArray(ymoveIds) || ymoveIds.length === 0) {
    return NextResponse.json({ error: 'ymoveIds must be a non-empty array.' }, { status: 400 })
  }
  if (ymoveIds.length > 100) {
    return NextResponse.json({ error: 'Maximum 100 IDs per bulk request.' }, { status: 400 })
  }

  try {
    const result = await applyBulkCuration(ymoveIds, action, user.id)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof CurationValidationError) {
      return NextResponse.json({ error: err.error.message, code: err.error.code }, { status: 422 })
    }
    console.error('[ymove-catalog] bulk curation error:', err)
    return NextResponse.json({ error: 'Internal error.' }, { status: 500 })
  }
}
