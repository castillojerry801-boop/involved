import { describe, it, expect } from 'vitest'
import {
  normalizeEquipmentList,
  extractEquipmentFromConversation,
  getCapableMovementPatterns,
  buildEquipmentCapabilitySummary,
} from '@/lib/v/equipment-normalize'

describe('normalizeEquipmentList', () => {
  it('normalizes the Set 1 production failure case', () => {
    const result = normalizeEquipmentList(
      'squat rack, lever bench press, dumbbells, kettlebells, leg extension and curl machine, Airdyne, treadmill, rower, cable crossover, jump box'
    )
    expect(result).toContain('barbell')
    expect(result).toContain('leverage machine')
    expect(result).toContain('dumbbell')
    expect(result).toContain('kettlebell')
    expect(result).toContain('stationary bike')
    // rower intentionally NOT mapped — no rowing machine exercises exist in ExerciseDB;
    // mapping to 'skierg machine' was wrong (that DB category has only 1 ski erg exercise).
    expect(result).not.toContain('skierg machine')
    expect(result).toContain('cable')
    expect(result).toContain('body weight')
  })

  it('normalizes the Set 2 production failure case', () => {
    const result = normalizeEquipmentList(
      'dumbbells, barbell, kettlebells, bench, pull-up bar, resistance bands, bodyweight'
    )
    expect(result).toContain('dumbbell')
    expect(result).toContain('barbell')
    expect(result).toContain('kettlebell')
    // 'resistance bands' normalises to 'band' (56 exercises) not 'resistance band' (13 exercises)
    expect(result).toContain('band')
    expect(result).toContain('body weight')
  })

  it('always includes body weight even when not listed', () => {
    const result = normalizeEquipmentList('barbell')
    expect(result).toContain('body weight')
  })

  it('deduplicates canonical values', () => {
    const result = normalizeEquipmentList('squat rack, barbell, power rack')
    const barbell = result.filter(e => e === 'barbell')
    expect(barbell.length).toBe(1)
  })

  it('handles newline-separated input', () => {
    const result = normalizeEquipmentList('dumbbells\nkettlebells\ncable machine')
    expect(result).toContain('dumbbell')
    expect(result).toContain('kettlebell')
    expect(result).toContain('cable')
  })

  it('handles airdyne / air dyne variations', () => {
    expect(normalizeEquipmentList('Airdyne')).toContain('stationary bike')
    expect(normalizeEquipmentList('air dyne')).toContain('stationary bike')
    expect(normalizeEquipmentList('air bike')).toContain('stationary bike')
    expect(normalizeEquipmentList('assault bike')).toContain('stationary bike')
  })

  it('rower is intentionally not mapped to skierg machine', () => {
    // No rowing machine equipment category exists in ExerciseDB.
    // 'skierg machine' has only one exercise (ski ergometer) — not a rowing machine.
    // Rower/rowing machine/Concept2 drops silently so searches are not polluted.
    expect(normalizeEquipmentList('rower')).not.toContain('skierg machine')
    expect(normalizeEquipmentList('rowing machine')).not.toContain('skierg machine')
    expect(normalizeEquipmentList('Concept 2')).not.toContain('skierg machine')
    // body weight is always present
    expect(normalizeEquipmentList('rower')).toContain('body weight')
  })

  it('handles leverage machine variations', () => {
    expect(normalizeEquipmentList('leg extension')).toContain('leverage machine')
    expect(normalizeEquipmentList('leg curl')).toContain('leverage machine')
    expect(normalizeEquipmentList('leg press')).toContain('leverage machine')
    expect(normalizeEquipmentList('leg extension and curl machine')).toContain('leverage machine')
    expect(normalizeEquipmentList('lever bench press')).toContain('leverage machine')
  })

  it('handles cable variations', () => {
    expect(normalizeEquipmentList('cable crossover')).toContain('cable')
    expect(normalizeEquipmentList('cables')).toContain('cable')
    expect(normalizeEquipmentList('cable machine')).toContain('cable')
    expect(normalizeEquipmentList('cable station')).toContain('cable')
  })

  it('maps pull-up bar to body weight', () => {
    const result = normalizeEquipmentList('pull-up bar')
    expect(result).toContain('body weight')
  })

  it('maps jump box to body weight', () => {
    const result = normalizeEquipmentList('jump box')
    expect(result).toContain('body weight')
  })

  it('maps treadmill to body weight', () => {
    const result = normalizeEquipmentList('treadmill')
    expect(result).toContain('body weight')
  })

  it('handles resistance band variations — all normalise to "band"', () => {
    // 'band' has 56 ExerciseDB exercises; 'resistance band' has 13.
    // All user mentions normalise to 'band' for the larger search pool.
    expect(normalizeEquipmentList('resistance bands')).toContain('band')
    expect(normalizeEquipmentList('elastic bands')).toContain('band')
    expect(normalizeEquipmentList('bands')).toContain('band')
    expect(normalizeEquipmentList('loop bands')).toContain('band')
  })

  it('handles ez bar', () => {
    expect(normalizeEquipmentList('ez bar')).toContain('ez barbell')
    expect(normalizeEquipmentList('EZ-bar')).toContain('ez barbell')
    expect(normalizeEquipmentList('curl bar')).toContain('ez barbell')
  })

  it('handles trap bar', () => {
    expect(normalizeEquipmentList('trap bar')).toContain('trap bar')
    expect(normalizeEquipmentList('hex bar')).toContain('trap bar')
  })
})

