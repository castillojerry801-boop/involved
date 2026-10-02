import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { getAllMappings, writeMapping } from '@/lib/ymove/mapping'
import { searchYmoveCandidates } from '@/lib/ymove/client'
import { exercises } from '@/lib/exercises'
import { getInvolvedDisplayName } from '@/lib/exercises/canonical'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * GET /api/admin/ymove-mapping
 *   Returns all exercises with their mapping status.
 *
 * GET /api/admin/ymove-mapping?search=<query>&limit=<n>
 *   Searches ymove for candidates matching <query>.
 *   DEV-ONLY — will 503 in production.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const search = req.nextUrl.searchParams.get('search')

  if (search) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'ymove search is not available in production' }, { status: 503 })
    }
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '5'), 10)
    try {
      const candidates = await searchYmoveCandidates(search, limit)
      return NextResponse.json({ candidates })
    } catch (err) {
      console.error('[ymove-mapping] search error:', err)
      return NextResponse.json({ error: 'ymove search failed' }, { status: 502 })
    }
  }

  // List all exercises with their current mapping status
  const mapping = getAllMappings()
  const result = exercises.map(ex => {
    const displayName = getInvolvedDisplayName(ex.id, ex.name)
    const mapped = mapping[ex.id]
    return {
      exerciseDbId: ex.id,
      displayName,
      rawName: ex.name,
      ymoveExerciseId: mapped ?? null,
      status: ex.id in mapping
        ? (mapping[ex.id] === null ? 'no_match' : 'mapped')
        : 'unmapped',
    }
  })

  return NextResponse.json({ exercises: result, total: result.length })
}

/**
 * PATCH /api/admin/ymove-mapping
 * Body: { exerciseDbId: string; ymoveExerciseId: string | null }
 *
 * Sets or clears the ymove mapping for a single ExerciseDB exercise.
 * null = explicitly no match exists.
 * DEV-ONLY — will 503 in production.
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

  const body = await req.json() as { exerciseDbId?: string; ymoveExerciseId?: string | null }
  const { exerciseDbId, ymoveExerciseId } = body

  if (!exerciseDbId || typeof exerciseDbId !== 'string') {
    return NextResponse.json({ error: 'exerciseDbId is required' }, { status: 400 })
  }
  if (ymoveExerciseId !== null && typeof ymoveExerciseId !== 'string') {
    return NextResponse.json({ error: 'ymoveExerciseId must be a string or null' }, { status: 400 })
  }

  const current = getAllMappings()
  const updated = { ...current, [exerciseDbId]: ymoveExerciseId ?? null }
  writeMapping(updated)

  return NextResponse.json({ ok: true, exerciseDbId, ymoveExerciseId })
}

/**
 * DELETE /api/admin/ymove-mapping
 * Body: { exerciseDbId: string }
 *
 * Removes the mapping entry entirely (reverts to "unmapped" / not-yet-checked state).
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
