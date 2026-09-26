/**
 * V Program Engine — production fixture tests
 *
 * These tests replicate the production failure scenarios that exposed V2
 * enforcement gaps. Each fixture is a realistic draft structure, not a
 * minimal synthetic one.
 *
 * Root causes covered:
 *   A — ADVANCED_SHALLOW_SESSION / SPARSE_SESSION are now errors (not warnings)
 *   B — MISSING_REQUIRED_ROLE fires when required session roles are absent
 *   C — NO_STRUCTURED_PROGRESSION fires when no week_progressions or progression_model
 *   D — ALTERNATING_NOT_IMPLEMENTED fires when sequencing_group is absent
 */

import { describe, it, expect } from 'vitest'
import { validateProgramQuality } from '../../lib/v/program-quality'
import type { ProgramDraft } from '../../lib/ai/tools/program'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeEx(
  exercise_id: string,
  intended_pattern: string,
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

// ─── Fixture A: Sparse advanced push day (3 exercises, production failure) ────

describe('Fixture A — Advanced push day with 3 exercises → errors fire', () => {
  // Mirrors a real production output: advanced user got bench + incline + OHP
  // but no isolation (fly), no shoulder_isolation, no tricep.
  const draft: ProgramDraft = {
    program_name: 'Hypertrophy Block',
    description: 'Upper/lower split for advanced hypertrophy',
    weeks: 8,
    phases: [
      { name: 'Accumulation', weeks: '1-4', focus: 'volume' },
      { name: 'Intensification', weeks: '5-8', focus: 'intensity' },
    ],
    progression_strategy: 'Double progression on all main lifts. Add load when top of rep range at target RIR.',
    days: [
      {
        name: 'Upper Push',
        focus: 'Chest, shoulder, tricep',
        estimated_duration_minutes: 60,
        exercises: [
          makeEx('0662', 'horizontal_push', { progression_model: 'double_progression' }),
          makeEx('0663', 'incline_push',    { progression_model: 'double_progression' }),
          makeEx('0664', 'vertical_push',   { progression_model: 'double_progression' }),
        ],
      },
    ],
  }

  it('ADVANCED_SHALLOW_SESSION is now an error (not warning)', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    const issue = issues.find(i => i.code === 'ADVANCED_SHALLOW_SESSION')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('MISSING_REQUIRED_ROLE fires for missing fly, shoulder_isolation, tricep', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    const issue = issues.find(i => i.code === 'MISSING_REQUIRED_ROLE')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('Upper Push')
  })

  it('hard errors appear first in sorted output', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    const firstWarning = issues.findIndex(i => i.severity === 'warning')
    const lastError   = issues.reduce((acc, i, idx) => i.severity === 'error' ? idx : acc, -1)
    if (firstWarning !== -1 && lastError !== -1) {
      expect(lastError).toBeLessThan(firstWarning)
    }
  })
})

// ─── Fixture B: Advanced push day, complete → no role errors ─────────────────

describe('Fixture B — Advanced push day with all required roles → MISSING_REQUIRED_ROLE absent', () => {
  // upper_push advanced required: horizontal_push, incline_push, fly, shoulder_isolation, tricep
  const draft: ProgramDraft = {
    program_name: 'Advanced Upper Lower',
    description: 'Upper/lower 4-day advanced hypertrophy split with full role coverage.',
    weeks: 8,
    phases: [
      { name: 'Base', weeks: '1-4', focus: 'volume accumulation' },
      { name: 'Peak', weeks: '5-8', focus: 'intensity and load' },
    ],
    progression_strategy: 'Double progression: hold weight until top rep × all sets, then increase 5 lb.',
    days: [
      {
        name: 'Upper Push',
        focus: 'Chest, shoulder, tricep — all roles covered',
        estimated_duration_minutes: 70,
        exercises: [
          makeEx('0662', 'horizontal_push',    { progression_model: 'double_progression' }),
          makeEx('0663', 'incline_push',        { progression_model: 'double_progression' }),
          makeEx('0665', 'fly',                 { progression_model: 'rep_progression' }),
          makeEx('0666', 'shoulder_isolation',  { progression_model: 'rep_progression' }),
          makeEx('0667', 'tricep',              { progression_model: 'double_progression' }),
        ],
      },
    ],
  }

  it('does NOT fire MISSING_REQUIRED_ROLE when all required roles are filled', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    const issue = issues.find(i => i.code === 'MISSING_REQUIRED_ROLE')
    expect(issue).toBeUndefined()
  })

  it('does NOT fire ADVANCED_SHALLOW_SESSION with 5 exercises', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'advanced', weeks: 8 })
    const issue = issues.find(i => i.code === 'ADVANCED_SHALLOW_SESSION')
    expect(issue).toBeUndefined()
  })
})

