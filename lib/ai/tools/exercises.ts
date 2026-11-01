import 'server-only'
import { searchExercises, getExerciseById, classifyExercise } from '@/lib/exercises'
import type { Exercise, ExerciseMeta, MovementPattern, MovementFamily, ExerciseRole, Laterality, ClassificationConfidence, ExerciseClassification } from '@/lib/exercises'
import type { PrismaClient } from '@prisma/client'
import { isYmvId, parseYmvId, formatYmvId } from '@/lib/exercises/identity'
import { classifyYmoveExercise } from '@/lib/ymove/classify'
import type { MovementClass, MovementSubclass } from '@/lib/ymove/hierarchy-scorer'

// Compact exercise summary sent to V — structured metadata only, never GIF URLs.
export interface ExerciseSummary {
  id: string
  name: string
  bodyPart: string
  equipment: string
  target: string
  secondaryMuscles: string[]
  // Involved classification layer — derived from name + metadata, NOT raw ExerciseDB fields
  movementPattern: MovementPattern
  secondaryMovementPatterns: MovementPattern[]
  movementFamily: MovementFamily
  exerciseRole: ExerciseRole
  laterality: Laterality
  classificationConfidence: ClassificationConfidence
}

function toSummary(e: Exercise): ExerciseSummary {
  const c = classifyExercise(e)
  return {
    id: e.id,
    name: e.name,
    bodyPart: e.bodyPart,
    equipment: e.equipment,
    target: e.target,
    secondaryMuscles: e.secondaryMuscles,
    movementPattern: c.primaryMovementPattern,
    secondaryMovementPatterns: c.secondaryMovementPatterns,
    movementFamily: c.movementFamily,
    exerciseRole: c.exerciseRole,
    laterality: c.laterality,
    classificationConfidence: c.classificationConfidence,
  }
}

export interface ExerciseSearchParams {
  query?: string
  bodyPart?: string
  equipment?: string
  muscle?: string
  movementPattern?: string
  limit?: number
}

// Role priority for search ranking: compounds surface before accessories/isolations.
// This prevents dataset-order bias (ExerciseDB IDs 0001-0200 are mostly barbell) from
// making barbell the default equipment when V searches without an equipment filter.
const ROLE_PRIORITY: Record<string, number> = {
  primary_compound:   0,
  secondary_compound: 1,
  accessory:          2,
  power:              3,
  isolation:          4,
  conditioning:       5,
  mobility:           6,
  unknown:            7,
}

export function executeExerciseSearch(params: ExerciseSearchParams): ExerciseSummary[] {
  const { query = '', bodyPart = 'all', equipment, muscle, movementPattern, limit = 15 } = params

  // Get a broad result set first (up to 300 so downstream filters have room)
  let results = searchExercises(query, bodyPart, 300)

  if (equipment) {
    const eq = equipment.toLowerCase()
    results = results.filter(e => e.equipment.toLowerCase().includes(eq))
  }
  if (muscle) {
    const m = muscle.toLowerCase()
    results = results.filter(
      e => e.target.toLowerCase().includes(m) || e.secondaryMuscles.some(s => s.toLowerCase().includes(m))
    )
  }
  if (movementPattern) {
    results = results.filter(e => classifyExercise(e).primaryMovementPattern === movementPattern)
  }

  // Rank by exerciseRole so primary/secondary compounds appear before accessories
  // and isolations, regardless of the underlying dataset order. Within the same role,
  // preserve the original order (which text-match relevance already implies).
  results.sort((a, b) => {
    const ra = ROLE_PRIORITY[classifyExercise(a).exerciseRole] ?? 7
    const rb = ROLE_PRIORITY[classifyExercise(b).exerciseRole] ?? 7
    return ra - rb
  })

  return results.slice(0, limit).map(toSummary)
}

// Validate that an exercise ID exists in our library (ExerciseDB only).
export function validateExerciseId(id: string): Exercise | null {
  return getExerciseById(id) ?? null
}

