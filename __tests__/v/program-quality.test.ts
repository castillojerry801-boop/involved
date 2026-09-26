/**
 * V Program Engine V2 — quality validator tests
 *
 * Tests the deterministic validateProgramQuality() function.
 * No AI calls, no DB — pure logic on draft structures.
 *
 * Scenarios:
 *   1 — Spartan missing carries → OCR_MISSING_CARRIES warning
 *   2 — Spartan missing pulls  → OCR_MISSING_PULLS warning
 *   3 — Spartan stationary-bike-only cardio → OCR_CARDIO_ONLY_BIKE warning
 *   4 — Powerlifting no progression (12 weeks) → NO_PROGRESSION error + NO_PHASES error
 *   5 — Powerlifting contradictory peak+deload phases → POWERLIFTING_PEAK_DELOAD_CONFLICT error
 *   6 — Beginner runner >3 run days in short program → BEGINNER_RUNNING_OVERLOAD error
 *   7 — Beginner runner with early intervals in notes → BEGINNER_INTERVALS_TOO_SOON warning
 *   8 — Clean program passes with zero issues
 *   9 — Load anchor computation: squat 183.7 kg 1RM, 70% ≈ 128.6 kg
 *  10 — 12-week powerlifting with no phases → POWERLIFTING_NO_PHASES error
 *  11 — week_progressions week exceeding program weeks → validator error
 *  12 — Identical/empty notes across all exercises → IDENTICAL_WEEK_NOTES warning
 */

import { describe, it, expect } from 'vitest'
import { validateProgramQuality } from '../../lib/v/program-quality'
import { isPowerliftingMovement, buildLoadAnchors } from '../../lib/v/training-context'
import type { ProgramDraft } from '../../lib/ai/tools/program'
import { validateProgramDraft } from '../../lib/ai/tools/program'

// ─── Minimal valid exercise stubs (use real IDs from exercises.json) ──────────
// 0662 push-up         → horizontal_push
// 0652 pull-up         → vertical_pull
// 3561 glute bridge march → hinge
// 3470 forward lunge   → lunge
// 0464 front plank twist → core_antiextension

function makeExercise(
  exercise_id = '0662',
  intended_pattern = 'horizontal_push',
  overrides: Record<string, unknown> = {}
) {
  return {
    exercise_id,
    intended_pattern,
    sets: 3,
    reps_min: 8,
    reps_max: 12,
    rest_seconds: 90,
    ...overrides,
  }
}

function makeDay(name: string, exercises = [makeExercise()], overrides: Record<string, unknown> = {}) {
  return {
    name,
    estimated_duration_minutes: 45,
    exercises,
    ...overrides,
  }
}

// ─── Scenario 1 — Spartan missing carries ─────────────────────────────────────

describe('Scenario 1 — Spartan missing carries → OCR_MISSING_CARRIES warning', () => {
  const draft: ProgramDraft = {
    program_name: 'Spartan Sprint Prep',
    description: 'OCR prep without any loaded carries',
    weeks: 8,
    phases: [{ name: 'Base', weeks: '1-4', focus: 'aerobic base' }, { name: 'Build', weeks: '5-8', focus: 'specificity' }],
    progression_strategy: 'Add 10% volume per week phases 1-4',
    days: [
      makeDay('Run Day', [makeExercise('0662', 'horizontal_push', { notes: 'run 30 min easy' })]),
      makeDay('Strength Day', [makeExercise('0652', 'vertical_pull'), makeExercise('3561', 'hinge'), makeExercise('3470', 'lunge')]),
    ],
  }

  it('reports OCR_MISSING_CARRIES as warning', () => {
    const issues = validateProgramQuality(draft, { sport: 'OCR', weeks: 8 })
    const codes = issues.map(i => i.code)
    expect(codes).toContain('OCR_MISSING_CARRIES')
  })

  it('is a warning, not an error', () => {
    const issues = validateProgramQuality(draft, { sport: 'spartan race', weeks: 8 })
    const carry = issues.find(i => i.code === 'OCR_MISSING_CARRIES')
    expect(carry?.severity).toBe('warning')
  })
})

// ─── Scenario 2 — Spartan missing pulls ───────────────────────────────────────