// ─── Fixture C: Intermediate full-body day missing horizontal_pull ────────────

describe('Fixture C — Intermediate full-body day missing horizontal_pull → MISSING_REQUIRED_ROLE', () => {
  // full_body intermediate requires: lower_compound_a (squat), lower_compound_b (hinge),
  // upper_push (horizontal_push), upper_pull (vertical_pull), row (horizontal_pull)
  const draft: ProgramDraft = {
    program_name: 'Intermediate Full Body',
    weeks: 6,
    progression_strategy: 'Linear progression on all compounds. Add 5 lb to squat/deadlift and 2.5 lb to press each week when all reps completed.',
    days: [
      {
        name: 'Full Body A',
        focus: 'Compound movements, full body stimulus',
        estimated_duration_minutes: 55,
        exercises: [
          makeEx('0662', 'squat',          { progression_model: 'linear' }),
          makeEx('0663', 'hinge',          { progression_model: 'linear' }),
          makeEx('0664', 'horizontal_push',{ progression_model: 'linear' }),
          makeEx('0665', 'vertical_pull',  { progression_model: 'linear' }),
          // horizontal_pull (row) is intentionally absent
        ],
      },
    ],
  }

  it('fires MISSING_REQUIRED_ROLE for missing horizontal_pull role', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 6 })
    const issue = issues.find(i => i.code === 'MISSING_REQUIRED_ROLE')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('horizontal_pull')
  })
})

// ─── Fixture D: No structured progression in 8-week program ──────────────────

describe('Fixture D — 8-week program with progression_strategy text but no week_progressions or progression_model', () => {
  // The original production failure: progression_strategy had keywords ("add 5 lb per week")
  // but NO exercise had week_progressions or progression_model set.
  // NO_PROGRESSION doesn't fire (keywords present). NO_STRUCTURED_PROGRESSION should.
  const draft: ProgramDraft = {
    program_name: '8-Week Strength Program',
    description: 'Strength block for intermediate lifters building squat and deadlift.',
    weeks: 8,
    phases: [
      { name: 'Foundation', weeks: '1-4', focus: 'base building' },
      { name: 'Strength', weeks: '5-8', focus: 'intensity increase' },
    ],
    progression_strategy: 'Add 5 lb per week to squat and deadlift. Deload week 4.',
    days: [
      {
        name: 'Lower Strength',
        focus: 'Squat and hinge dominant',
        estimated_duration_minutes: 65,
        exercises: [
          // No progression_model or week_progressions on any exercise
          makeEx('0662', 'squat'),
          makeEx('0663', 'hinge'),
          makeEx('0664', 'lunge'),
          makeEx('0665', 'core_antiextension'),
        ],
      },
    ],
  }

  it('does NOT fire NO_PROGRESSION (has keywords in progression_strategy)', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const issue = issues.find(i => i.code === 'NO_PROGRESSION')
    expect(issue).toBeUndefined()
  })

  it('fires NO_STRUCTURED_PROGRESSION as an error', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const issue = issues.find(i => i.code === 'NO_STRUCTURED_PROGRESSION')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('NO_STRUCTURED_PROGRESSION message instructs to add progression_model', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const issue = issues.find(i => i.code === 'NO_STRUCTURED_PROGRESSION')
    expect(issue?.message).toMatch(/progression_model/i)
  })
})

// ─── Fixture E: Structured progression present → NO_STRUCTURED_PROGRESSION absent ─