// ── YMove bridge helpers ──────────────────────────────────────────────────────

function muscleGroupToBodyPart(muscleGroup: string | null): string {
  if (!muscleGroup) return 'unknown'
  const m = muscleGroup.toLowerCase()
  if (/chest|pec/.test(m))                           return 'chest'
  if (/back|lat|rhomboid|trap|erector/.test(m))      return 'back'
  if (/shoulder|delt/.test(m))                       return 'shoulders'
  if (/bicep/.test(m))                               return 'upper arms'
  if (/tricep/.test(m))                              return 'upper arms'
  if (/forearm|wrist|lower arm/.test(m))             return 'lower arms'
  if (/quad|hamstring|glute|hip/.test(m))            return 'upper legs'
  if (/calf|gastrocnemius|soleus/.test(m))           return 'lower legs'
  if (/core|abs|abdominal|oblique/.test(m))          return 'waist'
  if (/neck/.test(m))                                return 'neck'
  if (/leg/.test(m))                                 return 'upper legs'
  return 'unknown'
}

function ymoveClassToMovementPattern(
  cls: MovementClass,
  sub: MovementSubclass,
  name: string,
): { primary: MovementPattern; secondary: MovementPattern[] } {
  const n = name.toLowerCase()
  switch (cls) {
    case 'lower_push':
      if (sub === 'calf_raise' || /calf raise|calf press/.test(n))
        return { primary: 'calf', secondary: [] }
      if (sub === 'hip_thrust' || /hip thrust|glute bridge/.test(n))
        return { primary: 'hinge', secondary: [] }
      if (sub === 'lunge' || /lunge|split squat|step.?up|bulgarian/.test(n))
        return { primary: 'lunge', secondary: [] }
      return { primary: 'squat', secondary: [] }
    case 'lower_pull':
      return { primary: 'hinge', secondary: [] }
    case 'upper_push_h':
      if (/\bfly\b|flye|crossover|pec deck|cable cross/.test(n))
        return { primary: 'fly', secondary: [] }
      if (/incline|decline/.test(n))
        return { primary: 'incline_push', secondary: ['horizontal_push'] }
      return { primary: 'horizontal_push', secondary: [] }
    case 'upper_push_v':
      return { primary: 'vertical_push', secondary: [] }
    case 'upper_pull_h':
      if (/rear delt|face pull/.test(n))
        return { primary: 'shoulder_isolation', secondary: ['horizontal_pull'] }
      return { primary: 'horizontal_pull', secondary: [] }
    case 'upper_pull_v':
      return { primary: 'vertical_pull', secondary: [] }
    case 'arm_flexion':
      if (/forearm|wrist/.test(n)) return { primary: 'forearm', secondary: [] }
      return { primary: 'bicep', secondary: [] }
    case 'arm_extension':
      return { primary: 'tricep', secondary: [] }
    case 'shoulder_isolation':
      return { primary: 'shoulder_isolation', secondary: [] }
    case 'core':
      if (/twist|rotation|woodchop/.test(n)) return { primary: 'core_rotation', secondary: [] }
      if (/side bend|lateral flex/.test(n))  return { primary: 'core_lateral', secondary: [] }
      if (/crunch|sit.?up|leg raise/.test(n)) return { primary: 'core_flexion', secondary: [] }
      return { primary: 'core_antiextension', secondary: [] }
    case 'cardio_conditioning':
      return { primary: 'cardio', secondary: [] }
    default:
      return { primary: 'other', secondary: [] }
  }
}

function ymoveClassToRole(cls: MovementClass): ExerciseRole {
  switch (cls) {
    case 'lower_push':
    case 'lower_pull':     return 'primary_compound'
    case 'upper_push_h':
    case 'upper_push_v':
    case 'upper_pull_h':
    case 'upper_pull_v':   return 'secondary_compound'
    case 'arm_flexion':
    case 'arm_extension':
    case 'shoulder_isolation': return 'isolation'
    case 'hip_abduction':  return 'accessory'
    case 'cardio_conditioning': return 'conditioning'
    case 'mobility_stretch':    return 'mobility'
    default: return 'unknown'
  }
}

