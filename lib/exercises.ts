import exercisesRaw from '@/data/exercises.json'
import aliasesRaw from '@/data/exercise-aliases.json'

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

// ─── Alias / synonym expansion ────────────────────────────────────────────────
// Aliases map common user-facing search terms to ExerciseDB exercise IDs.
// Stored in data/exercise-aliases.json — separate from ExerciseDB source data.
// Returns a Set of exercise IDs that match any alias for the given query.

interface AliasEntry {
  terms: string[]
  exerciseIds: string[]
}

let _aliasIndex: Map<string, Set<string>> | null = null

function getAliasIndex(): Map<string, Set<string>> {
  if (_aliasIndex) return _aliasIndex
  _aliasIndex = new Map()
  for (const entry of (aliasesRaw as { aliases: AliasEntry[] }).aliases) {
    if (!entry.exerciseIds.length) continue
    for (const term of entry.terms) {
      const existing = _aliasIndex.get(term.toLowerCase()) ?? new Set()
      for (const id of entry.exerciseIds) existing.add(id)
      _aliasIndex.set(term.toLowerCase(), existing)
    }
  }
  return _aliasIndex
}

export function getAliasMatchIds(query: string): Set<string> {
  if (!query.trim()) return new Set()
  const lq = query.toLowerCase().trim()
  const index = getAliasIndex()
  const matched = new Set<string>()
  for (const [term, ids] of index) {
    if (term.includes(lq) || lq.includes(term)) {
      for (const id of ids) matched.add(id)
    }
  }
  return matched
}

// ─── Movement pattern classification ─────────────────────────────────────────
// Derived at runtime from ExerciseDB bodyPart + target + exercise name.
// These patterns give V vocabulary to search by training role instead of body part,
// enabling design-first program building and redundancy detection.

export type MovementPattern =
  | 'squat'             // knee-dominant lower (back squat, leg press, hack squat)
  | 'hinge'             // hip-dominant posterior chain (deadlift, RDL, hip thrust)
  | 'lunge'             // unilateral lower (lunge, split squat, step-up, Bulgarian)
  | 'calf'              // calf raises and variants
  | 'horizontal_push'   // flat bench press and variants
  | 'incline_push'      // incline / decline press
  | 'fly'               // chest isolation (flye, crossover, pec deck)
  | 'vertical_push'     // overhead press
  | 'shoulder_isolation'// lateral raise, front raise, face pull, rear delt
  | 'vertical_pull'     // pull-ups, lat pulldowns
  | 'horizontal_pull'   // rows of all kinds
  | 'bicep'             // curls and variants
  | 'tricep'            // extensions, pushdowns, skull crushers
  | 'forearm'           // wrist/forearm work
  | 'core_antiextension'// plank, ab wheel, dead bug, Pallof press
  | 'core_flexion'      // crunch, sit-up
  | 'core_rotation'     // Russian twist, woodchop
  | 'core_lateral'      // side bend, lateral flexion
  | 'carry'             // farmer carry, suitcase carry
  | 'cardio'            // conditioning modalities
  | 'other'

