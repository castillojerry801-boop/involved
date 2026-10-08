import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { getAllMappings } from '@/lib/ymove/mapping'
import { exercises as dbExercises } from '@/lib/exercises'
import { getInvolvedDisplayName, getCanonicalByExerciseDbId, MOVEMENT_PATTERN_LABELS } from '@/lib/exercises/canonical'

const YMOVE_BASE = 'https://exercise-api.ymove.app/api/v2'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

function apiKey() {
  const k = process.env.YMOVE_API_KEY
  if (!k) throw new Error('YMOVE_API_KEY not configured')
  return k
}

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const sp = req.nextUrl.searchParams

  // ── Single video fetch ─────────────────────────────────────────────────────
  if (sp.has('video')) {
    const videoId = sp.get('video')!
    try {
      const res = await fetch(
        `${YMOVE_BASE}/exercises/${encodeURIComponent(videoId)}?includeVideos=true`,
        { headers: { 'X-API-Key': apiKey() }, cache: 'no-store' },
      )
      if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: res.status })
      const data = await res.json()
      return NextResponse.json({
        ymoveId: data.id,
        name: data.name ?? data.title ?? '',
        videoUrl: data.videoUrl ?? null,
        videoHlsUrl: data.videoHlsUrl ?? null,
        videoDurationSecs: data.videoDurationSecs ?? null,
      })
    } catch (err) {
      console.error('[ymove-browse] video error:', err)
      return NextResponse.json({ error: 'ymove fetch failed' }, { status: 502 })
    }
  }

  // ── Our exercise search (for the mapping assignment UI) ────────────────────
  if (sp.has('exerciseSearch')) {
    const q = sp.get('exerciseSearch')!.toLowerCase().trim()
    const mapping = await getAllMappings()
    const mapped = new Set(Object.keys(mapping))

    const results = dbExercises
      .map(ex => {
        const displayName = getInvolvedDisplayName(ex.id, ex.name)
        const canonical = getCanonicalByExerciseDbId(ex.id)
        return {
          exerciseDbId: ex.id,
          displayName,
          equipment: ex.equipment,
          target: ex.target,
          movementPatternLabel: canonical?.technicalPattern
            ? (MOVEMENT_PATTERN_LABELS[canonical.technicalPattern] ?? null)
            : null,
          alreadyMapped: mapped.has(ex.id),
          ymoveExerciseId: mapping[ex.id] ?? null,
        }
      })
      .filter(ex => {
        if (!q) return true
        return (
          ex.displayName.toLowerCase().includes(q) ||
          ex.target.toLowerCase().includes(q) ||
          ex.equipment.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        // Exact/starts-with first
        const aStarts = a.displayName.toLowerCase().startsWith(q) ? 0 : 1
        const bStarts = b.displayName.toLowerCase().startsWith(q) ? 0 : 1
        return aStarts - bStarts || a.displayName.localeCompare(b.displayName)
      })
      .slice(0, 12)

    return NextResponse.json({ results })
  }

  // ── ymove exercise list ────────────────────────────────────────────────────
  const page = Math.max(1, Number(sp.get('page') ?? '1'))
  const pageSize = Math.min(Number(sp.get('pageSize') ?? '48'), 96)
  const search = sp.get('search')?.trim() ?? ''

  const url = new URL(`${YMOVE_BASE}/exercises`)
  url.searchParams.set('pageSize', String(pageSize))
  url.searchParams.set('page', String(page))
  if (search) url.searchParams.set('search', search)

  try {
    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey() },
      cache: 'no-store',
    })
    if (!res.ok) return NextResponse.json({ error: `ymove ${res.status}` }, { status: 502 })

    const body = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: Record<string, any>[] =
      Array.isArray(body)             ? body
      : Array.isArray(body.exercises) ? body.exercises
      : Array.isArray(body.data)      ? body.data
      : []

    // Build reverse map: ymoveId → our display name
    const mapping = await getAllMappings()
    const reverseMap: Record<string, string> = {}
    for (const [dbId, ymoveId] of Object.entries(mapping)) {
      if (ymoveId) {
        const ex = dbExercises.find(e => e.id === dbId)
        reverseMap[ymoveId] = ex ? getInvolvedDisplayName(dbId, ex.name) : dbId
      }
    }

    const items = list.map(item => ({
      ymoveId: item.id as string,
      name: (item.name ?? item.title ?? '') as string,
      category: (item.category ?? null) as string | null,
      muscleGroup: (item.muscleGroup ?? null) as string | null,
      equipment: (item.equipment ?? null) as string | null,
      difficulty: (item.difficulty ?? null) as string | null,
      hasVideo: (item.hasVideo ?? false) as boolean,
      mappedTo: reverseMap[item.id as string] ?? null,
    }))

    return NextResponse.json({
      items,
      page,
      pageSize,
      totalPages: body.totalPages ?? body.pages ?? null,
      totalItems: body.total ?? body.totalCount ?? null,
      hasMore: list.length === pageSize,
    })
  } catch (err) {
    console.error('[ymove-browse] list error:', err)
    return NextResponse.json({ error: 'ymove fetch failed' }, { status: 502 })
  }
}