// Classify any Exercise (ExerciseDB or YMove) into a uniform ExerciseClassification.
// For ymv: exercises, reads ymoveCategory from ExerciseMeta so cardio/category-gated
// movement classes resolve correctly without a second catalog query.
export function classifyAnyExercise(exercise: Exercise): ExerciseClassification {
  if (!isYmvId(exercise.id)) return classifyExercise(exercise)
  const category = (exercise as ExerciseMeta).ymoveCategory ?? null
  const cls = classifyYmoveExercise({ name: exercise.name, equipment: exercise.equipment, category })
  const { primary, secondary } = ymoveClassToMovementPattern(cls.movementClass, cls.movementSubclass, exercise.name)
  const conf: ClassificationConfidence =
    cls.confidence === 'high'   ? 'high'
    : cls.confidence === 'medium' ? 'medium'
    : 'needs_review'
  return {
    primaryMovementPattern:    primary,
    secondaryMovementPatterns: secondary,
    movementFamily:            'unknown' as MovementFamily,
    exerciseRole:              ymoveClassToRole(cls.movementClass),
    laterality:                'bilateral',
    classificationConfidence:  conf,
  }
}

// YMove-first search. When YMOVE_CATALOG_ENABLED=true and db is provided, searches
// the YMove catalog exclusively — ExerciseDB results are NOT merged. This prevents
// ExerciseDB from crowding out YMove exercises and ensures honest no-match behavior:
// if YMove has no suitable result, an empty list is returned rather than a silent
// ExerciseDB fallback. ExerciseDB resolution is preserved for existing legacy records
// via validateExerciseIdAsync and getExerciseById.
//
// When flag is off or db is omitted, falls through to ExerciseDB-only behavior.
export async function executeExerciseSearchAsync(
  params: ExerciseSearchParams,
  db?: PrismaClient,
): Promise<ExerciseSummary[]> {
  if (!db || process.env.YMOVE_CATALOG_ENABLED !== 'true') return executeExerciseSearch(params)

  const { query = '', bodyPart = 'all', equipment, muscle, movementPattern, limit = 15 } = params
  const safeLimit = Math.min(limit, 100)

  const ymoveRows = await db.ymoveExerciseCatalog.findMany({
    where: {
      NOT:       { curationStatus: 'duplicate' },
      ...(query     ? { name:      { contains: query,     mode: 'insensitive' } } : {}),
      ...(equipment ? { equipment: { contains: equipment, mode: 'insensitive' } } : {}),
    },
    select: { ymoveId: true, name: true, equipment: true, category: true, primaryMuscleGroup: true },
    take: safeLimit * 3,
  })

  const ymoveResults: ExerciseSummary[] = []
  for (const row of ymoveRows) {
    const cls = classifyYmoveExercise({ name: row.name, equipment: row.equipment, category: row.category })
    const { primary, secondary } = ymoveClassToMovementPattern(cls.movementClass, cls.movementSubclass, row.name)

    if (movementPattern && primary !== movementPattern && !secondary.includes(movementPattern as MovementPattern)) continue
    if (muscle) {
      const m = muscle.toLowerCase()
      if (!(row.primaryMuscleGroup ?? '').toLowerCase().includes(m)) continue
    }
    if (bodyPart && bodyPart !== 'all') {
      const bp = muscleGroupToBodyPart(row.primaryMuscleGroup)
      if (bp !== bodyPart.toLowerCase()) continue
    }

    const conf: ClassificationConfidence =
      cls.confidence === 'high' ? 'high' : cls.confidence === 'medium' ? 'medium' : 'needs_review'
    ymoveResults.push({
      id:                        formatYmvId(row.ymoveId),
      name:                      row.name,
      bodyPart:                  muscleGroupToBodyPart(row.primaryMuscleGroup),
      equipment:                 row.equipment ?? 'unknown',
      target:                    row.primaryMuscleGroup ?? 'unknown',
      secondaryMuscles:          [],
      movementPattern:           primary,
      secondaryMovementPatterns: secondary,
      movementFamily:            'unknown' as MovementFamily,
      exerciseRole:              ymoveClassToRole(cls.movementClass),
      laterality:                'bilateral',
      classificationConfidence:  conf,
    })
  }

  ymoveResults.sort((a, b) => (ROLE_PRIORITY[a.exerciseRole] ?? 7) - (ROLE_PRIORITY[b.exerciseRole] ?? 7))
  return ymoveResults.slice(0, safeLimit)
}

