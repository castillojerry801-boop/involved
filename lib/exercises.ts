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

// O(1) lookup — exercises are module-level constants and never mutate
const _byId = new Map<string, Exercise>(exercises.map(e => [e.id, e]))

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
// Derived at runtime using exercise name (most reliable), then bodyPart+target.
// ExerciseDB's bodyPart and target fields are NOT treated as ground truth —
// the name typically describes the actual movement more accurately.

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
  | 'olympic_power'     // Olympic/power lifts (clean, snatch, jerk, thruster, power clean)
  | 'other'

// Classification confidence — how reliably was the pattern derived?
export type ClassificationConfidence =
  | 'high'          // Name and metadata agree; pattern is unambiguous
  | 'medium'        // Likely correct but metadata partially conflicts or name is ambiguous
  | 'needs_review'  // Name vs metadata conflict, multi-pattern exercise, or ambiguous Olympic variant

// Coarse movement family for redundancy detection across exercise variations.
// Two exercises with the same movementFamily fill the same programming role.
export type MovementFamily =
  | 'back_squat' | 'front_squat' | 'overhead_squat' | 'goblet_squat'
  | 'hack_squat' | 'leg_press' | 'leg_extension' | 'leg_curl'
  | 'deadlift' | 'romanian_deadlift' | 'sumo_deadlift'
  | 'hip_thrust' | 'glute_bridge' | 'good_morning' | 'back_extension'
  | 'lunge' | 'split_squat' | 'step_up' | 'pistol_squat'
  | 'calf_raise'
  | 'bench_press' | 'incline_press' | 'decline_press' | 'push_up' | 'dip' | 'chest_fly'
  | 'overhead_press' | 'push_press'
  | 'lateral_raise' | 'front_raise' | 'rear_delt' | 'face_pull' | 'upright_row' | 'shrug'
  | 'pull_up' | 'lat_pulldown' | 'row'
  | 'curl' | 'hammer_curl' | 'preacher_curl'
  | 'tricep_pushdown' | 'skull_crusher' | 'tricep_extension'
  | 'plank' | 'crunch' | 'sit_up' | 'ab_wheel' | 'leg_raise' | 'russian_twist' | 'side_bend'
  | 'farmer_carry'
  | 'clean' | 'snatch' | 'jerk' | 'thruster'
  | 'cardio'
  | 'unknown'

// Programming role — how does this exercise typically function in a program?
export type ExerciseRole =
  | 'primary_compound'    // Major multi-joint lift (squat, deadlift, bench, row, OHP, pull-up)
  | 'secondary_compound'  // Multi-joint accessory (RDL, split squat, incline press, cable row)
  | 'accessory'           // Targeted single or small multi-joint (face pull, carry, anti-extension)
  | 'isolation'           // Single-joint (curl, lateral raise, tricep ext, calf raise)
  | 'power'               // Explosive Olympic-derived movement
  | 'conditioning'        // Cardiovascular / metabolic work
  | 'mobility'            // Stretch, yoga, foam roll
  | 'unknown'

// Is the exercise bilateral, unilateral, or alternating?
export type Laterality = 'bilateral' | 'unilateral' | 'alternating' | 'unknown'

export interface ExerciseClassification {
  primaryMovementPattern: MovementPattern
  secondaryMovementPatterns: MovementPattern[]   // Only non-empty for true multi-pattern exercises
  movementFamily: MovementFamily
  exerciseRole: ExerciseRole
  laterality: Laterality
  classificationConfidence: ClassificationConfidence
  reviewReason?: string
}

// ─── Internal derivation helpers ──────────────────────────────────────────────

