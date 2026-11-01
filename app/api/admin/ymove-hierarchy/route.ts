import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { loadHierarchySuggestions } from '@/lib/ymove/hierarchy-store'
import { getThumbnailMediaIds } from '@/lib/ymove/catalog-curation'
import type { HierarchyL2Node } from '@/lib/ymove/hierarchy-store'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * GET /api/admin/ymove-hierarchy
 *
 * Read-only endpoint. Returns the hierarchical matching suggestions artifact.
 * No writes, no mutations, no PATCH support.
 *
 * Query params:
 *   ?family=fam_squat
 *   ?search=squat
 *   ?tier=high_priority|review|weak|protected|all  (default: all)
 *   ?page=1&limit=50
 *
 * Protected mapping thumbnails are resolved server-side from the YMove catalog
 * table so the UI never shows the wrong exercise's image for a protected entry.
 * YMove credentials are never returned; thumbnails use /api/ymove/thumbnail/:mediaId.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) return forbidden()

  const file = loadHierarchySuggestions()
  if (!file) {
    return NextResponse.json({
      ready:   false,
      message: 'Hierarchy pipeline has not been run yet. Execute: npx tsx scripts/ymove-hierarchy-pipeline.ts',
    })
  }

  const sp        = req.nextUrl.searchParams
  const family    = sp.get('family') ?? ''
  const search    = (sp.get('search') ?? '').toLowerCase().trim()
  const tierParam = sp.get('tier') ?? 'all'
  const page      = Math.max(1, Number(sp.get('page')  ?? '1'))
  const limit     = Math.min(Math.max(1, Number(sp.get('limit') ?? '50')), 200)

  // Build L1 family index (always returned for navigation)
  const familyIndex: Array<{ id: string; count: number; highPriority: number; review: number }> = []
  const familySeen = new Map<string, { count: number; highPriority: number; review: number }>()
  for (const node of file.l2Nodes) {
    const fam = node.movementFamilyId
    const cur = familySeen.get(fam) ?? { count: 0, highPriority: 0, review: 0 }
    cur.count += node.exercises.length
    for (const ex of node.exercises) {
      const tier = ex.topSuggestion?.tier
      if (tier === 'high_priority') cur.highPriority++
      else if (tier === 'review')   cur.review++
    }
    familySeen.set(fam, cur)
  }
  for (const [id, counts] of familySeen) familyIndex.push({ id, ...counts })
  familyIndex.sort((a, b) => b.highPriority - a.highPriority || b.count - a.count)

  // Filter
  let filtered = file.l2Nodes as HierarchyL2Node[]

  if (family) {
    filtered = filtered.filter(n => n.movementFamilyId === family)
  }

  if (search) {
    filtered = filtered
      .map(node => ({
        ...node,
        exercises: node.exercises.filter(ex =>
          ex.name.toLowerCase().includes(search) ||
          (ex.topSuggestion?.name ?? '').toLowerCase().includes(search) ||
          ex.canonicalName.toLowerCase().includes(search),
        ),
      }))
      .filter(node => node.exercises.length > 0)
  }

  if (tierParam !== 'all') {
    filtered = filtered
      .map(node => ({
        ...node,
        exercises: node.exercises.filter(ex => {
          if (tierParam === 'protected') return !!ex.protected
          return ex.topSuggestion?.tier === tierParam
        }),
      }))
      .filter(node => node.exercises.length > 0)
  }

  const totalNodes = filtered.length
  const paginated  = filtered.slice((page - 1) * limit, page * limit)

  // ── Enrich protected mappings with the correct catalog thumbnailMediaId ───────
  // The pipeline JSON only stores thumbnailMediaId on scored candidates.
  // For protected exercises the protected.ymoveId may differ from the top
  // suggestion's ymoveId, so we resolve thumbnails server-side from the DB.
  const protectedIds = new Set<string>()
  for (const node of paginated) {
    for (const ex of node.exercises) {
      if (ex.protected?.ymoveId) protectedIds.add(ex.protected.ymoveId)
    }
  }

  let protectedThumbnails = new Map<string, string | null>()
  if (protectedIds.size > 0) {
    try {
      protectedThumbnails = await getThumbnailMediaIds([...protectedIds])
    } catch {
      // DB unavailable — degrade gracefully; UI will show no-media placeholder
    }
  }

  // Inject thumbnailMediaId into each protected mapping
  const enriched = paginated.map(node => ({
    ...node,
    exercises: node.exercises.map(ex => {
      if (!ex.protected) return ex
      const mediaId = protectedThumbnails.has(ex.protected.ymoveId)
        ? protectedThumbnails.get(ex.protected.ymoveId) ?? null
        : null
      return {
        ...ex,
        protected: { ...ex.protected, thumbnailMediaId: mediaId },
      }
    }),
  }))

  return NextResponse.json({
    ready:        true,
    generatedAt:  file.generatedAt,
    summary:      file.summary,
    metadata:     file.metadata,
    families:     familyIndex,
    l2Nodes:      enriched,
    totalNodes,
    page,
    limit,
  })
}