describe('Fixture E — 8-week program with week_progressions → NO_STRUCTURED_PROGRESSION absent', () => {
  const draft: ProgramDraft = {
    program_name: '8-Week Strength',
    description: 'Linear periodization block with explicit weekly load targets.',
    weeks: 8,
    phases: [
      { name: 'Foundation', weeks: '1-4', focus: 'volume' },
      { name: 'Strength', weeks: '5-8', focus: 'intensity' },
    ],
    progression_strategy: 'Weeks 1–4: 4×5 @ 70–75% 1RM +2.5%/week. Weeks 5–8: 4×3 @ 80–85%.',
    days: [
      {
        name: 'Lower Strength',
        estimated_duration_minutes: 60,
        exercises: [
          makeEx('0662', 'squat', {
            progression_model: 'percentage_rpe',
            week_progressions: [
              { week: 1, sets: 4, reps_min: 5, reps_max: 5, load_note: '70% 1RM' },
              { week: 2, sets: 4, reps_min: 5, reps_max: 5, load_note: '72.5% 1RM' },
              { week: 3, sets: 4, reps_min: 5, reps_max: 5, load_note: '75% 1RM' },
              { week: 4, sets: 3, reps_min: 5, reps_max: 5, load_note: '60% — deload' },
            ],
          }),
          makeEx('0663', 'hinge',           { progression_model: 'linear' }),
          makeEx('0664', 'lunge',           { progression_model: 'double_progression' }),
          makeEx('0665', 'core_antiextension', { progression_model: 'rep_progression' }),
        ],
      },
    ],
  }

  it('does NOT fire NO_STRUCTURED_PROGRESSION when week_progressions are present', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 8 })
    const issue = issues.find(i => i.code === 'NO_STRUCTURED_PROGRESSION')
    expect(issue).toBeUndefined()
  })
})

// ─── Fixture F: Alternating preference without sequencing_group ───────────────

describe('Fixture F — session_sequencing "alternating" with no sequencing_group → ALTERNATING_NOT_IMPLEMENTED', () => {
  const draft: ProgramDraft = {
    program_name: 'Alternating Pairs Program',
    session_sequencing: 'Push-pull alternating pairs throughout all sessions',
    weeks: 6,
    progression_strategy: 'Add 5 lb to main lifts each week when all reps completed.',
    days: [
      {
        name: 'Upper Body',
        estimated_duration_minutes: 60,
        exercises: [
          // 5 exercises, none have sequencing_group — alternating not implemented
          makeEx('0662', 'horizontal_push', { progression_model: 'linear' }),
          makeEx('0652', 'vertical_pull',   { progression_model: 'linear' }),
          makeEx('0663', 'incline_push',    { progression_model: 'double_progression' }),
          makeEx('0661', 'horizontal_pull', { progression_model: 'double_progression' }),
          makeEx('0667', 'tricep',          { progression_model: 'rep_progression' }),
        ],
      },
    ],
  }

  it('fires ALTERNATING_NOT_IMPLEMENTED as a warning', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 6 })
    const issue = issues.find(i => i.code === 'ALTERNATING_NOT_IMPLEMENTED')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('warning')
  })

  it('does NOT fire ALTERNATING_NOT_IMPLEMENTED when session has < 4 exercises', () => {
    const smallDraft: ProgramDraft = {
      ...draft,
      days: [{
        ...draft.days[0],
        exercises: draft.days[0].exercises.slice(0, 3),
      }],
    }
    const issues = validateProgramQuality(smallDraft, { fitnessLevel: 'intermediate', weeks: 6 })
    const issue = issues.find(i => i.code === 'ALTERNATING_NOT_IMPLEMENTED')
    expect(issue).toBeUndefined()
  })
})

// ─── Fixture G: SPARSE_SESSION is error for intermediate, not warning ─────────

describe('Fixture G — Intermediate sparse strength day → SPARSE_SESSION is error', () => {
  const draft: ProgramDraft = {
    program_name: 'Intermediate Strength',
    weeks: 6,
    progression_strategy: 'Add 5 lb to main lifts weekly.',
    days: [
      {
        name: 'Upper Strength',
        focus: 'Press-focused upper day',
        estimated_duration_minutes: 45,
        exercises: [
          makeEx('0662', 'horizontal_push', { progression_model: 'linear' }),
          makeEx('0652', 'vertical_pull',   { progression_model: 'linear' }),
          // only 2 exercises — sparse for intermediate
        ],
      },
    ],
  }

  it('SPARSE_SESSION is an error (not a warning) for intermediate', () => {
    const issues = validateProgramQuality(draft, { fitnessLevel: 'intermediate', weeks: 6 })
    const issue = issues.find(i => i.code === 'SPARSE_SESSION')
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('SPARSE_SESSION does NOT fire when fitnessLevel is not set', () => {
    const issues = validateProgramQuality(draft, { weeks: 6 })
    const issue = issues.find(i => i.code === 'SPARSE_SESSION')
    expect(issue).toBeUndefined()
  })
})
