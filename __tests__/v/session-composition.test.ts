/**
 * V Program Engine V2 — Session Composition tests
 *
 * Tests for the 8 new quality checks added in the session composition pass,
 * plus field-level validation for the new ProgramExercise fields.
 *
 * No AI calls, no DB — pure logic on draft structures.
 *
 * Scenarios:
 *   1 — Intermediate push day with 2 exercises → SPARSE_SESSION warning
 *   2 — Advanced push day with 3 exercises → ADVANCED_SHALLOW_SESSION warning
 *   3 — Upper full body day with only push patterns → UNIPOLAR_UPPER_SESSION warning
 *   4 — Upper full body day with only pull patterns → UNIPOLAR_UPPER_SESSION warning
 *   5 — Beginner with failure_allowed=true → BEGINNER_FAILURE_OVERUSE error
 *   6 — All exercises using "linear" progression_model → UNIFORM_PROGRESSION_MODEL warning
 *   7 — Intermediate with >50% failure_allowed → EXCESSIVE_FAILURE warning
 *   8 — Superset mode without sequencing_group → SUPERSET_MISSING_GROUP warning
 *   9 — target_rir = 6 (out of range) → validation error
 *  10 — progression_model = "invalid_value" → validation error
 *  11 — sequencing_group = 0 (not a positive integer) → validation error
 *  12 — Clean advanced push day — no new quality checks fire
 */

import { describe, it, expect } from 'vitest'
import { validateProgramQuality } from '../../lib/v/program-quality'
import { validateProgramDraft } from '../../lib/ai/tools/program'
import type { ProgramDraft } from '../../lib/ai/tools/program'

// ─── Known real exercise IDs ──────────────────────────────────────────────────
// 0025  barbell bench press        → horizontal_push
// 0027  barbell bent over row      → horizontal_pull
// 0031  barbell curl               → bicep
// 0032  barbell deadlift           → hinge
// 0085  barbell romanian deadlift  → hinge
// 0091  barbell seated overhead press → vertical_push
// 0201  cable pushdown             → tricep
// 0293  dumbbell bent over row     → horizontal_pull
// 0308  dumbbell fly               → fly
// 0314  dumbbell incline bench press → incline_push
// 0334  dumbbell lateral raise     → shoulder_isolation
// 0464  front plank with twist     → core_antiextension
// 0652  pull-up                    → vertical_pull
// 0662  push-up                    → horizontal_push
// 1760  dumbbell goblet squat      → squat
// 2330  cable lat pulldown full range → vertical_pull
// 3470  forward lunge              → lunge
// 3561  glute bridge march         → hinge

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
    focus: overrides.focus as string | undefined,
    estimated_duration_minutes: 60,
    exercises,
    ...overrides,
  }
}

// ─── Scenario 1 — Intermediate push day with 2 exercises → SPARSE_SESSION ────

describe('Scenario 1 — Intermediate push day with 2 exercises → SPARSE_SESSION', () => {
  const draft: ProgramDraft = {
    program_name: 'Intermediate Push Pull',
    description: 'Intermediate PPL split, 12 weeks',
    weeks: 12,
    phases: [
      { name: 'Base', weeks: '1-4', focus: 'volume' },
      { name: 'Build', weeks: '5-8', focus: 'intensity' },
      { name: 'Peak', weeks: '9-12', focus: 'peak' },
    ],
    progression_strategy: 'Weeks 1-4: 4×10 @ RPE 7. Weeks 5-8: 4×6 @ RPE 8. Weeks 9-12: 4×3 @ RPE 9.',
    days: [
      makeDay('Push Day', [
        makeExercise('0025', 'horizontal_push'),
        makeExercise('0662', 'horizontal_push'),
      ]),
    ],
  }

  it('fires SPARSE_SESSION for intermediate push day with 2 exercises', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 12 })
    expect(issues.map(i => i.code)).toContain('SPARSE_SESSION')
  })

  it('does not fire SPARSE_SESSION for a beginner', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'beginner', weeks: 12 })
    expect(issues.map(i => i.code)).not.toContain('SPARSE_SESSION')
  })

  it('does not fire SPARSE_SESSION for a push day with 4+ exercises', () => {
    const draftFull: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Push Day', [
          makeExercise('0025', 'horizontal_push'),
          makeExercise('0314', 'incline_push'),
          makeExercise('0308', 'fly'),
          makeExercise('0201', 'tricep'),
        ]),
      ],
    }
    const issues = validateProgramQuality(draftFull, { fitnessLevel: 'intermediate', weeks: 12 })
    expect(issues.map(i => i.code)).not.toContain('SPARSE_SESSION')
  })
})