// Validate an exercise ID across all supported spaces with server-side catalog verification.
// CRITICAL: ymv: IDs require YMOVE_CATALOG_ENABLED=true AND a live DB catalog check.
// isYmvId() alone is not sufficient — the ID must exist in the catalog.
// When db is omitted (tests), ymv: IDs are treated as invalid (same as flag-off behavior).
// Returns ExerciseMeta so ymoveCategory is available to classifyAnyExercise.
export async function validateExerciseIdAsync(
  id: string,
  _userId?: string,
  db?: PrismaClient,
): Promise<ExerciseMeta | null> {
  if (isYmvId(id)) {
    if (!db || process.env.YMOVE_CATALOG_ENABLED !== 'true') return null
    const bareId = parseYmvId(id)
    if (!bareId) return null
    const row = await db.ymoveExerciseCatalog.findUnique({
      where:  { ymoveId: bareId },
      select: { ymoveId: true, name: true, equipment: true, category: true, primaryMuscleGroup: true },
    })
    if (!row) return null
    return {
      id:               formatYmvId(row.ymoveId),
      name:             row.name,
      bodyPart:         muscleGroupToBodyPart(row.primaryMuscleGroup),
      equipment:        row.equipment ?? 'unknown',
      target:           row.primaryMuscleGroup ?? 'unknown',
      secondaryMuscles: [],
      instructions:     [],
      description:      '',
      ymoveCategory:    row.category,
    }
  }
  return getExerciseById(id) ?? null
}

export const SEARCH_EXERCISES_TOOL = {
  type: 'function' as const,
  function: {
    name: 'search_exercises',
    description:
      'Search the Involved exercise library. Results may include ymv:-prefixed IDs from the YMove catalog alongside standard ExerciseDB IDs — use all returned IDs exactly as given. Each result includes movementPattern, movementFamily, exerciseRole, and laterality from the Involved classification layer — these are derived from the exercise name, NOT blindly from ExerciseDB bodyPart/target. Use movementPattern filter when filling a specific training role. Use movementFamily to detect redundancy across variations. Always search before selecting exercise IDs. Never invent IDs.',
    parameters: {
      type: 'object',
      properties: {
        query:     { type: 'string', description: 'Exercise name or keyword search' },
        bodyPart:  { type: 'string', description: 'Body part: back, chest, shoulders, upper arms, lower arms, upper legs, lower legs, waist, neck, cardio' },
        equipment: { type: 'string', description: 'Equipment type, e.g. barbell, dumbbell, cable, body weight, machine, kettlebell' },
        muscle:    { type: 'string', description: 'Target or secondary muscle to filter by, e.g. glutes, hamstrings, lats, quads' },
        movementPattern: {
          type: 'string',
          description: 'PREFERRED filter for role-based search. Values: squat, hinge, lunge, calf, horizontal_push, incline_push, fly, vertical_push, shoulder_isolation, vertical_pull, horizontal_pull, bicep, tricep, forearm, core_antiextension, core_flexion, core_rotation, core_lateral, carry, cardio, olympic_power, other. Use this instead of bodyPart when you have a specific training role to fill.',
        },
        limit: { type: 'number', description: 'Max results (default 15, max 20)' },
      },
      required: [],
    },
  },
}