describe('Scenario 2 — Spartan missing pulls → OCR_MISSING_PULLS warning', () => {
  // Only horizontal_push and hinge patterns — no pulling
  const draft: ProgramDraft = {
    program_name: 'Spartan No Pulls',
    description: 'OCR prep missing pulling movements',
    weeks: 8,
    phases: [{ name: 'Base', weeks: '1-4', focus: 'base' }, { name: 'Build', weeks: '5-8', focus: 'build' }],
    progression_strategy: 'increase carries and run weekly',
    days: [
      makeDay('Push Day', [
        makeExercise('0662', 'horizontal_push'),
        makeExercise('3561', 'hinge'),
        // carry exercise — use 0652 but mark as carry (simulate: can't validate actual carry ID without DB)
        // Instead, skip and test absence
      ]),
      makeDay('Strength Day', [makeExercise('3470', 'lunge'), makeExercise('0464', 'core_antiextension')]),
    ],
  }

  it('reports OCR_MISSING_PULLS when no vertical_pull or horizontal_pull', () => {
    const issues = validateProgramQuality(draft, { sport: 'ocr', weeks: 8 })
    const codes = issues.map(i => i.code)
    expect(codes).toContain('OCR_MISSING_PULLS')
  })
})

// ─── Scenario 3 — Spartan stationary-bike-only cardio ─────────────────────────

describe('Scenario 3 — Spartan bike-only cardio → OCR_CARDIO_ONLY_BIKE warning', () => {
  const draft: ProgramDraft = {
    program_name: 'Spartan Bike Only',
    description: 'OCR prep with only stationary bike cardio',
    weeks: 8,
    phases: [{ name: 'Base', weeks: '1-4', focus: 'base' }, { name: 'Build', weeks: '5-8', focus: 'build' }],
    progression_strategy: 'increase duration weekly',
    days: [
      makeDay('Cardio', [makeExercise('0662', 'cardio', { notes: '30 min stationary bike, Zone 2' })]),
      makeDay('Strength', [makeExercise('0652', 'vertical_pull'), makeExercise('3561', 'hinge')]),
    ],
  }

  it('reports OCR_CARDIO_ONLY_BIKE when all cardio exercises mention bike/stationary', () => {
    const issues = validateProgramQuality(draft, { sport: 'Spartan Race', weeks: 8 })
    const codes = issues.map(i => i.code)
    expect(codes).toContain('OCR_CARDIO_ONLY_BIKE')
  })
})

// ─── Scenario 4 — Powerlifting no progression ─────────────────────────────────

describe('Scenario 4 — Powerlifting 12-week with no progression → errors', () => {
  const draft: ProgramDraft = {
    program_name: '12-Week Powerlifting',
    description: 'Generic powerlifting program',
    weeks: 12,
    progression_strategy: 'train hard',  // no keywords, no percentages
    days: [
      makeDay('Squat Day — heavy squats', [makeExercise('0662', 'horizontal_push')]),
      makeDay('Bench Day — bench press', [makeExercise('0652', 'vertical_pull')]),
      makeDay('Deadlift Day — deadlifts', [makeExercise('3561', 'hinge')]),
    ],
  }

  it('reports NO_PROGRESSION as error for 12-week program with no progression data', () => {
    const issues = validateProgramQuality(draft, { sport: 'powerlifting', weeks: 12 })
    const noProgression = issues.find(i => i.code === 'NO_PROGRESSION')
    expect(noProgression?.severity).toBe('error')
  })

  it('reports POWERLIFTING_NO_PHASES as error for 10+ week powerlifting with no phases', () => {
    const issues = validateProgramQuality(draft, { sport: 'powerlifting', weeks: 12 })
    const noPhases = issues.find(i => i.code === 'POWERLIFTING_NO_PHASES')
    expect(noPhases?.severity).toBe('error')
  })

  it('errors come before warnings in sorted output', () => {
    const issues = validateProgramQuality(draft, { sport: 'powerlifting', weeks: 12 })
    const firstWarningIdx = issues.findIndex(i => i.severity === 'warning')
    const lastErrorIdx = issues.reduce((acc, i, idx) => i.severity === 'error' ? idx : acc, -1)
    if (firstWarningIdx !== -1 && lastErrorIdx !== -1) {
      expect(lastErrorIdx).toBeLessThan(firstWarningIdx)
    }
  })
})

// ─── Scenario 5 — Powerlifting contradictory peak+deload phases ───────────────