function _derivePrimaryPattern(
  name: string, bp: string, tgt: string
): { pattern: MovementPattern; secondary: MovementPattern[]; confidence: ClassificationConfidence; reviewReason?: string } {

  // ── OLYMPIC / POWER — must check before any bodyPart branch ──────────────
  if (name.includes('clean and press') || name.includes('clean & press')) {
    return { pattern: 'olympic_power', secondary: ['vertical_push'], confidence: 'high', reviewReason: 'multi-pattern: power clean + overhead press' }
  }
  if (name.includes('clean and jerk') || name.includes('clean & jerk')) {
    return { pattern: 'olympic_power', secondary: ['vertical_push'], confidence: 'high', reviewReason: 'multi-pattern: clean + jerk' }
  }
  if (name.includes('thruster')) {
    return { pattern: 'olympic_power', secondary: ['squat', 'vertical_push'], confidence: 'high', reviewReason: 'multi-pattern: squat + overhead press' }
  }
  if (name.includes('snatch pull')) {
    return { pattern: 'olympic_power', secondary: ['hinge'], confidence: 'medium', reviewReason: 'snatch pull — Olympic context, hinge-like' }
  }
  if (name.includes('snatch')) {
    return { pattern: 'olympic_power', secondary: [], confidence: 'high' }
  }
  if (name.includes('jerk') && !name.includes('upright')) {
    return { pattern: 'olympic_power', secondary: [], confidence: 'high' }
  }
  if (name.includes('power clean') || name.includes('hang clean')) {
    return { pattern: 'olympic_power', secondary: [], confidence: 'high' }
  }
  // Bare 'clean' keyword — only Olympic if not a 'clean-grip' or 'squat' variation
  if (name.includes('clean') && !name.includes('clean grip') && !name.includes('clean-grip') && !name.includes('squat')) {
    return { pattern: 'olympic_power', secondary: [], confidence: 'high' }
  }

  // ── CARRY ────────────────────────────────────────────────────────────────
  if (name.includes('farmer') || name.includes('suitcase carry') ||
      (name.includes('carry') && !name.includes('tricep'))) {
    return { pattern: 'carry', secondary: [], confidence: 'high' }
  }

  // ── CARDIO ───────────────────────────────────────────────────────────────
  if (bp === 'cardio') return { pattern: 'cardio', secondary: [], confidence: 'high' }

  // ── UPPER LEGS ───────────────────────────────────────────────────────────
  if (bp === 'upper legs') {
    // Hinge name keywords checked BEFORE target muscle (name is more reliable)
    if (
      name.includes('deadlift') || name.includes(' rdl') || name.includes('romanian') ||
      name.includes('good morning') || name.includes('hip thrust') ||
      name.includes('hip extension') || name.includes('back extension') ||
      name.includes('glute bridge') || name.includes('hyperextension')
    ) return { pattern: 'hinge', secondary: [], confidence: 'high' }

    // Lunge name keywords
    if (
      name.includes('lunge') || name.includes('step-up') || name.includes('step up') ||
      name.includes('split squat') || name.includes('bulgarian') || name.includes('pistol') ||
      name.includes('single-leg') || name.includes('single leg') ||
      name.includes('one-leg') || name.includes('one leg') || name.includes('curtsey')
    ) return { pattern: 'lunge', secondary: [], confidence: 'high' }

    // Squat name keywords BEFORE falling back to target muscle
    if (
      name.includes('squat') || name.includes('goblet') || name.includes('leg press') ||
      name.includes('zercher') || name.includes('jefferson') || name.includes('sissy')
    ) {
      // ExerciseDB sometimes marks squat variations with target=glutes — MEDIUM because metadata conflicts with name
      const confidence: ClassificationConfidence = (tgt === 'glutes' || tgt === 'hamstrings') ? 'medium' : 'high'
      return { pattern: 'squat', secondary: [], confidence }
    }

    // No name keyword — fall back to target muscle
    if (tgt === 'glutes' || tgt === 'hamstrings') {
      return { pattern: 'hinge', secondary: [], confidence: 'medium', reviewReason: 'target=glutes/hamstrings but movement name is ambiguous' }
    }
    return { pattern: 'squat', secondary: [], confidence: 'medium', reviewReason: 'upper legs default — movement name is ambiguous' }
  }

  // ── LOWER LEGS ───────────────────────────────────────────────────────────
  if (bp === 'lower legs') return { pattern: 'calf', secondary: [], confidence: 'high' }

  // ── CHEST ────────────────────────────────────────────────────────────────
  if (bp === 'chest') {
    if (name.includes('fly') || name.includes('flye') || name.includes('crossover') || name.includes('pec deck')) {
      return { pattern: 'fly', secondary: [], confidence: 'high' }
    }
    if (name.includes('incline') || name.includes('decline')) {
      return { pattern: 'incline_push', secondary: [], confidence: 'high' }
    }
    if (name.includes('dip')) {
      return { pattern: 'incline_push', secondary: ['tricep'], confidence: 'medium', reviewReason: 'dip — compound chest+tricep; tricep is meaningful secondary' }
    }
    return { pattern: 'horizontal_push', secondary: [], confidence: 'high' }
  }

  // ── SHOULDERS ────────────────────────────────────────────────────────────
  if (bp === 'shoulders') {
    if (
      name.includes('lateral') || name.includes('front raise') ||
      name.includes('rear delt') || name.includes('face pull') ||
      name.includes('reverse fly') || name.includes('upright row') ||
      name.includes('shrug') || tgt === 'traps' || tgt === 'upper back'
    ) return { pattern: 'shoulder_isolation', secondary: [], confidence: 'high' }
    return { pattern: 'vertical_push', secondary: [], confidence: 'high' }
  }

  // ── BACK ─────────────────────────────────────────────────────────────────
  if (bp === 'back') {
    if (
      tgt === 'lats' ||
      name.includes('pull-up') || name.includes('pull up') || name.includes('pullup') ||
      name.includes('chin-up') || name.includes('chin up') || name.includes('chinup') ||
      name.includes('pulldown') || name.includes('pull-down') || name.includes('pull down')
    ) return { pattern: 'vertical_pull', secondary: [], confidence: 'high' }
    return { pattern: 'horizontal_pull', secondary: [], confidence: 'high' }
  }

  // ── UPPER ARMS ───────────────────────────────────────────────────────────
  if (bp === 'upper arms') {
    if (
      tgt === 'triceps' || name.includes('tricep') || name.includes('pushdown') ||
      name.includes('skull') || name.includes('kickback') ||
      (name.includes('extension') && !name.includes('hip') && !name.includes('leg'))
    ) return { pattern: 'tricep', secondary: [], confidence: 'high' }
    return { pattern: 'bicep', secondary: [], confidence: 'high' }
  }

  // ── LOWER ARMS ───────────────────────────────────────────────────────────
  if (bp === 'lower arms') return { pattern: 'forearm', secondary: [], confidence: 'high' }

  // ── WAIST ────────────────────────────────────────────────────────────────
  if (bp === 'waist') {
    if (
      name.includes('plank') || name.includes('ab wheel') || name.includes('rollout') ||
      name.includes('hollow') || name.includes('dead bug') ||
      name.includes('bird-dog') || name.includes('bird dog') || name.includes('pallof')
    ) return { pattern: 'core_antiextension', secondary: [], confidence: 'high' }
    if (
      name.includes('twist') || name.includes('rotation') ||
      name.includes('russian') || name.includes('woodchop') || name.includes('wood chop')
    ) return { pattern: 'core_rotation', secondary: [], confidence: 'high' }
    if (name.includes('side bend') || name.includes('lateral flex')) {
      return { pattern: 'core_lateral', secondary: [], confidence: 'high' }
    }
    return { pattern: 'core_flexion', secondary: [], confidence: 'high' }
  }

  return { pattern: 'other', secondary: [], confidence: 'needs_review', reviewReason: `no bodyPart branch matched (bodyPart: ${bp})` }
}

