import { describe, it, expect } from 'vitest'
import { classifyYmoveExercise, type CatalogRowForClassify } from '../../lib/ymove/classify'

function row(name: string, equipment: string | null = null, category: string | null = null): CatalogRowForClassify {
  return { name, equipment, category }
}

// ── Equipment resolution ──────────────────────────────────────────────────────

describe('classifyYmoveExercise — equipment', () => {
  it('resolves known catalog equipment strings', () => {
    expect(classifyYmoveExercise(row('Barbell Squat', 'Barbell')).eqFamily).toBe('barbell')
    expect(classifyYmoveExercise(row('Dumbbell Curl', 'Dumbbell')).eqFamily).toBe('dumbbell')
    expect(classifyYmoveExercise(row('Cable Row', 'Cable')).eqFamily).toBe('cable')
    expect(classifyYmoveExercise(row('Machine Press', 'Machine')).eqFamily).toBe('machine')
    expect(classifyYmoveExercise(row('Kettlebell Swing', 'Kettlebell')).eqFamily).toBe('kettlebell')
    expect(classifyYmoveExercise(row('Band Pull-Apart', 'Band')).eqFamily).toBe('band')
    expect(classifyYmoveExercise(row('Push-up', 'Bodyweight')).eqFamily).toBe('bodyweight')
    expect(classifyYmoveExercise(row('Smith Squat', 'Smith Machine')).eqFamily).toBe('smith')
    expect(classifyYmoveExercise(row('Trap Bar Deadlift', 'Trap Bar')).eqFamily).toBe('trap_bar')
  })

  it('infers equipment from name when catalog field is null', () => {
    const r = classifyYmoveExercise(row('Dumbbell Bench Press', null))
    expect(r.eqFamily).toBe('dumbbell')
    expect(r.eqSource).toBe('name_inferred')
  })

  it('returns eqFamily null and eqSource unknown for unrecognised equipment', () => {
    const r = classifyYmoveExercise(row('Wiffle Ball Toss', 'Wiffle Ball'))
    expect(r.eqFamily).toBeNull()
    expect(r.eqSource).toBe('unknown')
  })

  it('returns eqSource unknown when both catalog and name provide nothing', () => {
    const r = classifyYmoveExercise(row('Stretch Hold', null))
    expect(r.eqSource).toBe('unknown')
  })

  it('prefers catalog equipment over name inference', () => {
    // Catalog says "Cable", name says "Dumbbell"
    const r = classifyYmoveExercise(row('Dumbbell-like Cable Fly', 'Cable'))
    expect(r.eqFamily).toBe('cable')
    expect(r.eqSource).toBe('catalog')
  })
})

// ── Movement class ────────────────────────────────────────────────────────────