// ─── Scenario 2 — Advanced push day with 3 exercises → ADVANCED_SHALLOW_SESSION ─

describe('Scenario 2 — Advanced push day with 3 exercises → ADVANCED_SHALLOW_SESSION', () => {
  const draft: ProgramDraft = {
    program_name: 'Advanced Push Specialization',
    description: 'Advanced 8-week push specialization',
    weeks: 8,
    phases: [
      { name: 'Accumulation', weeks: '1-4', focus: 'volume' },
      { name: 'Intensification', weeks: '5-8', focus: 'strength' },
    ],
    progression_strategy: 'Waves from 4×8 @ 70% to 5×5 @ 80%',
    days: [
      makeDay('Push Day', [
        makeExercise('0025', 'horizontal_push'),
        makeExercise('0314', 'incline_push'),
        makeExercise('0308', 'fly'),
      ]),
    ],
  }

  it('fires ADVANCED_SHALLOW_SESSION for advanced push day with 3 exercises', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    expect(issues.map(i => i.code)).toContain('ADVANCED_SHALLOW_SESSION')
  })

  it('does not fire ADVANCED_SHALLOW_SESSION for intermediate', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).not.toContain('ADVANCED_SHALLOW_SESSION')
  })

  it('does not fire for advanced push day with 5 exercises', () => {
    const draftFull: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Push Day', [
          makeExercise('0025', 'horizontal_push'),
          makeExercise('0314', 'incline_push'),
          makeExercise('0308', 'fly'),
          makeExercise('0091', 'vertical_push'),
          makeExercise('0201', 'tricep'),
        ]),
      ],
    }
    const issues = validateProgramQuality(draftFull, { fitnessLevel: 'advanced', weeks: 8 })
    expect(issues.map(i => i.code)).not.toContain('ADVANCED_SHALLOW_SESSION')
  })
})

// ─── Scenario 3 — Upper full body with only push → UNIPOLAR_UPPER_SESSION ─────

describe('Scenario 3 — Upper full body day with only push → UNIPOLAR_UPPER_SESSION', () => {
  const draft: ProgramDraft = {
    program_name: 'Upper Lower Split',
    description: 'Upper Lower 4 days/week',
    weeks: 8,
    phases: [
      { name: 'Base', weeks: '1-4', focus: 'volume' },
      { name: 'Strength', weeks: '5-8', focus: 'intensity' },
    ],
    progression_strategy: 'Linear load each week',
    days: [
      makeDay('Upper Body', [
        makeExercise('0025', 'horizontal_push'),
        makeExercise('0314', 'incline_push'),
        makeExercise('0308', 'fly'),
        makeExercise('0201', 'tricep'),
      ]),
    ],
  }

  it('fires UNIPOLAR_UPPER_SESSION when upper day has only push, no pull', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).toContain('UNIPOLAR_UPPER_SESSION')
  })

  it('does not fire UNIPOLAR_UPPER_SESSION when upper day has both push and pull', () => {
    const balanced: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Upper Body', [
          makeExercise('0025', 'horizontal_push'),
          makeExercise('0652', 'vertical_pull'),
          makeExercise('0027', 'horizontal_pull'),
          makeExercise('0201', 'tricep'),
        ]),
      ],
    }
    const issues = validateProgramQuality(balanced, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).not.toContain('UNIPOLAR_UPPER_SESSION')
  })

  it('does not fire for a dedicated push day (PPL — push-only is intentional)', () => {
    const pushOnly: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Push', [
          makeExercise('0025', 'horizontal_push'),
          makeExercise('0314', 'incline_push'),
          makeExercise('0201', 'tricep'),
        ]),
      ],
    }
    const issues = validateProgramQuality(pushOnly, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).not.toContain('UNIPOLAR_UPPER_SESSION')
  })
})

// ─── Scenario 4 — Upper full body with only pull → UNIPOLAR_UPPER_SESSION ─────

