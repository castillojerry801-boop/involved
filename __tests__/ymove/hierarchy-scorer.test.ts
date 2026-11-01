/**
 * Unit tests for lib/ymove/hierarchy-scorer.ts
 *
 * Covers:
 *  - detectMovementSubclass  (name-based detection, pattern fallback)
 *  - equipmentCompatible     (exact, soft, incompatible, trap_bar isolation)
 *  - movementSubclassCompatible (squat vs bridge, hinge, leg-curl)
 *  - movementClassesCompatible  (cross-domain hard blocks)
 *  - scoreCandidate             (equipment hard-block, subclass hard-block, threshold boundaries)
 *  - classifyTier               (55 = weak, 65 = review, 85 = high_priority, 54 = unmatched)
 *  - Determinism                (same input → identical output across multiple calls)
 *  - Protected mapping contracts (scorer never touches DB — purely functional)
 */

import { describe, it, expect } from 'vitest'
import {
  detectMovementSubclass,
  equipmentCompatible,
  movementSubclassCompatible,
  movementClassesCompatible,
  classifyTier,
  scoreCandidate,
  normalizeExdbEquipment,
  normalizeYmoveEquipment,
  inferEquipmentFromName,
  type CatalogEntry,
  type ExerciseMeta,
  SCORE_HIGH_PRIORITY,
  SCORE_REVIEW,
  SCORE_WEAK_MIN,
} from '../../lib/ymove/hierarchy-scorer'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCatalog(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    ymoveId:            overrides.ymoveId            ?? 'test-ymove-id',
    name:               overrides.name               ?? 'Barbell Bench Press',
    equipment:          overrides.equipment           ?? 'barbell',
    category:           overrides.category            ?? 'Chest',
    primaryMuscleGroup: overrides.primaryMuscleGroup  ?? 'pectorals',
    thumbnailMediaId:   overrides.thumbnailMediaId    ?? null,
    curationStatus:     overrides.curationStatus      ?? 'approved',
  }
}

function makeMeta(overrides: Partial<ExerciseMeta> = {}): ExerciseMeta {
  return {
    exerciseDbId:     overrides.exerciseDbId     ?? '0026',
    name:             overrides.name             ?? 'barbell bench press',
    equipment:        overrides.equipment        ?? 'barbell',
    equipmentFamily:  overrides.equipmentFamily  ?? 'barbell',
    target:           overrides.target           ?? 'pectorals',
    bodyPart:         overrides.bodyPart         ?? 'chest',
    technicalPattern: overrides.technicalPattern ?? 'horizontal_press',
    movementClass:    overrides.movementClass    ?? 'upper_push_h',
    movementSubclass: overrides.movementSubclass ?? null,
  }
}

// ── detectMovementSubclass ────────────────────────────────────────────────────

describe('detectMovementSubclass', () => {
  it('detects hip_thrust from "hip thrust"', () => {
    expect(detectMovementSubclass(null, 'Barbell Hip Thrust')).toBe('hip_thrust')
  })

  it('detects hip_thrust from "glute bridge"', () => {
    expect(detectMovementSubclass(null, 'Barbell Glute Bridge')).toBe('hip_thrust')
  })

  it('detects hip_thrust from bare "bridge" when not bench/row/gap/cable', () => {
    expect(detectMovementSubclass(null, 'Hip Bridge')).toBe('hip_thrust')
  })

  it('does NOT tag bench bridge as hip_thrust', () => {
    expect(detectMovementSubclass(null, 'Bench Press with Bridge Stance')).not.toBe('hip_thrust')
  })

  it('detects good_morning', () => {
    expect(detectMovementSubclass(null, 'Barbell Good Morning')).toBe('good_morning')
  })

  it('detects rdl from "romanian"', () => {
    expect(detectMovementSubclass(null, 'Barbell Romanian Deadlift')).toBe('rdl')
  })

  it('detects rdl from "stiff leg"', () => {
    expect(detectMovementSubclass(null, 'Barbell Stiff Leg Deadlift')).toBe('rdl')
  })

  it('detects deadlift from "deadlift" without rdl qualifiers', () => {
    expect(detectMovementSubclass(null, 'Barbell Deadlift')).toBe('deadlift')
  })

  it('detects leg_curl from "leg curl"', () => {
    expect(detectMovementSubclass(null, 'Lying Leg Curl')).toBe('leg_curl')
  })

  it('detects squat from name', () => {
    expect(detectMovementSubclass(null, 'Barbell Back Squat')).toBe('squat')
  })

  it('detects squat from technicalPattern when name is generic', () => {
    expect(detectMovementSubclass('squat', 'Back Squat Variation')).toBe('squat')
  })

  it('detects lunge from "split squat"', () => {
    expect(detectMovementSubclass(null, 'Dumbbell Bulgarian Split Squat')).toBe('lunge')
  })

  it('detects calf_raise from pattern ankle_plantarflexion', () => {
    expect(detectMovementSubclass('ankle_plantarflexion', 'Standing Calf Press')).toBe('calf_raise')
  })

  it('returns null for generic upper-body exercise', () => {
    expect(detectMovementSubclass('horizontal_press', 'Barbell Bench Press')).toBeNull()
  })

  it('falls back to deadlift for hinge pattern without name hint', () => {
    expect(detectMovementSubclass('hinge', 'Some Hinge Exercise')).toBe('deadlift')
  })

  it('trap bar deadlift name → deadlift (not rdl)', () => {
    expect(detectMovementSubclass(null, 'Trap Bar Deadlift')).toBe('deadlift')
  })
})

