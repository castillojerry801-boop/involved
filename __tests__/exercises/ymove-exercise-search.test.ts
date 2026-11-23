import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeExerciseSearchAsync } from '../../lib/ai/tools/exercises'

vi.mock('server-only', () => ({}))

// Prisma types not needed — we pass a minimal mock
function catalogRow(
  name: string,
  equipment: string | null,
  category: string | null,
  curationStatus = 'approved',
) {
  return {
    ymoveId: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    equipment,
    category,
    primaryMuscleGroup: null,
    curationStatus,
  }
}

function makeDb(rows: ReturnType<typeof catalogRow>[]) {
  return {
    ymoveExerciseCatalog: { findMany: vi.fn().mockResolvedValue(rows) },
  }
}

function callArgs(db: ReturnType<typeof makeDb>) {
  return (db.ymoveExerciseCatalog.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
}

// All tests require the ymove catalog flag to be active
beforeEach(() => {
  vi.stubEnv('YMOVE_CATALOG_ENABLED', 'true')
})

// ── Classification correctness after Priority 1 fix ───────────────────────────

describe('executeExerciseSearchAsync — vertical_pull classification (Priority 1 regression)', () => {
  it('returns Lat Pulldown when category is Back (production regression)', async () => {
    const db = makeDb([
      catalogRow('Lat Pulldown',    'Cable', 'Back'),
      catalogRow('Seated Cable Row','Cable', 'Back'),
    ])
    const results = await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', limit: 5 }, db as any)
    expect(results.map(r => r.name)).toContain('Lat Pulldown')
    expect(results.map(r => r.name)).not.toContain('Seated Cable Row')
  })

  it('returns Wide Grip and Assisted variants with category Back', async () => {
    const db = makeDb([
      catalogRow('Wide Grip Lat Pulldown', 'Cable',            'Back'),
      catalogRow('Assisted Pull-Up',        'Leverage Machine', 'Back'),
      catalogRow('Chin-Up',                 'Bodyweight',       'Back'),
    ])
    const results = await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', limit: 10 }, db as any)
    expect(results.length).toBe(3)
    expect(results.every(r => r.movementPattern === 'vertical_pull')).toBe(true)
  })

  it('row exercises with category Back are not returned for vertical_pull', async () => {
    const db = makeDb([
      catalogRow('Barbell Bent Over Row', 'Barbell', 'Back'),
      catalogRow('Dumbbell Row',          'Dumbbell', 'Back'),
    ])
    const results = await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', limit: 5 }, db as any)
    expect(results).toHaveLength(0)
  })
})

// ── Deterministic retrieval (Priority 2) ─────────────────────────────────────

describe('executeExerciseSearchAsync — deterministic retrieval (Priority 2)', () => {
  it('queries with orderBy name asc for insertion-order independence', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', limit: 5 }, db as any)
    expect(callArgs(db)).toMatchObject({ orderBy: { name: 'asc' } })
  })

  it('applies vertical_pull OR hints in WHERE clause', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', limit: 5 }, db as any)
    const { OR } = callArgs(db).where
    expect(OR).toBeDefined()
    const catClause = OR.find((c: any) => c.category?.in)
    expect(catClause?.category?.in).toContain('Pull')
    expect(catClause?.category?.in).toContain('calisthenics')
  })

  it('applies horizontal_pull hints (Back category)', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'horizontal_pull', limit: 5 }, db as any)
    const { OR } = callArgs(db).where
    const catClause = OR.find((c: any) => c.category?.in)
    expect(catClause?.category?.in).toContain('Back')
  })

  it('applies squat hints (Legs category)', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'squat', limit: 5 }, db as any)
    const { OR } = callArgs(db).where
    const catClause = OR.find((c: any) => c.category?.in)
    expect(catClause?.category?.in).toContain('Legs')
  })

  it('applies hinge hints (Legs and Back categories)', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'hinge', limit: 5 }, db as any)
    const { OR } = callArgs(db).where
    const catClause = OR.find((c: any) => c.category?.in)
    expect(catClause?.category?.in).toContain('Legs')
    expect(catClause?.category?.in).toContain('Back')
  })

  it('applies horizontal_push hints (Chest and Push categories)', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'horizontal_push', limit: 5 }, db as any)
    const { OR } = callArgs(db).where
    const catClause = OR.find((c: any) => c.category?.in)
    expect(catClause?.category?.in).toContain('Chest')
    expect(catClause?.category?.in).toContain('Push')
  })

  it('applies vertical_push hints (Shoulders category)', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'vertical_push', limit: 5 }, db as any)
    const { OR } = callArgs(db).where
    const catClause = OR.find((c: any) => c.category?.in)
    expect(catClause?.category?.in).toContain('Shoulders')
  })

  it('applies bicep hints (Arms and Arms - Biceps categories)', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'bicep', limit: 5 }, db as any)
    const { OR } = callArgs(db).where
    const catClause = OR.find((c: any) => c.category?.in)
    expect(catClause?.category?.in).toContain('Arms')
    expect(catClause?.category?.in).toContain('Arms - Biceps')
  })

  it('applies tricep hints (Arms - Triceps category)', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'tricep', limit: 5 }, db as any)
    const { OR } = callArgs(db).where
    const catClause = OR.find((c: any) => c.category?.in)
    expect(catClause?.category?.in).toContain('Arms - Triceps')
  })

  it('no OR hint applied when movementPattern is omitted', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ query: 'squat', limit: 5 }, db as any)
    expect(callArgs(db).where.OR).toBeUndefined()
  })

  it('no OR hint applied for unrecognised movement pattern', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'other' as any, limit: 5 }, db as any)
    expect(callArgs(db).where.OR).toBeUndefined()
  })
})

