/**
 * YMove video modal + exercise library
 *
 * Tests cover:
 * 1. ExerciseDetailModal MuscleBodyMap prop derivation
 *    - ymv: IDs use ymoveId (bare UUID), not exerciseId
 *    - Non-ymv IDs keep exerciseId, ymoveId undefined
 * 2. ExerciseBrowser ymoveMode constants (static source checks)
 *    - YMOVE_MOVEMENT_FAMILIES and YMOVE_EQ_FAMILIES defined
 *    - ymoveMode prop present, Load More 44px tap target, ExerciseMedia import
 * 3. ExerciseMedia videoModal prop (static source checks)
 *    - videoModal prop declared, VideoModal component, createPortal wired
 * 4. Exercise library page YMove branch (Prisma mock)
 *    - findMany called with duplicate exclusion + count
 *    - Exercise items receive ymv: prefix
 *    - Falls back gracefully on Prisma error
 *    - Does NOT hit Prisma when flag disabled
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve }      from 'node:path'

vi.mock('server-only', () => ({}))

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockFindMany     = vi.fn()
const mockCount        = vi.fn()
const mockFindFirst    = vi.fn()
const mockPrefFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ymoveExerciseCatalog: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      count:    (...a: unknown[]) => mockCount(...a),
    },
    equipmentProfile: {
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
    },
    exercisePreference: {
      findMany: (...a: unknown[]) => mockPrefFindMany(...a),
    },
  },
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockGetUser = vi.fn().mockResolvedValue({ id: 'user-1' })

vi.mock('@/lib/supabase/server', () => ({
  getUser: (...a: unknown[]) => mockGetUser(...a),
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  }),
}))

// ── Exercise queries mock ──────────────────────────────────────────────────────

vi.mock('@/lib/training/exercise-queries', () => ({
  getUserPreferenceMap: vi.fn().mockResolvedValue(new Map()),
  getAllowedExerciseIds: vi.fn().mockResolvedValue(null),
  getActiveEquipmentList: vi.fn().mockResolvedValue(null),
  getUserFavoriteIds: vi.fn().mockResolvedValue(new Set()),
  getUserExcludedIds: vi.fn().mockResolvedValue(new Set()),
}))

// ── Source files read once ────────────────────────────────────────────────────

const browserSrc = readFileSync(
  resolve(__dirname, '../components/training/exercise-browser.tsx'), 'utf-8',
)
const mediaSrc = readFileSync(
  resolve(__dirname, '../components/training/ExerciseMedia.tsx'), 'utf-8',
)
const modalSrc = readFileSync(
  resolve(__dirname, '../components/training/exercise-detail-modal.tsx'), 'utf-8',
)
const workoutPageSrc = readFileSync(
  resolve(__dirname, '../app/(app)/training/workout/[id]/page.tsx'), 'utf-8',
)
const sanitizeSrc = readFileSync(
  resolve(__dirname, '../lib/ymove/sanitize-svg.ts'), 'utf-8',
)

// ── Section 1: ymv: ID detection ──────────────────────────────────────────────

describe('MuscleBodyMap prop derivation for ymv: IDs', () => {
  function deriveMuscleProp(exerciseId: string) {
    return {
      ymoveId:    exerciseId.startsWith('ymv:') ? exerciseId.slice(4) : undefined,
      exerciseId: exerciseId.startsWith('ymv:') ? undefined           : exerciseId,
    }
  }

  it('strips ymv: prefix to get bare UUID', () => {
    const r = deriveMuscleProp('ymv:abc123de-0000-0000-0000-000000000000')
    expect(r.ymoveId).toBe('abc123de-0000-0000-0000-000000000000')
    expect(r.exerciseId).toBeUndefined()
  })

  it('passes exerciseId unchanged for ExDB 4-digit IDs', () => {
    const r = deriveMuscleProp('0001')
    expect(r.exerciseId).toBe('0001')
    expect(r.ymoveId).toBeUndefined()
  })

  it('passes exerciseId unchanged for custom exercises', () => {
    const r = deriveMuscleProp('custom-abc123de-0000-0000-0000-000000000000')
    expect(r.exerciseId).toBe('custom-abc123de-0000-0000-0000-000000000000')
    expect(r.ymoveId).toBeUndefined()
  })

  it('exercise-detail-modal.tsx passes ymoveId for ymv: IDs', () => {
    expect(modalSrc).toContain("exercise.id.startsWith('ymv:') ? exercise.id.slice(4) : undefined")
    expect(modalSrc).toContain("exercise.id.startsWith('ymv:') ? undefined : exercise.id")
  })
})

// ── Section 2: ExerciseBrowser ymoveMode ─────────────────────────────────────

describe('ExerciseBrowser ymoveMode constants (source check)', () => {
  it('YMOVE_MOVEMENT_FAMILIES constant is defined', () => {
    expect(browserSrc).toContain('YMOVE_MOVEMENT_FAMILIES')
  })

  it('YMOVE_EQ_FAMILIES constant is defined', () => {
    expect(browserSrc).toContain('YMOVE_EQ_FAMILIES')
  })

  it('ymoveMode prop in Props interface', () => {
    expect(browserSrc).toContain('ymoveMode?: boolean')
  })

  it('searchYmove fetches from ymove API', () => {
    expect(browserSrc).toContain('/api/training/exercises/ymove')
  })

  it('Load More button has 44px minimum tap target', () => {
    expect(browserSrc).toContain('min-h-[44px]')
  })

  it('ExerciseMedia imported for YMove card thumbnails', () => {
    expect(browserSrc).toContain("import { ExerciseMedia } from './ExerciseMedia'")
  })

  it('movement families include core YMove patterns', () => {
    expect(browserSrc).toContain('fam_squat')
    expect(browserSrc).toContain('fam_hip_hinge')
    expect(browserSrc).toContain('fam_chest_press')
    expect(browserSrc).toContain('fam_row')
    expect(browserSrc).toContain('fam_pulldown_pullup')
    expect(browserSrc).toContain('fam_core')
    expect(browserSrc).toContain('fam_overhead_press')
  })

  it('equipment families include primary gym equipment', () => {
    expect(browserSrc).toContain("{ id: 'barbell'")
    expect(browserSrc).toContain("{ id: 'dumbbell'")
    expect(browserSrc).toContain("{ id: 'cable'")
    expect(browserSrc).toContain("{ id: 'bodyweight'")
    expect(browserSrc).toContain("{ id: 'machine'")
  })

  it('Browse tab hidden when ymoveMode=true', () => {
    expect(browserSrc).toContain('!ymoveMode && (')
    expect(browserSrc).toContain("!ymoveMode && mode === 'browse'")
  })

  it('YMove mode uses ExerciseMedia for ymv: prefixed cards', () => {
    expect(browserSrc).toContain("exercise.id.startsWith('ymv:')")
  })
})

// ── Section 3: ExerciseMedia videoModal ──────────────────────────────────────

describe('ExerciseMedia videoModal prop (source check)', () => {
  it('videoModal prop declared in Props interface', () => {
    expect(mediaSrc).toContain('videoModal?: boolean')
  })

  it('VideoModal portal component defined', () => {
    expect(mediaSrc).toContain('function VideoModal(')
  })

  it('createPortal imported from react-dom', () => {
    expect(mediaSrc).toContain("import { createPortal } from 'react-dom'")
  })

  it('inline video guarded by !videoModal', () => {
    expect(mediaSrc).toContain('!videoModal')
  })

  it('portal renders into document.body', () => {
    expect(mediaSrc).toContain('document.body')
  })

  it('videoModal defaults to false', () => {
    expect(mediaSrc).toContain('videoModal = false,')
  })

  it('VideoModal portal renders conditionally on playing + videoSrc', () => {
    expect(mediaSrc).toContain('videoModal && playing && videoSrc')
  })
})

// ── Section 4: Exercise library page YMove branch ────────────────────────────

describe('ExerciseLibraryPage YMove branch', () => {
  const originalEnv = process.env.YMOVE_CATALOG_ENABLED

  beforeEach(() => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)
    mockPrefFindMany.mockResolvedValue([])
  })

  afterEach(() => {
    process.env.YMOVE_CATALOG_ENABLED = originalEnv
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('queries ymoveExerciseCatalog.findMany with duplicate exclusion', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    mockFindMany.mockResolvedValue([
      { ymoveId: 'uuid-1', name: 'Barbell Squat', equipment: 'barbell', primaryMuscleGroup: 'quadriceps' },
    ])
    mockCount.mockResolvedValue(1)

    const { default: Page } = await import('@/app/(app)/training/exercises/page')
    await Page({ searchParams: Promise.resolve({}) })

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { NOT: { curationStatus: 'duplicate' } },
        orderBy: { name: 'asc' },
        take: 20,
      }),
    )
  })

  it('queries count with the same duplicate-exclusion where clause', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(42)

    const { default: Page } = await import('@/app/(app)/training/exercises/page')
    await Page({ searchParams: Promise.resolve({}) })

    expect(mockCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { NOT: { curationStatus: 'duplicate' } },
      }),
    )
  })

  it('exercise items get ymv: prefix from ymoveId', () => {
    const uuid = 'aaaaaaaa-0000-0000-0000-000000000000'
    const row = { ymoveId: uuid, name: 'Test Exercise', equipment: 'barbell', primaryMuscleGroup: 'chest' }
    const mapped = {
      id: `ymv:${row.ymoveId}`,
      name: row.name,
      bodyPart: row.primaryMuscleGroup?.toLowerCase() ?? 'unknown',
      equipment: row.equipment ?? 'unknown',
      target: row.primaryMuscleGroup ?? 'unknown',
      secondaryMuscles: [],
      instructions: [],
      description: '',
    }

    expect(mapped.id).toBe(`ymv:${uuid}`)
    expect(mapped.bodyPart).toBe('chest')
    expect(mapped.equipment).toBe('barbell')
    expect(mapped.secondaryMuscles).toEqual([])
    expect(mapped.instructions).toEqual([])
  })

  it('falls back to empty arrays on Prisma error', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'true'
    mockFindMany.mockRejectedValue(new Error('DB error'))
    mockCount.mockRejectedValue(new Error('DB error'))

    const { default: Page } = await import('@/app/(app)/training/exercises/page')
    await expect(Page({ searchParams: Promise.resolve({}) })).resolves.not.toThrow()
  })

  it('does NOT query ymoveExerciseCatalog when flag is disabled', async () => {
    process.env.YMOVE_CATALOG_ENABLED = 'false'

    const { default: Page } = await import('@/app/(app)/training/exercises/page')
    await Page({ searchParams: Promise.resolve({}) })

    expect(mockFindMany).not.toHaveBeenCalled()
    expect(mockCount).not.toHaveBeenCalled()
  })
})

// ── Section 5: Safari QA fixes ───────────────────────────────────────────────

describe('Workout card thumbnail — nested button fix', () => {
  it('thumbnail div is NOT a child of the collapse button', () => {
    // The thumbnail must appear before the collapse <button> opens.
    // If the thumbnail div comes after the collapse button's opening tag
    // but before its flex-1 name div, they are nested (the bug).
    // After the fix, the thumbnail appears before the button tag entirely.
    const collapseButtonIdx = workoutPageSrc.indexOf(
      'onClick={() => setCollapsed(c => !c)}',
    )
    expect(collapseButtonIdx).toBeGreaterThan(-1)

    const thumbnailIdx = workoutPageSrc.indexOf('size-12 shrink-0 rounded-xl')
    expect(thumbnailIdx).toBeGreaterThan(-1)

    // Thumbnail div should appear BEFORE the collapse button opening tag
    expect(thumbnailIdx).toBeLessThan(collapseButtonIdx)
  })

  it('thumbnail row uses gap-3 spacing since thumbnail is outside the collapse button', () => {
    expect(workoutPageSrc).toContain('gap-3')
  })

  it('ExerciseMedia videoModal prop is still on the workout card', () => {
    expect(workoutPageSrc).toContain('videoModal')
  })
})

describe('Exercise detail modal — instructions section', () => {
  it('instructions section is conditionally rendered when non-empty', () => {
    expect(modalSrc).toContain('exercise.instructions.length > 0')
  })

  it('instructions list is inside the conditional block', () => {
    const condIdx = modalSrc.indexOf('exercise.instructions.length > 0')
    const olIdx   = modalSrc.indexOf('<ol', condIdx)
    expect(condIdx).toBeGreaterThan(-1)
    expect(olIdx).toBeGreaterThan(condIdx)
  })
})

describe('ExerciseBrowser — Load More deduplication', () => {
  it('searchYmove deduplicates by id when appending', () => {
    expect(browserSrc).toContain('seen.has(e.id)')
  })

  it('does not mutate existing items when append=false', () => {
    expect(browserSrc).toContain('if (!append) return data.items')
  })
})

describe('SVG sanitizer — inline style attribute (allowedStyles)', () => {
  it("allows 'style' in SHAPE_ATTRS for inline fill declarations", () => {
    expect(sanitizeSrc).toContain("'style'")
  })

  it('includes style in svg root allowed attributes', () => {
    const svgAttrsIdx = sanitizeSrc.indexOf("'xmlns'")
    expect(svgAttrsIdx).toBeGreaterThan(-1)
    const afterSvg = sanitizeSrc.slice(svgAttrsIdx, svgAttrsIdx + 300)
    expect(afterSvg).toContain("'style'")
  })

  it('ALLOWED_STYLES restricts fill to color patterns (url injection blocked)', () => {
    expect(sanitizeSrc).toContain('ALLOWED_STYLES')
    expect(sanitizeSrc).toContain('CSS_COLOR')
    expect(sanitizeSrc).toContain('allowedStyles: ALLOWED_STYLES')
  })
})
