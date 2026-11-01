/**
 * Pure scoring functions for the hierarchical YMove matching pipeline.
 *
 * ZERO side effects: no network calls, no Prisma, no server-only imports.
 * Safe for use in scripts, API routes, and unit tests.
 *
 * Hierarchy:
 *   L1  Movement Family   (fam_squat, fam_arms, …)
 *   L2  Equipment-Specific Exercise  (inv_biceps_curl × barbell, × dumbbell, …)
 *   L3  Meaningful Variation         (flat/incline/close-grip/unilateral, …)
 */

// ── Equipment families ────────────────────────────────────────────────────────
// trap_bar is a DISTINCT family from barbell — different biomechanics, separate
// PR identity, separate YMove media target.

export type EqFamily =
  | 'barbell' | 'trap_bar' | 'dumbbell' | 'smith'
  | 'cable' | 'kettlebell' | 'machine' | 'band'
  | 'bodyweight' | 'weighted'

// ── Movement classes ──────────────────────────────────────────────────────────

export type MovementClass =
  | 'lower_push'          // squat, lunge, leg press, calf raise
  | 'lower_pull'          // deadlift, hinge, leg curl, RDL
  | 'upper_push_h'        // bench press, push-up, dip
  | 'upper_push_v'        // overhead press
  | 'upper_pull_h'        // row, rear delt
  | 'upper_pull_v'        // pull-up, lat pulldown
  | 'arm_flexion'         // biceps curl
  | 'arm_extension'       // triceps extension, pushdown
  | 'shoulder_isolation'  // lateral/front raise, face pull, shrug
  | 'core'                // plank, crunch, rotation, pallof
  | 'hip_abduction'       // abductor, glute kick
  | 'cardio_conditioning'
  | 'mobility_stretch'
  | 'unknown'

// ── Movement subclasses ───────────────────────────────────────────────────────
// Used for within-domain hard incompatibility (e.g. squat ≠ glute bridge,
// even though both score as lower_push). null = general/unclassified.

export type MovementSubclass =
  | 'squat'         // knee-dominant vertical: back squat, front squat, goblet
  | 'lunge'         // split-stance: lunge, split squat, step-up, Bulgarian
  | 'calf_raise'    // ankle plantarflexion
  | 'hip_thrust'    // horizontal hip-dominant: hip thrust, glute bridge variants
  | 'deadlift'      // conventional / sumo deadlift (hip hinge from floor)
  | 'rdl'           // Romanian / stiff-leg / straight-leg — partial ROM hinge
  | 'good_morning'  // good morning — hip hinge, torso horizontal
  | 'leg_curl'      // knee flexion: hamstring curl, nordic curl
  | null

// ── Score thresholds ──────────────────────────────────────────────────────────

export const SCORE_HIGH_PRIORITY = 85  // strong multi-signal match; still requires explicit confirm
export const SCORE_REVIEW        = 65  // compatible but needs side-by-side comparison
export const SCORE_WEAK_MIN      = 55  // below this = no reliable match → unmatched

// ── Core types ────────────────────────────────────────────────────────────────

export interface CatalogEntry {
  ymoveId:            string
  name:               string
  equipment:          string | null
  category:           string | null
  primaryMuscleGroup: string | null
  thumbnailMediaId:   string | null
  curationStatus:     string
}

export interface ExerciseMeta {
  exerciseDbId:     string
  name:             string
  equipment:        string
  equipmentFamily:  EqFamily | null
  target:           string
  bodyPart:         string
  technicalPattern: string | null
  movementClass:    MovementClass
  movementSubclass: MovementSubclass
}

export interface ScoredMatch {
  ymoveId:           string
  name:              string
  score:             number
  tier:              'high_priority' | 'review' | 'weak' | 'unmatched'
  signals:           Record<string, number>
  hardBlock:         string | null
  equipmentFamily:   EqFamily | null
  matchReasons:      string[]
  penaltyReasons:    string[]
  thumbnailMediaId:  string | null
}

export interface ConflictInfo {
  conflictingYmoveId: string
  conflictingDbId:    string
  verifiedAt:         string | null
}

export interface MisclassificationResult {
  reason:                    string
  expectedPattern:           string
  actualTarget:              string
  actualBodyPart:            string
  canonicalCorrectionSuggested: string | null
}

// ── Equipment normalisation ───────────────────────────────────────────────────

