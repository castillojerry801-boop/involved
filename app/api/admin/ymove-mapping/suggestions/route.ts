import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { loadSuggestions } from '@/lib/ymove/suggestions-store'
import { getAllMappings, getAllMappingsWithMeta, upsertMapping } from '@/lib/ymove/mapping'
import { exercises } from '@/lib/exercises'
import { getInvolvedDisplayName } from '@/lib/exercises/canonical'
import { type MatchClass } from '@/lib/ymove/pipeline'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * GET /api/admin/ymove-mapping/suggestions
 *   Returns pipeline suggestions enriched with current mapping review status.
 *   ?status=high_confidence|needs_review|unmatched|all  (default: all)
 *   ?page=1&limit=100
 *
 * Review status is computed from the live mapping:
 *   pending    — exerciseDbId not yet in active mapping
 *   approved   — active mapping matches the suggested ymoveId
 *   overridden — active mapping has a different ymoveId (manual override)
 *   rejected   — active mapping is null (explicit no-match)
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const suggestions = loadSuggestions()
  if (!suggestions) {
    return NextResponse.json({
      ready: false,
      message: 'Pipeline has not been run yet. Execute: npx tsx scripts/ymove-run-pipeline.ts',
    })
  }

  const [mapping, mappingMeta] = await Promise.all([
    getAllMappings(),
    getAllMappingsWithMeta(),
  ])

  // Reverse map: ymoveId → exerciseDbId (active non-null mappings only)
  const ymoveToActiveDbId = new Map<string, string>()
  for (const [dbId, ymoveId] of Object.entries(mapping)) {
    if (ymoveId) ymoveToActiveDbId.set(ymoveId, dbId)
  }

  // Index: ymoveId → all exerciseDbIds that suggest it (for within-pipeline duplicate detection)
  const ymoveToSuggestedDbIds = new Map<string, string[]>()
  for (const s of suggestions.suggestions) {
    if (s.topMatch?.ymoveId) {
      const arr = ymoveToSuggestedDbIds.get(s.topMatch.ymoveId) ?? []
      arr.push(s.exerciseDbId)
      ymoveToSuggestedDbIds.set(s.topMatch.ymoveId, arr)
    }
  }

  const sp           = req.nextUrl.searchParams
  const statusFilter = (sp.get('status') as MatchClass | 'all' | null) ?? 'all'
  const page         = Math.max(1, Number(sp.get('page')  ?? '1'))
  const limit        = Math.min(Number(sp.get('limit') ?? '100'), 500)

  let filtered = suggestions.suggestions
  if (statusFilter !== 'all') {
    filtered = filtered.filter(s => s.status === statusFilter)
  }

  const enriched = filtered.map(s => {
    const currentId    = mapping[s.exerciseDbId]
    const reviewStatus =
      currentId === undefined                      ? 'pending'   :
      currentId === null                           ? 'rejected'  :
      currentId === s.topMatch?.ymoveId            ? 'approved'  :
      /* different ymoveId — manual override */      'overridden'

    const topYmoveId = s.topMatch?.ymoveId ?? null
    // exerciseDbId that currently uses this ymoveId in the active mapping (≠ this exercise)
    const activeConflictDbId = topYmoveId
      ? (ymoveToActiveDbId.get(topYmoveId) ?? null)
      : null
    const activeConflictName = activeConflictDbId
      ? (() => {
          const ex = exercises.find(e => e.id === activeConflictDbId)
          return ex ? getInvolvedDisplayName(activeConflictDbId, ex.name) : activeConflictDbId
        })()
      : null
    // other exerciseDbIds in the pipeline that also suggest this ymoveId
    const suggestedConflictDbIds = topYmoveId
      ? (ymoveToSuggestedDbIds.get(topYmoveId) ?? []).filter(id => id !== s.exerciseDbId)
      : []

    const verifiedAt = mappingMeta[s.exerciseDbId]?.verifiedAt?.toISOString() ?? null

    return {
      ...s,
      reviewStatus,
      currentMappedId: currentId ?? null,
      verifiedAt,
      activeConflictDbId,
      activeConflictName,
      suggestedConflictDbIds,
    }
  })

  const total     = enriched.length
  const paginated = enriched.slice((page - 1) * limit, page * limit)

  return NextResponse.json({
    ready:       true,
    generatedAt: suggestions.generatedAt,
    summary:     suggestions.summary,
    suggestions: paginated,
    total,
    page,
    limit,
  })
}

/**
 * POST /api/admin/ymove-mapping/suggestions
 * Body: { approvals: Array<{ exerciseDbId: string; ymoveId: string }> }
 *   Batch-approve suggestions. Each entry maps an ExerciseDB ID to a YMove UUID.
 *
 *   Conflict protection (same rules as PATCH /api/admin/ymove-mapping):
 *   - Within-batch duplicate UUIDs are rejected (only the first wins).
 *   - UUIDs already in the active mapping for a DIFFERENT exercise are rejected.
 *   - Existing mappings for the same exerciseDbId are overwritten (upsert).
 *
 * Returns: { ok: true; approved: number; skipped: number; failed: number;
 *            conflicts: Array<{ exerciseDbId; ymoveId; reason }> }
 */
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const body = await req.json() as {
    approvals?: Array<{ exerciseDbId: string; ymoveId: string }>
  }

  if (!Array.isArray(body.approvals) || body.approvals.length === 0) {
    return NextResponse.json({ error: 'approvals array is required' }, { status: 400 })
  }

  // Load active mapping once for conflict checks.
  const activeMapping = await getAllMappings()
  // Reverse map: ymoveId → exerciseDbId (active, non-null mappings only)
  const ymoveToActiveDbId = new Map<string, string>()
  for (const [dbId, ymoveId] of Object.entries(activeMapping)) {
    if (ymoveId) ymoveToActiveDbId.set(ymoveId, dbId)
  }

  let approved = 0
  let skipped  = 0
  let failed   = 0
  const conflicts: Array<{ exerciseDbId: string; ymoveId: string; reason: string }> = []

  // Track UUIDs committed during this batch to catch within-batch duplicates.
  const batchYmoveIds = new Set<string>()

  for (const { exerciseDbId, ymoveId } of body.approvals) {
    if (!exerciseDbId || !ymoveId) { failed++; continue }

    // Within-batch duplicate
    if (batchYmoveIds.has(ymoveId)) {
      skipped++
      conflicts.push({ exerciseDbId, ymoveId, reason: 'duplicate uuid in this batch' })
      continue
    }

    // Conflict with existing active mapping for a DIFFERENT exercise
    const existingDbId = ymoveToActiveDbId.get(ymoveId)
    if (existingDbId && existingDbId !== exerciseDbId) {
      skipped++
      conflicts.push({ exerciseDbId, ymoveId, reason: `uuid already mapped to ${existingDbId}` })
      continue
    }

    try {
      await upsertMapping(exerciseDbId, ymoveId)
      batchYmoveIds.add(ymoveId)
      // Update the reverse map so subsequent items in the batch see this mapping.
      ymoveToActiveDbId.set(ymoveId, exerciseDbId)
      approved++
    } catch {
      failed++
    }
  }

  return NextResponse.json({ ok: true, approved, skipped, failed, conflicts })
}
