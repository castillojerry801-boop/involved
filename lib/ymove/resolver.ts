import 'server-only'
import type { PrismaClient } from '@prisma/client'
import type { ExerciseMeta } from '@/lib/exercises'
import { getExerciseById, isCustomExerciseId } from '@/lib/exercises'
import { customToMeta } from '@/lib/training/custom-exercises'
import { isYmvId, parseYmvId, formatYmvId } from '@/lib/exercises/identity'

interface YmoveCatalogRow {
  ymoveId:            string
  name:               string
  equipment:          string | null
  primaryMuscleGroup: string | null
  thumbnailMediaId:   string | null
  hasVideo:           boolean
}

function muscleGroupToBodyPart(muscleGroup: string | null): string {
  if (!muscleGroup) return 'unknown'
  const m = muscleGroup.toLowerCase()
  if (/chest|pec/.test(m))                         return 'chest'
  if (/back|lat|rhomboid|trap|erector/.test(m))    return 'back'
  if (/shoulder|delt/.test(m))                     return 'shoulders'
  if (/bicep|forearm|lower arm/.test(m))           return 'upper arms'
  if (/tricep/.test(m))                            return 'upper arms'
  if (/quad|hamstring|glute|hip|calf|leg/.test(m)) return 'upper legs'
  if (/calf|gastrocnemius|soleus/.test(m))         return 'lower legs'
  if (/core|abs|abdominal|oblique/.test(m))        return 'waist'
  if (/neck/.test(m))                              return 'neck'
  if (/cardio/.test(m))                            return 'cardio'
  return 'unknown'
}

export function ymvToMeta(row: YmoveCatalogRow): ExerciseMeta {
  return {
    id:               formatYmvId(row.ymoveId),
    name:             row.name,
    bodyPart:         muscleGroupToBodyPart(row.primaryMuscleGroup),
    equipment:        row.equipment ?? 'unknown',
    target:           row.primaryMuscleGroup ?? 'unknown',
    secondaryMuscles: [],
    instructions:     [],
    description:      '',
  }
}

/**
 * Verify all ymv:-prefixed IDs in the list exist in YmoveExerciseCatalog.
 * Non-ymv IDs are ignored (pass-through). Returns false only if a ymv:
 * ID is not in the catalog.
 */
export async function verifyYmvIds(ids: string[], db: PrismaClient): Promise<boolean> {
  const ymvIds = ids.filter(isYmvId)
  if (ymvIds.length === 0) return true
  const bareIds = ymvIds.map(id => parseYmvId(id)!)
  const found = await db.ymoveExerciseCatalog.findMany({
    where:  { ymoveId: { in: bareIds } },
    select: { ymoveId: true },
  })
  return found.length === bareIds.length
}

/**
 * Unified exercise resolver for all three identity spaces.
 *
 * Checks ymove → custom → exercisedb in order. Returns null if the ID
 * is not found in any space.
 */
export async function resolveExerciseMeta(
  id:     string,
  userId: string,
  db:     PrismaClient,
): Promise<ExerciseMeta | null> {
  if (isYmvId(id)) {
    const bareId = parseYmvId(id)!
    const row = await db.ymoveExerciseCatalog.findUnique({
      where:  { ymoveId: bareId },
      select: { ymoveId: true, name: true, equipment: true, primaryMuscleGroup: true, thumbnailMediaId: true, hasVideo: true },
    })
    return row ? ymvToMeta(row) : null
  }
  if (isCustomExerciseId(id)) {
    const row = await db.customExercise.findFirst({ where: { id, userId } })
    return row ? customToMeta(row) : null
  }
  return getExerciseById(id) ?? null
}

/**
 * Batch-prefetch all ymv: IDs from the catalog and return a lookup map.
 * Use this in routes/contexts that process many exercises at once to avoid
 * N+1 Prisma queries.
 *
 * Usage:
 *   const ymvMap = await prefetchYmvMeta(allExerciseIds, prisma)
 *   const ex = ymvMap.get(id) ?? getExerciseById(id) ?? null
 */
export async function prefetchYmvMeta(
  ids: string[],
  db:  PrismaClient,
): Promise<Map<string, ExerciseMeta>> {
  const ymvIds = [...new Set(ids.filter(isYmvId))]
  if (ymvIds.length === 0) return new Map()
  const bareIds = ymvIds.map(id => parseYmvId(id)!)
  const rows = await db.ymoveExerciseCatalog.findMany({
    where:  { ymoveId: { in: bareIds } },
    select: { ymoveId: true, name: true, equipment: true, primaryMuscleGroup: true, thumbnailMediaId: true, hasVideo: true },
  })
  return new Map(rows.map(r => [formatYmvId(r.ymoveId), ymvToMeta(r)]))
}
