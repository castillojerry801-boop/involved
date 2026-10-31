import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { exercises, getGifUrl } from '@/lib/exercises'
import { getInvolvedDisplayName } from '@/lib/exercises/canonical'
import { getConflictOwners, getMappingRow, transferMapping, type TransferOptions } from '@/lib/ymove/mapping'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * GET /api/admin/ymove-mapping/transfer?ymoveId=<uuid>&destExerciseDbId=<id>
 * Returns all current owners of a ymove UUID for the conflict comparison panel,
 * plus the current DB state of the destination mapping for staleness detection.
 * Never charges video credits — only metadata and GIFs.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const ymoveId         = req.nextUrl.searchParams.get('ymoveId')
  const destExerciseDbId = req.nextUrl.searchParams.get('destExerciseDbId')
  if (!ymoveId) return NextResponse.json({ error: 'ymoveId is required' }, { status: 400 })

  const [owners, destRow] = await Promise.all([
    getConflictOwners(ymoveId),
    destExerciseDbId ? getMappingRow(destExerciseDbId) : Promise.resolve(null),
  ])

  const enriched = owners.map(owner => {
    const ex = exercises.find(e => e.id === owner.exerciseDbId)
    return {
      exerciseDbId: owner.exerciseDbId,
      displayName:  ex ? getInvolvedDisplayName(owner.exerciseDbId, ex.name) : owner.exerciseDbId,
      bodyPart:     ex?.bodyPart  ?? '',
      equipment:    ex?.equipment ?? '',
      target:       ex?.target    ?? '',
      gifUrl:       getGifUrl(owner.exerciseDbId),
      verifiedAt:   owner.verifiedAt?.toISOString() ?? null,
      updatedAt:    owner.isJsonOnly ? null : owner.updatedAt.toISOString(),
      isJsonOnly:   owner.isJsonOnly,
    }
  })

  return NextResponse.json({
    owners:    enriched,
    ymoveId,
    destState: { updatedAt: destRow?.updatedAt.toISOString() ?? null },
  })
}

/**
 * POST /api/admin/ymove-mapping/transfer
 * Resolves a UUID conflict by transferring or sharing a ymove assignment.
 *
 * Body: {
 *   action:                'move_here' | 'use_for_both'
 *   destExerciseDbId:      string          — exercise being reviewed
 *   ymoveId:               string          — the contested UUID
 *   revokeFromDbIds:       string[]        — owners to revoke (move_here only)
 *   isJsonOnlyIds:         string[]        — which revokeFromDbIds are JSON-only
 *   verified:              boolean         — sets verifiedAt on dest if true
 *   expectedUpdatedAts:    Record<string, string>  — ISO updatedAt per revoked DB row
 *   expectedDestUpdatedAt: string | null   — ISO updatedAt of dest DB row; null if none existed
 *   expectedOwnerDbIds:    string[]        — all owner IDs seen in compare panel (new-owner detection)
 * }
 *
 * Returns:
 *   200 { ok: true; action; revoked; assigned; displayName; verifiedAt }
 *   409 { ok: false; stale: true; exerciseDbId; message }   — concurrent change
 *   400/403/500 on bad input / no auth / unexpected error
 */
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const body = await req.json() as {
    action?:                unknown
    destExerciseDbId?:      unknown
    ymoveId?:               unknown
    revokeFromDbIds?:       unknown
    isJsonOnlyIds?:         unknown
    verified?:              unknown
    expectedUpdatedAts?:    unknown
    expectedDestUpdatedAt?: unknown
    expectedOwnerDbIds?:    unknown
  }

  const { action, destExerciseDbId, ymoveId, verified = false } = body

  if (action !== 'move_here' && action !== 'use_for_both') {
    return NextResponse.json({ error: 'action must be move_here or use_for_both' }, { status: 400 })
  }
  if (!destExerciseDbId || typeof destExerciseDbId !== 'string') {
    return NextResponse.json({ error: 'destExerciseDbId is required' }, { status: 400 })
  }
  if (!ymoveId || typeof ymoveId !== 'string') {
    return NextResponse.json({ error: 'ymoveId is required' }, { status: 400 })
  }

  const revokeFromDbIds: string[] = Array.isArray(body.revokeFromDbIds)
    ? (body.revokeFromDbIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : []
  const isJsonOnlyIds: string[] = Array.isArray(body.isJsonOnlyIds)
    ? (body.isJsonOnlyIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : []
  const expectedUpdatedAts: Record<string, string> =
    body.expectedUpdatedAts !== null &&
    typeof body.expectedUpdatedAts === 'object' &&
    !Array.isArray(body.expectedUpdatedAts)
      ? (body.expectedUpdatedAts as Record<string, string>)
      : {}
  const expectedDestUpdatedAt: string | null =
    typeof body.expectedDestUpdatedAt === 'string' ? body.expectedDestUpdatedAt : null
  const expectedOwnerDbIds: string[] = Array.isArray(body.expectedOwnerDbIds)
    ? (body.expectedOwnerDbIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : []

  if (action === 'move_here' && revokeFromDbIds.length === 0) {
    return NextResponse.json({ error: 'move_here requires at least one entry in revokeFromDbIds' }, { status: 400 })
  }

  const opts: TransferOptions = {
    destExerciseDbId,
    ymoveId,
    action,
    revokeFromDbIds,
    isJsonOnlyIds,
    verified: verified === true,
    expectedUpdatedAts,
    expectedDestUpdatedAt,
    expectedOwnerDbIds,
  }

  try {
    const result = await transferMapping(opts)
    const ex          = exercises.find(e => e.id === destExerciseDbId)
    const displayName = ex ? getInvolvedDisplayName(destExerciseDbId, ex.name) : destExerciseDbId

    return NextResponse.json({
      ok:          true,
      action,
      revoked:     result.revoked,
      assigned:    result.assigned,
      displayName,
      verifiedAt:  result.verifiedAt?.toISOString() ?? null,
    })
  } catch (err: unknown) {
    const e = err as { code?: string; exerciseDbId?: string; message?: string; meta?: { code?: string } }
    if (e.code === 'STALE') {
      return NextResponse.json(
        { ok: false, stale: true, exerciseDbId: e.exerciseDbId ?? null, message: e.message ?? 'Stale conflict' },
        { status: 409 },
      )
    }
    // P2034: Prisma serialization failure — treat as generic stale conflict
    if (e.code === 'P2034') {
      return NextResponse.json(
        { ok: false, stale: true, exerciseDbId: null, message: 'Concurrent modification detected — please reload and retry' },
        { status: 409 },
      )
    }
    console.error('[ymove-mapping/transfer] unexpected error:', err)
    return NextResponse.json({ error: 'Transfer failed' }, { status: 500 })
  }
}