const EXDB_EQ_MAP: Record<string, EqFamily> = {
  'barbell':          'barbell',
  'ez barbell':       'barbell',
  'olympic barbell':  'barbell',
  'trap bar':         'trap_bar',  // explicitly separated from barbell
  'dumbbell':         'dumbbell',
  'smith machine':    'smith',
  'cable':            'cable',
  'kettlebell':       'kettlebell',
  'leverage machine': 'machine',
  'band':             'band',
  'resistance band':  'band',
  'body weight':      'bodyweight',
  'weighted':         'weighted',
  'assisted':         'machine',
}

const YMOVE_EQ_MAP: Record<string, EqFamily> = {
  'barbell':       'barbell',
  'trap bar':      'trap_bar',
  'dumbbell':      'dumbbell',
  'smith machine': 'smith',
  'cable':         'cable',
  'kettlebell':    'kettlebell',
  'machine':       'machine',
  'band':          'band',
  'mini band':     'band',
  'bodyweight':    'bodyweight',
  'body weight':   'bodyweight',
  'weighted vest': 'weighted',
}

export function normalizeExdbEquipment(eq: string): EqFamily | null {
  return EXDB_EQ_MAP[eq.toLowerCase()] ?? null
}

export function normalizeYmoveEquipment(eq: string | null): EqFamily | null {
  if (!eq) return null
  return YMOVE_EQ_MAP[eq.toLowerCase()] ?? null
}

export function inferEquipmentFromName(name: string): EqFamily | null {
  const n = name.toLowerCase()
  if (n.includes('trap bar') || n.includes('trap-bar')) return 'trap_bar'
  if (n.includes('barbell') || n.includes('ez bar'))    return 'barbell'
  if (n.includes('dumbbell'))                           return 'dumbbell'
  if (n.includes('smith machine') || /\bsmith\b/.test(n)) return 'smith'
  if (n.includes('cable'))                              return 'cable'
  if (n.includes('kettlebell') || /\bkb\b/.test(n))    return 'kettlebell'
  if (n.includes('machine') || n.includes('lever'))    return 'machine'
  if (/\bband\b/.test(n))                               return 'band'
  return null
}

/**
 * Equipment compatibility between an ExDB exercise and a YMove catalog entry.
 * Returns 'exact' | 'soft' | 'incompatible'.
 *
 * trap_bar is NOT soft-compatible with anything — it has distinct biomechanics,
 * loading, and PR identity from barbell.
 */
export function equipmentCompatible(
  exdb: EqFamily,
  ymove: EqFamily,
): 'exact' | 'soft' | 'incompatible' {
  if (exdb === ymove) return 'exact'
  // trap_bar is incompatible with everything including barbell
  if (exdb === 'trap_bar' || ymove === 'trap_bar') return 'incompatible'
  const SOFT: [EqFamily, EqFamily][] = [
    ['barbell', 'smith'],   // smith bar ≈ barbell variant — NOT batch-confirmable
    ['cable',   'band'],    // band ≈ cable substitute
    ['machine', 'cable'],   // cable machine ≈ selectorized
  ]
  if (SOFT.some(([a, b]) => (exdb === a && ymove === b) || (exdb === b && ymove === a))) {
    return 'soft'
  }
  return 'incompatible'
}

// ── Movement class ────────────────────────────────────────────────────────────

const PATTERN_TO_CLASS: Record<string, MovementClass> = {
  squat:                  'lower_push',
  lunge:                  'lower_push',
  knee_extension:         'lower_push',
  ankle_plantarflexion:   'lower_push',
  hinge:                  'lower_pull',
  knee_flexion:           'lower_pull',
  horizontal_press:       'upper_push_h',
  vertical_press:         'upper_push_v',
  horizontal_pull:        'upper_pull_h',
  vertical_pull:          'upper_pull_v',
  elbow_flexion:          'arm_flexion',
  arm_isolation:          'arm_flexion',
  elbow_extension:        'arm_extension',
  shoulder_abduction:     'shoulder_isolation',
  shoulder_flexion:       'shoulder_isolation',
  scapular_elevation:     'shoulder_isolation',
  core_anti_extension:    'core',
  core_flexion:           'core',
  core_rotation:          'core',
  hip_abduction:          'hip_abduction',
  stretch:                'mobility_stretch',
  yoga:                   'mobility_stretch',
  leg_general:            'lower_push',
  leg_accessory:          'lower_pull',
}

