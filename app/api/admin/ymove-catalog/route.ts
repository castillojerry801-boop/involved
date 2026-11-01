import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * GET /api/admin/ymove-catalog
 *
 * Paginated, filterable list of the ymove_exercise_catalog with curation fields.
 *
 * Query params:
 *   status    pending_review | approved | rejected | duplicate | all  (default: all)
 *   category  string — exact match
 *   equipment string — exact match
 *   hasVideo  true | false
 *   q         name substring search (case-insensitive)
 *   page      number (default 1)
 *   pageSize  number (default 20, max 50)
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const sp = req.nextUrl.searchParams
  const status   = sp.get('status') ?? 'all'
  const category = sp.get('category')?.trim() || null
  const equipment = sp.get('equipment')?.trim() || null
  const hasVideoParam = sp.get('hasVideo')
  const q        = sp.get('q')?.trim() || null
  const page     = Math.max(1, Number(sp.get('page') ?? '1'))
  const pageSize = Math.min(Math.max(1, Number(sp.get('pageSize') ?? '20')), 50)

  const where = {
    ...(status !== 'all' && { curationStatus: status }),
    ...(category   && { category }),
    ...(equipment  && { equipment }),
    ...(hasVideoParam !== null && { hasVideo: hasVideoParam === 'true' }),
    ...(q && { name: { contains: q, mode: 'insensitive' as const } }),
  }

  const [items, total] = await Promise.all([
    prisma.ymoveExerciseCatalog.findMany({
      where,
      orderBy: [{ curationStatus: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ymoveId: true,
        name: true,
        slug: true,
        category: true,
        equipment: true,
        difficulty: true,
        primaryMuscleGroup: true,
        hasVideo: true,
        thumbnailMediaId: true,
        syncedAt: true,
        curationStatus: true,
        verifiedMediaFor: true,
        isDuplicateOf: true,
        canonicalId: true,
        curatorNotes: true,
        curatedAt: true,
        curatedBy: true,
      },
    }),
    prisma.ymoveExerciseCatalog.count({ where }),
  ])

  const statusCounts = await prisma.ymoveExerciseCatalog.groupBy({
    by: ['curationStatus'],
    _count: { _all: true },
  })
  const counts: Record<string, number> = { pending_review: 0, approved: 0, rejected: 0, duplicate: 0 }
  for (const row of statusCounts) {
    counts[row.curationStatus] = row._count._all
  }

  return NextResponse.json({
    items: items.map(item => ({
      ...item,
      syncedAt: item.syncedAt.toISOString(),
      curatedAt: item.curatedAt?.toISOString() ?? null,
    })),
    total,
    page,
    pageSize,
    counts,
  })
}
