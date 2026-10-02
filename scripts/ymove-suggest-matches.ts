#!/usr/bin/env tsx
/**
 * DEV-ONLY script: suggest ymove exercise matches for canonical exercises.
 *
 * Usage:
 *   npx tsx scripts/ymove-suggest-matches.ts              # all unmapped exercises
 *   npx tsx scripts/ymove-suggest-matches.ts --limit 20   # first 20 unmapped
 *   npx tsx scripts/ymove-suggest-matches.ts --id 0026    # single exercise by ID
 *   npx tsx scripts/ymove-suggest-matches.ts --output data/ymove-mapping-suggestions.json
 *
 * Output: a JSON report of candidate matches per exercise for human review.
 * Nothing is written to ymove-exercise-mapping.json automatically.
 * Use the admin page at /admin/ymove-mapping to approve suggestions.
 */

import 'dotenv/config'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const YMOVE_BASE = 'https://exercise-api.ymove.app/api/v2'

const apiKey = process.env.YMOVE_API_KEY
if (!apiKey) {
  console.error('Error: YMOVE_API_KEY is not set. Add it to .env.local and retry.')
  process.exit(1)
}

interface Exercise {
  id: string
  name: string
}

interface YmoveCandidate {
  ymoveId: string
  name: string
}

interface SuggestionEntry {
  exerciseDbId: string
  displayName: string
  candidates: YmoveCandidate[]
  searchedAt: string
}

async function searchYmove(query: string, limit = 5): Promise<YmoveCandidate[]> {
  const res = await fetch(
    `${YMOVE_BASE}/exercises?search=${encodeURIComponent(query)}&pageSize=${limit}&includeVideos=false`,
    { headers: { 'X-API-Key': apiKey! } },
  )
  if (!res.ok) {
    console.warn(`  ymove search failed (${res.status}) for: ${query}`)
    return []
  }
  const body = await res.json()
  const list: Record<string, unknown>[] =
    Array.isArray(body)             ? body
    : Array.isArray(body.exercises) ? body.exercises
    : Array.isArray(body.data)      ? body.data
    : []

  return list
    .filter(item => item?.id)
    .map(item => ({
      ymoveId: item.id as string,
      name:    (item.name ?? item.title ?? '') as string,
    }))
}

// Normalize an ExerciseDB name to a display-friendly label.
function normalize(name: string): string {
  return name
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

async function main() {
  const args = process.argv.slice(2)
  const idFlag      = args.indexOf('--id')
  const limitFlag   = args.indexOf('--limit')
  const outputFlag  = args.indexOf('--output')
  const candidatesFlag = args.indexOf('--candidates')

  const singleId    = idFlag      >= 0 ? args[idFlag + 1]      : null
  const limit       = limitFlag   >= 0 ? Number(args[limitFlag + 1])   : Infinity
  const outputPath  = outputFlag  >= 0 ? args[outputFlag + 1]  : null
  const numCandidates = candidatesFlag >= 0 ? Number(args[candidatesFlag + 1]) : 5

  const exercises: Exercise[] = JSON.parse(
    readFileSync(join(process.cwd(), 'data/exercises.json'), 'utf8')
  )
  const mapping: Record<string, string | null> = JSON.parse(
    readFileSync(join(process.cwd(), 'data/ymove-exercise-mapping.json'), 'utf8')
  )

  const targets = singleId
    ? exercises.filter(ex => ex.id === singleId)
    : exercises.filter(ex => !(ex.id in mapping))

  const toProcess = isFinite(limit) ? targets.slice(0, limit) : targets

  console.log(`\nymove suggestion run`)
  console.log(`  Exercises to check: ${toProcess.length}`)
  console.log(`  Candidates per exercise: ${numCandidates}`)
  if (outputPath) console.log(`  Output: ${outputPath}`)
  console.log()

  const suggestions: SuggestionEntry[] = []
  let i = 0

  for (const ex of toProcess) {
    i++
    const displayName = normalize(ex.name)
    process.stdout.write(`[${i}/${toProcess.length}] ${displayName}… `)

    const candidates = await searchYmove(displayName, numCandidates)
    suggestions.push({
      exerciseDbId: ex.id,
      displayName,
      candidates,
      searchedAt: new Date().toISOString(),
    })

    if (candidates.length === 0) {
      console.log('no results')
    } else {
      console.log(`${candidates.length} candidates — top: "${candidates[0].name}"`)
    }

    // Polite delay to avoid hammering the API
    if (i < toProcess.length) await new Promise(r => setTimeout(r, 150))
  }

  const output = {
    generatedAt: new Date().toISOString(),
    note: 'Review candidates below. Use /admin/ymove-mapping to approve entries.',
    suggestions,
  }

  if (outputPath) {
    writeFileSync(join(process.cwd(), outputPath), JSON.stringify(output, null, 2) + '\n', 'utf8')
    console.log(`\nWrote ${suggestions.length} entries to ${outputPath}`)
  } else {
    console.log('\n' + JSON.stringify(output, null, 2))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
