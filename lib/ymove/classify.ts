/**
 * Read-only classification helpers for YMove catalog entries.
 *
 * Derives movement family, equipment family, movement subclass, and
 * meaningful variation from a YMove exercise name + catalog metadata.
 *
 * Rules:
 * - Unknown equipment and uncertain movement classification are returned
 *   as explicit null / 'unknown' — never guessed or fabricated.
 * - This module is ZERO side-effects: no network, no Prisma, no server-only.
 *   Safe to use in tests, API routes, and scripts.
 */

import {
  type EqFamily,
  type MovementClass,
  type MovementSubclass,
  normalizeYmoveEquipment,
  inferEquipmentFromName,
  movementClassFromYmove,
  detectMovementSubclass,
} from './hierarchy-scorer'

// ── Movement family IDs ───────────────────────────────────────────────────────
// These are the L1 family slugs used across the Involved hierarchy pipeline.

export type MovementFamilyId =
  | 'fam_squat'
  | 'fam_lunge'
  | 'fam_hip_hinge'
  | 'fam_leg_accessories'
  | 'fam_chest_press'
  | 'fam_chest'
  | 'fam_overhead_press'
  | 'fam_shoulders'
  | 'fam_row'
  | 'fam_back'
  | 'fam_pulldown_pullup'
  | 'fam_arms'
  | 'fam_core'
  | 'fam_legs'
  | 'fam_cardio'
  | 'fam_mobility'
  | 'fam_power'
  | 'fam_neck'
  | 'fam_plyometrics'
  | 'fam_carries'

// ── Variation tags ────────────────────────────────────────────────────────────

export type VariationTag =
  | 'flat' | 'incline' | 'decline'
  | 'close_grip' | 'wide_grip' | 'neutral_grip' | 'reverse_grip' | 'hammer_grip'
  | 'sumo' | 'paused' | 'tempo'
  | 'unilateral' | 'alternating'
  | 'seated' | 'standing' | 'lying' | 'kneeling'
  | 'front' | 'rear'
  | 'high_cable' | 'low_cable' | 'mid_cable'

// ── Classification result ─────────────────────────────────────────────────────

export interface YmoveClassification {
  movementClass:    MovementClass
  movementSubclass: MovementSubclass
  movementFamilyId: MovementFamilyId | null  // null = could not determine
  eqFamily:         EqFamily | null           // null = unknown/unrecognised equipment
  eqSource:         'catalog' | 'name_inferred' | 'unknown'
  variations:       VariationTag[]
  confidence:       'high' | 'medium' | 'low'
}

// ── Movement class → movement family mapping ──────────────────────────────────
// The mapping is not 1:1; subclass is used to pick the correct family when
// a movement class covers multiple L1 families.

function movementFamilyFromClass(
  cls: MovementClass,
  sub: MovementSubclass,
  name: string,
): MovementFamilyId | null {
  const n = name.toLowerCase()

  switch (cls) {
    case 'lower_push':
      if (sub === 'squat')      return 'fam_squat'
      if (sub === 'lunge')      return 'fam_lunge'
      if (sub === 'hip_thrust') return 'fam_hip_hinge'
      if (sub === 'calf_raise') return 'fam_leg_accessories'
      // Name fallback for lower_push without a strong subclass
      if (n.includes('leg press') || n.includes('leg extension')) return 'fam_leg_accessories'
      if (n.includes('glute bridge') || n.includes('hip bridge') || n.includes('hip thrust')) return 'fam_hip_hinge'
      return 'fam_squat'  // default for lower_push

    case 'lower_pull':
      if (sub === 'deadlift' || sub === 'rdl' || sub === 'good_morning') return 'fam_hip_hinge'
      if (sub === 'leg_curl') return 'fam_leg_accessories'
      // Name fallback
      if (n.includes('deadlift') || n.includes('rdl') || n.includes('romanian') || n.includes('good morning')) return 'fam_hip_hinge'
      if (n.includes('leg curl') || n.includes('hamstring curl') || n.includes('nordic')) return 'fam_leg_accessories'
      return 'fam_legs'

    case 'upper_push_h':
      if (n.includes('dip'))                           return 'fam_chest'
      if (n.includes('push') && !n.includes('push down') && !n.includes('pushdown') && !n.includes('press')) return 'fam_chest'
      if (n.includes('fly') || n.includes('flye') || n.includes('cable cross')) return 'fam_chest'
      return 'fam_chest_press'

    case 'upper_push_v':
      return 'fam_overhead_press'

    case 'upper_pull_h':
      if (n.includes('rear delt') || n.includes('rear-delt')) return 'fam_shoulders'
      return 'fam_row'

    case 'upper_pull_v':
      return 'fam_pulldown_pullup'

    case 'arm_flexion':
    case 'arm_extension':
      return 'fam_arms'

    case 'shoulder_isolation':
      return 'fam_shoulders'

    case 'core':
      return 'fam_core'

    case 'hip_abduction':
      return 'fam_leg_accessories'

    case 'cardio_conditioning':
      return 'fam_cardio'

    case 'mobility_stretch':
      return 'fam_mobility'

    case 'unknown':
      // Final name-based attempt before giving up
      if (n.includes('neck'))                          return 'fam_neck'
      if (n.includes('jump') || n.includes('box jump') || n.includes('broad jump')) return 'fam_plyometrics'
      if (n.includes('clean') || n.includes('snatch') || n.includes('jerk') || n.includes('thruster')) return 'fam_power'
      if (n.includes('carry') || n.includes('farmer')) return 'fam_carries'
      return null
  }
}