const YMOVE_CATEGORY_TO_CLASS: Record<string, MovementClass> = {
  'Arms - Biceps':  'arm_flexion',
  'Arms':           'arm_flexion',
  'Arms - Triceps': 'arm_extension',
  'Chest':          'upper_push_h',
  'Push':           'upper_push_h',
  'Back':           'upper_pull_h',
  'Pull':           'upper_pull_v',
  'Shoulders':      'shoulder_isolation',
  'Legs':           'lower_push',
  'Core':           'core',
  'CORE':           'core',
  'cardio':         'cardio_conditioning',
  'hiit-cardio':    'cardio_conditioning',
  'mobility':       'mobility_stretch',
  'YOGA':           'mobility_stretch',
  'calisthenics':   'upper_pull_v',
}

export function movementClassFromPattern(pattern: string | null | undefined): MovementClass {
  if (!pattern) return 'unknown'
  return PATTERN_TO_CLASS[pattern] ?? 'unknown'
}

export function movementClassFromYmove(category: string | null, name: string): MovementClass {
  const n = name.toLowerCase()

  // High-confidence name overrides run FIRST — these patterns are unambiguous
  // regardless of how YMove categorizes them (e.g. 'Legs' covers both push + pull).
  if (n.includes('deadlift') || /\brdl\b/.test(n) || n.includes('romanian') || n.includes('good morning')) return 'lower_pull'
  if (n.includes('leg curl') || n.includes('hamstring curl') || n.includes('nordic curl'))                  return 'lower_pull'

  if (category) {
    const cls = YMOVE_CATEGORY_TO_CLASS[category]
    if (cls) return cls
  }

  // Remaining name-based detection (used when category is absent or unrecognised)
  if (n.includes('squat'))                                                                   return 'lower_push'
  if (n.includes('glute bridge') || n.includes('hip thrust') || n.includes('hip bridge'))  return 'lower_push'
  if (n.includes('bench press') || n.includes('chest press') || /\bpush.?up\b/.test(n))   return 'upper_push_h'
  if (n.includes('overhead press') || n.includes('military press') || n.includes('shoulder press')) return 'upper_push_v'
  if (/\brow\b/.test(n) || n.includes('bent over'))                                        return 'upper_pull_h'
  if (/pull.?up|chin.?up|lat pulldown/.test(n))                                            return 'upper_pull_v'
  if (n.includes(' curl') && !n.includes('leg curl') && !/(hamstring|nordic)/.test(n))    return 'arm_flexion'
  if (n.includes('tricep') || n.includes('pushdown') || (n.includes('extension') && /tricep|arm|elbow/.test(n))) return 'arm_extension'
  if (n.includes('lateral raise') || n.includes('front raise') || n.includes('face pull') || n.includes('shrug')) return 'shoulder_isolation'
  if (n.includes('plank') || n.includes('crunch') || n.includes('sit-up'))                return 'core'
  return 'unknown'
}

export function movementClassesCompatible(a: MovementClass, b: MovementClass): boolean {
  if (a === 'unknown' || b === 'unknown') return true
  if (a === b) return true
  const ALLOWED_CROSS: [MovementClass, MovementClass][] = [
    ['upper_push_h', 'upper_push_v'],  // incline press bridges horizontal and vertical
    ['upper_pull_h', 'upper_pull_v'],  // pulldown vs row can overlap
  ]
  return ALLOWED_CROSS.some(([x, y]) => (a === x && b === y) || (a === y && b === x))
}

// ── Movement subclass ─────────────────────────────────────────────────────────