function _deriveMovementFamily(name: string, bp: string, pattern: MovementPattern): MovementFamily {
  // Olympic
  if (name.includes('thruster')) return 'thruster'
  if (name.includes('snatch')) return 'snatch'
  if (name.includes('jerk') && !name.includes('upright')) return 'jerk'
  if (name.includes('clean')) return 'clean'

  // Carry
  if (name.includes('farmer') || name.includes('suitcase carry') || name.includes('carry')) return 'farmer_carry'

  // Squat variants
  if (name.includes('overhead squat')) return 'overhead_squat'
  if (name.includes('front squat') || name.includes('front chest squat') || name.includes('zercher')) return 'front_squat'
  if (name.includes('goblet')) return 'goblet_squat'
  if (name.includes('hack squat') || name.includes('hack ')) return 'hack_squat'
  if (name.includes('leg press')) return 'leg_press'
  if (name.includes('leg extension')) return 'leg_extension'
  if (name.includes('leg curl') || name.includes('hamstring curl') || name.includes('hamstring flex')) return 'leg_curl'
  if (name.includes('pistol')) return 'pistol_squat'
  if (name.includes('split squat') || name.includes('bulgarian')) return 'split_squat'
  if (name.includes('step-up') || name.includes('step up')) return 'step_up'
  if (name.includes('lunge') || name.includes('curtsey')) return 'lunge'
  if (name.includes('squat')) return 'back_squat'

  // Hinge variants
  if (name.includes('romanian') || name.includes(' rdl') || name.includes('stiff-leg') || name.includes('stiff leg')) return 'romanian_deadlift'
  if (name.includes('sumo deadlift')) return 'sumo_deadlift'
  if (name.includes('deadlift')) return 'deadlift'
  if (name.includes('hip thrust')) return 'hip_thrust'
  if (name.includes('glute bridge')) return 'glute_bridge'
  if (name.includes('good morning')) return 'good_morning'
  if (name.includes('back extension') || name.includes('hyperextension')) return 'back_extension'

  // Calf
  if (name.includes('calf raise') || name.includes('calf press') || name.includes('standing calf') || name.includes('seated calf')) return 'calf_raise'

  // Chest
  if (name.includes('chest fly') || name.includes('pec fly') || name.includes('pec deck') ||
      ((name.includes('fly') || name.includes('flye')) && bp === 'chest')) return 'chest_fly'
  if (name.includes('cable crossover') || name.includes('chest crossover')) return 'chest_fly'
  if ((name.includes('push-up') || name.includes('push up') || name.includes('pushup')) && bp === 'chest') return 'push_up'
  if (name.includes('dip') && bp === 'chest') return 'dip'
  if (name.includes('incline') && (name.includes('press') || bp === 'chest')) return 'incline_press'
  if (name.includes('decline') && (name.includes('press') || bp === 'chest')) return 'decline_press'
  if (name.includes('bench press') || (bp === 'chest' && name.includes('press'))) return 'bench_press'

  // Shoulder push
  if (name.includes('push press')) return 'push_press'
  if (name.includes('overhead press') || name.includes('shoulder press') || name.includes('military press') || name.includes('ohp')) return 'overhead_press'
  if (bp === 'shoulders' && name.includes('press')) return 'overhead_press'

  // Shoulder isolation
  if (name.includes('lateral raise') || name.includes('side raise') || name.includes('side lateral')) return 'lateral_raise'
  if (name.includes('front raise')) return 'front_raise'
  if (name.includes('rear delt') || (name.includes('reverse fly') && bp === 'shoulders')) return 'rear_delt'
  if (name.includes('face pull')) return 'face_pull'
  if (name.includes('upright row')) return 'upright_row'
  if (name.includes('shrug')) return 'shrug'

  // Pull
  if (name.includes('pull-up') || name.includes('pull up') || name.includes('pullup') ||
      name.includes('chin-up') || name.includes('chin up') || name.includes('chinup')) return 'pull_up'
  if (name.includes('pulldown') || name.includes('pull-down') || name.includes('pull down')) return 'lat_pulldown'
  if (name.includes('row') && bp === 'back') return 'row'

  // Arms
  if (name.includes('hammer curl')) return 'hammer_curl'
  if (name.includes('preacher curl') || name.includes('spider curl')) return 'preacher_curl'
  if (name.includes('curl') && !name.includes('tricep')) return 'curl'
  if (name.includes('skull')) return 'skull_crusher'
  if (name.includes('pushdown') || name.includes('push-down')) return 'tricep_pushdown'
  if (name.includes('tricep') && name.includes('extension')) return 'tricep_extension'
  if (name.includes('tricep') && name.includes('dip')) return 'dip'

  // Core
  if (name.includes('plank')) return 'plank'
  if (name.includes('ab wheel') || name.includes('rollout')) return 'ab_wheel'
  if (name.includes('crunch')) return 'crunch'
  if (name.includes('sit-up') || name.includes('sit up')) return 'sit_up'
  if (name.includes('leg raise')) return 'leg_raise'
  if (name.includes('russian twist')) return 'russian_twist'
  if (name.includes('side bend')) return 'side_bend'

  if (pattern === 'cardio') return 'cardio'

  return 'unknown'
}

