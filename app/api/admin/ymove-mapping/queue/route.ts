import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { exercises } from '@/lib/exercises'
import { getAllMappingsWithMeta } from '@/lib/ymove/mapping'
import { getInvolvedDisplayName, getCanonicalByExerciseDbId, MOVEMENT_PATTERN_LABELS } from '@/lib/exercises/canonical'
import { buildSearchQuery } from '@/lib/ymove/search'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export type QueueStatus = 'unmapped' | 'rejected' | 'approved_unverified' | 'verified'

export interface QueueExercise {
  exerciseDbId:         string
  displayName:          string
  equipment:            string
  bodyPart:             string
  target:               string
  ymoveExerciseId:      string | null
  verifiedAt:           string | null
  queueStatus:          QueueStatus
  suggestedSearchQuery: string
  primaryMuscles:       string[] | null
  movementPatternLabel: string | null
}

export interface QueueCounts {
  needs_review: number
  verified:     number
  unmapped:     number
}

export interface QueueResponse {
  exercises: QueueExercise[]
  counts:    QueueCounts
  total:     number
  page:      number
  limit:     number
}

export async function GET(req: NextRequest): Promise<NextResponse<QueueResponse | { error: string }>> {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const sp    = req.nextUrl.searchParams
  const mode  = (sp.get('mode') ?? 'needs_review') as 'needs_review' | 'verified' | 'unmapped' | 'all'
  const page  = Math.max(1, Number(sp.get('page') ?? '1'))
  const limit = Math.min(Number(sp.get('limit') ?? '100'), 1500)
  const q     = sp.get('search')?.toLowerCase().trim() ?? ''

  const meta = await getAllMappingsWithMeta()

  function getStatus(id: string): QueueStatus {
    const m = meta[id]
    if (!m) return 'unmapped'
    if (m.ymoveId === null) return 'rejected'
    if (m.verifiedAt !== null) return 'verified'
    return 'approved_unverified'
  }

  const counts: QueueCounts = { needs_review: 0, verified: 0, unmapped: 0 }
  for (const ex of exercises) {
    const s = getStatus(ex.id)
    if (s === 'verified') {
      counts.verified++
    } else {
      counts.needs_review++
      if (s === 'unmapped' || s === 'rejected') counts.unmapped++
    }
  }

  let filtered = exercises.filter(ex => {
    const s = getStatus(ex.id)
    if (mode === 'needs_review') return s !== 'verified'
    if (mode === 'verified')     return s === 'verified'
    if (mode === 'unmapped')     return s === 'unmapped' || s === 'rejected'
    return true
  })

  if (q) {
    filtered = filtered.filter(ex => {
      const dn = getInvolvedDisplayName(ex.id, ex.name).toLowerCase()
      return dn.includes(q) || ex.id.toLowerCase().includes(q)
    })
  }

  const total = filtered.length
  const paged = filtered.slice((page - 1) * limit, page * limit)

  const result: QueueExercise[] = paged.map(ex => {
    const s         = getStatus(ex.id)
    const m         = meta[ex.id]
    const dn        = getInvolvedDisplayName(ex.id, ex.name)
    const canonical = getCanonicalByExerciseDbId(ex.id)
    return {
      exerciseDbId:         ex.id,
      displayName:          dn,
      equipment:            ex.equipment,
      bodyPart:             ex.bodyPart,
      target:               ex.target,
      ymoveExerciseId:      (m?.ymoveId ?? null) as string | null,
      verifiedAt:           m?.verifiedAt?.toISOString() ?? null,
      queueStatus:          s,
      suggestedSearchQuery: buildSearchQuery({
        exerciseDbId:    ex.id,
        displayName:     dn,
        equipment:       ex.equipment,
        bodyPart:        ex.bodyPart,
        target:          ex.target,
        technicalPattern: canonical?.technicalPattern,
        primaryMuscles:  canonical?.muscleCard?.primary,
      }),
      primaryMuscles:       canonical?.muscleCard?.primary ?? null,
      movementPatternLabel: canonical?.technicalPattern
        ? (MOVEMENT_PATTERN_LABELS[canonical.technicalPattern] ?? canonical.technicalPattern)
        : null,
    }
  })

  return NextResponse.json({ exercises: result, counts, total, page, limit })
}