describe('classifyYmoveExercise — movement class', () => {
  it('classifies lower-body patterns', () => {
    expect(classifyYmoveExercise(row('Barbell Back Squat', 'Barbell', 'Legs')).movementClass).toBe('lower_push')
    expect(classifyYmoveExercise(row('Romanian Deadlift', 'Barbell', 'Legs')).movementClass).toBe('lower_pull')
    expect(classifyYmoveExercise(row('Hamstring Curl', 'Machine', 'Legs')).movementClass).toBe('lower_pull')
    expect(classifyYmoveExercise(row('Hip Thrust', 'Barbell')).movementClass).toBe('lower_push')
  })

  it('classifies upper-push patterns', () => {
    expect(classifyYmoveExercise(row('Bench Press', 'Barbell', 'Chest')).movementClass).toBe('upper_push_h')
    expect(classifyYmoveExercise(row('Overhead Press', 'Barbell', 'Shoulders')).movementClass).toBe('upper_push_v')
    expect(classifyYmoveExercise(row('Push-Up', 'Bodyweight')).movementClass).toBe('upper_push_h')
  })

  it('classifies upper-pull patterns', () => {
    expect(classifyYmoveExercise(row('Barbell Row', 'Barbell', 'Back')).movementClass).toBe('upper_pull_h')
    expect(classifyYmoveExercise(row('Lat Pulldown', 'Cable', 'Pull')).movementClass).toBe('upper_pull_v')
    expect(classifyYmoveExercise(row('Pull-Up', 'Bodyweight')).movementClass).toBe('upper_pull_v')
  })

  it('classifies arm isolation patterns', () => {
    expect(classifyYmoveExercise(row('Bicep Curl', 'Dumbbell', 'Arms - Biceps')).movementClass).toBe('arm_flexion')
    expect(classifyYmoveExercise(row('Tricep Pushdown', 'Cable', 'Arms - Triceps')).movementClass).toBe('arm_extension')
  })

  it('classifies shoulder isolation', () => {
    expect(classifyYmoveExercise(row('Lateral Raise', 'Dumbbell', 'Shoulders')).movementClass).toBe('shoulder_isolation')
    expect(classifyYmoveExercise(row('Face Pull', 'Cable', 'Shoulders')).movementClass).toBe('shoulder_isolation')
  })

  it('classifies core exercises', () => {
    expect(classifyYmoveExercise(row('Plank', 'Bodyweight', 'Core')).movementClass).toBe('core')
    expect(classifyYmoveExercise(row('Crunch', 'Bodyweight', 'CORE')).movementClass).toBe('core')
  })

  it('returns unknown for genuinely ambiguous exercises', () => {
    const r = classifyYmoveExercise(row('Random Warm-up Drill', null, null))
    expect(r.movementClass).toBe('unknown')
  })
})

// ── Movement family ───────────────────────────────────────────────────────────

describe('classifyYmoveExercise — movement family', () => {
  it('maps squats to fam_squat', () => {
    expect(classifyYmoveExercise(row('Barbell Back Squat', 'Barbell', 'Legs')).movementFamilyId).toBe('fam_squat')
    expect(classifyYmoveExercise(row('Goblet Squat', 'Kettlebell')).movementFamilyId).toBe('fam_squat')
  })

  it('maps lunges to fam_lunge', () => {
    expect(classifyYmoveExercise(row('Dumbbell Lunge', 'Dumbbell')).movementFamilyId).toBe('fam_lunge')
    expect(classifyYmoveExercise(row('Bulgarian Split Squat', 'Barbell')).movementFamilyId).toBe('fam_lunge')
  })

  it('maps hip hinges to fam_hip_hinge', () => {
    expect(classifyYmoveExercise(row('Conventional Deadlift', 'Barbell')).movementFamilyId).toBe('fam_hip_hinge')
    expect(classifyYmoveExercise(row('Romanian Deadlift', 'Barbell')).movementFamilyId).toBe('fam_hip_hinge')
    expect(classifyYmoveExercise(row('Good Morning', 'Barbell')).movementFamilyId).toBe('fam_hip_hinge')
  })

  it('maps chest presses to fam_chest_press', () => {
    expect(classifyYmoveExercise(row('Barbell Bench Press', 'Barbell', 'Chest')).movementFamilyId).toBe('fam_chest_press')
    expect(classifyYmoveExercise(row('Incline Dumbbell Press', 'Dumbbell', 'Chest')).movementFamilyId).toBe('fam_chest_press')
  })

  it('maps flies and dips to fam_chest', () => {
    expect(classifyYmoveExercise(row('Dumbbell Fly', 'Dumbbell', 'Chest')).movementFamilyId).toBe('fam_chest')
    expect(classifyYmoveExercise(row('Parallel Bar Dip', 'Bodyweight')).movementFamilyId).toBe('fam_chest')
  })

  it('maps overhead press to fam_overhead_press', () => {
    expect(classifyYmoveExercise(row('Overhead Press', 'Barbell', 'Shoulders')).movementFamilyId).toBe('fam_overhead_press')
  })

  it('maps rows to fam_row', () => {
    expect(classifyYmoveExercise(row('Barbell Bent Over Row', 'Barbell', 'Back')).movementFamilyId).toBe('fam_row')
  })

  it('maps pulldowns/pullups to fam_pulldown_pullup', () => {
    expect(classifyYmoveExercise(row('Lat Pulldown', 'Cable', 'Pull')).movementFamilyId).toBe('fam_pulldown_pullup')
    expect(classifyYmoveExercise(row('Pull-Up', 'Bodyweight')).movementFamilyId).toBe('fam_pulldown_pullup')
  })

  it('maps curl and extension to fam_arms', () => {
    expect(classifyYmoveExercise(row('Barbell Bicep Curl', 'Barbell', 'Arms - Biceps')).movementFamilyId).toBe('fam_arms')
    expect(classifyYmoveExercise(row('Tricep Extension', 'Dumbbell', 'Arms - Triceps')).movementFamilyId).toBe('fam_arms')
  })

  it('maps shoulders isolation to fam_shoulders', () => {
    expect(classifyYmoveExercise(row('Dumbbell Lateral Raise', 'Dumbbell', 'Shoulders')).movementFamilyId).toBe('fam_shoulders')
  })

  it('maps core to fam_core', () => {
    expect(classifyYmoveExercise(row('Plank', 'Bodyweight', 'Core')).movementFamilyId).toBe('fam_core')
  })

  it('returns null movementFamilyId for truly unknown exercises', () => {
    const r = classifyYmoveExercise(row('Unknown Drill', null, null))
    expect(r.movementFamilyId).toBeNull()
    expect(r.confidence).toBe('low')
  })
})

