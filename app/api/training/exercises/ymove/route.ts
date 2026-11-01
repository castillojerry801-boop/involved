import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { formatYmvId } from '@/lib/exercises/identity'
import { classifyYmoveExercise } from '@/lib/ymove/classify'

// ── Feature flag ──────────────────────────────────────────────────────────────
// Default-off. Set YMOVE_CATALOG_ENABLED=true in .env.local to enable for
// development/testing. Do not expose to users until write paths support ymv: IDs.

function isCatalogEnabled(): boolean {
  return process.env.YMOVE_CATALOG_ENABLED === 'true'
}

const MAX_LIMIT = 100

/**
 * GET /api/training/exercises/ymove
 *
 * Read-only YMove catalog search. Returns exercises in ExerciseMeta-compatible
 * shape with ymv:-prefixed IDs.
 *
 * Query params:
 *   ?q=bench              — full-text name search (case-insensitive contains)
 *   ?equipment=barbell    — exact equipment string match (YMove API value)
 *   ?movement=fam_chest_press — movement family filter (derived at query time)
 *   ?eqFamily=barbell     — normalised equipment family filter (derived at query time)
 *   ?page=1&limit=50      — pagination (max 100 per page)
 *
 * Response shape (per item):
 *   id            — "ymv:<ymoveId>"
 *   name          — YMove exercise name
 *   bodyPart      — derived from primaryMuscleGroup
 *   equipment     — YMove equipment string ("barbell", "dumbbell", …) or "unknown"
 *   target        — YMove primaryMuscleGroup or "unknown"
 *   source        — always "ymove"
 *   ymoveId       — bare UUID
 *   thumbnailMediaId — thumbnail proxy UUID or null
 *   movementFamilyId — classified movement family or null
 *   eqFamily      — normalised equipment family or null
 *   variations    — array of detected variation tags
 *   classification.confidence — "high" | "medium" | "low"
 */
export async function GET(req: NextRequest) {
  if (!isCatalogEnabled()) {
    return NextResponse.json(
      { error: 'YMove catalog is not enabled on this environment.' },
      { status: 404 },
    )
  }

  const sp        = req.nextUrl.searchParams
  const q         = (sp.get('q') ?? '').trim()
  const equipment = (sp.get('equipment') ?? '').trim()
  const movement  = (sp.get('movement') ?? '').trim()
  const eqFamily  = (sp.get('eqFamily') ?? '').trim()
  const page      = Math.max(1, parseInt(sp.get('page') ?? '1', 10))
  const limit     = Math.min(Math.max(1, parseInt(sp.get('limit') ?? '50', 10)), MAX_LIMIT)
  const offset    = (page - 1) * limit

  // Build Prisma where clause
  const where: Prisma.YmoveExerciseCatalogWhereInput = {
    // Exclude entries that curation has marked as duplicates
    NOT: { curationStatus: 'duplicate' },
  }

  if (q) {
    where.name = { contains: q, mode: 'insensitive' }
  }

  if (equipment) {
    where.equipment = { equals: equipment, mode: 'insensitive' }
  }

  const [total, rows] = await Promise.all([
    prisma.ymoveExerciseCatalog.count({ where }),
    prisma.ymoveExerciseCatalog.findMany({
      where,
      select: {
        ymoveId:           true,
        name:              true,
        equipment:         true,
        category:          true,
        primaryMuscleGroup: true,
        thumbnailMediaId:  true,
        hasVideo:          true,
      },
      orderBy: { name: 'asc' },
      skip:    offset,
      take:    limit,
    }),
  ])

  const items = rows
    .map(row => {
      const cls = classifyYmoveExercise({
        name:      row.name,
        equipment: row.equipment,
        category:  row.category,
      })

      // Post-classification filters (movementFamilyId and eqFamily are computed,
      // not stored, so they can't be applied in the SQL WHERE clause)
      if (movement && cls.movementFamilyId !== movement) return null
      if (eqFamily && cls.eqFamily !== eqFamily) return null

      return {
        id:               formatYmvId(row.ymoveId),
        name:             row.name,
        bodyPart:         muscleGroupToBodyPart(row.primaryMuscleGroup),
        equipment:        row.equipment ?? 'unknown',
        target:           row.primaryMuscleGroup ?? 'unknown',
        secondaryMuscles: [] as string[],
        instructions:     [] as string[],
        description:      '',
        source:           'ymove' as const,
        ymoveId:          row.ymoveId,
        ymoveCategory:    row.category ?? null,
        thumbnailMediaId: row.thumbnailMediaId ?? null,
        hasVideo:         row.hasVideo,
        movementFamilyId: cls.movementFamilyId,
        eqFamily:         cls.eqFamily,
        variations:       cls.variations,
        classification:   {
          movementClass:    cls.movementClass,
          movementSubclass: cls.movementSubclass,
          eqSource:         cls.eqSource,
          confidence:       cls.confidence,
        },
      }
    })
    .filter(Boolean)

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function muscleGroupToBodyPart(muscleGroup: string | null): string {
  if (!muscleGroup) return 'unknown'
  const m = muscleGroup.toLowerCase()
  if (/chest|pec/.test(m))                           return 'chest'
  if (/back|lat|rhomboid|trap|erector/.test(m))      return 'back'
  if (/shoulder|delt/.test(m))                       return 'shoulders'
  if (/bicep|forearm|lower arm/.test(m))             return 'upper arms'
  if (/tricep/.test(m))                              return 'upper arms'
  if (/quad|hamstring|glute|hip|calf|leg/.test(m))   return 'upper legs'
  if (/calf|gastrocnemius|soleus/.test(m))           return 'lower legs'
  if (/core|abs|abdominal|oblique/.test(m))          return 'waist'
  if (/neck/.test(m))                                return 'neck'
  if (/cardio/.test(m))                              return 'cardio'
  return 'unknown'
}