export function deriveMovementPattern(exercise: Exercise): MovementPattern {
  const name = exercise.name.toLowerCase()
  const bp   = exercise.bodyPart.toLowerCase()
  const tgt  = exercise.target.toLowerCase()

  if (bp === 'cardio') return 'cardio'

  if (name.includes('farmer') || name.includes('suitcase carry') ||
      (name.includes('carry') && !name.includes('tricep'))) return 'carry'

  if (bp === 'upper legs') {
    // Hinge: hip-dominant — glute/hamstring target or named hip-extension movements
    if (
      tgt === 'glutes' || tgt === 'hamstrings' ||
      name.includes('deadlift') || name.includes(' rdl') || name.includes('romanian') ||
      name.includes('good morning') || name.includes('hip thrust') ||
      name.includes('hip extension') || name.includes('back extension') ||
      name.includes('glute bridge') || name.includes('hyperextension')
    ) return 'hinge'

    // Lunge: unilateral lower
    if (
      name.includes('lunge') || name.includes('step-up') || name.includes('step up') ||
      name.includes('split squat') || name.includes('bulgarian') || name.includes('pistol') ||
      name.includes('single-leg') || name.includes('single leg') ||
      name.includes('one-leg') || name.includes('one leg')
    ) return 'lunge'

    return 'squat'
  }

  if (bp === 'lower legs') return 'calf'

  if (bp === 'chest') {
    if (name.includes('fly') || name.includes('flye') ||
        name.includes('crossover') || name.includes('pec deck')) return 'fly'
    if (name.includes('incline') || name.includes('decline')) return 'incline_push'
    return 'horizontal_push'
  }

  if (bp === 'shoulders') {
    if (
      name.includes('lateral') || name.includes('front raise') ||
      name.includes('rear delt') || name.includes('face pull') ||
      name.includes('reverse fly') || name.includes('upright row') ||
      name.includes('shrug') || tgt === 'traps' || tgt === 'upper back'
    ) return 'shoulder_isolation'
    return 'vertical_push'
  }

  if (bp === 'back') {
    if (
      tgt === 'lats' ||
      name.includes('pull-up') || name.includes('pull up') || name.includes('pullup') ||
      name.includes('chin-up') || name.includes('chin up') || name.includes('chinup') ||
      name.includes('pulldown') || name.includes('pull-down') || name.includes('pull down')
    ) return 'vertical_pull'
    return 'horizontal_pull'
  }

  if (bp === 'upper arms') {
    if (
      tgt === 'triceps' ||
      name.includes('tricep') || name.includes('pushdown') ||
      name.includes('skull') || name.includes('kickback') ||
      (name.includes('extension') && !name.includes('hip') && !name.includes('leg'))
    ) return 'tricep'
    return 'bicep'
  }

  if (bp === 'lower arms') return 'forearm'

  if (bp === 'waist') {
    if (
      name.includes('plank') || name.includes('ab wheel') || name.includes('rollout') ||
      name.includes('hollow') || name.includes('dead bug') ||
      name.includes('bird-dog') || name.includes('bird dog') || name.includes('pallof')
    ) return 'core_antiextension'
    if (
      name.includes('twist') || name.includes('rotation') ||
      name.includes('russian') || name.includes('woodchop') || name.includes('wood chop')
    ) return 'core_rotation'
    if (name.includes('side bend') || name.includes('lateral flex')) return 'core_lateral'
    return 'core_flexion'
  }

  return 'other'
}

// ─── Stackable filter ─────────────────────────────────────────────────────────

export interface FilterOptions {
  q?: string
  bodyPart?: string | null
  equipment?: string | null
  target?: string | null
  movementPattern?: MovementPattern | null
  allowedIds?: Set<string>       // restrict to this set (e.g. from equipment profile)
  favoriteIds?: Set<string>      // used when favoritesOnly=true
  favoritesOnly?: boolean
  excludeIds?: Set<string>       // dont_recommend exercises
  limit?: number
  offset?: number
}

export function filterExercises(opts: FilterOptions): Exercise[] {
  const {
    q, bodyPart, equipment, target, movementPattern,
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

  if (movementPattern) {
    results = results.filter(e => deriveMovementPattern(e) === movementPattern)
  }

  if (q?.trim()) {
    const lq = q.toLowerCase()
    // Text match against exercise fields
    const textMatches = results.filter(e =>
      e.name.toLowerCase().includes(lq) ||
      e.target.toLowerCase().includes(lq) ||
      e.equipment.toLowerCase().includes(lq) ||
      e.bodyPart.toLowerCase().includes(lq) ||
      e.secondaryMuscles.some(m => m.toLowerCase().includes(lq))
    )

    // Alias expansion — exercises matched via synonym/alias file
    const aliasIds = getAliasMatchIds(q)
    if (aliasIds.size > 0) {
      const textMatchIds = new Set(textMatches.map(e => e.id))
      // Alias matches that survived the other active filters (allowedIds, bodyPart, equipment, target)
      const aliasMatches = results.filter(e => aliasIds.has(e.id) && !textMatchIds.has(e.id))
      // Text matches first, then alias-only matches
      results = [...textMatches, ...aliasMatches]
    } else {
      results = textMatches
    }
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
