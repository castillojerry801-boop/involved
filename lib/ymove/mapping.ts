import 'server-only'
import { readFileSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'

type Mapping = Record<string, string | null>

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
 * Returns all mappings (JSON baseline merged with DB).
 */
export async function getAllMappings(): Promise<Mapping> {
  return loadMapping()
}

/**
 * Upsert a single mapping entry to the database.
 * null = explicitly no ymove match. Works in production.
 */
export async function upsertMapping(exerciseDbId: string, ymoveId: string | null): Promise<void> {
  await prisma.ymoveMapping.upsert({
    where:  { exerciseDbId },
    create: { exerciseDbId, ymoveId },
    update: { ymoveId },
  })
}

/**
 * Remove a mapping entry from the database (back to "not yet checked").
 */
export async function deleteMapping(exerciseDbId: string): Promise<void> {
  await prisma.ymoveMapping.deleteMany({ where: { exerciseDbId } })
}
