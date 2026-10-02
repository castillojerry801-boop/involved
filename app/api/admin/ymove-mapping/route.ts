import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { getAllMappings, writeMapping } from '@/lib/ymove/mapping'
import { searchYmoveCandidates } from '@/lib/ymove/client'
import { exercises } from '@/lib/exercises'
import { getInvolvedDisplayName, getCanonicalByExerciseDbId, MOVEMENT_PATTERN_LABELS } from '@/lib/exercises/canonical'
import { buildSearchQuery, rankCandidates, STARTER_BATCH_IDS, type ExerciseMetadata } from '@/lib/ymove/search'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/** Build the rich ExerciseMetadata for an ExerciseDB exercise. */
function buildMetadata(ex: { id: string; name: string; equipment: string; bodyPart: string; target: string }): ExerciseMetadata {
  const displayName = getInvolvedDisplayName(ex.id, ex.name)
  const canonical = getCanonicalByExerciseDbId(ex.id)
  return {
    exerciseDbId: ex.id,
    displayName,
    equipment: ex.equipment,
    bodyPart: ex.bodyPart,
    target: ex.target,
    technicalPattern: canonical?.technicalPattern,
    primaryMuscles: canonical?.muscleCard?.primary,
  }
}

/**
 * GET /api/admin/ymove-mapping
 *   Returns exercises with rich metadata and current mapping status.
 *   ?status=unmapped|mapped|no_match|all   — filter (default: all)
 *   ?batch=starter                          — only the 20 starter-batch IDs
 *   ?ids=0025,0043,...                      — specific exercise IDs
 *   ?page=1&limit=100                       — pagination (default limit 200)
 *
 * GET /api/admin/ymove-mapping?search=<query>&exerciseId=<id>
 *   Searches ymove and returns ranked, scored candidates.
 *   DEV-ONLY — 503 in production.
 *
 * GET /api/admin/ymove-mapping?preview=<ymoveId>
 *   Returns a fresh video URL for a ymove exercise (admin preview only).
 *   Counts against the monthly ymove quota — use sparingly.
 *   DEV-ONLY — 503 in production.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const sp = req.nextUrl.searchParams

  // ── Video preview ─────────────────────────────────────────────────────────
  const previewId = sp.get('preview')
  if (previewId) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Video preview not available in production.' }, { status: 503 })
    }
    try {
      const { getYmoveById } = await import('@/lib/ymove/client')
      const media = await getYmoveById(previewId, true)
      if (!media) return NextResponse.json({ error: 'Not found on ymove' }, { status: 404 })
      return NextResponse.json({
        ymoveId: media.ymoveId,
        name: previewId,
        videoUrl: media.videoUrl ?? null,
        videoHlsUrl: media.videoHlsUrl ?? null,
        videoDurationSecs: media.videoDurationSecs ?? null,
      })
    } catch (err) {
      console.error('[ymove-mapping] preview error:', err)
      return NextResponse.json({ error: 'ymove preview failed' }, { status: 502 })
    }
  }

  // ── Candidate search ──────────────────────────────────────────────────────
  const searchQuery = sp.get('search')
  const exerciseIdForSearch = sp.get('exerciseId')
  if (searchQuery) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'ymove search is not available in production.' }, { status: 503 })
    }
    const limit = Math.min(Number(sp.get('limit') ?? '8'), 12)
    try {
      const rawCandidates = await searchYmoveCandidates(searchQuery, limit)

      // Build metadata for scoring if we have an exerciseId
      let meta: ExerciseMetadata | null = null
      if (exerciseIdForSearch) {
        const ex = exercises.find(e => e.id === exerciseIdForSearch)
        if (ex) meta = buildMetadata(ex)
      }

      // Score and rank
      const scored = meta
        ? rankCandidates(rawCandidates, meta)
        : rawCandidates.map(c => ({ ...c, score: 50, confidence: 'possible' as const, matchReasons: [], penaltyReasons: [] }))

      // Duplicate detection: warn if a candidate UUID is already mapped elsewhere
      const currentMapping = getAllMappings()
      const reverseMapping: Record<string, string> = {}
      for (const [dbId, ymoveId] of Object.entries(currentMapping)) {
        if (ymoveId) reverseMapping[ymoveId] = dbId
      }

      const withDupCheck = scored.map(c => {
        const existingDbId = reverseMapping[c.ymoveId]
        if (existingDbId && existingDbId !== exerciseIdForSearch) {
          const existingEx = exercises.find(e => e.id === existingDbId)
          const existingName = existingEx
            ? getInvolvedDisplayName(existingDbId, existingEx.name)
            : existingDbId
          return { ...c, alreadyMappedTo: existingName, alreadyMappedDbId: existingDbId }
        }
        return { ...c, alreadyMappedTo: null, alreadyMappedDbId: null }
      })

      return NextResponse.json({ candidates: withDupCheck, searchQuery, exerciseId: exerciseIdForSearch })
    } catch (err) {
      console.error('[ymove-mapping] search error:', err)
      return NextResponse.json({ error: 'ymove search failed' }, { status: 502 })
    }
  }

  // ── Exercise list ─────────────────────────────────────────────────────────
  const mapping = getAllMappings()
  const statusFilter = sp.get('status') ?? 'all'
  const batchFilter = sp.get('batch')
  const idsFilter = sp.get('ids')?.split(',').filter(Boolean)
  const page = Math.max(1, Number(sp.get('page') ?? '1'))
  const limit = Math.min(Number(sp.get('limit') ?? '200'), 500)

  let filtered = exercises

  // ID filter (most specific)
  if (idsFilter?.length) {
    const idSet = new Set(idsFilter)
    filtered = filtered.filter(ex => idSet.has(ex.id))
  } else if (batchFilter === 'starter') {
    filtered = filtered.filter(ex => STARTER_BATCH_IDS.has(ex.id))
  }

  // Status filter
  if (statusFilter !== 'all') {
    filtered = filtered.filter(ex => {
      const mapped = mapping[ex.id]
      const status = ex.id in mapping
        ? (mapped === null ? 'no_match' : 'mapped')
        : 'unmapped'
      return status === statusFilter
    })
  }

  const total = filtered.length
  const paginated = filtered.slice((page - 1) * limit, page * limit)

  const result = paginated.map(ex => {
    const meta = buildMetadata(ex)
    const mapped = mapping[ex.id]
    const status: 'mapped' | 'no_match' | 'unmapped' = ex.id in mapping
      ? (mapped === null ? 'no_match' : 'mapped')
      : 'unmapped'

    return {
      exerciseDbId: ex.id,
      displayName: meta.displayName,
      rawName: ex.name,
      equipment: ex.equipment,
      bodyPart: ex.bodyPart,
      target: ex.target,
      technicalPattern: meta.technicalPattern ?? null,
      movementPatternLabel: meta.technicalPattern ? (MOVEMENT_PATTERN_LABELS[meta.technicalPattern] ?? meta.technicalPattern) : null,
      primaryMuscles: meta.primaryMuscles ?? null,
      suggestedSearchQuery: buildSearchQuery(meta),
      ymoveExerciseId: mapped ?? null,
      status,
      isStarterBatch: STARTER_BATCH_IDS.has(ex.id),
    }
  })

  return NextResponse.json({ exercises: result, total, page, limit })
}

/**
 * PATCH /api/admin/ymove-mapping
 * Body: { exerciseDbId: string; ymoveExerciseId: string | null; forceOverwrite?: boolean }
 *
 * null = no ymove match for this exercise.
 * DEV-ONLY — 503 in production.
 */
