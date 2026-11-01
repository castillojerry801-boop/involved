import { describe, it, expect } from 'vitest'
import {
  isExerciseDbId,
  isCustomExerciseId,
  isYmvId,
  parseYmvId,
  formatYmvId,
  resolveExerciseKind,
} from '../../lib/exercises/identity'

const VALID_UUID   = '65e95132-e6bb-41e8-af7d-0eda931a1693'
const VALID_YMV    = `ymv:${VALID_UUID}`
const EXDB_ID      = '0025'
const EXDB_ZERO    = '0000'
const EXDB_MAX     = '9999'

// ── isExerciseDbId ────────────────────────────────────────────────────────────

describe('isExerciseDbId', () => {
  it('accepts 4-digit zero-padded numeric IDs', () => {
    expect(isExerciseDbId('0025')).toBe(true)
    expect(isExerciseDbId('0000')).toBe(true)
    expect(isExerciseDbId('9999')).toBe(true)
    expect(isExerciseDbId('1234')).toBe(true)
  })

  it('rejects IDs shorter or longer than 4 digits', () => {
    expect(isExerciseDbId('025')).toBe(false)
    expect(isExerciseDbId('00025')).toBe(false)
    expect(isExerciseDbId('')).toBe(false)
    expect(isExerciseDbId('1')).toBe(false)
  })

  it('rejects non-numeric strings', () => {
    expect(isExerciseDbId('abcd')).toBe(false)
    expect(isExerciseDbId('0025a')).toBe(false)
  })

  it('rejects UUIDs', () => {
    expect(isExerciseDbId(VALID_UUID)).toBe(false)
  })

  it('rejects ymv: IDs', () => {
    expect(isExerciseDbId(VALID_YMV)).toBe(false)
  })
})

// ── isYmvId ───────────────────────────────────────────────────────────────────

describe('isYmvId', () => {
  it('accepts well-formed ymv: IDs', () => {
    expect(isYmvId(VALID_YMV)).toBe(true)
    expect(isYmvId('ymv:00000000-0000-0000-0000-000000000000')).toBe(true)
  })

  it('rejects bare UUIDs without ymv: prefix', () => {
    expect(isYmvId(VALID_UUID)).toBe(false)
  })

  it('rejects ymv: with malformed UUID portion', () => {
    expect(isYmvId('ymv:not-a-uuid')).toBe(false)
    expect(isYmvId('ymv:')).toBe(false)
    expect(isYmvId('ymv:1234')).toBe(false)
    // Wrong segment lengths
    expect(isYmvId('ymv:65e95132-e6bb-41e8-af7d-0eda931a169')).toBe(false)
  })

  it('rejects ExerciseDB IDs', () => {
    expect(isYmvId(EXDB_ID)).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isYmvId('')).toBe(false)
  })
})

// ── isCustomExerciseId ────────────────────────────────────────────────────────

describe('isCustomExerciseId', () => {
  it('accepts bare UUIDs', () => {
    expect(isCustomExerciseId(VALID_UUID)).toBe(true)
    expect(isCustomExerciseId('00000000-0000-0000-0000-000000000000')).toBe(true)
  })

  it('rejects ymv:-prefixed UUIDs — critical collision guard', () => {
    // A YMove ID must NEVER resolve as a custom exercise
    expect(isCustomExerciseId(VALID_YMV)).toBe(false)
    expect(isCustomExerciseId(`ymv:${VALID_UUID}`)).toBe(false)
  })

  it('rejects ExerciseDB IDs', () => {
    expect(isCustomExerciseId(EXDB_ID)).toBe(false)
    expect(isCustomExerciseId(EXDB_ZERO)).toBe(false)
  })

  it('rejects malformed UUIDs', () => {
    expect(isCustomExerciseId('not-a-uuid')).toBe(false)
    expect(isCustomExerciseId('')).toBe(false)
    expect(isCustomExerciseId('65e95132-e6bb-41e8-af7d-0eda931a169')).toBe(false)
  })
})

// ── parseYmvId ────────────────────────────────────────────────────────────────

describe('parseYmvId', () => {
  it('returns the bare UUID from a valid ymv: ID', () => {
    expect(parseYmvId(VALID_YMV)).toBe(VALID_UUID)
  })

  it('returns null for bare UUIDs (missing prefix)', () => {
    expect(parseYmvId(VALID_UUID)).toBeNull()
  })

  it('returns null for ExerciseDB IDs', () => {
    expect(parseYmvId(EXDB_ID)).toBeNull()
  })

  it('returns null for ymv: with malformed UUID', () => {
    expect(parseYmvId('ymv:not-a-uuid')).toBeNull()
    expect(parseYmvId('ymv:')).toBeNull()
  })
})

// ── formatYmvId ──────────────────────────────────────────────────────────────

describe('formatYmvId', () => {
  it('wraps a bare UUID in the ymv: namespace', () => {
    expect(formatYmvId(VALID_UUID)).toBe(VALID_YMV)
  })

  it('round-trips with parseYmvId', () => {
    expect(parseYmvId(formatYmvId(VALID_UUID))).toBe(VALID_UUID)
  })
})

// ── resolveExerciseKind ───────────────────────────────────────────────────────

describe('resolveExerciseKind', () => {
  it('classifies ExerciseDB IDs correctly', () => {
    expect(resolveExerciseKind(EXDB_ID)).toBe('exercisedb')
    expect(resolveExerciseKind(EXDB_ZERO)).toBe('exercisedb')
    expect(resolveExerciseKind(EXDB_MAX)).toBe('exercisedb')
  })

  it('classifies ymv: IDs correctly', () => {
    expect(resolveExerciseKind(VALID_YMV)).toBe('ymove')
  })

  it('classifies bare UUIDs as custom', () => {
    expect(resolveExerciseKind(VALID_UUID)).toBe('custom')
  })

  it('returns unknown for unrecognised formats', () => {
    expect(resolveExerciseKind('')).toBe('unknown')
    expect(resolveExerciseKind('random-string')).toBe('unknown')
    expect(resolveExerciseKind('12345')).toBe('unknown')
    expect(resolveExerciseKind('abc')).toBe('unknown')
  })

  it('three spaces are disjoint — no ID classifies as more than one kind', () => {
    const ids = [EXDB_ID, VALID_YMV, VALID_UUID]
    const kinds = ids.map(resolveExerciseKind)
    const unique = new Set(kinds)
    expect(unique.size).toBe(ids.length)
  })

  it('ymv: ID never resolves as custom — collision guard', () => {
    expect(resolveExerciseKind(VALID_YMV)).not.toBe('custom')
  })
})