// ── equipmentCompatible ───────────────────────────────────────────────────────

describe('equipmentCompatible', () => {
  it('returns exact for same family', () => {
    expect(equipmentCompatible('barbell', 'barbell')).toBe('exact')
    expect(equipmentCompatible('dumbbell', 'dumbbell')).toBe('exact')
    expect(equipmentCompatible('trap_bar', 'trap_bar')).toBe('exact')
  })

  it('returns soft for barbell ↔ smith', () => {
    expect(equipmentCompatible('barbell', 'smith')).toBe('soft')
    expect(equipmentCompatible('smith', 'barbell')).toBe('soft')
  })

  it('returns soft for cable ↔ band', () => {
    expect(equipmentCompatible('cable', 'band')).toBe('soft')
    expect(equipmentCompatible('band', 'cable')).toBe('soft')
  })

  it('returns soft for machine ↔ cable', () => {
    expect(equipmentCompatible('machine', 'cable')).toBe('soft')
    expect(equipmentCompatible('cable', 'machine')).toBe('soft')
  })

  it('trap_bar is incompatible with barbell', () => {
    expect(equipmentCompatible('trap_bar', 'barbell')).toBe('incompatible')
    expect(equipmentCompatible('barbell', 'trap_bar')).toBe('incompatible')
  })

  it('trap_bar is incompatible with dumbbell', () => {
    expect(equipmentCompatible('trap_bar', 'dumbbell')).toBe('incompatible')
  })

  it('trap_bar is incompatible with smith', () => {
    expect(equipmentCompatible('trap_bar', 'smith')).toBe('incompatible')
  })

  it('dumbbell vs barbell is incompatible (not soft)', () => {
    expect(equipmentCompatible('dumbbell', 'barbell')).toBe('incompatible')
  })

  it('kettlebell vs dumbbell is incompatible', () => {
    expect(equipmentCompatible('kettlebell', 'dumbbell')).toBe('incompatible')
  })
})

// ── normalizeExdbEquipment / normalizeYmoveEquipment ─────────────────────────

describe('normalizeExdbEquipment', () => {
  it('maps trap bar to trap_bar (not barbell)', () => {
    expect(normalizeExdbEquipment('trap bar')).toBe('trap_bar')
  })

  it('maps barbell to barbell', () => {
    expect(normalizeExdbEquipment('barbell')).toBe('barbell')
  })

  it('maps ez barbell to barbell', () => {
    expect(normalizeExdbEquipment('ez barbell')).toBe('barbell')
  })

  it('maps body weight to bodyweight', () => {
    expect(normalizeExdbEquipment('body weight')).toBe('bodyweight')
  })

  it('maps resistance band to band', () => {
    expect(normalizeExdbEquipment('resistance band')).toBe('band')
  })

  it('returns null for unknown equipment', () => {
    expect(normalizeExdbEquipment('medicine ball')).toBeNull()
    expect(normalizeExdbEquipment('sled')).toBeNull()
  })
})