describe('extractEquipmentFromConversation', () => {
  it('extracts equipment from a realistic intake response', () => {
    const text = `V: What equipment do you have available at home?
User: I have a squat rack, lever bench press, dumbbells, kettlebells, leg extension and curl machine, Airdyne, treadmill, rower, cable crossover, and a jump box.`
    const result = extractEquipmentFromConversation(text)
    expect(result).not.toBeNull()
    expect(result).toContain('barbell')
    expect(result).toContain('leverage machine')
    expect(result).toContain('dumbbell')
    expect(result).toContain('kettlebell')
    expect(result).toContain('stationary bike')
    // rower → no canonical mapping (see normalizeEquipmentList rower test)
    expect(result).not.toContain('skierg machine')
    expect(result).toContain('cable')
    expect(result).toContain('body weight')
  })

  it('extracts from set 2 intake response', () => {
    const text = 'I have dumbbells, barbell, kettlebells, bench, pull-up bar, resistance bands, and bodyweight'
    const result = extractEquipmentFromConversation(text)
    expect(result).not.toBeNull()
    expect(result).toContain('dumbbell')
    expect(result).toContain('barbell')
    expect(result).toContain('kettlebell')
    // 'resistance bands' normalises to 'band'
    expect(result).toContain('band')
    expect(result).toContain('body weight')
  })

  it('returns null when "full gym" is stated (no restriction)', () => {
    const text = 'I train at a full gym'
    expect(extractEquipmentFromConversation(text)).toBeNull()
  })

  it('returns null when "commercial gym" is stated', () => {
    const text = 'I go to a commercial gym'
    expect(extractEquipmentFromConversation(text)).toBeNull()
  })

  it('returns null when no equipment is mentioned', () => {
    const text = 'I want to build muscle and get stronger'
    expect(extractEquipmentFromConversation(text)).toBeNull()
  })

  it('always includes body weight when equipment is found', () => {
    const text = 'I have dumbbells'
    const result = extractEquipmentFromConversation(text)
    expect(result).toContain('body weight')
  })
})

describe('getCapableMovementPatterns', () => {
  it('dumbbell + body weight covers all major patterns', () => {
    const patterns = getCapableMovementPatterns(['dumbbell', 'body weight'])
    expect(patterns.has('horizontal_push')).toBe(true)
    expect(patterns.has('hinge')).toBe(true)
    expect(patterns.has('squat')).toBe(true)
    expect(patterns.has('vertical_pull')).toBe(true)
    expect(patterns.has('lunge')).toBe(true)
  })

  it('barbell + dumbbell + cable covers full strength patterns', () => {
    const patterns = getCapableMovementPatterns(['barbell', 'dumbbell', 'cable'])
    expect(patterns.has('horizontal_push')).toBe(true)
    expect(patterns.has('vertical_push')).toBe(true)
    expect(patterns.has('bicep')).toBe(true)
    expect(patterns.has('core_antiextension')).toBe(true)
  })

  it('always includes body weight patterns regardless of input', () => {
    const patterns = getCapableMovementPatterns([])
    expect(patterns.has('horizontal_push')).toBe(true)  // push-ups
    expect(patterns.has('squat')).toBe(true)             // bodyweight squat
  })

  it('stationary bike adds cardio pattern', () => {
    const patterns = getCapableMovementPatterns(['stationary bike'])
    expect(patterns.has('cardio')).toBe(true)
  })

  it('leverage machine enables squat, hinge, and bicep patterns', () => {
    const patterns = getCapableMovementPatterns(['leverage machine'])
    expect(patterns.has('squat')).toBe(true)
    expect(patterns.has('hinge')).toBe(true)
    expect(patterns.has('bicep')).toBe(true)
  })

  it('full gym setup covers all training modalities', () => {
    const patterns = getCapableMovementPatterns([
      'barbell', 'dumbbell', 'cable', 'leverage machine', 'kettlebell',
      'stationary bike', 'skierg machine',
    ])
    expect(patterns.has('olympic_power')).toBe(true)
    expect(patterns.has('cardio')).toBe(true)
    expect(patterns.has('bicep')).toBe(true)
    expect(patterns.has('hinge')).toBe(true)
  })
})

describe('buildEquipmentCapabilitySummary', () => {
  it('produces a non-empty summary for a home gym', () => {
    const summary = buildEquipmentCapabilitySummary(['dumbbell', 'barbell', 'body weight'])
    expect(summary).toContain('AVAILABLE EQUIPMENT')
    expect(summary).toContain('ENABLED MOVEMENT PATTERNS')
    expect(summary).toContain('compound strength')
  })

  it('lists exact canonical equipment names', () => {
    const summary = buildEquipmentCapabilitySummary(['dumbbell', 'cable', 'leverage machine'])
    expect(summary).toContain('dumbbell')
    expect(summary).toContain('cable')
    expect(summary).toContain('leverage machine')
  })

  it('mentions cardio capability when cardio equipment is present', () => {
    const summary = buildEquipmentCapabilitySummary(['stationary bike', 'skierg machine'])
    expect(summary).toContain('Cardio')
  })

  it('includes instruction for using canonical names in search', () => {
    const summary = buildEquipmentCapabilitySummary(['dumbbell'])
    expect(summary).toContain('canonical equipment names')
  })
})
