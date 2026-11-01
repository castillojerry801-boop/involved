import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { applyCurationAction, CurationValidationError, type CurationAction } from '@/lib/ymove/catalog-curation'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * PATCH /api/admin/ymove-catalog/[ymoveId]
 *
 * Apply a curation action to a single catalog record.
 *
 * Body:
 *   { action: 'approve' | 'reject' | 'mark_duplicate' | 'link_exercise' |
 *             'set_canonical' | 'set_notes' | 'reset',
 *     isDuplicateOf?:     string  (required for mark_duplicate)
 *     verifiedMediaFor?:  string  (required for link_exercise — exact ExerciseDB ID)
 *     canonicalId?:       string | null  (for set_canonical)
 *     notes?:             string  (for set_notes)
 *   }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ymoveId: string }> },
) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const { ymoveId } = await params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const actionType = body.action as string | undefined
  if (!actionType) {
    return NextResponse.json({ error: 'action is required.' }, { status: 400 })
  }

  let action: CurationAction

  switch (actionType) {
    case 'approve':
      action = { type: 'approve' }
      break
    case 'reject':
      action = { type: 'reject' }
      break
    case 'mark_duplicate': {
      const isDuplicateOf = body.isDuplicateOf
      if (typeof isDuplicateOf !== 'string' || !isDuplicateOf.trim()) {
        return NextResponse.json({ error: 'isDuplicateOf is required for mark_duplicate.' }, { status: 400 })
      }
      action = { type: 'mark_duplicate', isDuplicateOf: isDuplicateOf.trim() }
      break
    }
    case 'link_exercise': {
      const verifiedMediaFor = body.verifiedMediaFor
      if (typeof verifiedMediaFor !== 'string' || !verifiedMediaFor.trim()) {
        return NextResponse.json({ error: 'verifiedMediaFor is required for link_exercise.' }, { status: 400 })
      }
      action = { type: 'link_exercise', verifiedMediaFor: verifiedMediaFor.trim() }
      break
    }
    case 'set_canonical':
      action = { type: 'set_canonical', canonicalId: typeof body.canonicalId === 'string' ? body.canonicalId : null }
      break
    case 'set_notes':
      action = { type: 'set_notes', notes: typeof body.notes === 'string' ? body.notes : '' }
      break
    case 'reset':
      action = { type: 'reset' }
      break
    default:
      return NextResponse.json({ error: `Unknown action '${actionType}'.` }, { status: 400 })
  }

  try {
    await applyCurationAction(ymoveId, action, user.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CurationValidationError) {
      const status = err.error.code === 'NOT_FOUND' ? 404 : 422
      return NextResponse.json({ error: err.error.message, code: err.error.code }, { status })
    }
    console.error('[ymove-catalog] curation error:', err)
    return NextResponse.json({ error: 'Internal error.' }, { status: 500 })
  }
}