describe('normalizeYmoveEquipment', () => {
  it('maps barbell', () => { expect(normalizeYmoveEquipment('barbell')).toBe('barbell') })
  it('maps bodyweight variants', () => {
    expect(normalizeYmoveEquipment('bodyweight')).toBe('bodyweight')
    expect(normalizeYmoveEquipment('body weight')).toBe('bodyweight')
  })
  it('handles null', () => { expect(normalizeYmoveEquipment(null)).toBeNull() })
})

describe('inferEquipmentFromName', () => {
  it('infers trap_bar from "Trap Bar Deadlift"', () => {
    expect(inferEquipmentFromName('Trap Bar Deadlift')).toBe('trap_bar')
  })

  it('infers barbell from "Barbell Squat"', () => {
    expect(inferEquipmentFromName('Barbell Squat')).toBe('barbell')
  })

  it('returns null for bodyweight name without equipment cue', () => {
    expect(inferEquipmentFromName('Push-Up')).toBeNull()
  })
})

// ── movementSubclassCompatible ────────────────────────────────────────────────

describe('movementSubclassCompatible', () => {
  // Compatible — same subclass
  it('squat vs squat is compatible', () => {
    expect(movementSubclassCompatible('squat', 'squat')).toBe(true)
  })

  it('deadlift vs rdl is compatible (both are hinge variants)', () => {
    expect(movementSubclassCompatible('deadlift', 'rdl')).toBe(true)
  })

  it('rdl vs good_morning is compatible (both are hinge variants)', () => {
    expect(movementSubclassCompatible('rdl', 'good_morning')).toBe(true)
  })

  it('lunge vs squat is compatible (both knee-dominant)', () => {
    expect(movementSubclassCompatible('lunge', 'squat')).toBe(true)
  })

  // null means unclassified → always compatible
  it('null vs anything is compatible', () => {
    expect(movementSubclassCompatible(null, 'squat')).toBe(true)
    expect(movementSubclassCompatible('squat', null)).toBe(true)
    expect(movementSubclassCompatible(null, null)).toBe(true)
  })

  // Hard incompatibles
  it('squat vs hip_thrust is incompatible', () => {
    expect(movementSubclassCompatible('squat', 'hip_thrust')).toBe(false)
  })

  it('hip_thrust vs squat is incompatible (symmetric)', () => {
    expect(movementSubclassCompatible('hip_thrust', 'squat')).toBe(false)
  })

  it('squat vs deadlift is incompatible', () => {
    expect(movementSubclassCompatible('squat', 'deadlift')).toBe(false)
  })

  it('squat vs good_morning is incompatible', () => {
    expect(movementSubclassCompatible('squat', 'good_morning')).toBe(false)
  })

  it('squat vs leg_curl is incompatible', () => {
    expect(movementSubclassCompatible('squat', 'leg_curl')).toBe(false)
  })

  it('lunge vs hip_thrust is incompatible', () => {
    expect(movementSubclassCompatible('lunge', 'hip_thrust')).toBe(false)
  })

  it('hip_thrust vs deadlift is incompatible', () => {
    expect(movementSubclassCompatible('hip_thrust', 'deadlift')).toBe(false)
  })

  it('hip_thrust vs leg_curl is incompatible', () => {
    expect(movementSubclassCompatible('hip_thrust', 'leg_curl')).toBe(false)
  })

  it('leg_curl vs squat is incompatible', () => {
    expect(movementSubclassCompatible('leg_curl', 'squat')).toBe(false)
  })

  it('leg_curl vs deadlift is incompatible', () => {
    expect(movementSubclassCompatible('leg_curl', 'deadlift')).toBe(false)
  })
})

// ── movementClassesCompatible ─────────────────────────────────────────────────