/** Detect movement subclass from canonical technicalPattern + exercise name. */
export function detectMovementSubclass(
  technicalPattern: string | null,
  name: string,
): MovementSubclass {
  const n = name.toLowerCase().replace(/-/g, ' ')

  // Hip-dominant horizontal patterns — must check BEFORE generic 'bridge' patterns
  if (/hip thrust/.test(n))                                        return 'hip_thrust'
  if (/glute bridge|hip bridge|butt bridge/.test(n))              return 'hip_thrust'
  if (/\bbridge\b/.test(n) && !/(bench|row|gap|cable)/.test(n))  return 'hip_thrust'

  // Good morning
  if (/good morning/.test(n))                                      return 'good_morning'

  // RDL / stiff-leg / Romanian — partial-ROM hinge
  if (/\brdl\b|romanian|stiff leg|straight leg/.test(n))          return 'rdl'

  // Deadlift (conventional or named variants that aren't RDL/good morning)
  if (/deadlift/.test(n))                                          return 'deadlift'

  // Leg curl (knee flexion)
  if (/leg curl|hamstring curl|nordic curl|inverse leg curl/.test(n)) return 'leg_curl'

  // Lunge / split squat — checked BEFORE generic squat so "bulgarian split squat" → lunge
  if (technicalPattern === 'lunge' || /\blunge\b|split squat|step up|step-up|bulgarian/.test(n)) return 'lunge'

  // Squat (generic — after lunge patterns have been ruled out above)
  if (technicalPattern === 'squat' || (/\bsquat\b/.test(n) && !/deadlift/.test(n)))  return 'squat'

  // Calf raise
  if (technicalPattern === 'ankle_plantarflexion' || /calf raise|calf press|calf stretch/.test(n)) return 'calf_raise'

  // Pattern-based fallback
  if (technicalPattern === 'hinge')        return 'deadlift'
  if (technicalPattern === 'knee_flexion') return 'leg_curl'

  return null
}

/** Hard incompatibility between movement subclasses. */
export function movementSubclassCompatible(
  exdb: MovementSubclass,
  ymove: MovementSubclass,
): boolean {
  if (!exdb || !ymove) return true
  if (exdb === ymove)   return true

  // Pairs that are hard incompatible regardless of score
  const HARD_INCOMPATIBLE: Array<[MovementSubclass, MovementSubclass]> = [
    // Squat/lunge vs any hip-dominant or hinge pattern
    ['squat',       'hip_thrust'],
    ['squat',       'deadlift'],
    ['squat',       'rdl'],
    ['squat',       'good_morning'],
    ['squat',       'leg_curl'],
    ['lunge',       'hip_thrust'],
    ['lunge',       'deadlift'],
    ['lunge',       'rdl'],
    ['lunge',       'good_morning'],
    ['lunge',       'leg_curl'],
    // Hip thrust vs knee-dominant or hinge
    ['hip_thrust',  'squat'],
    ['hip_thrust',  'lunge'],
    ['hip_thrust',  'deadlift'],
    ['hip_thrust',  'rdl'],
    ['hip_thrust',  'good_morning'],
    ['hip_thrust',  'leg_curl'],
    // Deadlift vs squat/hip thrust/leg curl
    ['deadlift',    'squat'],
    ['deadlift',    'lunge'],
    ['deadlift',    'hip_thrust'],
    ['deadlift',    'leg_curl'],
    // RDL vs squat/hip thrust/leg curl
    ['rdl',         'squat'],
    ['rdl',         'lunge'],
    ['rdl',         'hip_thrust'],
    ['rdl',         'leg_curl'],
    // Good morning vs squat/hip thrust/leg curl
    ['good_morning','squat'],
    ['good_morning','lunge'],
    ['good_morning','hip_thrust'],
    ['good_morning','leg_curl'],
    // Leg curl vs any squatting or hinging
    ['leg_curl',    'squat'],
    ['leg_curl',    'lunge'],
    ['leg_curl',    'deadlift'],
    ['leg_curl',    'rdl'],
    ['leg_curl',    'good_morning'],
    ['leg_curl',    'hip_thrust'],
  ]

  return !HARD_INCOMPATIBLE.some(
    ([a, b]) => (exdb === a && ymove === b) || (exdb === b && ymove === a),
  )
}

// ── Misclassification detection ───────────────────────────────────────────────

