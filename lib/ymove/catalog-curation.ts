import 'server-only'
import { prisma } from '@/lib/prisma'
import { exercises } from '@/lib/exercises'

// ── Thumbnail media ID lookup ─────────────────────────────────────────────────

/**
 * Batch-fetch thumbnailMediaId for a set of ymoveIds from the catalog.
 * Returns a Map<ymoveId, thumbnailMediaId | null>.
 * IDs not found in the catalog are omitted from the map.
 */
export async function getThumbnailMediaIds(
  ymoveIds: string[],
): Promise<Map<string, string | null>> {
  if (ymoveIds.length === 0) return new Map()
  const rows = await prisma.ymoveExerciseCatalog.findMany({
    where: { ymoveId: { in: ymoveIds } },
    select: { ymoveId: true, thumbnailMediaId: true },
  })
  return new Map(rows.map(r => [r.ymoveId, r.thumbnailMediaId]))
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const VALID_STATUSES = ['pending_review', 'approved', 'rejected', 'duplicate'] as const
export type CurationStatus = (typeof VALID_STATUSES)[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Action types ──────────────────────────────────────────────────────────────

export type CurationAction =
  | { type: 'approve' }
  | { type: 'reject' }
  | { type: 'mark_duplicate'; isDuplicateOf: string }
  | { type: 'link_exercise'; verifiedMediaFor: string }
  | { type: 'set_canonical'; canonicalId: string | null }
  | { type: 'set_notes'; notes: string }
  | { type: 'reset' }

export interface CurationError {
  code: 'NOT_FOUND' | 'INVALID_ACTION' | 'DUPLICATE_CYCLE' | 'UNKNOWN_EXERCISE' | 'INVALID_STATUS' | 'INVALID_DUPLICATE_TARGET'
  message: string
}

export class CurationValidationError extends Error {
  constructor(public readonly error: CurationError) {
    super(error.message)
    this.name = 'CurationValidationError'
  }
}

// ── Validation helpers ────────────────────────────────────────────────────────

const knownExerciseIds = new Set(exercises.map(e => e.id))

function validateExerciseId(id: string): void {
  if (!knownExerciseIds.has(id)) {
    throw new CurationValidationError({
      code: 'UNKNOWN_EXERCISE',
      message: `ExerciseDB exercise '${id}' not found in the exercise library.`,
    })
  }
}

async function detectDuplicateCycle(
  subjectYmoveId: string,
  targetYmoveId: string,
  maxDepth = 10,
): Promise<void> {
  if (subjectYmoveId === targetYmoveId) {
    throw new CurationValidationError({
      code: 'DUPLICATE_CYCLE',
      message: 'An exercise cannot be marked as a duplicate of itself.',
    })
  }

  // Walk the chain starting from targetYmoveId.
  // If we ever reach subjectYmoveId, there's a cycle.
  let cursor = targetYmoveId
  for (let i = 0; i < maxDepth; i++) {
    const row = await prisma.ymoveExerciseCatalog.findUnique({
      where: { ymoveId: cursor },
      select: { isDuplicateOf: true },
    })
    if (!row) break
    if (row.isDuplicateOf === null) break
    if (row.isDuplicateOf === subjectYmoveId) {
      throw new CurationValidationError({
        code: 'DUPLICATE_CYCLE',
        message: `Marking '${subjectYmoveId}' as duplicate of '${targetYmoveId}' would create a cycle.`,
      })
    }
    cursor = row.isDuplicateOf
  }
}

// ── Core curation function ────────────────────────────────────────────────────

/**
 * Apply a validated curation action to a single ymove_exercise_catalog record.
 *
 * Throws CurationValidationError for invalid inputs; other errors propagate.
 * Never touches workout, PR, program, template, or mapping tables.
 */
export async function applyCurationAction(
  ymoveId: string,
  action: CurationAction,
  adminUserId: string,
): Promise<void> {
  if (!UUID_RE.test(ymoveId)) {
    throw new CurationValidationError({
      code: 'INVALID_ACTION',
      message: 'Invalid ymoveId format.',
    })
  }

  const existing = await prisma.ymoveExerciseCatalog.findUnique({
    where: { ymoveId },
    select: { ymoveId: true, curationStatus: true },
  })
  if (!existing) {
    throw new CurationValidationError({
      code: 'NOT_FOUND',
      message: `Catalog entry '${ymoveId}' not found.`,
    })
  }

  const now = new Date()
  const base = { curatedAt: now, curatedBy: adminUserId }

  switch (action.type) {
    case 'approve':
      await prisma.ymoveExerciseCatalog.update({
        where: { ymoveId },
        data: { curationStatus: 'approved', ...base },
      })
      break

    case 'reject':
      await prisma.ymoveExerciseCatalog.update({
        where: { ymoveId },
        data: { curationStatus: 'rejected', verifiedMediaFor: null, isDuplicateOf: null, ...base },
      })
      break

    case 'mark_duplicate': {
      const target = action.isDuplicateOf.trim()
      if (!UUID_RE.test(target)) {
        throw new CurationValidationError({
          code: 'INVALID_DUPLICATE_TARGET',
          message: 'isDuplicateOf must be a valid YMove exercise UUID.',
        })
      }
      const targetExists = await prisma.ymoveExerciseCatalog.findUnique({
        where: { ymoveId: target },
        select: { ymoveId: true },
      })
      if (!targetExists) {
        throw new CurationValidationError({
          code: 'INVALID_DUPLICATE_TARGET',
          message: `Target exercise '${target}' not found in the catalog.`,
        })
      }
      await detectDuplicateCycle(ymoveId, target)
      await prisma.ymoveExerciseCatalog.update({
        where: { ymoveId },
        data: { curationStatus: 'duplicate', isDuplicateOf: target, verifiedMediaFor: null, ...base },
      })
      break
    }

    case 'link_exercise': {
      const exerciseId = action.verifiedMediaFor.trim()
      validateExerciseId(exerciseId)
      await prisma.ymoveExerciseCatalog.update({
        where: { ymoveId },
        data: { verifiedMediaFor: exerciseId, curationStatus: 'approved', isDuplicateOf: null, ...base },
      })
      break
    }

    case 'set_canonical':
      await prisma.ymoveExerciseCatalog.update({
        where: { ymoveId },
        data: { canonicalId: action.canonicalId?.trim() || null, ...base },
      })
      break

    case 'set_notes': {
      const notes = action.notes.slice(0, 500)
      await prisma.ymoveExerciseCatalog.update({
        where: { ymoveId },
        data: { curatorNotes: notes || null, ...base },
      })
      break
    }

    case 'reset':
      await prisma.ymoveExerciseCatalog.update({
        where: { ymoveId },
        data: {
          curationStatus: 'pending_review',
          verifiedMediaFor: null,
          isDuplicateOf: null,
          ...base,
        },
      })
      break

    default: {
      const _exhaustive: never = action
      throw new CurationValidationError({
        code: 'INVALID_ACTION',
        message: 'Unknown curation action.',
      })
    }
  }
}

// ── Bulk action ───────────────────────────────────────────────────────────────

export interface BulkCurationResult {
  applied: number
  skipped: number
  errors: Array<{ ymoveId: string; message: string }>
}

/**
 * Apply approve or reject to multiple catalog records in a single transaction.
 *
 * Each ID is validated independently; failures are collected rather than
 * aborting the entire batch. Max 100 IDs per call.
 */
export async function applyBulkCuration(
  ymoveIds: string[],
  action: 'approve' | 'reject',
  adminUserId: string,
): Promise<BulkCurationResult> {
  if (ymoveIds.length > 100) {
    throw new CurationValidationError({
      code: 'INVALID_ACTION',
      message: 'Bulk actions are limited to 100 IDs at a time.',
    })
  }

  const unique = [...new Set(ymoveIds.filter(id => UUID_RE.test(id)))]
  const invalid = ymoveIds.filter(id => !UUID_RE.test(id))

  const result: BulkCurationResult = {
    applied: 0,
    skipped: invalid.length,
    errors: invalid.map(id => ({ ymoveId: id, message: 'Invalid UUID format.' })),
  }

  if (unique.length === 0) return result

  const now = new Date()
  const data = action === 'approve'
    ? { curationStatus: 'approved', curatedAt: now, curatedBy: adminUserId }
    : { curationStatus: 'rejected', verifiedMediaFor: null, isDuplicateOf: null, curatedAt: now, curatedBy: adminUserId }

  const updated = await prisma.ymoveExerciseCatalog.updateMany({
    where: { ymoveId: { in: unique } },
    data,
  })

  result.applied = updated.count
  result.skipped += unique.length - updated.count

  return result
}