// ── Variation detection ───────────────────────────────────────────────────────

function detectVariations(name: string): VariationTag[] {
  const n     = name.toLowerCase()
  const tags: VariationTag[] = []

  // Plane / angle
  if (/\bflat\b/.test(n))                                          tags.push('flat')
  if (/\bincline\b/.test(n))                                       tags.push('incline')
  if (/\bdecline\b/.test(n))                                       tags.push('decline')

  // Grip — reverse grip before close grip (more distinctive)
  if (/reverse grip|reverse-grip|underhand/.test(n))               tags.push('reverse_grip')
  if (/close[\s-]grip|narrow[\s-]grip/.test(n))                    tags.push('close_grip')
  if (/wide[\s-]grip/.test(n))                                     tags.push('wide_grip')
  if (/neutral[\s-]grip/.test(n))                                  tags.push('neutral_grip')
  if (/\bhammer\b/.test(n) && !n.includes('hammer strength'))      tags.push('hammer_grip')

  // Technique modifier
  if (/\bsumo\b/.test(n))                                          tags.push('sumo')
  if (/\bpaused\b/.test(n))                                        tags.push('paused')
  if (/\btempo\b/.test(n))                                         tags.push('tempo')

  // Laterality
  if (/single[\s-]leg|single[\s-]arm|one[\s-]arm|one[\s-]leg|unilateral/.test(n)) tags.push('unilateral')
  if (/\balternating\b/.test(n))                                   tags.push('alternating')

  // Position
  if (/\bseated\b/.test(n))                                        tags.push('seated')
  if (/\bstanding\b/.test(n))                                      tags.push('standing')
  if (/\blying\b|lie down/.test(n))                                tags.push('lying')
  if (/\bkneeling\b/.test(n))                                      tags.push('kneeling')

  // Cable height (relevant for cable exercises)
  if (/high[\s-]cable|overhead cable/.test(n))                     tags.push('high_cable')
  if (/low[\s-]cable|low cable/.test(n))                           tags.push('low_cable')

  // Shoulder position
  if (/\bfront\b/.test(n) && /raise|delt|shoulder/.test(n))       tags.push('front')
  if (/\brear\b/.test(n)  && /raise|delt|shoulder/.test(n))       tags.push('rear')

  return tags
}

// ── Confidence scoring ────────────────────────────────────────────────────────

function scoreConfidence(
  cls: MovementClass,
  eqSource: YmoveClassification['eqSource'],
  familyId: MovementFamilyId | null,
): YmoveClassification['confidence'] {
  if (cls === 'unknown' || familyId === null) return 'low'
  if (eqSource !== 'catalog')                 return 'medium'  // name_inferred or unknown
  return 'high'
}

// ── Main classifier ───────────────────────────────────────────────────────────

export interface CatalogRowForClassify {
  name:      string
  equipment: string | null
  category:  string | null
}

export function classifyYmoveExercise(row: CatalogRowForClassify): YmoveClassification {
  const { name, equipment, category } = row

  // Equipment resolution — explicit unknown, no fabrication
  const eqFromCatalog = normalizeYmoveEquipment(equipment)
  const eqFromName    = eqFromCatalog === null ? inferEquipmentFromName(name) : null
  const eqFamily      = eqFromCatalog ?? eqFromName
  const eqSource: YmoveClassification['eqSource'] =
    eqFromCatalog !== null ? 'catalog'
    : eqFromName  !== null ? 'name_inferred'
    : 'unknown'

  // Movement classification
  const movementClass    = movementClassFromYmove(category, name)
  const movementSubclass = detectMovementSubclass(null, name)

  // Movement family
  const movementFamilyId = movementFamilyFromClass(movementClass, movementSubclass, name)

  // Variation tags
  const variations = detectVariations(name)

  // Confidence
  const confidence = scoreConfidence(movementClass, eqSource, movementFamilyId)

  return { movementClass, movementSubclass, movementFamilyId, eqFamily, eqSource, variations, confidence }
}