function _deriveExerciseRole(name: string, equipment: string, pattern: MovementPattern): ExerciseRole {
  if (pattern === 'olympic_power') return 'power'
  if (pattern === 'cardio') return 'conditioning'

  if (
    name.includes('stretch') || name.includes('yoga') || name.includes('foam') ||
    name.includes('mobility') || name.includes('flexibility') || name.includes('massage')
  ) return 'mobility'

  const eq = equipment.toLowerCase()

  // Primary compound: heavy barbell lifts + bodyweight pull-ups
  if (
    (pattern === 'squat' && (eq === 'barbell' || eq === 'smith machine')) ||
    (pattern === 'hinge' && (eq === 'barbell' || eq === 'trap bar')) ||
    ((pattern === 'horizontal_push' || pattern === 'vertical_push') && eq === 'barbell') ||
    (pattern === 'vertical_pull' && (eq === 'body weight' || name.includes('pull-up') || name.includes('chin-up'))) ||
    (pattern === 'horizontal_pull' && eq === 'barbell')
  ) return 'primary_compound'

  // Isolation: single-joint or single-muscle patterns
  if (
    pattern === 'bicep' || pattern === 'tricep' || pattern === 'forearm' ||
    pattern === 'fly' || pattern === 'shoulder_isolation' || pattern === 'calf' ||
    pattern === 'core_flexion' || pattern === 'core_rotation' || pattern === 'core_lateral'
  ) return 'isolation'

  // Accessory: anti-extension core, carries
  if (pattern === 'carry' || pattern === 'core_antiextension') return 'accessory'

  // Secondary compound: everything else multi-joint
  if (
    pattern === 'lunge' || pattern === 'incline_push' ||
    pattern === 'vertical_pull' || pattern === 'horizontal_pull' ||
    pattern === 'squat' || pattern === 'hinge' ||
    pattern === 'horizontal_push' || pattern === 'vertical_push'
  ) return 'secondary_compound'

  return 'unknown'
}

