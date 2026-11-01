/**
 * Exercise identity resolver.
 *
 * Three disjoint identity spaces:
 *   exercisedb  – 4-digit numeric string ("0025")
 *   ymove       – ymv:<uuid> namespaced string ("ymv:65e95132-...")
 *   custom      – bare UUID string ("65e95132-...") NOT prefixed with ymv:
 *
 * The three spaces are mutually exclusive by construction:
 *   - ExerciseDB IDs are purely numeric and never 36 chars.
 *   - ymv: IDs have a fixed prefix that a bare UUID cannot have.
 *   - Custom UUIDs are bare UUIDs with no prefix.
 *
 * Nothing outside this module needs to re-implement these predicates.
 */

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXDB_RE   = /^\d{4}$/
const YMV_PREFIX = 'ymv:'

export type ExerciseKind = 'exercisedb' | 'ymove' | 'custom' | 'unknown'

/** Four-digit zero-padded ExerciseDB ID, e.g. "0025". */
export function isExerciseDbId(id: string): boolean {
  return EXDB_RE.test(id)
}

/**
 * Bare UUID custom exercise ID, e.g. "65e95132-e6bb-41e8-af7d-0eda931a1693".
 * Explicitly excludes ymv:-prefixed strings so a YMove ID can never
 * accidentally resolve as a custom exercise.
 */
export function isCustomExerciseId(id: string): boolean {
  return UUID_RE.test(id) && !id.startsWith(YMV_PREFIX)
}

/**
 * Namespaced YMove ID, e.g. "ymv:65e95132-e6bb-41e8-af7d-0eda931a1693".
 * The prefix is mandatory. A bare UUID is not a valid ymv ID.
 */
export function isYmvId(id: string): boolean {
  if (!id.startsWith(YMV_PREFIX)) return false
  return UUID_RE.test(id.slice(YMV_PREFIX.length))
}

/**
 * Extract the bare YMove UUID from a ymv:-prefixed ID.
 * Returns null for any other input — never throws.
 */
export function parseYmvId(id: string): string | null {
  if (!id.startsWith(YMV_PREFIX)) return null
  const uuid = id.slice(YMV_PREFIX.length)
  return UUID_RE.test(uuid) ? uuid : null
}

/** Wrap a bare YMove UUID in the ymv: namespace. */
export function formatYmvId(ymoveId: string): string {
  return `${YMV_PREFIX}${ymoveId}`
}

/**
 * Classify an exercise ID into one of four disjoint kinds.
 * Returns 'unknown' for any string that matches none of the three
 * recognised formats — callers must handle this explicitly.
 */
export function resolveExerciseKind(id: string): ExerciseKind {
  if (isYmvId(id))         return 'ymove'
  if (isExerciseDbId(id))  return 'exercisedb'
  if (isCustomExerciseId(id)) return 'custom'
  return 'unknown'
}
