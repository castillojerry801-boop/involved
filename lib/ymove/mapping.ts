import 'server-only'
import { readFileSync } from 'fs'
import { join } from 'path'

type Mapping = Record<string, string | null>

// Production: cache on first load (mapping is baked in at deploy time).
// Development: re-read on every call so admin tool writes are visible immediately.
let _prodCache: Mapping | null = null

function loadMapping(): Mapping {
  if (process.env.NODE_ENV === 'production') {
    if (_prodCache) return _prodCache
    _prodCache = JSON.parse(readFileSync(join(process.cwd(), 'data/ymove-exercise-mapping.json'), 'utf8')) as Mapping
    return _prodCache
  }
  return JSON.parse(readFileSync(join(process.cwd(), 'data/ymove-exercise-mapping.json'), 'utf8')) as Mapping
}

/**
 * Returns the ymove exercise UUID for a given ExerciseDB exercise ID,
 * or undefined if no verified mapping exists.
 *
 * A null value means "explicitly checked — no ymove match for this exercise."
 * undefined means "not yet checked."
 */
export function getYmoveExerciseId(exerciseDbId: string): string | null | undefined {
  const m = loadMapping()
  if (!(exerciseDbId in m)) return undefined
  return m[exerciseDbId]
}

/**
 * Read the full mapping (DEV-ONLY — for admin tooling).
 * Returns every entry, including null (no-match) entries.
 */
export function getAllMappings(): Mapping {
  return loadMapping()
}

/**
 * Atomically write the full mapping back to disk (DEV-ONLY).
 * Throws in production — the filesystem is read-only on Vercel.
 */
export function writeMapping(mapping: Mapping): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('writeMapping must not be called in production')
  }
  const { writeFileSync } = require('fs') as typeof import('fs')
  writeFileSync(
    join(process.cwd(), 'data/ymove-exercise-mapping.json'),
    JSON.stringify(mapping, null, 2) + '\n',
    'utf8',
  )
}