// ── Existing invariants preserved ─────────────────────────────────────────────

describe('executeExerciseSearchAsync — preserved invariants', () => {
  it('excludes duplicate exercises', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', limit: 5 }, db as any)
    expect(callArgs(db).where.NOT).toEqual({ curationStatus: 'duplicate' })
  })

  it('equipment param passed through to WHERE clause', async () => {
    const db = makeDb([catalogRow('Lat Pulldown', 'Cable', 'Pull')])
    await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', equipment: 'cable', limit: 5 }, db as any)
    expect(callArgs(db).where.equipment).toEqual({ contains: 'cable', mode: 'insensitive' })
  })

  it('equipment param not present in WHERE when omitted', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', limit: 5 }, db as any)
    expect(callArgs(db).where.equipment).toBeUndefined()
  })

  it('query param applied alongside hints', async () => {
    const db = makeDb([])
    await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', query: 'lat', limit: 5 }, db as any)
    expect(callArgs(db).where.name).toEqual({ contains: 'lat', mode: 'insensitive' })
    expect(callArgs(db).where.OR).toBeDefined()
  })

  it('results capped at limit', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      catalogRow(`Lat Pulldown ${i}`, 'Cable', 'Pull'),
    )
    const db = makeDb(rows)
    const results = await executeExerciseSearchAsync({ movementPattern: 'vertical_pull', limit: 5 }, db as any)
    expect(results.length).toBeLessThanOrEqual(5)
  })
})

// ── End-to-end Back/Triceps production regression ─────────────────────────────

describe('executeExerciseSearchAsync — Back/Triceps production regression', () => {
  it('vertical_pull and horizontal_pull each receive correct exercises (P1 + P2 combined)', async () => {
    const rows = [
      catalogRow('Lat Pulldown',           'Cable',    'Back'),
      catalogRow('Wide Grip Lat Pulldown', 'Cable',    'Back'),
      catalogRow('Assisted Pull-Up',        'Machine',  'Back'),
      catalogRow('Seated Cable Row',        'Cable',    'Back'),
      catalogRow('Barbell Bent Over Row',   'Barbell',  'Back'),
    ]

    const dbVP = makeDb(rows)
    const dbHP = makeDb(rows)

    const vpResults = await executeExerciseSearchAsync({ movementPattern: 'vertical_pull',   limit: 10 }, dbVP as any)
    const hpResults = await executeExerciseSearchAsync({ movementPattern: 'horizontal_pull', limit: 10 }, dbHP as any)

    // vertical_pull gets pulldowns and pull-ups
    expect(vpResults.map(r => r.name)).toContain('Lat Pulldown')
    expect(vpResults.map(r => r.name)).toContain('Wide Grip Lat Pulldown')
    expect(vpResults.map(r => r.name)).toContain('Assisted Pull-Up')
    expect(vpResults.map(r => r.name)).not.toContain('Seated Cable Row')
    expect(vpResults.map(r => r.name)).not.toContain('Barbell Bent Over Row')

    // horizontal_pull gets rows
    expect(hpResults.map(r => r.name)).toContain('Seated Cable Row')
    expect(hpResults.map(r => r.name)).toContain('Barbell Bent Over Row')
    expect(hpResults.map(r => r.name)).not.toContain('Lat Pulldown')
  })
})