const MISCLASS_RULES: Array<{
  patterns:           string[]
  forbiddenTargets?:  string[]
  forbiddenBodyParts?: string[]
  reason:             string
}> = [
  {
    patterns:            ['elbow_flexion', 'arm_isolation'],
    forbiddenTargets:    ['hamstrings', 'glutes', 'quads', 'adductors', 'abductors', 'calves'],
    forbiddenBodyParts:  ['upper legs', 'lower legs'],
    reason:              'Leg exercise (target/bodyPart) inside arm-flexion canonical group',
  },
  {
    patterns:            ['elbow_extension'],
    forbiddenTargets:    ['hamstrings', 'glutes', 'quads', 'adductors', 'abductors', 'calves'],
    forbiddenBodyParts:  ['upper legs', 'lower legs'],
    reason:              'Leg exercise inside arm-extension canonical group',
  },
  {
    patterns:            ['squat', 'lunge', 'knee_extension'],
    forbiddenTargets:    ['biceps', 'triceps', 'pectorals'],
    forbiddenBodyParts:  ['upper arms', 'lower arms', 'chest'],
    reason:              'Arm/chest exercise inside squat/lunge canonical group',
  },
  {
    patterns:            ['knee_flexion'],
    forbiddenTargets:    ['biceps', 'triceps', 'pectorals', 'lats'],
    forbiddenBodyParts:  ['upper arms', 'lower arms', 'chest', 'back'],
    reason:              'Upper-body exercise inside knee-flexion (leg curl) canonical group',
  },
  {
    patterns:            ['horizontal_press', 'vertical_press'],
    forbiddenTargets:    ['hamstrings', 'glutes', 'quads'],
    forbiddenBodyParts:  ['upper legs', 'lower legs'],
    reason:              'Leg exercise inside pressing canonical group',
  },
]

/**
 * Suggest which canonical family the exercise actually belongs in,
 * given it was misclassified.
 */
function suggestCanonicalCorrection(
  target: string,
  bodyPart: string,
  pattern: string,
): string | null {
  const t = target.toLowerCase()
  const b = bodyPart.toLowerCase()
  if ((t.includes('hamstring') || t === 'hamstrings') && ['elbow_flexion', 'arm_isolation'].includes(pattern)) {
    return 'fam_legs → knee-flexion canonical (hamstring curl, e.g. inv_leg_curl)'
  }
  if ((b.includes('upper legs') || b.includes('lower legs')) && ['elbow_flexion', 'arm_isolation', 'elbow_extension'].includes(pattern)) {
    return 'fam_legs → appropriate lower-body canonical based on target muscle'
  }
  if ((t.includes('biceps') || t.includes('triceps')) && ['squat', 'lunge', 'knee_extension'].includes(pattern)) {
    return 'fam_arms → arm-flexion or arm-extension canonical'
  }
  if (t.includes('quads') && ['horizontal_press', 'vertical_press'].includes(pattern)) {
    return 'fam_core or fam_full_body → compound/functional movement canonical'
  }
  if (['biceps', 'triceps', 'pectorals', 'lats'].some(m => t.includes(m)) && pattern === 'knee_flexion') {
    return 'fam_arms or fam_chest/back → upper-body isolation canonical'
  }
  return null
}

/** Detect if an exercise is misclassified in its canonical group. */
export function detectMisclassification(
  pattern: string | null,
  target: string,
  bodyPart: string,
): MisclassificationResult | null {
  if (!pattern) return null
  for (const rule of MISCLASS_RULES) {
    if (!rule.patterns.includes(pattern)) continue
    const targetHit  = rule.forbiddenTargets?.some(t => target.toLowerCase().includes(t)) ?? false
    const bodyHit    = rule.forbiddenBodyParts?.some(b => bodyPart.toLowerCase().includes(b)) ?? false
    if (targetHit || bodyHit) {
      return {
        reason:                       rule.reason,
        expectedPattern:              pattern,
        actualTarget:                 target,
        actualBodyPart:               bodyPart,
        canonicalCorrectionSuggested: suggestCanonicalCorrection(target, bodyPart, pattern),
      }
    }
  }
  return null
}

// ── Token and variation helpers ───────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'with', 'for',
  'on', 'at', 'by', 'as', 'is', 'are', 'was', 'v', 'vs',
  'using', 'over', 'under', 'from', 'into', 'onto',
])

export function tokenize(name: string): Set<string> {
  return new Set(
    name.toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w)),
  )
}

