import exercisesRaw from '@/data/exercises.json'

export interface Exercise {
  id: string
  name: string
  bodyPart: string
  equipment: string
  target: string
  secondaryMuscles: string[]
  instructions: string[]
  description: string
}

export const exercises = exercisesRaw as Exercise[]

export const BODY_PARTS = [
  'all',
  'back',
  'cardio',
  'chest',
  'lower arms',
  'lower legs',
  'neck',
  'shoulders',
  'upper arms',
  'upper legs',
  'waist',
] as const

export function getGifUrl(id: string) {
  const base = process.env.NEXT_PUBLIC_EXERCISE_GIF_BASE_URL ?? '/exercises'
  return `${base}/${id}.gif`
}

// ─── Derived metadata (computed once from source data) ────────────────────────

export interface EquipmentOption {
  value: string
  count: number
}

let _equipmentCache: EquipmentOption[] | null = null

export function getDistinctEquipment(): EquipmentOption[] {
  if (_equipmentCache) return _equipmentCache
  const counts = new Map<string, number>()
  for (const ex of exercises) {
    counts.set(ex.equipment, (counts.get(ex.equipment) ?? 0) + 1)
  }
  _equipmentCache = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
  return _equipmentCache
}

let _targetCache: string[] | null = null

export function getDistinctTargets(): string[] {
  if (_targetCache) return _targetCache
  _targetCache = [...new Set(exercises.map(e => e.target))].sort()
  return _targetCache
}

// ─── Stackable filter ─────────────────────────────────────────────────────────

export interface FilterOptions {
  q?: string
  bodyPart?: string | null
  equipment?: string | null
  target?: string | null
  allowedIds?: Set<string>       // restrict to this set (e.g. from equipment profile)
  favoriteIds?: Set<string>      // used when favoritesOnly=true
  favoritesOnly?: boolean
  excludeIds?: Set<string>       // dont_recommend exercises
  limit?: number
  offset?: number
}

export function filterExercises(opts: FilterOptions): Exercise[] {
  const {
    q, bodyPart, equipment, target,
    allowedIds, favoriteIds, favoritesOnly, excludeIds,
    limit = 60, offset = 0,
  } = opts

  let results = exercises

  if (favoritesOnly && favoriteIds) {
    results = results.filter(e => favoriteIds.has(e.id))
  }

  if (allowedIds) {
    results = results.filter(e => allowedIds.has(e.id))
  }

  if (excludeIds?.size) {
    results = results.filter(e => !excludeIds.has(e.id))
  }

  if (bodyPart && bodyPart !== 'all') {
    results = results.filter(e => e.bodyPart === bodyPart)
  }

  if (equipment) {
    results = results.filter(e => e.equipment === equipment)
  }

  if (target) {
    results = results.filter(e => e.target === target)
  }

  if (q?.trim()) {
    const lq = q.toLowerCase()
    results = results.filter(e =>
      e.name.toLowerCase().includes(lq) ||
      e.target.toLowerCase().includes(lq) ||
      e.equipment.toLowerCase().includes(lq) ||
      e.bodyPart.toLowerCase().includes(lq) ||
      e.secondaryMuscles.some(m => m.toLowerCase().includes(lq))
    )
  }

  // Favorites float to the top when not in favoritesOnly mode
  if (favoriteIds?.size && !favoritesOnly) {
    results = [
      ...results.filter(e => favoriteIds.has(e.id)),
      ...results.filter(e => !favoriteIds.has(e.id)),
    ]
  }

  return results.slice(offset, offset + limit)
}

// ─── Legacy wrapper kept for existing call sites ──────────────────────────────

export function searchExercises(query: string, bodyPart: string, limit = 30, offset = 0): Exercise[] {
  return filterExercises({ q: query, bodyPart, limit, offset })
}

export function getExerciseById(id: string): Exercise | undefined {
  return exercises.find(e => e.id === id)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isCustomExerciseId(id: string): boolean {
  return UUID_RE.test(id)
}

// ExerciseMeta unifies ExerciseDB exercises and custom exercises
// into one shape safe to use across the UI.
export interface ExerciseMeta extends Exercise {
  isCustom?: boolean
  trackingType?: string
}

// Returns compatible exercise IDs for a given list of equipment values.
// Used by equipment profiles and (future) V workout generation.
export function getExerciseIdsForEquipment(equipmentList: string[]): Set<string> {
  const set = new Set(equipmentList)
  return new Set(exercises.filter(e => set.has(e.equipment)).map(e => e.id))
}