describe('Scenario 4 — Upper full body day with only pull → UNIPOLAR_UPPER_SESSION', () => {
  const draft: ProgramDraft = {
    program_name: 'Upper Lower Split',
    description: 'Upper Lower 4 days/week',
    weeks: 8,
    phases: [
      { name: 'Base', weeks: '1-4', focus: 'volume' },
      { name: 'Strength', weeks: '5-8', focus: 'intensity' },
    ],
    progression_strategy: 'Linear load each week',
    days: [
      makeDay('Upper Body', [
        makeExercise('0652', 'vertical_pull'),
        makeExercise('0027', 'horizontal_pull'),
        makeExercise('0293', 'horizontal_pull'),
        makeExercise('0031', 'bicep'),
      ]),
    ],
  }

  it('fires UNIPOLAR_UPPER_SESSION when upper day has only pull, no push', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).toContain('UNIPOLAR_UPPER_SESSION')
  })
})

// ─── Scenario 5 — Beginner with failure_allowed → BEGINNER_FAILURE_OVERUSE ────

describe('Scenario 5 — Beginner with failure_allowed=true → BEGINNER_FAILURE_OVERUSE', () => {
  const draft: ProgramDraft = {
    program_name: 'Beginner Starter Program',
    description: 'Simple beginner 3-day full body',
    weeks: 4,
    progression_strategy: 'Add 5 lb to main lifts each week',
    days: [
      makeDay('Full Body A', [
        makeExercise('0662', 'horizontal_push', { progression_model: 'linear', failure_allowed: true }),
        makeExercise('0652', 'vertical_pull', { progression_model: 'linear' }),
        makeExercise('1760', 'squat', { progression_model: 'linear' }),
        makeExercise('3561', 'hinge', { progression_model: 'linear' }),
      ]),
    ],
  }

  it('fires BEGINNER_FAILURE_OVERUSE as error for beginner with failure_allowed', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'beginner', weeks: 4 })
    const failure = issues.find(i => i.code === 'BEGINNER_FAILURE_OVERUSE')
    expect(failure).toBeDefined()
    expect(failure?.severity).toBe('error')
  })

  it('does not fire BEGINNER_FAILURE_OVERUSE for intermediate with failure_allowed on one exercise', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 4 })
    expect(issues.map(i => i.code)).not.toContain('BEGINNER_FAILURE_OVERUSE')
  })

  it('does not fire when no exercises have failure_allowed', () => {
    const clean: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Full Body A', [
          makeExercise('0662', 'horizontal_push', { progression_model: 'linear', failure_allowed: false }),
          makeExercise('0652', 'vertical_pull', { progression_model: 'linear' }),
          makeExercise('1760', 'squat', { progression_model: 'linear' }),
        ]),
      ],
    }
    const issues = validateProgramQuality(clean, { fitnessLevel: 'beginner', weeks: 4 })
    expect(issues.map(i => i.code)).not.toContain('BEGINNER_FAILURE_OVERUSE')
  })
})

// ─── Scenario 6 — All exercises linear → UNIFORM_PROGRESSION_MODEL ────────────

describe('Scenario 6 — All exercises same progression_model → UNIFORM_PROGRESSION_MODEL', () => {
  const draft: ProgramDraft = {
    program_name: 'Intermediate Push Day',
    description: 'Push day with all-linear progression',
    weeks: 8,
    phases: [
      { name: 'Build', weeks: '1-4', focus: 'volume' },
      { name: 'Strength', weeks: '5-8', focus: 'intensity' },
    ],
    progression_strategy: 'Linear load each week on everything',
    days: [
      makeDay('Push Day', [
        makeExercise('0025', 'horizontal_push', { progression_model: 'linear' }),
        makeExercise('0314', 'incline_push',    { progression_model: 'linear' }),
        makeExercise('0308', 'fly',             { progression_model: 'linear' }),
        makeExercise('0201', 'tricep',          { progression_model: 'linear' }),
        makeExercise('0334', 'shoulder_isolation', { progression_model: 'linear' }),
      ]),
    ],
  }

  it('fires UNIFORM_PROGRESSION_MODEL when all exercises use "linear"', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).toContain('UNIFORM_PROGRESSION_MODEL')
  })

  it('does not fire when exercises use mixed progression models', () => {
    const mixed: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Push Day', [
          makeExercise('0025', 'horizontal_push', { progression_model: 'linear' }),
          makeExercise('0314', 'incline_push',    { progression_model: 'double_progression' }),
          makeExercise('0308', 'fly',             { progression_model: 'rep_progression' }),
          makeExercise('0201', 'tricep',          { progression_model: 'double_progression' }),
        ]),
      ],
    }
    const issues = validateProgramQuality(mixed, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).not.toContain('UNIFORM_PROGRESSION_MODEL')
  })

  it('does not fire when fewer than 4 exercises have a model set', () => {
    const sparse: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Push Day', [
          makeExercise('0025', 'horizontal_push', { progression_model: 'linear' }),
          makeExercise('0314', 'incline_push'),  // no progression_model
          makeExercise('0308', 'fly'),            // no progression_model
        ]),
      ],
    }
    const issues = validateProgramQuality(sparse, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).not.toContain('UNIFORM_PROGRESSION_MODEL')
  })
})

