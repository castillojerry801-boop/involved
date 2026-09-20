import libraryData from '@/data/involved-exercise-library.json'
import scaffoldNames from '@/data/involved-exercise-display-names.json'

export interface ImplementationSource {
  provider: string
  exerciseId: string
  sourceName?: string
}

export interface ImplementationMedia {
  source: 'exercisedb' | 'involved'
  gifPath: string
  replacementStatus: 'temporary' | 'permanent'
}

export interface CanonicalImplementation {
  implementationId: string
  displayLabel: string
  equipment: string
  source: ImplementationSource
  media?: ImplementationMedia
  priority: number
  notes?: string
}

export interface CanonicalSourceGap {
  status: string
  reason: string
}

export interface CanonicalMechanics {
  loadPosition?: string
  stance?: string
  support?: string
}

export interface CanonicalMuscleCard {
  primary: string[]
  secondary: string[]
  stabilizers: string[]
  bodyMap?: {
    front: string[]
    back: string[]
    status: string
  }
}

export interface CanonicalDescription {
  summary: string
  steps?: string[]
  feelItIn?: string[]
  hold?: string
  reps?: string
  whyUseIt?: string
  /** Present in v0.2 seeds; optional going forward */
  whatItTrains?: string
}

export interface CanonicalExercise {
  id: string
  name: string
  slug: string
  movementFamilyId: string
  technicalPattern: string
  browseTags?: string[]
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  mechanics?: CanonicalMechanics
  muscleCard: CanonicalMuscleCard
  description: CanonicalDescription
  coachingCues: string[]
  commonMistakes: string[]
  aliases: string[]
  implementations: CanonicalImplementation[]
  sourceGap?: CanonicalSourceGap
  /** Path under /public for Involved-original placeholder visuals, e.g. /originals/inv_yoga_downward_dog.png */
  originalVisualPath?: string
}

export interface CanonicalFamily {
  id: string
  displayName: string
  technicalName: string
}

type LibraryShape = {
  movementFamilies: CanonicalFamily[]
  canonicalExercises: CanonicalExercise[]
}

const lib = libraryData as unknown as LibraryShape

export const movementFamilies: CanonicalFamily[] = lib.movementFamilies
export const canonicalExercises: CanonicalExercise[] = lib.canonicalExercises

/** Maps internal technical pattern keys to beginner-friendly gym labels. */
export const MOVEMENT_PATTERN_LABELS: Record<string, string> = {
  // Primary patterns
  squat:                'Squat',
  hinge:                'Hip Hinge',
  horizontal_press:     'Chest Press',
  horizontal_pull:      'Row',
  vertical_pull:        'Pulldown / Pull-Up',
  vertical_press:       'Overhead Press',
  lunge:                'Lunge',
  // Core
  core_anti_extension:  'Core Stability',
  core_flexion:         'Core',
  // Shoulder accessories
  shoulder_abduction:   'Shoulder Raise',
  shoulder_flexion:     'Front Raise',
  scapular_elevation:   'Shrug',
  shoulder_accessory:   'Shoulders',
  // Arm isolation
  elbow_flexion:        'Curl',
  elbow_extension:      'Triceps Extension',
  arm_isolation:        'Arms',
  // Leg accessories
  knee_hip_extension:   'Leg Press',
  knee_extension:       'Leg Extension',
  knee_flexion:         'Leg Curl',
  ankle_plantarflexion: 'Calf Raise',
  leg_accessory:        'Leg Accessory',
  // v0.4 fast-pass additions
  back_general:         'Back',
  chest_isolation:      'Chest',
  leg_general:          'Legs',
  plyometrics:          'Plyometrics',
  olympic_power:        'Power / Olympic',
  other:                'Other',
  // v0.5 specialty additions
  cardio_machine:       'Cardio',
  locomotion:           'Cardio',
  conditioning:         'Conditioning',
  stretch:              'Mobility',
  olympic_lift:         'Olympic Lift',
  power_lift:           'Power',
  lower_body_plyometric:'Plyometric',
  lateral_plyometric:   'Plyometric',
  upper_body_plyometric:'Plyometric',
  carry:                'Carry',
  // v1.1 base + Involved-original additions
  neck:                 'Neck',
  yoga:                 'Yoga',
  agility:              'Agility / Athletic',
}

export function getCanonicalFamily(id: string): CanonicalFamily | undefined {
  return movementFamilies.find(f => f.id === id)
}

export function getCanonicalExercise(id: string): CanonicalExercise | undefined {
  return canonicalExercises.find(e => e.id === id)
}

export function getExercisesForFamily(familyId: string): CanonicalExercise[] {
  return canonicalExercises.filter(e => e.movementFamilyId === familyId)
}

// Built once at module load — O(1) lookups at render time.
function buildDisplayNameMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const exercise of canonicalExercises) {
    for (const impl of exercise.implementations) {
      const eid = impl.source?.exerciseId
      if (eid && impl.displayLabel) map.set(eid, impl.displayLabel)
    }
  }
  return map
}
const _displayNameMap = buildDisplayNameMap()

/**
 * Applies light normalization to a raw ExerciseDB name for exercises that
 * are not yet mapped to a canonical implementation.
 * - "lever X"        → "Machine X"
 * - " (male)"        → stripped
 * - " v. 2"          → stripped
 * - lowercase        → Title Case
 */
export function normalizeExerciseName(raw: string): string {
  return raw
    .replace(/\s*\((?:male|female)\)\s*$/i, '')
    .replace(/\s+v\.?\s*\d+$/i, '')
    .replace(/^lever\s+/i, 'Machine ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

const _scaffoldNames = scaffoldNames as Record<string, string>

/**
 * Returns the clean Involved display name for an ExerciseDB exercise.
 * Priority:
 *  1. Canonical library `displayLabel`  — curated, highest confidence
 *  2. Migration scaffold name           — covers all 1,394 ExerciseDB IDs
 *  3. `normalizeExerciseName(rawName)`  — true fallback for anything not yet mapped
 */
export function getInvolvedDisplayName(exerciseId: string, rawName: string): string {
  return _displayNameMap.get(exerciseId)
    ?? _scaffoldNames[exerciseId]
    ?? normalizeExerciseName(rawName)
}