describe('Scenario 5 — Powerlifting peak/deload conflict → POWERLIFTING_PEAK_DELOAD_CONFLICT', () => {
  const draft: ProgramDraft = {
    program_name: 'Conflicting Peak Program',
    weeks: 12,
    progression_strategy: 'peak to 90%, 5 lb per week, deload week 4 and 8',
    phases: [
      { name: 'Hypertrophy', weeks: '1-3', focus: 'volume' },
      { name: 'Peak', weeks: '4', focus: 'heavy singles' },      // same range as...
      { name: 'Deload', weeks: '4', focus: 'recovery' },         // ...this deload
      { name: 'Strength', weeks: '5-11', focus: 'strength' },
      { name: 'Taper', weeks: '12', focus: 'taper' },
    ],
    days: [
      makeDay('Squat Day — heavy squats and bench press and deadlifts', [makeExercise('0662', 'horizontal_push', { notes: 'increase 5 lb per week' })]),
      makeDay('Bench Day — bench press work', [makeExercise('0652', 'vertical_pull')]),
      makeDay('Deadlift Day — deadlifts', [makeExercise('3561', 'hinge')]),
      makeDay('Accessory Day', [makeExercise('3470', 'lunge')]),
    ],
  }

  it('reports POWERLIFTING_PEAK_DELOAD_CONFLICT as error', () => {
    const issues = validateProgramQuality(draft, { sport: 'powerlifting', weeks: 12 })
    const conflict = issues.find(i => i.code === 'POWERLIFTING_PEAK_DELOAD_CONFLICT')
    expect(conflict?.severity).toBe('error')
    expect(conflict?.message).toContain('week')
  })
})

// ─── Scenario 6 — Beginner runner overload ────────────────────────────────────

describe('Scenario 6 — Beginner runner >3 run days in short program → error', () => {
  const draft: ProgramDraft = {
    program_name: 'Beginner Running Plan',
    weeks: 2,
    progression_strategy: 'add 1 min per run per week',
    days: [
      makeDay('Run Day Monday', [makeExercise('0662', 'cardio', { notes: 'easy run 20 min' })]),
      makeDay('Run Day Tuesday', [makeExercise('0662', 'cardio', { notes: 'easy run 20 min' })]),
      makeDay('Run Day Wednesday', [makeExercise('0662', 'cardio', { notes: 'easy run 20 min' })]),
      makeDay('Run Day Friday Cardio', [makeExercise('0662', 'cardio', { notes: 'easy run 25 min' })]),
    ],
  }

  it('reports BEGINNER_RUNNING_OVERLOAD as error', () => {
    const issues = validateProgramQuality(draft, {
      sport: 'running',
      fitnessLevel: 'beginner',
      weeks: 2,
    })
    const overload = issues.find(i => i.code === 'BEGINNER_RUNNING_OVERLOAD')
    expect(overload?.severity).toBe('error')
  })

  it('does NOT flag an experienced runner with 4 run days', () => {
    const issues = validateProgramQuality(draft, {
      sport: 'running',
      fitnessLevel: 'intermediate',
      weeks: 2,
    })
    const overload = issues.find(i => i.code === 'BEGINNER_RUNNING_OVERLOAD')
    expect(overload).toBeUndefined()
  })
})

// ─── Scenario 7 — Beginner runner with early intervals ────────────────────────

describe('Scenario 7 — Beginner runner with early intervals in notes → warning', () => {
  const draft: ProgramDraft = {
    program_name: 'Beginner Running with Intervals',
    weeks: 12,
    progression_strategy: 'run/walk week 1, add intervals week 2',
    phases: [
      { name: 'Base', weeks: '1-4', focus: 'base' },
      { name: 'Build', weeks: '5-12', focus: 'build' },
    ],
    days: [
      makeDay('Run Day', [
        makeExercise('0662', 'cardio', {
          notes: 'Week 2: interval training 400m repeats x6',
        }),
      ]),
      makeDay('Rest Day Strength', [makeExercise('0652', 'vertical_pull'), makeExercise('3561', 'hinge'), makeExercise('3470', 'lunge')]),
    ],
  }

  it('reports BEGINNER_INTERVALS_TOO_SOON as warning', () => {
    const issues = validateProgramQuality(draft, {
      sport: 'running',
      fitnessLevel: 'beginner',
      weeks: 12,
    })
    const early = issues.find(i => i.code === 'BEGINNER_INTERVALS_TOO_SOON')
    expect(early?.severity).toBe('warning')
  })
})

// ─── Scenario 8 — Clean program passes ────────────────────────────────────────