export async function PATCH(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Mapping writes are not available in production. Build the mapping locally and commit the file.' },
      { status: 503 },
    )
  }

  const body = await req.json() as {
    exerciseDbId?: string
    ymoveExerciseId?: string | null
    forceOverwrite?: boolean
  }
  const { exerciseDbId, ymoveExerciseId, forceOverwrite = false } = body

  if (!exerciseDbId || typeof exerciseDbId !== 'string') {
    return NextResponse.json({ error: 'exerciseDbId is required' }, { status: 400 })
  }
  if (ymoveExerciseId !== undefined && ymoveExerciseId !== null && typeof ymoveExerciseId !== 'string') {
    return NextResponse.json({ error: 'ymoveExerciseId must be a string, null, or omitted' }, { status: 400 })
  }

  const current = getAllMappings()

  // Duplicate UUID protection: if this ymove UUID is already mapped to a different exercise, warn.
  if (ymoveExerciseId && !forceOverwrite) {
    const existingDbId = Object.entries(current).find(
      ([dbId, uuid]) => uuid === ymoveExerciseId && dbId !== exerciseDbId,
    )?.[0]

    if (existingDbId) {
      const existingEx = exercises.find(e => e.id === existingDbId)
      const existingName = existingEx
        ? getInvolvedDisplayName(existingDbId, existingEx.name)
        : existingDbId
      return NextResponse.json(
        {
          conflict: true,
          message: `This ymove UUID is already mapped to: "${existingName}" (${existingDbId}). Pass forceOverwrite: true to proceed anyway.`,
          existingDbId,
          existingName,
        },
        { status: 409 },
      )
    }
  }

  const updated = { ...current, [exerciseDbId]: ymoveExerciseId ?? null }
  writeMapping(updated)

  const ex = exercises.find(e => e.id === exerciseDbId)
  const displayName = ex ? getInvolvedDisplayName(exerciseDbId, ex.name) : exerciseDbId

  return NextResponse.json({ ok: true, exerciseDbId, displayName, ymoveExerciseId })
}

/**
 * DELETE /api/admin/ymove-mapping
 * Body: { exerciseDbId: string }
 *
 * Removes the entry entirely (back to "not yet checked").
 * DEV-ONLY.
 */
export async function DELETE(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Mapping writes are not available in production.' }, { status: 503 })
  }

  const body = await req.json() as { exerciseDbId?: string }
  const { exerciseDbId } = body

  if (!exerciseDbId || typeof exerciseDbId !== 'string') {
    return NextResponse.json({ error: 'exerciseDbId is required' }, { status: 400 })
  }

  const current = getAllMappings()
  const { [exerciseDbId]: _removed, ...updated } = current
  writeMapping(updated)

  return NextResponse.json({ ok: true, exerciseDbId })
}