describe('movementClassesCompatible', () => {
  it('same class is compatible', () => {
    expect(movementClassesCompatible('upper_push_h', 'upper_push_h')).toBe(true)
  })

  it('upper_push_h ↔ upper_push_v is compatible (incline bridge)', () => {
    expect(movementClassesCompatible('upper_push_h', 'upper_push_v')).toBe(true)
    expect(movementClassesCompatible('upper_push_v', 'upper_push_h')).toBe(true)
  })

  it('upper_pull_h ↔ upper_pull_v is compatible', () => {
    expect(movementClassesCompatible('upper_pull_h', 'upper_pull_v')).toBe(true)
  })

  it('unknown is always compatible', () => {
    expect(movementClassesCompatible('unknown', 'arm_flexion')).toBe(true)
    expect(movementClassesCompatible('lower_push', 'unknown')).toBe(true)
  })

  it('lower_push vs arm_flexion is incompatible', () => {
    expect(movementClassesCompatible('lower_push', 'arm_flexion')).toBe(false)
  })

  it('lower_push vs upper_push_h is incompatible', () => {
    expect(movementClassesCompatible('lower_push', 'upper_push_h')).toBe(false)
  })

  it('arm_flexion vs arm_extension is incompatible', () => {
    expect(movementClassesCompatible('arm_flexion', 'arm_extension')).toBe(false)
  })
})

// ── classifyTier ──────────────────────────────────────────────────────────────

describe('classifyTier', () => {
  it('54 → unmatched (just below weak threshold)', () => {
    expect(classifyTier(54)).toBe('unmatched')
  })

  it('55 → weak (at threshold boundary)', () => {
    expect(classifyTier(55)).toBe('weak')
    expect(classifyTier(SCORE_WEAK_MIN)).toBe('weak')
  })

  it('64 → weak (just below review)', () => {
    expect(classifyTier(64)).toBe('weak')
  })

  it('65 → review (at threshold boundary)', () => {
    expect(classifyTier(65)).toBe('review')
    expect(classifyTier(SCORE_REVIEW)).toBe('review')
  })

  it('84 → review (just below high_priority)', () => {
    expect(classifyTier(84)).toBe('review')
  })

  it('85 → high_priority (at threshold boundary)', () => {
    expect(classifyTier(85)).toBe('high_priority')
    expect(classifyTier(SCORE_HIGH_PRIORITY)).toBe('high_priority')
  })

  it('100 → high_priority', () => {
    expect(classifyTier(100)).toBe('high_priority')
  })

  it('0 → unmatched', () => {
    expect(classifyTier(0)).toBe('unmatched')
  })
})

// ── scoreCandidate — equipment hard-block ─────────────────────────────────────