describe('Scenario 8 — Well-formed intermediate strength program → no issues', () => {
  const draft: ProgramDraft = {
    program_name: '8-Week Strength Foundation',
    description: 'Progressive overload strength program targeting compound movements with weekly load increases. Phase 1 builds volume, Phase 2 builds intensity.',
    primary_goal: 'Build strength',
    weeks: 8,
    progression_strategy: 'Weeks 1–4: 4×5 @ 70–75%, add 5 lb/week. Weeks 5–8: 4×3 @ 80–85%, add 2.5 lb/week. Deload week 4.',
    phases: [
      { name: 'Foundation', weeks: '1-4', focus: 'technique and volume at 70-75% 1RM' },
      { name: 'Strength', weeks: '5-8', focus: 'intensity at 80-85% 1RM, lower reps' },
    ],
    days: [
      {
        name: 'Lower Body Strength',
        focus: 'Squat-dominant compound work',
        estimated_duration_minutes: 60,
        exercises: [
          makeExercise('0662', 'horizontal_push', {
            notes: 'Week 1: 4×5 @ 70%. Week 2: 4×5 @ 72.5%. Week 3: 4×5 @ 75%. Week 4: 3×5 @ 65% deload.',
            week_progressions: [
              { week: 1, sets: 4, reps_min: 5, reps_max: 5, load_note: '70% 1RM' },
              { week: 2, sets: 4, reps_min: 5, reps_max: 5, load_note: '72.5% 1RM' },
              { week: 3, sets: 4, reps_min: 5, reps_max: 5, load_note: '75% 1RM' },
              { week: 4, sets: 3, reps_min: 5, reps_max: 5, load_note: '65% — deload' },
            ],
          }),
          makeExercise('3561', 'hinge'),
          makeExercise('3470', 'lunge'),
          makeExercise('0464', 'core_antiextension'),
        ],
      },
      {
        name: 'Upper Body Strength',
        focus: 'Horizontal push and pull',
        estimated_duration_minutes: 55,
        exercises: [
          makeExercise('0662', 'horizontal_push'),
          makeExercise('0652', 'vertical_pull'),
          makeExercise('0464', 'core_antiextension'),
        ],
      },
    ],
  }

  it('produces zero quality issues', () => {
    const issues = validateProgramQuality(draft, { sport: 'general_fitness', weeks: 8 })
    expect(issues).toHaveLength(0)
  })
})

// ─── Scenario 9 — Load anchor computation ─────────────────────────────────────

describe('Scenario 9 — Load anchor computation from 1RM', () => {
  const SQUAT_1RM_KG = 183.7  // ~405 lb

  it('isPowerliftingMovement identifies squat correctly', () => {
    expect(isPowerliftingMovement('Barbell Back Squat')).toBe(true)
    expect(isPowerliftingMovement('Barbell Bench Press')).toBe(true)
    expect(isPowerliftingMovement('Deadlift')).toBe(true)
    expect(isPowerliftingMovement('Romanian Deadlift')).toBe(true)
  })

  it('isPowerliftingMovement does NOT flag accessory movements', () => {
    expect(isPowerliftingMovement('Bicep Curl')).toBe(false)
    expect(isPowerliftingMovement('Lateral Raise')).toBe(false)
    expect(isPowerliftingMovement('Leg Press')).toBe(false)
  })

  it('computes 70% anchor within 0.5 kg of expected', () => {
    const prs = [{ exerciseName: 'Barbell Back Squat', metric: 'estimated_1rm', value: SQUAT_1RM_KG, unit: 'kg' }]
    const anchors = buildLoadAnchors(prs)
    expect(anchors.length).toBeGreaterThan(0)
    // Find the line with 70%
    const allText = anchors.join('\n')
    // 70% of 183.7 kg = 128.59 kg, rounded to 128.6
    expect(allText).toContain('70%')
    // Extract the kg value from "70% = X lb / Y kg"
    const match = allText.match(/70%\s*=\s*\d+\s*lb\s*\/\s*([\d.]+)\s*kg/)
    expect(match).not.toBeNull()
    const computed = parseFloat(match![1])
    expect(Math.abs(computed - 128.6)).toBeLessThan(0.5)
  })

  it('computes 90% anchor correctly', () => {
    const prs = [{ exerciseName: 'Barbell Back Squat', metric: 'estimated_1rm', value: SQUAT_1RM_KG, unit: 'kg' }]
    const anchors = buildLoadAnchors(prs)
    const allText = anchors.join('\n')
    const match = allText.match(/90%\s*=\s*\d+\s*lb\s*\/\s*([\d.]+)\s*kg/)
    expect(match).not.toBeNull()
    const computed = parseFloat(match![1])
    // 90% of 183.7 = 165.33
    expect(Math.abs(computed - 165.3)).toBeLessThan(0.5)
  })

  it('does NOT generate anchors for weight (non-1RM) metric', () => {
    const prs = [{ exerciseName: 'Barbell Back Squat', metric: 'weight', value: SQUAT_1RM_KG, unit: 'kg' }]
    const anchors = buildLoadAnchors(prs)
    expect(anchors).toHaveLength(0)
  })

  it('converts lb 1RM correctly — squat 405 lb', () => {
    const prs = [{ exerciseName: 'Barbell Back Squat', metric: 'estimated_1rm', value: 405, unit: 'lb' }]
    const anchors = buildLoadAnchors(prs)
    const allText = anchors.join('\n')
    // 70% of 405 lb = 283.5 → 284 lb
    const match = allText.match(/70%\s*=\s*(\d+)\s*lb/)
    expect(match).not.toBeNull()
    const lbs = parseInt(match![1], 10)
    expect(Math.abs(lbs - 284)).toBeLessThanOrEqual(1)
  })
})