// ── Variation detection ───────────────────────────────────────────────────────

describe('classifyYmoveExercise — variation tags', () => {
  it('detects incline / decline / flat plane variations', () => {
    expect(classifyYmoveExercise(row('Incline Barbell Press')).variations).toContain('incline')
    expect(classifyYmoveExercise(row('Decline Dumbbell Press')).variations).toContain('decline')
    expect(classifyYmoveExercise(row('Flat Dumbbell Fly')).variations).toContain('flat')
  })

  it('detects grip variations — reverse grip before close grip', () => {
    expect(classifyYmoveExercise(row('Reverse Grip Bench Press')).variations).toContain('reverse_grip')
    expect(classifyYmoveExercise(row('Close Grip Bench Press')).variations).toContain('close_grip')
    expect(classifyYmoveExercise(row('Wide Grip Pull-Up')).variations).toContain('wide_grip')
    expect(classifyYmoveExercise(row('Neutral Grip Pull-Up')).variations).toContain('neutral_grip')
  })

  it('detects sumo and position modifiers', () => {
    expect(classifyYmoveExercise(row('Sumo Deadlift')).variations).toContain('sumo')
    expect(classifyYmoveExercise(row('Seated Dumbbell Press')).variations).toContain('seated')
    expect(classifyYmoveExercise(row('Standing Cable Curl')).variations).toContain('standing')
  })

  it('detects unilateral / alternating', () => {
    expect(classifyYmoveExercise(row('Single Arm Dumbbell Row')).variations).toContain('unilateral')
    expect(classifyYmoveExercise(row('Alternating Dumbbell Curl')).variations).toContain('alternating')
  })

  it('returns empty array for basic exercises with no variation keywords', () => {
    expect(classifyYmoveExercise(row('Barbell Back Squat', 'Barbell')).variations).toEqual([])
  })
})

// ── Confidence ────────────────────────────────────────────────────────────────

describe('classifyYmoveExercise — confidence', () => {
  it('is high when class and family are known and equipment is from catalog', () => {
    const r = classifyYmoveExercise(row('Barbell Bench Press', 'Barbell', 'Chest'))
    expect(r.confidence).toBe('high')
  })

  it('is medium when equipment must be inferred from name', () => {
    const r = classifyYmoveExercise(row('Dumbbell Row', null, 'Back'))
    expect(r.confidence).toBe('medium')
  })

  it('is low when movement class is unknown', () => {
    const r = classifyYmoveExercise(row('Mystery Drill', null, null))
    expect(r.confidence).toBe('low')
  })

  it('is low when movement family cannot be determined', () => {
    const r = classifyYmoveExercise(row('Unknown Exercise', null, null))
    expect(r.movementFamilyId).toBeNull()
    expect(r.confidence).toBe('low')
  })
})