const ANGLE_TAGS:    [string, string][] = [['incline','incline'],['decline','decline'],['overhead','overhead'],['floor','floor'],['flat','flat']]
// 'reverse grip' checked first: compound names like "reverse close-grip" should
// capture the most-distinctive qualifier (reverse) rather than the secondary one (close).
const GRIP_TAGS:     [string, string][] = [['reverse grip','reverse'],['reverse-grip','reverse'],['close grip','close'],['close-grip','close'],['wide grip','wide'],['wide-grip','wide'],['neutral grip','neutral'],['neutral-grip','neutral'],['hammer','hammer'],['underhand','underhand'],['overhand','overhand']]
const LATERAL_TAGS:  [string, string][] = [['single arm','unilateral'],['one arm','unilateral'],['single leg','unilateral'],['one leg','unilateral'],['unilateral','unilateral'],['alternating','alternating']]
const POSITION_TAGS: [string, string][] = [['seated','seated'],['standing','standing'],['lying','lying'],['prone','prone'],['kneeling','kneeling'],['bent over','bent_over'],['bent-over','bent_over'],['preacher','preacher']]
const MODIFIER_TAGS: [string, string][] = [['sumo','sumo'],['romanian','romanian'],['rdl','romanian'],['stiff leg','stiff_leg'],['straight leg','stiff_leg'],['paused','paused'],['deficit','deficit'],['rack pull','rack_pull'],['split','split'],['bulgarian','bulgarian'],['landmine','landmine'],['zottman','zottman'],['spider','spider'],['concentration','concentration'],['guillotine','guillotine'],['jm press','jm_press'],['jm-press','jm_press']]

interface VariationDims {
  angle?:    string
  grip?:     string
  lateral?:  string
  position?: string
  modifier?: string
}

function extractVariationDims(name: string): VariationDims {
  const n = name.toLowerCase().replace(/-/g, ' ')
  const dims: VariationDims = {}
  for (const [kw, tag] of ANGLE_TAGS)    { if (n.includes(kw)) { dims.angle    = tag; break } }
  for (const [kw, tag] of GRIP_TAGS)     { if (n.includes(kw)) { dims.grip     = tag; break } }
  for (const [kw, tag] of LATERAL_TAGS)  { if (n.includes(kw)) { dims.lateral  = tag; break } }
  for (const [kw, tag] of POSITION_TAGS) { if (n.includes(kw)) { dims.position = tag; break } }
  for (const [kw, tag] of MODIFIER_TAGS) { if (n.includes(kw)) { dims.modifier = tag; break } }
  return dims
}

// ── Muscle group scoring ──────────────────────────────────────────────────────

const MUSCLE_CLASS: Record<string, string> = {
  pectorals: 'chest', chest: 'chest', pecs: 'chest',
  biceps: 'biceps', brachialis: 'biceps', brachioradialis: 'forearms',
  triceps: 'triceps',
  lats: 'lats', 'latissimus dorsi': 'lats',
  traps: 'traps', trapezius: 'traps',
  deltoids: 'shoulders', delts: 'shoulders', shoulders: 'shoulders',
  rhomboids: 'upper_back', rhomboid: 'upper_back',
  'erector spinae': 'lower_back', 'lower back': 'lower_back', spine: 'lower_back',
  quads: 'quads', quadriceps: 'quads',
  hamstrings: 'hamstrings', hamstring: 'hamstrings',
  glutes: 'glutes', glute: 'glutes', gluteus: 'glutes',
  calves: 'calves', calf: 'calves', gastrocnemius: 'calves', soleus: 'calves',
  adductors: 'adductors', adductor: 'adductors',
  abductors: 'abductors', abductor: 'abductors',
  abs: 'abs', abdominals: 'abs', core: 'abs',
  obliques: 'obliques',
  forearms: 'forearms',
  'cardiovascular system': 'cardio',
  'serratus anterior': 'chest',
}

const MUSCLE_REGION: Record<string, string> = {
  chest: 'push', pecs: 'push',
  triceps: 'push',
  shoulders: 'push',
  biceps: 'arms', forearms: 'arms',
  lats: 'back', traps: 'back', upper_back: 'back', lower_back: 'back',
  quads: 'legs', hamstrings: 'legs', glutes: 'legs',
  calves: 'legs', adductors: 'legs', abductors: 'legs',
  abs: 'core', obliques: 'core',
}

function normalizeMuscle(m: string): string {
  return MUSCLE_CLASS[m.toLowerCase()] ?? m.toLowerCase().split(' ')[0]
}

function muscleScore(exdbTarget: string, ymoveMuscle: string | null): number {
  if (!ymoveMuscle) return 0
  const a = normalizeMuscle(exdbTarget)
  const b = normalizeMuscle(ymoveMuscle)
  if (a === b) return 25
  if (MUSCLE_REGION[a] && MUSCLE_REGION[a] === MUSCLE_REGION[b]) return 12
  return 0
}

