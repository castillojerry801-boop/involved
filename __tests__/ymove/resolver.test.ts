/**
 * Tests for lib/ymove/resolver.ts
 *
 * Covers:
 *   - ymvToMeta shape and field mapping
 *   - verifyYmvIds — exists / missing / mixed / non-ymv pass-through
 *   - resolveExerciseMeta — routing by ID kind
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// ── Prisma mock ───────────────────────────────────────────────────────────────

const CATALOG_ROWS = [
  {
    ymoveId:            'aaaa0000-0000-0000-0000-000000000001',
    name:               'Barbell Back Squat',
    equipment:          'Barbell',
    primaryMuscleGroup: 'Quadriceps',
    thumbnailMediaId:   'thumb-001',
    hasVideo:           true,
  },
  {
    ymoveId:            'aaaa0000-0000-0000-0000-000000000002',
    name:               'Pull-Up',
    equipment:          'Bodyweight',
    primaryMuscleGroup: 'Latissimus Dorsi',
    thumbnailMediaId:   null,
    hasVideo:           true,
  },
]

const CUSTOM_ROW = {
  id:           'bbbb0000-0000-0000-0000-000000000001',
  userId:       'user-123',
  name:         'My Custom Exercise',
  bodyPart:     'chest',
  targetMuscle: 'pectoralis major',
  equipment:    'dumbbell',
  trackingType: 'strength',
  instructions: null,
  createdAt:    new Date(),
  updatedAt:    new Date(),
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ymoveExerciseCatalog: {
      findMany: ({ where }: { where: { ymoveId: { in: string[] } } }) =>
        Promise.resolve(
          CATALOG_ROWS.filter(r => where.ymoveId.in.includes(r.ymoveId))
        ),
      findUnique: ({ where }: { where: { ymoveId: string } }) =>
        Promise.resolve(CATALOG_ROWS.find(r => r.ymoveId === where.ymoveId) ?? null),
    },
    customExercise: {
      findFirst: ({ where }: { where: { id: string; userId: string } }) =>
        Promise.resolve(
          where.id === CUSTOM_ROW.id && where.userId === CUSTOM_ROW.userId
            ? CUSTOM_ROW
            : null
        ),
    },
  },
}))

// ── ExerciseDB mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/exercises', () => ({
  getExerciseById: (id: string) =>
    id === '0025'
      ? { id: '0025', name: 'Bench Press', bodyPart: 'chest', equipment: 'barbell',
          target: 'pectoralis major', secondaryMuscles: [], instructions: [], description: '' }
      : undefined,
  isCustomExerciseId: (id: string) => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return UUID_RE.test(id) && !id.startsWith('ymv:')
  },
}))

vi.mock('@/lib/training/custom-exercises', () => ({
  customToMeta: (c: typeof CUSTOM_ROW) => ({
    id:               c.id,
    name:             c.name,
    bodyPart:         c.bodyPart ?? 'other',
    equipment:        c.equipment ?? 'bodyweight',
    target:           c.targetMuscle ?? 'other',
    secondaryMuscles: [],
    instructions:     c.instructions ? [c.instructions] : [],
    description:      '',
    isCustom:         true,
    trackingType:     c.trackingType,
  }),
}))

// ── Import under test ─────────────────────────────────────────────────────────

import { ymvToMeta, verifyYmvIds, resolveExerciseMeta, prefetchYmvMeta } from '../../lib/ymove/resolver'
import { prisma } from '@/lib/prisma'

// ── ymvToMeta ─────────────────────────────────────────────────────────────────

describe('ymvToMeta', () => {
  it('produces ymv:-prefixed id', () => {
    const meta = ymvToMeta(CATALOG_ROWS[0])
    expect(meta.id).toBe('ymv:aaaa0000-0000-0000-0000-000000000001')
  })

  it('maps name from catalog row', () => {
    const meta = ymvToMeta(CATALOG_ROWS[0])
    expect(meta.name).toBe('Barbell Back Squat')
  })

  it('maps equipment from catalog row', () => {
    const meta = ymvToMeta(CATALOG_ROWS[0])
    expect(meta.equipment).toBe('Barbell')
  })

  it('maps primaryMuscleGroup to target', () => {
    const meta = ymvToMeta(CATALOG_ROWS[0])
    expect(meta.target).toBe('Quadriceps')
  })

  it('derives bodyPart from primaryMuscleGroup', () => {
    const meta = ymvToMeta(CATALOG_ROWS[0])
    expect(meta.bodyPart).toBe('upper legs')
  })

  it('derives bodyPart back correctly for lat exercises', () => {
    const meta = ymvToMeta(CATALOG_ROWS[1])
    expect(meta.bodyPart).toBe('back')
  })

  it('returns unknown bodyPart when primaryMuscleGroup is null', () => {
    const meta = ymvToMeta({ ...CATALOG_ROWS[0], primaryMuscleGroup: null })
    expect(meta.bodyPart).toBe('unknown')
  })

  it('defaults equipment to "unknown" when null', () => {
    const meta = ymvToMeta({ ...CATALOG_ROWS[0], equipment: null })
    expect(meta.equipment).toBe('unknown')
  })

  it('has empty secondaryMuscles and instructions arrays', () => {
    const meta = ymvToMeta(CATALOG_ROWS[0])
    expect(meta.secondaryMuscles).toEqual([])
    expect(meta.instructions).toEqual([])
  })
})

// ── verifyYmvIds ──────────────────────────────────────────────────────────────

describe('verifyYmvIds', () => {
  it('returns true when all ymv: IDs exist in catalog', async () => {
    const ok = await verifyYmvIds(
      ['ymv:aaaa0000-0000-0000-0000-000000000001', 'ymv:aaaa0000-0000-0000-0000-000000000002'],
      prisma as never,
    )
    expect(ok).toBe(true)
  })

  it('returns false when a ymv: ID is not in catalog', async () => {
    const ok = await verifyYmvIds(
      ['ymv:ffff0000-0000-0000-0000-000000000099'],
      prisma as never,
    )
    expect(ok).toBe(false)
  })

  it('returns true for empty array', async () => {
    const ok = await verifyYmvIds([], prisma as never)
    expect(ok).toBe(true)
  })

  it('ignores non-ymv IDs (exercisedb, custom, unknown)', async () => {
    const ok = await verifyYmvIds(
      ['0025', 'bbbb0000-0000-0000-0000-000000000001', 'not-an-id'],
      prisma as never,
    )
    expect(ok).toBe(true)
  })

  it('mixed: ymv: IDs that exist + non-ymv IDs → true', async () => {
    const ok = await verifyYmvIds(
      ['ymv:aaaa0000-0000-0000-0000-000000000001', '0025'],
      prisma as never,
    )
    expect(ok).toBe(true)
  })

  it('mixed: one existing ymv: + one missing ymv: → false', async () => {
    const ok = await verifyYmvIds(
      ['ymv:aaaa0000-0000-0000-0000-000000000001', 'ymv:ffff0000-0000-0000-0000-000000000099'],
      prisma as never,
    )
    expect(ok).toBe(false)
  })
})

// ── resolveExerciseMeta ───────────────────────────────────────────────────────

describe('resolveExerciseMeta', () => {
  it('resolves a ymv: ID from the catalog', async () => {
    const meta = await resolveExerciseMeta(
      'ymv:aaaa0000-0000-0000-0000-000000000001',
      'user-123',
      prisma as never,
    )
    expect(meta).not.toBeNull()
    expect(meta!.id).toBe('ymv:aaaa0000-0000-0000-0000-000000000001')
    expect(meta!.name).toBe('Barbell Back Squat')
  })

  it('returns null for a ymv: ID not in catalog', async () => {
    const meta = await resolveExerciseMeta(
      'ymv:ffff0000-0000-0000-0000-000000000099',
      'user-123',
      prisma as never,
    )
    expect(meta).toBeNull()
  })

  it('resolves a custom exercise ID by userId', async () => {
    const meta = await resolveExerciseMeta(
      'bbbb0000-0000-0000-0000-000000000001',
      'user-123',
      prisma as never,
    )
    expect(meta).not.toBeNull()
    expect(meta!.name).toBe('My Custom Exercise')
    expect(meta!.isCustom).toBe(true)
  })

  it('returns null for a custom ID belonging to a different user', async () => {
    const meta = await resolveExerciseMeta(
      'bbbb0000-0000-0000-0000-000000000001',
      'other-user',
      prisma as never,
    )
    expect(meta).toBeNull()
  })

  it('resolves an ExerciseDB 4-digit ID', async () => {
    const meta = await resolveExerciseMeta('0025', 'user-123', prisma as never)
    expect(meta).not.toBeNull()
    expect(meta!.name).toBe('Bench Press')
  })

  it('returns null for an unknown ExerciseDB ID', async () => {
    const meta = await resolveExerciseMeta('9999', 'user-123', prisma as never)
    expect(meta).toBeNull()
  })
})

// ── prefetchYmvMeta ───────────────────────────────────────────────────────────

describe('prefetchYmvMeta', () => {
  it('returns a map keyed by ymv:-prefixed IDs', async () => {
    const map = await prefetchYmvMeta(
      ['ymv:aaaa0000-0000-0000-0000-000000000001', '0025'],
      prisma as never,
    )
    expect(map.size).toBe(1)
    expect(map.has('ymv:aaaa0000-0000-0000-0000-000000000001')).toBe(true)
    expect(map.has('0025')).toBe(false)
  })

  it('returns empty map when no ymv: IDs provided', async () => {
    const map = await prefetchYmvMeta(['0025', 'bbbb0000-0000-0000-0000-000000000001'], prisma as never)
    expect(map.size).toBe(0)
  })

  it('deduplicates ymv: IDs before querying', async () => {
    const map = await prefetchYmvMeta(
      ['ymv:aaaa0000-0000-0000-0000-000000000001', 'ymv:aaaa0000-0000-0000-0000-000000000001'],
      prisma as never,
    )
    expect(map.size).toBe(1)
  })
})
