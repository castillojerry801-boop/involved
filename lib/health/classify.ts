import 'server-only'
import type { HealthActivityType } from '@prisma/client'

export interface ClassifyInput {
  title: string
  exercises: Array<{ trackingType: string }>
}

// Title keyword → activity type. Ordered most-specific first.
// Each pattern must be unambiguous — prefer false-negative over false-positive.
const TITLE_PATTERNS: Array<[RegExp, HealthActivityType]> = [
  [/\b(run|running|jog|jogging|5k|10k|half[\s-]?marathon|marathon|race)\b/i, 'running'],
  [/\b(walk|walking|stroll)\b/i, 'walking'],
  [/\b(hike|hiking|trail\s+run)\b/i, 'hiking'],
  [/\b(cycl|cycling|bike|biking|spin|spinning|fixie)\b/i, 'cycling'],
  [/\b(swim|swimming|pool)\b/i, 'swimming'],
  [/\b(row|rowing|erg)\b/i, 'rowing'],
  [/\b(yoga|pilates|mobility|stretch)\b/i, 'yoga'],
  [/\b(hiit|tabata|circuit|interval|intervals)\b/i, 'hiit'],
  [/\b(elliptical)\b/i, 'elliptical'],
  [/\b(stair|stairs|stairmaster|step|steps)\b/i, 'stair_climbing'],
  [/\bcross[\s-]?train/i, 'cross_training'],
  // Generic strength signals — matched last so cardio keywords above win
  [/\b(strength|lift|lifting|weights|barbell|dumbbell|squat|deadlift|bench|press|pull[\s-]?up)\b/i, 'strength_training'],
]

// TrackingType values that indicate strength-focused work
const STRENGTH_TYPES = new Set(['strength', 'bodyweight', 'assisted', 'carry', 'isometric'])

/**
 * Classify an Involved workout as a HealthActivityType.
 *
 * Priority:
 *  1. Workout title keywords (highest confidence — user-named)
 *  2. Exercise tracking types
 *  3. 'other' when uncertain (never defaults to strength_training blindly)
 */
export function classifyWorkoutActivity(input: ClassifyInput): HealthActivityType {
  // 1. Title keyword match
  for (const [pattern, type] of TITLE_PATTERNS) {
    if (pattern.test(input.title)) return type
  }

  if (input.exercises.length === 0) return 'other'

  const types = new Set(input.exercises.map(e => e.trackingType))

  // 2. All cardio tracking type → no title signal → generic cross-training
  if ([...types].every(t => t === 'cardio')) return 'cross_training'

  // 3. All intervals → HIIT
  if ([...types].every(t => t === 'intervals')) return 'hiit'

  // 4. Any strength-type exercise → strength training
  if ([...types].some(t => STRENGTH_TYPES.has(t))) return 'strength_training'

  // 5. Mixed or unrecognised → neutral
  return 'other'
}

/**
 * Returns true if two activity types are close enough to be the same real-world session.
 * Used during deduplication — we require type compatibility, not just proximity.
 */
export function activityTypesCompatible(a: HealthActivityType, b: HealthActivityType): boolean {
  if (a === b) return true
  const strengthGroup: ReadonlySet<HealthActivityType> = new Set(['strength_training', 'functional_strength'])
  if (strengthGroup.has(a) && strengthGroup.has(b)) return true
  // All other pairs must match exactly to avoid false-positive merges.
  return false
}