// ── Tier classification ───────────────────────────────────────────────────────

export function classifyTier(score: number): ScoredMatch['tier'] {
  if (score >= SCORE_HIGH_PRIORITY) return 'high_priority'
  if (score >= SCORE_REVIEW)        return 'review'
  if (score >= SCORE_WEAK_MIN)      return 'weak'
  return 'unmatched'
}

// ── Five-signal scorer ────────────────────────────────────────────────────────
//
// Signal 1 Equipment family:   hard filter + up to +30 pts
// Signal 2 Primary muscle:     up to +25 pts
// Signal 3 Movement class:     hard filter for incompatibles + up to +20 pts
//            +subclass check:  hard block for squat-vs-bridge, hinge-vs-squat, etc.
// Signal 4 Name token overlap: up to +15 pts
// Signal 5 Variation modifiers: ±10 pts

export function scoreCandidate(
  catalog:  CatalogEntry,
  meta:     ExerciseMeta,
): ScoredMatch {
  const signals:        Record<string, number> = {}
  const matchReasons:   string[] = []
  const penaltyReasons: string[] = []

  const ymoveEqRaw = normalizeYmoveEquipment(catalog.equipment) ?? inferEquipmentFromName(catalog.name)
  const ymoveClass = movementClassFromYmove(catalog.category, catalog.name)
  const ymoveSubclass = detectMovementSubclass(null, catalog.name)

  // ── Signal 1: Equipment (hard filter + weight) ────────────────────────────
  if (meta.equipmentFamily && ymoveEqRaw) {
    const compat = equipmentCompatible(meta.equipmentFamily, ymoveEqRaw)
    if (compat === 'exact') {
      signals.equipment = 30
      matchReasons.push(`equipment match (${meta.equipmentFamily})`)
    } else if (compat === 'soft') {
      signals.equipment = 0
      penaltyReasons.push(`soft equipment mismatch (${meta.equipmentFamily} vs ${ymoveEqRaw}) — capped at review tier`)
    } else {
      return hardBlock(catalog, ymoveEqRaw, signals,
        `equipment incompatible: exercise needs ${meta.equipmentFamily}, catalog entry is ${ymoveEqRaw}`,
        matchReasons, penaltyReasons)
    }
  } else if (meta.equipmentFamily && !ymoveEqRaw) {
    signals.equipment = 8   // equipment unknown in catalog → small partial credit
  } else {
    signals.equipment = 0
  }

  // ── Signal 3a: Movement class (hard filter for cross-domain incompatibility) ─
  if (meta.movementClass !== 'unknown' && ymoveClass !== 'unknown') {
    if (!movementClassesCompatible(meta.movementClass, ymoveClass)) {
      return hardBlock(catalog, ymoveEqRaw, signals,
        `movement class incompatible: ${meta.movementClass} vs ${ymoveClass}`,
        matchReasons, penaltyReasons)
    }
    if (meta.movementClass === ymoveClass) {
      signals.movement = 20
      matchReasons.push(`movement class match (${meta.movementClass})`)
    } else {
      signals.movement = 10
      matchReasons.push('movement class compatible')
    }
  } else {
    signals.movement = 0
  }

  // ── Signal 3b: Movement SUBCLASS (hard block: squat ≠ bridge, hinge, etc.) ─
  if (meta.movementSubclass && ymoveSubclass) {
    if (!movementSubclassCompatible(meta.movementSubclass, ymoveSubclass)) {
      return hardBlock(catalog, ymoveEqRaw, signals,
        `movement subclass incompatible: ${meta.movementSubclass} vs ${ymoveSubclass} — not a compatible demonstration`,
        matchReasons, penaltyReasons)
    }
  }

  // ── Signal 2: Primary muscle group ───────────────────────────────────────
  const mScore = muscleScore(meta.target, catalog.primaryMuscleGroup)
  signals.muscle = mScore
  if (mScore >= 25) matchReasons.push(`muscle match (${normalizeMuscle(meta.target)})`)
  else if (mScore > 0) matchReasons.push('muscle region match')

  // ── Signal 4: Name token overlap ─────────────────────────────────────────
  const ourTok  = tokenize(meta.name)
  const candTok = tokenize(catalog.name)
  const union   = new Set([...ourTok, ...candTok])
  const isect   = [...ourTok].filter(t => candTok.has(t))
  const jaccard  = union.size > 0 ? isect.length / union.size : 0
  signals.name   = Math.round(jaccard * 15)
  if (signals.name >= 10) matchReasons.push('strong name overlap')
  else if (signals.name >= 5) matchReasons.push('partial name overlap')

  // ── Signal 5: Variation modifier ±10 ─────────────────────────────────────
  const ourDims  = extractVariationDims(meta.name)
  const candDims = extractVariationDims(catalog.name)
  let varScore = 0

  if (ourDims.angle && candDims.angle) {
    if (ourDims.angle === candDims.angle) { varScore += 5 }
    else { varScore -= 5; penaltyReasons.push(`angle conflict: exercise=${ourDims.angle} vs catalog=${candDims.angle}`) }
  } else if (!ourDims.angle && candDims.angle) {
    varScore -= 3
    penaltyReasons.push(`catalog has angle (${candDims.angle}) not in exercise`)
  }

  if (ourDims.grip && candDims.grip) {
    if (ourDims.grip === candDims.grip) { varScore += 5 }
    else { varScore -= 5; penaltyReasons.push(`grip conflict: exercise=${ourDims.grip} vs catalog=${candDims.grip}`) }
  } else if (!ourDims.grip && candDims.grip) {
    varScore -= 2
  } else if (ourDims.grip && !candDims.grip) {
    // Exercise specifies a grip (often 'reverse') that the catalog entry doesn't mention.
    // The catalog entry most likely uses the standard grip, so this is a meaningful mismatch.
    varScore -= 7
    penaltyReasons.push(`exercise has grip modifier (${ourDims.grip}) absent in catalog`)
  }

  if (!ourDims.lateral && candDims.lateral === 'unilateral') {
    varScore -= 5; penaltyReasons.push('unilateral variant for bilateral exercise')
  } else if (ourDims.lateral === 'unilateral' && !candDims.lateral) {
    varScore -= 5; penaltyReasons.push('unilateral exercise matched to bilateral catalog entry')
  }

  if (ourDims.modifier && candDims.modifier) {
    if (ourDims.modifier === candDims.modifier) { varScore += 5 }
    else { varScore -= 5; penaltyReasons.push(`modifier conflict: ${ourDims.modifier} vs ${candDims.modifier}`) }
  } else if (ourDims.modifier && !candDims.modifier) {
    varScore -= 3
    penaltyReasons.push(`exercise has technique modifier (${ourDims.modifier}) absent in catalog`)
  } else if (!ourDims.modifier && candDims.modifier) {
    varScore -= 3
    penaltyReasons.push(`catalog has technique modifier (${candDims.modifier}) not in exercise`)
  }

  signals.variation = Math.max(-10, Math.min(10, varScore))

  const rawScore = (signals.equipment ?? 0) + (signals.movement ?? 0) +
                   (signals.muscle ?? 0) + (signals.name ?? 0) + signals.variation
  const score = Math.max(0, Math.min(100, rawScore))

  return {
    ymoveId:          catalog.ymoveId,
    name:             catalog.name,
    score,
    tier:             classifyTier(score),
    signals,
    hardBlock:        null,
    equipmentFamily:  ymoveEqRaw,
    matchReasons,
    penaltyReasons,
    thumbnailMediaId: catalog.thumbnailMediaId,
  }
}

function hardBlock(
  catalog:       CatalogEntry,
  ymoveEq:       EqFamily | null,
  signals:       Record<string, number>,
  reason:        string,
  matchReasons:  string[],
  penaltyReasons: string[],
): ScoredMatch {
  return {
    ymoveId:          catalog.ymoveId,
    name:             catalog.name,
    score:            0,
    tier:             'unmatched',
    signals,
    hardBlock:        reason,
    equipmentFamily:  ymoveEq,
    matchReasons,
    penaltyReasons:   [...penaltyReasons, reason],
    thumbnailMediaId: catalog.thumbnailMediaId,
  }
}

/** Soft-related equipment families for candidate pre-filtering. */
export const SOFT_RELATED: Partial<Record<EqFamily, EqFamily[]>> = {
  barbell: ['smith'],
  smith:   ['barbell'],
  cable:   ['band'],
  band:    ['cable'],
  machine: ['cable'],
}