// ─── Scenario 7 — >50% failure_allowed → EXCESSIVE_FAILURE ──────────────────

describe('Scenario 7 — Intermediate with >50% failure_allowed → EXCESSIVE_FAILURE', () => {
  const draft: ProgramDraft = {
    program_name: 'Intermediate Hypertrophy',
    description: 'High failure program',
    weeks: 8,
    phases: [
      { name: 'Volume', weeks: '1-4', focus: 'volume' },
      { name: 'Intensity', weeks: '5-8', focus: 'intensity' },
    ],
    progression_strategy: 'Progressive overload with RIR tracking',
    days: [
      makeDay('Push Day', [
        makeExercise('0025', 'horizontal_push', { failure_allowed: true }),
        makeExercise('0314', 'incline_push',    { failure_allowed: true }),
        makeExercise('0308', 'fly',             { failure_allowed: true }),
        makeExercise('0201', 'tricep',          { failure_allowed: false }),
        makeExercise('0334', 'shoulder_isolation', { failure_allowed: false }),
      ]),
    ],
  }

  it('fires EXCESSIVE_FAILURE when >50% of exercises have failure_allowed', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).toContain('EXCESSIVE_FAILURE')
  })

  it('does not fire when failure is only on isolations (≤50%)', () => {
    const reasonable: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Push Day', [
          makeExercise('0025', 'horizontal_push', { failure_allowed: false }),
          makeExercise('0314', 'incline_push',    { failure_allowed: false }),
          makeExercise('0308', 'fly',             { failure_allowed: true }),
          makeExercise('0201', 'tricep',          { failure_allowed: false }),
          makeExercise('0334', 'shoulder_isolation', { failure_allowed: false }),
        ]),
      ],
    }
    const issues = validateProgramQuality(reasonable, { fitnessLevel: 'intermediate', weeks: 8 })
    expect(issues.map(i => i.code)).not.toContain('EXCESSIVE_FAILURE')
  })

  it('does not fire EXCESSIVE_FAILURE for beginners (they get BEGINNER_FAILURE_OVERUSE instead)', () => {
    // Beginner check already covers this — EXCESSIVE_FAILURE should not double-fire for beginners
    const issues = validateProgramQuality(draft, { fitnessLevel: 'beginner', weeks: 8 })
    expect(issues.map(i => i.code)).not.toContain('EXCESSIVE_FAILURE')
  })
})

// ─── Scenario 8 — Superset mode without sequencing_group → SUPERSET_MISSING_GROUP

describe('Scenario 8 — Superset without sequencing_group → SUPERSET_MISSING_GROUP', () => {
  const draft: ProgramDraft = {
    program_name: 'Accessory Circuit',
    description: 'Superset-based hypertrophy',
    weeks: 6,
    phases: [
      { name: 'Volume', weeks: '1-3', focus: 'volume' },
      { name: 'Strength', weeks: '4-6', focus: 'strength' },
    ],
    progression_strategy: 'Add 2.5 lb on compounds each week; accessories use double progression',
    days: [
      makeDay('Upper', [
        makeExercise('0025', 'horizontal_push', { sequencing_mode: 'superset' }),  // missing sequencing_group
        makeExercise('0652', 'vertical_pull',   { sequencing_mode: 'superset' }),  // missing sequencing_group
        makeExercise('0031', 'bicep',           { progression_model: 'double_progression' }),
      ]),
    ],
  }

  it('fires SUPERSET_MISSING_GROUP when superset mode is set without sequencing_group', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 6 })
    expect(issues.map(i => i.code)).toContain('SUPERSET_MISSING_GROUP')
  })

  it('does not fire when superset exercises have sequencing_group set', () => {
    const withGroup: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Upper', [
          makeExercise('0025', 'horizontal_push', { sequencing_mode: 'superset', sequencing_group: 1 }),
          makeExercise('0652', 'vertical_pull',   { sequencing_mode: 'superset', sequencing_group: 1 }),
          makeExercise('0031', 'bicep', { progression_model: 'double_progression' }),
        ]),
      ],
    }
    const issues = validateProgramQuality(withGroup, { fitnessLevel: 'intermediate', weeks: 6 })
    expect(issues.map(i => i.code)).not.toContain('SUPERSET_MISSING_GROUP')
  })

  it('does not fire for "straight" or "alternating" mode without sequencing_group', () => {
    const alternating: ProgramDraft = {
      ...draft,
      days: [
        makeDay('Upper', [
          makeExercise('0025', 'horizontal_push', { sequencing_mode: 'alternating' }),
          makeExercise('0652', 'vertical_pull',   { sequencing_mode: 'alternating' }),
        ]),
      ],
    }
    const issues = validateProgramQuality(alternating, { fitnessLevel: 'intermediate', weeks: 6 })
    expect(issues.map(i => i.code)).not.toContain('SUPERSET_MISSING_GROUP')
  })
})