// ─── Scenario 10 — Powerlifting 12-week no phases ────────────────────────────

describe('Scenario 10 — Powerlifting 12-week program, no phases → POWERLIFTING_NO_PHASES', () => {
  const draft: ProgramDraft = {
    program_name: 'Powerlifting 12 Week',
    weeks: 12,
    progression_strategy: 'add 5 lb each week on squat, 2.5 lb on bench, 5 lb on deadlift. Deload week 4 and 8.',
    days: [
      makeDay('Squat Day heavy squats + bench press', [
        makeExercise('0662', 'horizontal_push', { notes: 'week 1: 4x5 @ 70% increase 5 lb/week' }),
        makeExercise('3561', 'hinge'),
      ]),
      makeDay('Bench Day — bench press + deadlift', [makeExercise('0652', 'vertical_pull'), makeExercise('3470', 'lunge')]),
      makeDay('Deadlift Day — deadlift session', [makeExercise('3561', 'hinge', { notes: 'week 1: 70% progress weekly' }), makeExercise('0464', 'core_antiextension')]),
      makeDay('Accessory', [makeExercise('0652', 'vertical_pull')]),
    ],
  }

  it('reports POWERLIFTING_NO_PHASES as error', () => {
    const issues = validateProgramQuality(draft, { sport: 'powerlifting', weeks: 12 })
    const noPhases = issues.find(i => i.code === 'POWERLIFTING_NO_PHASES')
    expect(noPhases?.severity).toBe('error')
  })
})

// ─── Scenario 11 — week_progressions validation ──────────────────────────────

describe('Scenario 11 — week_progressions week > program weeks → validation error', () => {
  const draft: ProgramDraft = {
    program_name: 'Bad Week Prog',
    weeks: 4,
    days: [
      makeDay('Day A', [
        makeExercise('0662', 'horizontal_push', {
          week_progressions: [
            { week: 5, sets: 3, load_note: 'this is week 5 but program is only 4 weeks' },
          ],
        }),
      ]),
    ],
  }

  it('validateProgramDraft rejects week_progressions week > program weeks', () => {
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('week 5') && e.includes('4 weeks'))).toBe(true)
  })
})

// ─── Scenario 12 — Identical repeated notes → IDENTICAL_WEEK_NOTES warning ───

describe('Scenario 12 — Same note text on nearly all exercises → IDENTICAL_WEEK_NOTES warning', () => {
  const COPY_PASTE_NOTE = 'Add 5 lb each week and progress as able'

  // All exercises have the exact same note — classic copy-paste program
  const makeCopyPasteEx = (id: string, pattern: string) => ({
    exercise_id: id, intended_pattern: pattern,
    sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90,
    notes: COPY_PASTE_NOTE,
  })

  const draft: ProgramDraft = {
    program_name: '8-Week Copy Paste',
    weeks: 8,
    phases: [{ name: 'Base', weeks: '1-4', focus: 'base' }, { name: 'Build', weeks: '5-8', focus: 'build' }],
    progression_strategy: 'add 5 lb each week and progress as able',
    days: [
      makeDay('Day A', [
        makeCopyPasteEx('0662', 'horizontal_push'),
        makeCopyPasteEx('3561', 'hinge'),
        makeCopyPasteEx('3470', 'lunge'),
        makeCopyPasteEx('0464', 'core_antiextension'),
      ]),
      makeDay('Day B', [
        makeCopyPasteEx('0652', 'vertical_pull'),
        makeCopyPasteEx('3561', 'hinge'),
      ]),
    ],
  }

  it('reports IDENTICAL_WEEK_NOTES when >75% of non-empty notes are identical', () => {
    const issues = validateProgramQuality(draft, { weeks: 8 })
    const codes = issues.map(i => i.code)
    expect(codes).toContain('IDENTICAL_WEEK_NOTES')
  })

  it('is a warning, not an error', () => {
    const issues = validateProgramQuality(draft, { weeks: 8 })
    const issue = issues.find(i => i.code === 'IDENTICAL_WEEK_NOTES')
    expect(issue?.severity).toBe('warning')
  })
})
