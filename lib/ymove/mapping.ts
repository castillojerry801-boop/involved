import 'server-only'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Mapping = Record<string, string | null>

export interface MappingMeta {
  ymoveId:    string | null
  verifiedAt: Date | null
}

function loadJsonBaseline(): Mapping {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'data/ymove-exercise-mapping.json'), 'utf8')) as Mapping
  } catch {
    return {}
  }
}

// Merge JSON baseline with DB overrides (DB wins).
async function loadMapping(): Promise<Mapping> {
  const [json, rows] = await Promise.all([
    Promise.resolve(loadJsonBaseline()),
    prisma.ymoveMapping.findMany(),
  ])
  const merged: Mapping = { ...json }
  for (const row of rows) {
    merged[row.exerciseDbId] = row.ymoveId ?? null
  }
  return merged
}

/**
 * Returns the ymove exercise UUID for a given ExerciseDB exercise ID,
 * or undefined if no verified mapping exists.
 *
 * A null value means "explicitly checked — no ymove match for this exercise."
 * undefined means "not yet checked."
 */
export async function getYmoveExerciseId(exerciseDbId: string): Promise<string | null | undefined> {
  // Fast path: check DB row directly (avoids loading all JSON).
  const row = await prisma.ymoveMapping.findUnique({ where: { exerciseDbId } })
  if (row !== null) return row.ymoveId ?? null

  // Fall back to JSON baseline.
  const json = loadJsonBaseline()
  if (!(exerciseDbId in json)) return undefined
  return json[exerciseDbId]
}

/**
 * Returns all mappings (JSON baseline merged with DB) as exerciseDbId → ymoveId.
 * Callers that only need ymoveId should use this (fast path).
 */
export async function getAllMappings(): Promise<Mapping> {
  return loadMapping()
}

/**
 * Returns all mappings with full metadata (ymoveId + verifiedAt).
 * DB rows always win over JSON baseline. JSON baseline items have verifiedAt=null.
 */
export async function getAllMappingsWithMeta(): Promise<Record<string, MappingMeta>> {
  const [json, rows] = await Promise.all([
    Promise.resolve(loadJsonBaseline()),
    prisma.ymoveMapping.findMany(),
  ])
  const result: Record<string, MappingMeta> = {}
  // JSON baseline (unverified by definition)
  for (const [exerciseDbId, ymoveId] of Object.entries(json)) {
    result[exerciseDbId] = { ymoveId, verifiedAt: null }
  }
  // DB rows override JSON
  for (const row of rows) {
    result[row.exerciseDbId] = {
      ymoveId:    row.ymoveId ?? null,
      verifiedAt: row.verifiedAt ?? null,
    }
  }
  return result
}

/**
 * Upsert a single mapping entry to the database.
 * - ymoveId: null = explicitly no ymove match.
 * - verified: true = admin watched the video and confirmed; sets verifiedAt = now().
 *   Omitting or passing false clears verifiedAt (verification resets on any write).
 */
export async function upsertMapping(
  exerciseDbId: string,
  ymoveId: string | null,
  verified = false,
): Promise<void> {
  const verifiedAt = verified ? new Date() : null
  await prisma.ymoveMapping.upsert({
    where:  { exerciseDbId },
    create: { exerciseDbId, ymoveId, verifiedAt },
    update: { ymoveId, verifiedAt },
  })
}

/**
 * Remove a mapping entry from the database (back to "not yet checked").
 */
export async function deleteMapping(exerciseDbId: string): Promise<void> {
  await prisma.ymoveMapping.deleteMany({ where: { exerciseDbId } })
}

// ── Conflict resolution ───────────────────────────────────────────────────────

export interface ConflictOwner {
  exerciseDbId: string
  ymoveId:      string
  verifiedAt:   Date | null
  /** updatedAt from the DB row; new Date(0) sentinel for JSON-only entries. */
  updatedAt:    Date
  /** True when there is no DB row — the mapping comes from the JSON baseline only. */
  isJsonOnly:   boolean
}

/**
 * Returns all current owners of a given ymove UUID.
 * Includes both DB rows and JSON-baseline-only entries that have no DB override.
 */
export async function getConflictOwners(ymoveId: string): Promise<ConflictOwner[]> {
  const json   = loadJsonBaseline()
  const dbRows = await prisma.ymoveMapping.findMany({ where: { ymoveId } })
  const dbIds  = new Set(dbRows.map(r => r.exerciseDbId))

  const owners: ConflictOwner[] = dbRows.map(row => ({
    exerciseDbId: row.exerciseDbId,
    ymoveId:      row.ymoveId!,
    verifiedAt:   row.verifiedAt,
    updatedAt:    row.updatedAt,
    isJsonOnly:   false,
  }))

  for (const [dbId, jYmoveId] of Object.entries(json)) {
    if (jYmoveId === ymoveId && !dbIds.has(dbId)) {
      owners.push({
        exerciseDbId: dbId,
        ymoveId,
        verifiedAt:   null,
        updatedAt:    new Date(0),
        isJsonOnly:   true,
      })
    }
  }
  return owners
}

/** Returns the raw DB row for a single exercise (updatedAt exposed for staleness checks). */
export async function getMappingRow(
  exerciseDbId: string,
): Promise<{ ymoveId: string | null; updatedAt: Date } | null> {
  const row = await prisma.ymoveMapping.findUnique({ where: { exerciseDbId } })
  if (!row) return null
  return { ymoveId: row.ymoveId ?? null, updatedAt: row.updatedAt }
}