// ─── Scenario 9 — target_rir out of range → validation error ─────────────────

describe('Scenario 9 — target_rir out of range → validateProgramDraft error', () => {
  const draftWithBadRIR: ProgramDraft = {
    program_name: 'Bad RIR Program',
    days: [
      {
        name: 'Push Day',
        estimated_duration_minutes: 60,
        exercises: [
          makeExercise('0025', 'horizontal_push', { target_rir: 6 }),  // out of range
        ],
      },
    ],
  }

  it('rejects target_rir = 6 (must be 0–5)', () => {
    const result = validateProgramDraft(draftWithBadRIR)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('target_rir'))).toBe(true)
  })

  it('accepts target_rir = 0 (failure)', () => {
    const draft: ProgramDraft = {
      program_name: 'Valid RIR Program',
      days: [
        {
          name: 'Push Day',
          estimated_duration_minutes: 60,
          exercises: [
            makeExercise('0025', 'horizontal_push', { target_rir: 0 }),
          ],
        },
      ],
    }
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(true)
  })

  it('accepts target_rir = 3', () => {
    const draft: ProgramDraft = {
      program_name: 'Valid RIR Program',
      days: [
        {
          name: 'Push Day',
          estimated_duration_minutes: 60,
          exercises: [
            makeExercise('0025', 'horizontal_push', { target_rir: 3 }),
          ],
        },
      ],
    }
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(true)
  })
})

// ─── Scenario 10 — invalid progression_model → validation error ───────────────

describe('Scenario 10 — invalid progression_model → validateProgramDraft error', () => {
  it('rejects progression_model = "invalid_value"', () => {
    const draft: ProgramDraft = {
      program_name: 'Bad Progression Model',
      days: [
        {
          name: 'Push Day',
          estimated_duration_minutes: 60,
          exercises: [
            makeExercise('0025', 'horizontal_push', {
              progression_model: 'invalid_value' as never,
            }),
          ],
        },
      ],
    }
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('progression_model'))).toBe(true)
  })

  it('accepts all valid progression_model values', () => {
    const validModels = ['linear', 'double_progression', 'rep_progression', 'set_progression', 'percentage_rpe', 'duration_distance', 'auto']
    for (const model of validModels) {
      const draft: ProgramDraft = {
        program_name: `Test ${model}`,
        days: [
          {
            name: 'Push Day',
            estimated_duration_minutes: 60,
            exercises: [
              makeExercise('0025', 'horizontal_push', { progression_model: model as never }),
            ],
          },
        ],
      }
      const result = validateProgramDraft(draft)
      expect(result.valid, `Expected valid for progression_model=${model}`).toBe(true)
    }
  })
})

// ─── Scenario 11 — sequencing_group = 0 → validation error ───────────────────

describe('Scenario 11 — sequencing_group = 0 → validateProgramDraft error', () => {
  it('rejects sequencing_group = 0 (must be a positive integer)', () => {
    const draft: ProgramDraft = {
      program_name: 'Bad Sequencing Group',
      days: [
        {
          name: 'Upper',
          estimated_duration_minutes: 60,
          exercises: [
            makeExercise('0025', 'horizontal_push', { sequencing_group: 0, sequencing_mode: 'superset' }),
          ],
        },
      ],
    }
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('sequencing_group'))).toBe(true)
  })

  it('accepts sequencing_group = 1', () => {
    const draft: ProgramDraft = {
      program_name: 'Valid Superset',
      days: [
        {
          name: 'Upper',
          estimated_duration_minutes: 60,
          exercises: [
            makeExercise('0025', 'horizontal_push', { sequencing_group: 1, sequencing_mode: 'superset' }),
            makeExercise('0652', 'vertical_pull',   { sequencing_group: 1, sequencing_mode: 'superset' }),
          ],
        },
      ],
    }
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(true)
  })
})

