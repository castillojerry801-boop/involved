/**
 * DEV-ONLY: Deterministic ymove candidate scoring and search query building.
 *
 * Nothing in this file touches production media rendering.
 * All output is for human review; no auto-mapping occurs here.
 */

export interface ExerciseMetadata {
  exerciseDbId: string
  displayName: string
  equipment: string   // from ExerciseDB: 'barbell' | 'dumbbell' | 'cable' | ...
  bodyPart: string    // from ExerciseDB: 'chest' | 'back' | 'upper legs' | ...
  target: string      // from ExerciseDB primary muscle: 'pectorals' | 'lats' | ...
  technicalPattern?: string   // from canonical: 'squat' | 'hinge' | ...
  primaryMuscles?: string[]   // from canonical muscleCard.primary
}

export interface YmoveCandidateRaw {
  ymoveId: string
  name: string
  // ymove may return these; if absent we infer from name
  equipment?: string
  muscles?: string[]
  category?: string
}

export interface ScoredCandidate extends YmoveCandidateRaw {
  score: number          // 0–100
  confidence: 'strong' | 'likely' | 'possible' | 'weak'
  matchReasons: string[] // positive signals
  penaltyReasons: string[] // negative signals
}

// ── Equipment ─────────────────────────────────────────────────────────────────

type EqFamily = 'barbell' | 'dumbbell' | 'cable' | 'kettlebell' | 'machine' | 'band' | 'smith' | 'body_weight' | 'plate'

const EQ_KEYWORDS: [EqFamily, string[]][] = [
  ['barbell',    ['barbell']],
  ['dumbbell',   ['dumbbell']],
  ['cable',      ['cable']],
  ['kettlebell', ['kettlebell']],
  ['smith',      ['smith']],
  ['machine',    ['machine', 'lever', 'leverage', 'selectorized']],
  ['band',       ['band', 'banded', 'resistance band']],
  ['plate',      ['plate', 'weight plate']],
  ['body_weight',['bodyweight', 'body weight', 'body-weight']],
]

function normalizeEquipment(eq: string): EqFamily | null {
  const lower = eq.toLowerCase()
  if (lower === 'barbell')                                      return 'barbell'
  if (lower === 'dumbbell')                                     return 'dumbbell'
  if (lower === 'cable')                                        return 'cable'
  if (lower === 'kettlebell')                                   return 'kettlebell'
  if (lower === 'smith machine')                                return 'smith'
  if (lower.includes('machine') || lower.includes('leverage')) return 'machine'
  if (lower === 'band')                                         return 'band'
  if (lower === 'body weight')                                  return 'body_weight'
  return null
}

function inferEquipmentFromName(name: string): EqFamily | null {
  const lower = name.toLowerCase()
  for (const [family, keywords] of EQ_KEYWORDS) {
    if (keywords.some(k => lower.includes(k))) return family
  }
  return null
}

/** Is it a soft match (different but related equipment families)? */
function equipmentSoftRelated(a: EqFamily, b: EqFamily): boolean {
  const softGroups: EqFamily[][] = [
    ['barbell', 'smith'],            // smith ≈ barbell variant
    ['cable', 'band'],               // band ≈ cable substitute
    ['machine', 'cable'],            // machine row ≈ cable row
  ]
  return softGroups.some(g => g.includes(a) && g.includes(b))
}

// ── Movement patterns ──────────────────────────────────────────────────────────

const PATTERN_MOVEMENT_WORDS: Record<string, string[]> = {
  squat:                ['squat'],
  hinge:                ['deadlift', 'rdl', 'hinge'],
  horizontal_press:     ['press', 'bench', 'push-up', 'pushup'],
  horizontal_pull:      ['row', 'pull'],
  vertical_pull:        ['pulldown', 'pull-up', 'pullup', 'chin-up', 'chinup'],
  vertical_press:       ['press', 'overhead', 'military press'],
  lunge:                ['lunge', 'split squat', 'step-up'],
  elbow_flexion:        ['curl'],
  elbow_extension:      ['pushdown', 'extension', 'dip'],
  arm_isolation:        ['curl', 'extension', 'pushdown'],
  knee_flexion:         ['curl', 'leg curl', 'nordic'],
  knee_extension:       ['extension', 'leg extension'],
  ankle_plantarflexion: ['calf', 'calf raise'],
  core_anti_extension:  ['plank', 'pallof', 'hollow'],
  core_flexion:         ['crunch', 'sit-up', 'pallof'],
  shoulder_abduction:   ['lateral raise', 'lateral', 'side raise'],
  shoulder_flexion:     ['front raise'],
  scapular_elevation:   ['shrug'],
  leg_accessory:        ['press', 'curl', 'extension', 'calf'],
  leg_general:          ['swing', 'step', 'jump'],
  stretch:              ['stretch', 'yoga', 'mobility'],
  yoga:                 ['yoga', 'stretch', 'pose'],
}

// ── Token helpers ─────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'with', 'for', 'on',
  'at', 'by', 'as', 'its', 'be', 'is', 'are', 'was', 'v', 'vs',
])

function tokens(name: string): Set<string> {
  return new Set(
    name.toLowerCase()
      .replace(/[^a-z0-9 -]/g, ' ')
      .replace(/-/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w)),
  )
}

// ── Variant detection ──────────────────────────────────────────────────────────

const UNILATERAL_WORDS = ['single arm', 'one arm', 'single leg', 'one leg', 'unilateral', 'alternating']
const MODIFICATION_WORDS = ['incline', 'decline', 'close grip', 'wide grip', 'reverse grip', 'neutral grip', 'sumo', 'stiff leg', 'straight leg']