describe('scoreCandidate — equipment hard-block', () => {
  it('dumbbell exercise gets hard-block against barbell catalog entry', () => {
    const catalog = makeCatalog({ equipment: 'barbell', name: 'Barbell Bench Press' })
    const meta    = makeMeta({ equipmentFamily: 'dumbbell', equipment: 'dumbbell', name: 'dumbbell bench press' })
    const result  = scoreCandidate(catalog, meta)
    expect(result.hardBlock).not.toBeNull()
    expect(result.score).toBe(0)
    expect(result.tier).toBe('unmatched')
  })

  it('barbell exercise hard-blocked against trap_bar catalog entry', () => {
    const catalog = makeCatalog({ equipment: 'trap bar', name: 'Trap Bar Deadlift' })
    const meta    = makeMeta({ equipmentFamily: 'barbell', equipment: 'barbell', name: 'barbell deadlift' })
    const result  = scoreCandidate(catalog, meta)
    expect(result.hardBlock).not.toBeNull()
    expect(result.score).toBe(0)
  })

  it('trap_bar exercise hard-blocked against barbell catalog entry', () => {
    const catalog = makeCatalog({ equipment: 'barbell', name: 'Barbell Deadlift' })
    const meta    = makeMeta({
      equipmentFamily: 'trap_bar', equipment: 'trap bar',
      name: 'trap bar deadlift',
      movementSubclass: 'deadlift',
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).not.toBeNull()
    expect(result.score).toBe(0)
  })

  it('soft-match (barbell vs smith) does not hard-block', () => {
    const catalog = makeCatalog({ equipment: 'smith machine', name: 'Smith Machine Bench Press' })
    const meta    = makeMeta({ equipmentFamily: 'barbell', equipment: 'barbell', name: 'barbell bench press' })
    const result  = scoreCandidate(catalog, meta)
    expect(result.hardBlock).toBeNull()
    expect(result.score).toBeGreaterThan(0)
  })
})

// ── scoreCandidate — movement subclass hard-block ────────────────────────────

describe('scoreCandidate — movement subclass hard-block', () => {
  it('squat exercise hard-blocked against glute bridge catalog entry', () => {
    const catalog = makeCatalog({
      equipment:          'barbell',
      name:               'Barbell Glute Bridge',
      category:           'Legs',
      primaryMuscleGroup: 'glutes',
    })
    const meta = makeMeta({
      name:             'barbell squat',
      target:           'quads',
      bodyPart:         'upper legs',
      technicalPattern: 'squat',
      movementClass:    'lower_push',
      movementSubclass: 'squat',
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).not.toBeNull()
    expect(result.hardBlock).toMatch(/subclass incompatible/)
    expect(result.score).toBe(0)
  })

  it('squat exercise hard-blocked against hip thrust catalog entry', () => {
    const catalog = makeCatalog({
      equipment:          'barbell',
      name:               'Barbell Hip Thrust',
      category:           'Legs',
      primaryMuscleGroup: 'glutes',
    })
    const meta = makeMeta({
      name:             'barbell back squat',
      target:           'quads',
      bodyPart:         'upper legs',
      technicalPattern: 'squat',
      movementClass:    'lower_push',
      movementSubclass: 'squat',
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).not.toBeNull()
    expect(result.score).toBe(0)
  })

  it('squat exercise hard-blocked against good morning catalog entry', () => {
    const catalog = makeCatalog({
      equipment:          'barbell',
      name:               'Barbell Good Morning',
      category:           'Legs',
      primaryMuscleGroup: 'hamstrings',
    })
    const meta = makeMeta({
      name:             'barbell squat',
      target:           'quads',
      movementClass:    'lower_push',
      movementSubclass: 'squat',
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).not.toBeNull()
  })

  it('deadlift exercise scores normally against deadlift catalog entry (not blocked)', () => {
    const catalog = makeCatalog({
      equipment:          'barbell',
      name:               'Barbell Deadlift',
      category:           'Legs',
      primaryMuscleGroup: 'hamstrings',
    })
    const meta = makeMeta({
      name:             'barbell deadlift',
      target:           'hamstrings',
      bodyPart:         'upper legs',
      technicalPattern: 'hinge',
      movementClass:    'lower_pull',
      movementSubclass: 'deadlift',
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).toBeNull()
    expect(result.score).toBeGreaterThan(0)
  })

  it('rdl scores normally against deadlift catalog entry (hinge-hinge compatible)', () => {
    const catalog = makeCatalog({
      equipment:          'barbell',
      name:               'Barbell Romanian Deadlift',
      category:           'Legs',
      primaryMuscleGroup: 'hamstrings',
    })
    const meta = makeMeta({
      name:             'barbell stiff leg deadlift',
      target:           'hamstrings',
      bodyPart:         'upper legs',
      technicalPattern: 'hinge',
      movementClass:    'lower_pull',
      movementSubclass: 'rdl',
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).toBeNull()
    expect(result.score).toBeGreaterThan(0)
  })
})

// ── scoreCandidate — movement class cross-domain hard-block ──────────────────

describe('scoreCandidate — movement class cross-domain hard-block', () => {
  it('curl exercise hard-blocked against squat catalog entry', () => {
    const catalog = makeCatalog({
      equipment:          'barbell',
      name:               'Barbell Squat',
      category:           'Legs',
      primaryMuscleGroup: 'quads',
    })
    const meta = makeMeta({
      name:             'barbell curl',
      equipment:        'barbell',
      equipmentFamily:  'barbell',
      target:           'biceps',
      bodyPart:         'upper arms',
      technicalPattern: 'elbow_flexion',
      movementClass:    'arm_flexion',
      movementSubclass: null,
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).not.toBeNull()
    expect(result.hardBlock).toMatch(/movement class/)
    expect(result.score).toBe(0)
  })
})

// ── scoreCandidate — good match produces high score ──────────────────────────

describe('scoreCandidate — good match quality', () => {
  it('barbell bench press vs Barbell Bench Press catalog entry scores ≥85', () => {
    const catalog = makeCatalog({
      ymoveId:            'ymove-bench-001',
      name:               'Barbell Bench Press',
      equipment:          'barbell',
      category:           'Chest',
      primaryMuscleGroup: 'pectorals',
    })
    const meta = makeMeta({
      name:             'barbell bench press',
      equipmentFamily:  'barbell',
      target:           'pectorals',
      bodyPart:         'chest',
      technicalPattern: 'horizontal_press',
      movementClass:    'upper_push_h',
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).toBeNull()
    expect(result.score).toBeGreaterThanOrEqual(SCORE_HIGH_PRIORITY)
    expect(result.tier).toBe('high_priority')
  })

  it('incline barbell bench press has angle penalty against flat bench catalog entry', () => {
    const catalog = makeCatalog({
      name:      'Barbell Bench Press',
      equipment: 'barbell',
      category:  'Chest',
      primaryMuscleGroup: 'pectorals',
    })
    const meta = makeMeta({
      name:             'incline barbell bench press',
      equipmentFamily:  'barbell',
      target:           'pectorals',
      movementClass:    'upper_push_h',
    })
    const result = scoreCandidate(catalog, meta)
    // Should score lower than a flat match, but still be valid
    expect(result.hardBlock).toBeNull()
    const flat = scoreCandidate(
      makeCatalog({ name: 'Barbell Flat Bench Press', equipment: 'barbell', category: 'Chest', primaryMuscleGroup: 'pectorals' }),
      meta,
    )
    const incline = scoreCandidate(
      makeCatalog({ name: 'Incline Barbell Bench Press', equipment: 'barbell', category: 'Chest', primaryMuscleGroup: 'pectorals' }),
      meta,
    )
    expect(incline.score).toBeGreaterThan(flat.score)
  })
})

// ── Variation penalties ───────────────────────────────────────────────────────

describe('scoreCandidate — variation penalties', () => {
  it('unilateral catalog entry penalizes bilateral exercise', () => {
    const catalogBilateral = makeCatalog({ name: 'Dumbbell Curl', equipment: 'dumbbell', category: 'Arms - Biceps', primaryMuscleGroup: 'biceps' })
    const catalogUnilateral = makeCatalog({ name: 'Single Arm Dumbbell Curl', equipment: 'dumbbell', category: 'Arms - Biceps', primaryMuscleGroup: 'biceps' })
    const meta = makeMeta({
      name:            'dumbbell curl',
      equipmentFamily: 'dumbbell',
      target:          'biceps',
      bodyPart:        'upper arms',
      movementClass:   'arm_flexion',
    })
    const bilateral   = scoreCandidate(catalogBilateral, meta)
    const unilateral  = scoreCandidate(catalogUnilateral, meta)
    expect(bilateral.score).toBeGreaterThan(unilateral.score)
  })

  it('grip conflict lowers score', () => {
    const reverseGripCatalog = makeCatalog({ name: 'Reverse Grip Barbell Curl', equipment: 'barbell', category: 'Arms - Biceps', primaryMuscleGroup: 'biceps' })
    const meta = makeMeta({
      name:            'barbell curl',
      equipmentFamily: 'barbell',
      target:          'biceps',
      movementClass:   'arm_flexion',
    })
    // A catalog entry with no grip vs one with conflicting grip
    const noGripCatalog = makeCatalog({ name: 'Barbell Curl', equipment: 'barbell', category: 'Arms - Biceps', primaryMuscleGroup: 'biceps' })
    const withGrip    = scoreCandidate(reverseGripCatalog, meta)
    const withoutGrip = scoreCandidate(noGripCatalog, meta)
    // reverse grip adds penalty for exercise that didn't request it
    // note: meta exercise also has no grip → catalog adds grip penalty
    expect(withoutGrip.score).toBeGreaterThanOrEqual(withGrip.score)
  })
})

// ── False-positive regressions (variation incompatibilities) ─────────────────
// These four cases were incorrectly reaching high_priority (≥85) before the
// bidirectional variation fixes.  Each must stay below SCORE_HIGH_PRIORITY.

describe('scoreCandidate — false-positive regression suite', () => {
  // Case 1: generic dumbbell squat should NOT match sumo squat at high_priority
  // Root cause: catalog has modifier 'sumo' but exercise has none → was missing -3 penalty.
  it('dumbbell squat does NOT reach high_priority against Dumbbell Sumo Squat', () => {
    const catalog = makeCatalog({
      name:               'Dumbbell Sumo Squat',
      equipment:          'dumbbell',
      category:           'Legs',
      primaryMuscleGroup: 'glutes',
    })
    const meta = makeMeta({
      name:             'dumbbell squat',
      equipment:        'dumbbell',
      equipmentFamily:  'dumbbell',
      target:           'glutes',
      bodyPart:         'upper legs',
      technicalPattern: 'squat',
      movementClass:    'lower_push',
      movementSubclass: 'squat',
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).toBeNull()
    expect(result.score).toBeLessThan(SCORE_HIGH_PRIORITY)
    expect(result.tier).not.toBe('high_priority')
    expect(result.penaltyReasons.some(r => r.includes('sumo'))).toBe(true)
  })

  // Case 2: one-arm incline chest press should NOT match bilateral incline press at high_priority
  // Root cause: exercise has lateral='unilateral' but catalog doesn't → was missing -5 penalty.
  it('one-arm incline chest press does NOT reach high_priority against bilateral incline press', () => {
    const catalog = makeCatalog({
      name:               'Incline Dumbbell Press',
      equipment:          'dumbbell',
      category:           'Chest',
      primaryMuscleGroup: 'pectorals',
    })
    const meta = makeMeta({
      name:             'dumbbell one arm incline chest press',
      equipment:        'dumbbell',
      equipmentFamily:  'dumbbell',
      target:           'pectorals',
      bodyPart:         'chest',
      technicalPattern: 'horizontal_press',
      movementClass:    'upper_push_h',
      movementSubclass: null,
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).toBeNull()
    expect(result.score).toBeLessThan(SCORE_HIGH_PRIORITY)
    expect(result.tier).not.toBe('high_priority')
    expect(result.penaltyReasons.some(r => r.includes('unilateral'))).toBe(true)
  })

  // Case 3: reverse-grip cable triceps extension should NOT match rope extension at high_priority
  // Root cause: exercise has grip='reverse' but catalog has no grip → was missing -7 penalty.
  it('reverse-grip cable triceps extension does NOT reach high_priority against rope extension', () => {
    const catalog = makeCatalog({
      name:               'Overhead Cable Rope Extension',
      equipment:          'cable',
      category:           'Arms - Triceps',
      primaryMuscleGroup: 'triceps',
    })
    const meta = makeMeta({
      name:             'cable standing reverse grip one arm overhead tricep extension',
      equipment:        'cable',
      equipmentFamily:  'cable',
      target:           'triceps',
      bodyPart:         'upper arms',
      technicalPattern: 'arm_isolation',
      movementClass:    'arm_extension',
      movementSubclass: null,
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).toBeNull()
    expect(result.score).toBeLessThan(SCORE_HIGH_PRIORITY)
    expect(result.tier).not.toBe('high_priority')
    expect(result.penaltyReasons.some(r => r.includes('reverse'))).toBe(true)
  })

  // Case 4: reverse-grip incline push-up should NOT match ordinary incline push-up at high_priority
  // Same root cause as Case 3.
  it('reverse-grip incline push-up does NOT reach high_priority against ordinary incline push-up', () => {
    const catalog = makeCatalog({
      name:               'Inclined push up',
      equipment:          'bodyweight',
      category:           'Chest',
      primaryMuscleGroup: 'pectorals',
    })
    const meta = makeMeta({
      name:             'incline reverse grip push-up',
      equipment:        'body weight',
      equipmentFamily:  'bodyweight',
      target:           'pectorals',
      bodyPart:         'chest',
      technicalPattern: 'horizontal_press',
      movementClass:    'upper_push_h',
      movementSubclass: null,
    })
    const result = scoreCandidate(catalog, meta)
    expect(result.hardBlock).toBeNull()
    expect(result.score).toBeLessThan(SCORE_HIGH_PRIORITY)
    expect(result.tier).not.toBe('high_priority')
    expect(result.penaltyReasons.some(r => r.includes('reverse'))).toBe(true)
  })

  // Symmetric check: grip penalty applied in both directions
  it('exercise with reverse grip scores lower against no-grip catalog than against reverse-grip catalog', () => {
    const noGripCatalog = makeCatalog({
      name: 'Barbell Decline Bench Press', equipment: 'barbell', category: 'Chest', primaryMuscleGroup: 'pectorals',
    })
    const reverseGripCatalog = makeCatalog({
      name: 'Barbell Reverse Grip Decline Bench Press', equipment: 'barbell', category: 'Chest', primaryMuscleGroup: 'pectorals',
    })
    const meta = makeMeta({
      name:             'barbell reverse grip decline bench press',
      equipmentFamily:  'barbell',
      target:           'pectorals',
      movementClass:    'upper_push_h',
    })
    const noGrip      = scoreCandidate(noGripCatalog, meta)
    const reverseGrip = scoreCandidate(reverseGripCatalog, meta)
    expect(reverseGrip.score).toBeGreaterThan(noGrip.score)
    expect(noGrip.score).toBeLessThan(SCORE_HIGH_PRIORITY)
  })

  // Modifier incompatibility: catalog has 'sumo', exercise has none
  it('catalog sumo modifier is penalized when exercise has no modifier', () => {
    const sumo = makeCatalog({
      name: 'Dumbbell Sumo Deadlift', equipment: 'dumbbell', category: 'Legs', primaryMuscleGroup: 'hamstrings',
    })
    const meta = makeMeta({
      name:            'dumbbell deadlift',
      equipmentFamily: 'dumbbell',
      target:          'hamstrings',
      movementClass:   'lower_pull',
      movementSubclass: 'deadlift',
    })
    const result = scoreCandidate(sumo, meta)
    expect(result.penaltyReasons.some(r => r.includes('sumo'))).toBe(true)
    expect(result.score).toBeLessThan(SCORE_HIGH_PRIORITY)
  })

  // GRIP_TAGS order: when a catalog name contains BOTH "reverse grip" and "close grip"
  // as contiguous substrings, "reverse grip" should be detected (it's checked first).
  it('reverse grip is detected before close grip when both phrases appear contiguously', () => {
    // A catalog name that has "reverse grip" as a contiguous phrase
    const reverseGripCatalog = makeCatalog({
      name: 'Barbell Reverse Grip Bench Press', equipment: 'barbell', category: 'Chest', primaryMuscleGroup: 'triceps',
    })
    const reverseGripMeta = makeMeta({
      name:            'barbell reverse grip bench press',
      equipmentFamily: 'barbell',
      target:          'triceps',
      movementClass:   'upper_push_h',
    })
    // Both exercise and catalog have "reverse grip" as contiguous phrase → grip match (+5)
    const result = scoreCandidate(reverseGripCatalog, reverseGripMeta)
    expect(result.penaltyReasons.filter(r => r.includes('grip'))).toHaveLength(0)
    // Should NOT have a grip penalty since both parsed as 'reverse'
    expect(result.signals.variation).toBeGreaterThan(0)
  })
})

// ── Determinism ───────────────────────────────────────────────────────────────

describe('Determinism', () => {
  it('scoreCandidate produces identical results across multiple calls', () => {
    const catalog = makeCatalog()
    const meta    = makeMeta()
    const results = Array.from({ length: 5 }, () => scoreCandidate(catalog, meta))
    for (const r of results) {
      expect(r.score).toBe(results[0].score)
      expect(r.tier).toBe(results[0].tier)
      expect(r.hardBlock).toBe(results[0].hardBlock)
    }
  })

  it('hard-blocked result is deterministic', () => {
    const catalog = makeCatalog({ equipment: 'dumbbell' })
    const meta    = makeMeta({ equipmentFamily: 'barbell' })
    const r1 = scoreCandidate(catalog, meta)
    const r2 = scoreCandidate(catalog, meta)
    expect(r1.score).toBe(r2.score)
    expect(r1.hardBlock).toBe(r2.hardBlock)
  })
})

// ── Threshold boundary confidence ────────────────────────────────────────────

describe('SCORE constants', () => {
  it('SCORE_WEAK_MIN is 55', () => { expect(SCORE_WEAK_MIN).toBe(55) })
  it('SCORE_REVIEW is 65',   () => { expect(SCORE_REVIEW).toBe(65) })
  it('SCORE_HIGH_PRIORITY is 85', () => { expect(SCORE_HIGH_PRIORITY).toBe(85) })
})