// ─── Scenario 12 — Clean advanced push day → no new quality checks fire ──────

describe('Scenario 12 — Clean advanced push day → no new quality checks fire', () => {
  const draft: ProgramDraft = {
    program_name: 'Advanced Push Day V2',
    description: 'Advanced 6-day PPL with supersets on accessories, proper progression model variety, and experience-appropriate volume.',
    weeks: 8,
    phases: [
      { name: 'Accumulation', weeks: '1-4', focus: 'Volume — 4×10 @ RPE 7–8; accessories doubled up in antagonist supersets' },
      { name: 'Intensification', weeks: '5-8', focus: 'Intensity — 5×5 @ 78–85%; accessories maintain volume' },
    ],
    progression_strategy: 'Main lifts: percentage_rpe wave from 75% to 85% 1RM over 4 weeks. Accessories: double_progression on isolation, rep_progression on carries.',
    session_sequencing: 'Main compounds as straight sets; accessories in antagonist supersets',
    days: [
      makeDay('Push Day', [
        makeExercise('0025', 'horizontal_push', {
          progression_model: 'percentage_rpe',
          target_rir: 2,
          failure_allowed: false,
          sequencing_mode: 'straight',
          week_progressions: [
            { week: 1, sets: 4, reps_min: 5, reps_max: 5, load_note: '75% 1RM' },
            { week: 2, sets: 4, reps_min: 5, reps_max: 5, load_note: '78% 1RM' },
            { week: 3, sets: 4, reps_min: 5, reps_max: 5, load_note: '80% 1RM' },
            { week: 4, sets: 3, reps_min: 5, reps_max: 5, load_note: '70% 1RM deload' },
          ],
        }),
        makeExercise('0314', 'incline_push', {
          progression_model: 'double_progression',
          progression_increment: 5,
          progression_condition: 'increase load once all sets reach reps_max at 2 RIR',
          target_rir: 2,
          failure_allowed: false,
          sequencing_mode: 'straight',
        }),
        makeExercise('0308', 'fly', {
          progression_model: 'rep_progression',
          target_rir: 1,
          failure_allowed: true,
          sequencing_mode: 'antagonist_superset',
          sequencing_group: 1,
        }),
        makeExercise('0027', 'horizontal_pull', {
          progression_model: 'double_progression',
          target_rir: 1,
          failure_allowed: false,
          sequencing_mode: 'antagonist_superset',
          sequencing_group: 1,
        }),
        makeExercise('0201', 'tricep', {
          progression_model: 'rep_progression',
          target_rir: 1,
          failure_allowed: true,
          sequencing_mode: 'superset',
          sequencing_group: 2,
        }),
        makeExercise('0334', 'shoulder_isolation', {
          progression_model: 'double_progression',
          target_rir: 1,
          failure_allowed: false,
          sequencing_mode: 'superset',
          sequencing_group: 2,
        }),
      ]),
    ],
  }

  const NEW_CHECKS = [
    'SPARSE_SESSION',
    'ADVANCED_SHALLOW_SESSION',
    'UNIPOLAR_UPPER_SESSION',
    'BEGINNER_FAILURE_OVERUSE',
    'UNIFORM_PROGRESSION_MODEL',
    'EXCESSIVE_FAILURE',
    'SUPERSET_MISSING_GROUP',
  ]

  it('does not fire any new session composition checks for a well-formed advanced push day', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    const newIssues = issues.filter(i => NEW_CHECKS.includes(i.code))
    expect(newIssues).toHaveLength(0)
  })

  it('passes validateProgramDraft without errors', () => {
    const result = validateProgramDraft(draft)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('includes SUPERSET_MISSING_GROUP warning in warnings when superset group is provided', () => {
    // Verify it does NOT fire when all superset exercises have sequencing_group
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    expect(issues.map(i => i.code)).not.toContain('SUPERSET_MISSING_GROUP')
  })
})
