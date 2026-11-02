/**
 * YMove display hydration regression tests
 *
 * Guards against the regression where getExerciseById() was used unconditionally
 * in server-rendered pages. getExerciseById() only knows about ExerciseDB (4-digit
 * IDs) — it returns undefined for ymv:uuid IDs, causing exercise names to fall
 * back to the raw ymv:uuid string and thumbnails to not render.
 *
 * Fix: all three pages now call prefetchYmvMeta() and compose it with
 * getExerciseById() via a resolveMeta() helper.
 *
 * Sections:
 *   1. Source-pattern verification — confirm fix is in place (prevents silent regression)
 *   2. resolveMeta pattern behavior — ymv:/ExDB/custom/unknown across all spaces
 *   3. History page: ymv: exercise renders name, not raw ID
 *   4. Programs page: ymv: exercise display name resolves correctly
 *   5. Workout CompletedCard: primary muscles use API-resolved target
 *   6. ExerciseDB preservation — existing ExDB exercises unaffected by the fix
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve }      from 'node:path'

vi.mock('server-only', () => ({}))

// ── Source files read once ────────────────────────────────────────────────────

const historySrc = readFileSync(
  resolve(__dirname, '../app/(app)/training/history/[id]/page.tsx'), 'utf-8',
)
const programsSrc = readFileSync(
  resolve(__dirname, '../app/(app)/training/programs/[id]/page.tsx'), 'utf-8',
)
const workoutPageSrc = readFileSync(
  resolve(__dirname, '../app/(app)/training/workout/[id]/page.tsx'), 'utf-8',
)

// ── Prisma mock ───────────────────────────────────────────────────────────────
// UUIDs must be lowercase hex only — parseYmvId validates against UUID_RE.

const YMV_BENCH = 'aabbccdd-ee11-2233-4455-667788990011'
const YMV_SQUAT = 'aabbccdd-ee11-2233-4455-667788990022'

const CATALOG_ROWS = [
  {
    ymoveId:            YMV_BENCH,
    name:               'Barbell Bench Press',
    equipment:          'barbell',
    category:           'Chest',
    primaryMuscleGroup: 'pectoralis major',
    thumbnailMediaId:   'thumb-bench-001',
    hasVideo:           true,
  },
  {
    ymoveId:            YMV_SQUAT,
    name:               'Barbell Back Squat',
    equipment:          'barbell',
    category:           'Legs',
    primaryMuscleGroup: 'quadriceps',
    thumbnailMediaId:   'thumb-squat-002',
    hasVideo:           true,
  },
]

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ymoveExerciseCatalog: {
      findMany: ({ where }: { where: { ymoveId: { in: string[] } } }) =>
        Promise.resolve(CATALOG_ROWS.filter(r => where.ymoveId.in.includes(r.ymoveId))),
      findUnique: ({ where }: { where: { ymoveId: string } }) =>
        Promise.resolve(CATALOG_ROWS.find(r => r.ymoveId === where.ymoveId) ?? null),
    },
    customExercise: {
      findFirst: () => Promise.resolve(null),
    },
  },
}))

// ── ExerciseDB mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/exercises', () => ({
  getExerciseById: (id: string) =>
    id === '0001'
      ? { id: '0001', name: 'ExDB Bench Press', bodyPart: 'chest', equipment: 'barbell',
          target: 'pectoralis major', secondaryMuscles: ['triceps'], instructions: ['step1'], description: '' }
      : undefined,
  isCustomExerciseId: (id: string) => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return UUID_RE.test(id) && !id.startsWith('ymv:')
  },
}))

vi.mock('@/lib/training/custom-exercises', () => ({
  customToMeta: () => null,
}))

import { prefetchYmvMeta } from '@/lib/ymove/resolver'
import { getExerciseById } from '@/lib/exercises'
import { prisma } from '@/lib/prisma'

// ── Section 1: Source-pattern verification ────────────────────────────────────
// Guards against silent regression where the fix is accidentally reverted.

describe('history/[id]/page.tsx — source patterns', () => {
  it('imports prefetchYmvMeta from ymove/resolver', () => {
    expect(historySrc).toContain("import { prefetchYmvMeta } from '@/lib/ymove/resolver'")
  })

  it('calls prefetchYmvMeta with exercise IDs and prisma', () => {
    expect(historySrc).toContain('prefetchYmvMeta(exerciseIds, prisma)')
  })

  it('uses ymvMap.get() + getExerciseById() composition', () => {
    expect(historySrc).toContain('ymvMap.get(eid) ?? getExerciseById(eid)')
  })

  it('uses resolveMeta helper for muscle derivation', () => {
    expect(historySrc).toContain('resolveMeta(we.exerciseId)')
  })

  it('uses resolveMeta helper for per-exercise rendering', () => {
    expect(historySrc).toContain('resolveMeta(ex.exerciseId)')
  })

  it('does not call getExerciseById directly with we.exerciseId', () => {
    expect(historySrc).not.toContain('getExerciseById(we.exerciseId)')
  })

  it('does not call getExerciseById directly with ex.exerciseId', () => {
    expect(historySrc).not.toContain('getExerciseById(ex.exerciseId)')
  })
})

describe('programs/[id]/page.tsx — source patterns', () => {
  it('imports prefetchYmvMeta from ymove/resolver', () => {
    expect(programsSrc).toContain("import { prefetchYmvMeta } from '@/lib/ymove/resolver'")
  })

  it('prefetches with allExerciseIds from all program days', () => {
    expect(programsSrc).toContain('allExerciseIds')
    expect(programsSrc).toContain('prefetchYmvMeta(allExerciseIds, prisma)')
  })

  it('uses resolveMeta helper per exercise', () => {
    expect(programsSrc).toContain('resolveMeta(ex.exerciseId)')
  })

  it('does not call getExerciseById directly with ex.exerciseId', () => {
    expect(programsSrc).not.toContain('getExerciseById(ex.exerciseId)')
  })
})

describe('workout/[id]/page.tsx CompletedCard — source patterns', () => {
  it('primary muscles read we.exercise?.target first (API-resolved covers ymv:)', () => {
    expect(workoutPageSrc).toContain('we.exercise?.target')
  })

  it('primary muscles do NOT use getExerciseById as the primary lookup path', () => {
    // Old pattern: getExerciseById(we.exerciseId) was the sole resolver — ymv: returned undefined
    // New pattern: we.exercise?.target comes first; getExerciseById is a fallback for ExDB
    // The old code was: const ex = getExerciseById(we.exerciseId); return ex ? [ex.target] : …
    // Verify the old unconditional-first-lookup pattern is gone
    expect(workoutPageSrc).not.toContain(
      'const ex = getExerciseById(we.exerciseId)\n      return ex ? [ex.target]'
    )
  })
})

// ── Section 2: resolveMeta pattern behavior ───────────────────────────────────

describe('resolveMeta composition — behavior across all ID spaces', () => {
  it('ymv: ID maps to catalog row name, not raw ymv:uuid string', async () => {
    const ymvId = `ymv:${YMV_BENCH}`
    const map = await prefetchYmvMeta([ymvId], prisma as never)
    const meta = map.get(ymvId)
    expect(meta).not.toBeNull()
    expect(meta!.name).toBe('Barbell Bench Press')
    expect(meta!.name).not.toContain('ymv:')
  })

  it('ymv: ID not in catalog returns undefined from map', async () => {
    const missing = 'ymv:ffffffff-0000-0000-0000-000000000099'
    const map = await prefetchYmvMeta([missing], prisma as never)
    expect(map.get(missing)).toBeUndefined()
  })

  it('ExDB ID is absent from ymvMap (parseYmvId rejects non-ymv: strings)', async () => {
    const map = await prefetchYmvMeta(['0001', `ymv:${YMV_BENCH}`], prisma as never)
    expect(map.has('0001')).toBe(false)
    expect(map.size).toBe(1)
  })

  it('composition: ymv: prefers catalog name over getExerciseById (which returns undefined)', async () => {
    const ymvId = `ymv:${YMV_BENCH}`
    const map = await prefetchYmvMeta([ymvId], prisma as never)
    const resolved = map.get(ymvId) ?? getExerciseById(ymvId)
    expect(resolved).not.toBeUndefined()
    expect(resolved!.name).toBe('Barbell Bench Press')
  })

  it('composition: ExDB ID falls through to getExerciseById when absent from ymvMap', async () => {
    const map = await prefetchYmvMeta(['0001'], prisma as never)
    const resolved = map.get('0001') ?? getExerciseById('0001')
    expect(resolved).not.toBeUndefined()
    expect(resolved!.name).toBe('ExDB Bench Press')
  })

  it('composition: unknown ID returns undefined from both', async () => {
    const map = await prefetchYmvMeta(['9999'], prisma as never)
    const resolved = map.get('9999') ?? getExerciseById('9999')
    expect(resolved).toBeUndefined()
  })
})

// ── Section 3: History page hydration simulation ──────────────────────────────

describe('history page hydration simulation', () => {
  async function buildResolveMeta(ids: string[]) {
    const ymvMap = await prefetchYmvMeta(ids, prisma as never)
    return (eid: string) => ymvMap.get(eid) ?? getExerciseById(eid)
  }

  it('ymv: exercise resolves to display name, not ymv:uuid string', async () => {
    const ids = [`ymv:${YMV_BENCH}`, `ymv:${YMV_SQUAT}`, '0001']
    const resolveMeta = await buildResolveMeta(ids)

    const bench = resolveMeta(`ymv:${YMV_BENCH}`)
    expect(bench?.name).toBe('Barbell Bench Press')
    expect(bench?.name).not.toMatch(/^ymv:/)

    const squat = resolveMeta(`ymv:${YMV_SQUAT}`)
    expect(squat?.name).toBe('Barbell Back Squat')
    expect(squat?.name).not.toMatch(/^ymv:/)
  })

  it('muscles worked section includes target from ymv: exercises', async () => {
    const ids = [`ymv:${YMV_BENCH}`]
    const resolveMeta = await buildResolveMeta(ids)

    const primaryMuscles = [...new Set(ids.flatMap(eid => {
      const ex = resolveMeta(eid)
      return ex ? [ex.target] : []
    }))]

    expect(primaryMuscles).toContain('pectoralis major')
    expect(primaryMuscles.some(m => m.startsWith('ymv:'))).toBe(false)
  })

  it('exercise thumbnail guard: meta is truthy for ymv: exercises (renders ExerciseMedia)', async () => {
    const ids = [`ymv:${YMV_BENCH}`]
    const resolveMeta = await buildResolveMeta(ids)
    // In the history page: {meta && <ExerciseMedia … />}
    // Before fix: meta was undefined → thumbnail not rendered
    // After fix:  meta is truthy  → thumbnail renders
    expect(resolveMeta(`ymv:${YMV_BENCH}`)).toBeTruthy()
  })

  it('ExDB exercise still resolves in the same pass', async () => {
    const ids = [`ymv:${YMV_BENCH}`, '0001']
    const resolveMeta = await buildResolveMeta(ids)
    expect(resolveMeta('0001')?.name).toBe('ExDB Bench Press')
  })
})

// ── Section 4: Programs page hydration simulation ─────────────────────────────

describe('programs page hydration simulation', () => {
  async function buildResolveMeta(ids: string[]) {
    const ymvMap = await prefetchYmvMeta(ids, prisma as never)
    return (eid: string) => ymvMap.get(eid) ?? getExerciseById(eid)
  }

  it('ymv: exercise displayName input is catalog name, not raw ymv:uuid', async () => {
    const ids = [`ymv:${YMV_BENCH}`, '0001']
    const resolveMeta = await buildResolveMeta(ids)

    // programs page: displayName: getInvolvedDisplayName(ex.exerciseId, meta?.name ?? ex.exerciseId)
    const benchMeta = resolveMeta(`ymv:${YMV_BENCH}`)
    const fallback  = `ymv:${YMV_BENCH}`
    const nameInput = benchMeta?.name ?? fallback
    expect(nameInput).toBe('Barbell Bench Press')
    expect(nameInput).not.toMatch(/^ymv:/)
  })

  it('bodyPart and target are populated for ymv: exercises', async () => {
    const ids = [`ymv:${YMV_SQUAT}`]
    const resolveMeta = await buildResolveMeta(ids)
    const meta = resolveMeta(`ymv:${YMV_SQUAT}`)
    expect(meta?.bodyPart).toBe('upper legs')
    expect(meta?.target).toBe('quadriceps')
  })

  it('program with mix of ymv: and ExDB returns populated metadata for both', async () => {
    const ids = [`ymv:${YMV_BENCH}`, `ymv:${YMV_SQUAT}`, '0001']
    const resolveMeta = await buildResolveMeta(ids)

    const results = ids.map(id => ({ id, name: resolveMeta(id)?.name }))
    expect(results).toEqual([
      { id: `ymv:${YMV_BENCH}`, name: 'Barbell Bench Press' },
      { id: `ymv:${YMV_SQUAT}`, name: 'Barbell Back Squat' },
      { id: '0001',              name: 'ExDB Bench Press' },
    ])
  })

  it('unknown exerciseId returns undefined (safe — no crash, no raw ID shown)', async () => {
    const ids = ['9999']
    const resolveMeta = await buildResolveMeta(ids)
    expect(resolveMeta('9999')).toBeUndefined()
  })
})

// ── Section 5: Workout CompletedCard primary muscles ─────────────────────────

describe('workout CompletedCard — primary muscles use API-resolved target', () => {
  type ExerciseField = { target: string } | null

  function computePrimaryMuscles(
    exercises: Array<{ exerciseId: string; exercise: ExerciseField }>,
  ) {
    return [...new Set(
      exercises.flatMap(we => {
        // Mirror the fixed CompletedCard logic: API-resolved target first
        const target = we.exercise?.target ?? getExerciseById(we.exerciseId)?.target
        return target ? [target] : []
      }),
    )]
  }

  it('ymv: exercise target comes from API-resolved exercise field', () => {
    const muscles = computePrimaryMuscles([
      { exerciseId: `ymv:${YMV_BENCH}`, exercise: { target: 'pectoralis major' } },
      { exerciseId: `ymv:${YMV_SQUAT}`, exercise: { target: 'quadriceps' } },
    ])
    expect(muscles).toContain('pectoralis major')
    expect(muscles).toContain('quadriceps')
  })

  it('ExDB exercise target still works via getExerciseById fallback', () => {
    // exercise field may be null if API resolution failed; ExDB lookup covers it
    const muscles = computePrimaryMuscles([
      { exerciseId: '0001', exercise: null },
    ])
    expect(muscles).toContain('pectoralis major')
  })

  it('both ymv: and ExDB exercises contribute muscles in one workout', () => {
    const muscles = computePrimaryMuscles([
      { exerciseId: `ymv:${YMV_SQUAT}`, exercise: { target: 'quadriceps' } },
      { exerciseId: '0001', exercise: null },
    ])
    expect(muscles).toContain('quadriceps')
    expect(muscles).toContain('pectoralis major')
  })

  it('missing exercise (null API + unknown ExDB) contributes no muscles', () => {
    const muscles = computePrimaryMuscles([
      { exerciseId: 'ymv:ffffffff-0000-0000-0000-000000000099', exercise: null },
    ])
    expect(muscles).toHaveLength(0)
  })
})

// ── Section 6: ExerciseDB preservation ───────────────────────────────────────

describe('ExerciseDB preservation after hydration fix', () => {
  it('ExDB exercise name resolves correctly when no ymv: IDs in batch', async () => {
    const ymvMap = await prefetchYmvMeta(['0001'], prisma as never)
    const resolveMeta = (eid: string) => ymvMap.get(eid) ?? getExerciseById(eid)
    expect(ymvMap.size).toBe(0)
    expect(resolveMeta('0001')?.name).toBe('ExDB Bench Press')
  })

  it('ExDB exercise muscles appear in history page simulation', async () => {
    const ymvMap = await prefetchYmvMeta(['0001'], prisma as never)
    const resolveMeta = (eid: string) => ymvMap.get(eid) ?? getExerciseById(eid)
    const primaryMuscles = ['0001'].flatMap(eid => {
      const ex = resolveMeta(eid)
      return ex ? [ex.target] : []
    })
    expect(primaryMuscles).toContain('pectoralis major')
  })

  it('ExDB secondary muscles still available via getExerciseById fallback', async () => {
    const ymvMap = await prefetchYmvMeta(['0001'], prisma as never)
    const resolveMeta = (eid: string) => ymvMap.get(eid) ?? getExerciseById(eid)
    const secondaryMuscles = ['0001'].flatMap(eid => resolveMeta(eid)?.secondaryMuscles ?? [])
    expect(secondaryMuscles).toContain('triceps')
  })

  it('prefetchYmvMeta with mixed IDs does not affect ExDB resolution', async () => {
    const ids = [`ymv:${YMV_BENCH}`, '0001', `ymv:${YMV_SQUAT}`]
    const ymvMap = await prefetchYmvMeta(ids, prisma as never)
    const resolveMeta = (eid: string) => ymvMap.get(eid) ?? getExerciseById(eid)
    // ExDB still works alongside ymv: IDs
    expect(resolveMeta('0001')?.name).toBe('ExDB Bench Press')
    expect(resolveMeta(`ymv:${YMV_BENCH}`)?.name).toBe('Barbell Bench Press')
  })
})