function _deriveLaterality(name: string): Laterality {
  if (name.includes('alternating') || name.includes('alternate ')) return 'alternating'
  if (
    name.includes('single') || name.includes('one-arm') || name.includes('one arm') ||
    name.includes('unilateral') || name.includes('single-leg') || name.includes('single leg') ||
    name.includes('one-leg') || name.includes('one leg') || name.includes('pistol') ||
    name.includes('bulgarian') || name.includes('curtsey') ||
    name.includes('lunge') || name.includes('split squat') ||
    name.includes('step-up') || name.includes('step up')
  ) return 'unilateral'
  if (
    name.includes('barbell') || name.includes('machine') ||
    name.includes('double') || name.includes('two-arm') || name.includes('two arm') ||
    name.includes('bilateral')
  ) return 'bilateral'
  return 'unknown'
}

// ─── Public API ───────────────────────────────────────────────────────────────

const _classifyCache = new Map<string, ExerciseClassification>()

export function classifyExercise(exercise: Exercise): ExerciseClassification {
  const cached = _classifyCache.get(exercise.id)
  if (cached) return cached
  const name = exercise.name.toLowerCase()
  const bp   = exercise.bodyPart.toLowerCase()
  const tgt  = exercise.target.toLowerCase()
  const { pattern, secondary, confidence, reviewReason } = _derivePrimaryPattern(name, bp, tgt)
  const result: ExerciseClassification = {
    primaryMovementPattern:    pattern,
    secondaryMovementPatterns: secondary,
    movementFamily:            _deriveMovementFamily(name, bp, pattern),
    exerciseRole:              _deriveExerciseRole(name, exercise.equipment, pattern),
    laterality:                _deriveLaterality(name),
    classificationConfidence:  confidence,
    reviewReason,
  }
  _classifyCache.set(exercise.id, result)
  return result
}

// Thin wrapper kept for backwards-compatible call sites.
export function deriveMovementPattern(exercise: Exercise): MovementPattern {
  return classifyExercise(exercise).primaryMovementPattern
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
  return _byId.get(id)
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