// ── Main exports ───────────────────────────────────────────────────────────────

/**
 * Build a search query string that gives ymove the best signal for a given
 * canonical exercise. Prepends equipment when the display name lacks it.
 */
export function buildSearchQuery(meta: ExerciseMetadata): string {
  const nameLower = meta.displayName.toLowerCase()
  const eqLower = meta.equipment.toLowerCase()

  const GENERIC_EQ = new Set(['body weight', 'other', 'weighted'])
  if (!GENERIC_EQ.has(eqLower) && !nameLower.includes(eqLower)) {
    return `${meta.equipment} ${meta.displayName}`
  }
  return meta.displayName
}

/**
 * Score a single ymove candidate against canonical exercise metadata.
 * Returns score 0–100 with reasons.
 * Does NOT make any network calls; pure computation over strings.
 */
export function scoreCandidate(
  candidate: YmoveCandidateRaw,
  meta: ExerciseMetadata,
): ScoredCandidate {
  let score = 0
  const matchReasons: string[] = []
  const penaltyReasons: string[] = []

  const ourTokens = tokens(meta.displayName)
  const candTokens = tokens(candidate.name)
  const union = new Set([...ourTokens, ...candTokens])
  const intersect = [...ourTokens].filter(t => candTokens.has(t))

  // ── 1. Name token overlap (0–40 pts) ──────────────────────────────────────
  const jaccard = union.size > 0 ? intersect.length / union.size : 0
  const nameScore = Math.round(jaccard * 40)
  score += nameScore
  if (nameScore >= 28) matchReasons.push('name match')
  else if (nameScore >= 12) matchReasons.push('partial name match')

  // ── 2. Equipment (±30 pts) ────────────────────────────────────────────────
  const ourEq = normalizeEquipment(meta.equipment)
  const candEq = candidate.equipment
    ? normalizeEquipment(candidate.equipment)
    : inferEquipmentFromName(candidate.name)

  if (ourEq && candEq) {
    if (ourEq === candEq) {
      score += 30
      matchReasons.push('equipment match')
    } else if (equipmentSoftRelated(ourEq, candEq)) {
      score -= 8
      penaltyReasons.push(`equipment soft mismatch (${candEq} vs ${ourEq})`)
    } else {
      score -= 20
      penaltyReasons.push(`equipment mismatch: wanted ${meta.equipment}`)
    }
  }

  // ── 3. Movement pattern (0–15 pts) ────────────────────────────────────────
  if (meta.technicalPattern) {
    const patternWords = PATTERN_MOVEMENT_WORDS[meta.technicalPattern] ?? []
    const candLower = candidate.name.toLowerCase()
    if (patternWords.some(w => candLower.includes(w))) {
      score += 15
      matchReasons.push('movement match')
    }
  }

  // ── 4. Variant penalties ──────────────────────────────────────────────────
  const candLower = candidate.name.toLowerCase()
  const ourLower = meta.displayName.toLowerCase()

  if (candLower.includes('assisted') && !ourLower.includes('assisted')) {
    score -= 15
    penaltyReasons.push('assisted variant')
  }

  // band when canonical isn't band
  if ((candLower.includes(' band ') || /^band /.test(candLower)) &&
      meta.equipment.toLowerCase() !== 'band') {
    score -= 15
    penaltyReasons.push('banded variant')
  }

  // unilateral when canonical is bilateral
  const ourUnilateral = UNILATERAL_WORDS.some(w => ourLower.includes(w))
  const candUnilateral = UNILATERAL_WORDS.some(w => candLower.includes(w))
  if (candUnilateral && !ourUnilateral) {
    score -= 10
    penaltyReasons.push('unilateral variant')
  }

  // modifiers not in canonical (incline/decline/grip etc)
  const extraMods = MODIFICATION_WORDS.filter(w => candLower.includes(w) && !ourLower.includes(w))
  if (extraMods.length > 0) {
    score -= 5 * extraMods.length
    penaltyReasons.push(`variant: ${extraMods.join(', ')}`)
  }

  score = Math.max(0, Math.min(100, score))

  const confidence: ScoredCandidate['confidence'] =
    score >= 65 ? 'strong'   :
    score >= 45 ? 'likely'   :
    score >= 25 ? 'possible' :
    'weak'

  return { ...candidate, score, confidence, matchReasons, penaltyReasons }
}

/**
 * Score and sort a list of ymove candidates for a given exercise.
 * Returned array is sorted descending by score.
 */
export function rankCandidates(
  candidates: YmoveCandidateRaw[],
  meta: ExerciseMetadata,
): ScoredCandidate[] {
  return candidates
    .map(c => scoreCandidate(c, meta))
    .sort((a, b) => b.score - a.score)
}

/**
 * Starter batch: ExerciseDB IDs for the 20 priority exercises to map first.
 * These are representative implementations — not an exhaustive list.
 */
export const STARTER_BATCH_IDS = new Set([
  '0025', // Barbell Bench Press
  '0043', // Barbell Back Squat
  '0032', // Barbell Deadlift
  '0085', // Romanian Deadlift
  '0652', // Pull-Up
  '0007', // Lat Pulldown
  '0027', // Barbell Bent Over Row
  '0091', // Barbell Overhead Press
  '0334', // Dumbbell Lateral Raise
  '0294', // Dumbbell Biceps Curl
  '0241', // Cable Triceps Pushdown
  '0987', // Split Squat
  '2287', // Leg Press
  '0586', // Leg Curl
  '0605', // Calf Raise
  '0464', // Front Plank
  '0979', // Pallof Press
  '0662', // Push-Up
  '0549', // Kettlebell Swing
  '1366', // Upward-Facing Dog (mobility)
])