export interface TransferOptions {
  destExerciseDbId:      string
  ymoveId:               string
  action:                'move_here' | 'use_for_both'
  /** DB IDs to null-out (move_here only). Also covers JSON-baseline entries. */
  revokeFromDbIds:       string[]
  /** Subset of revokeFromDbIds that have no existing DB row (JSON-only). */
  isJsonOnlyIds:         string[]
  verified:              boolean
  /** exerciseDbId → ISO updatedAt for CAS validation on revoked DB rows. */
  expectedUpdatedAts:    Record<string, string>
  /** ISO updatedAt of the destination's current DB row; null if no DB row exists. */
  expectedDestUpdatedAt: string | null
  /** All owner exerciseDbIds the admin saw when the compare panel loaded (move_here: detect new arrivals). */
  expectedOwnerDbIds:    string[]
}

export interface TransferResult {
  revoked:    string[]
  assigned:   string
  verifiedAt: Date | null
}

/**
 * Atomically transfer or share a ymove UUID under SERIALIZABLE isolation.
 *
 * move_here — revoke selected owners (CAS on DB rows; null-override for JSON-only),
 *             then assign ymoveId to dest.
 * use_for_both — assign ymoveId to dest; existing owners are untouched.
 *
 * All reads and writes run in a single SERIALIZABLE transaction. PostgreSQL will
 * reject any concurrent transaction that modifies the same rows with a P2034
 * serialization error, which the caller translates to a 409 response.
 *
 * Throws { code: 'STALE', exerciseDbId, reason? } on detected conflicts.
 */
export async function transferMapping(opts: TransferOptions): Promise<TransferResult> {
  const {
    destExerciseDbId, ymoveId, action,
    revokeFromDbIds, isJsonOnlyIds, verified,
    expectedUpdatedAts, expectedDestUpdatedAt, expectedOwnerDbIds,
  } = opts
  const verifiedAt  = verified ? new Date() : null
  const jsonOnlySet = new Set(isJsonOnlyIds)

  await prisma.$transaction(async tx => {

    // ── 1. New-owner detection (move_here only) ──────────────────────────────
    // Reading ymove_mapping here creates a Serializable predicate lock, so any
    // concurrent insert of a new owner will cause a serialization failure.
    if (action === 'move_here' && expectedOwnerDbIds.length > 0) {
      const currentOwners = await tx.ymoveMapping.findMany({ where: { ymoveId } })
      const expectedSet   = new Set(expectedOwnerDbIds)
      const unexpected    = currentOwners.filter(
        r => !expectedSet.has(r.exerciseDbId) && r.exerciseDbId !== destExerciseDbId,
      )
      if (unexpected.length > 0) {
        throw Object.assign(
          new Error(`New owner of this YMove UUID appeared since the panel opened: ${unexpected[0].exerciseDbId}`),
          { code: 'STALE', exerciseDbId: unexpected[0].exerciseDbId, reason: 'new_owner' },
        )
      }
    }

    // ── 2. Source revocation (move_here only) ────────────────────────────────
    if (action === 'move_here') {
      for (const revokeDbId of revokeFromDbIds) {
        if (jsonOnlySet.has(revokeDbId)) {
          // JSON-only: fail atomically if a DB row appeared concurrently
          const row = await tx.ymoveMapping.findUnique({ where: { exerciseDbId: revokeDbId } })
          if (row !== null) {
            throw Object.assign(
              new Error(`Concurrent change: ${revokeDbId} now has a DB mapping`),
              { code: 'STALE', exerciseDbId: revokeDbId },
            )
          }
          // Null override prevents the JSON baseline from re-surfacing
          await tx.ymoveMapping.create({
            data: { exerciseDbId: revokeDbId, ymoveId: null, verifiedAt: null },
          })
        } else {
          // CAS: update only if updatedAt still matches expected
          const expected = expectedUpdatedAts[revokeDbId]
          if (!expected) {
            throw Object.assign(
              new Error(`Missing expectedUpdatedAt for source ${revokeDbId}`),
              { code: 'STALE', exerciseDbId: revokeDbId },
            )
          }
          const result = await tx.ymoveMapping.updateMany({
            where: { exerciseDbId: revokeDbId, updatedAt: new Date(expected) },
            data:  { ymoveId: null, verifiedAt: null },
          })
          if (result.count === 0) {
            throw Object.assign(
              new Error(`Source mapping changed concurrently: ${revokeDbId}`),
              { code: 'STALE', exerciseDbId: revokeDbId },
            )
          }
        }
      }
    }

    // ── 3. Destination write with staleness guard ────────────────────────────
    if (expectedDestUpdatedAt === null) {
      // No DB row expected — fail if one was created concurrently
      const existing = await tx.ymoveMapping.findUnique({ where: { exerciseDbId: destExerciseDbId } })
      if (existing !== null) {
        throw Object.assign(
          new Error(`Destination ${destExerciseDbId} was mapped concurrently`),
          { code: 'STALE', exerciseDbId: destExerciseDbId, reason: 'destination_changed' },
        )
      }
      await tx.ymoveMapping.create({
        data: { exerciseDbId: destExerciseDbId, ymoveId, verifiedAt },
      })
    } else {
      // CAS: update only if updatedAt still matches
      const result = await tx.ymoveMapping.updateMany({
        where: { exerciseDbId: destExerciseDbId, updatedAt: new Date(expectedDestUpdatedAt) },
        data:  { ymoveId, verifiedAt },
      })
      if (result.count === 0) {
        throw Object.assign(
          new Error(`Destination mapping changed concurrently: ${destExerciseDbId}`),
          { code: 'STALE', exerciseDbId: destExerciseDbId, reason: 'destination_changed' },
        )
      }
    }

  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  return {
    revoked:    action === 'move_here' ? revokeFromDbIds : [],
    assigned:   destExerciseDbId,
    verifiedAt,
  }
}
