import 'server-only'
import { readFileSync } from 'fs'
import { join } from 'path'
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
