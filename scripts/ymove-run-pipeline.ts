#!/usr/bin/env tsx
/**
 * DEV-ONLY: Automated ExerciseDB → YMove catalog matching pipeline.
 *
 * Runs deterministic scoring for every unmapped exercise and classifies
 * each proposed match as high_confidence, needs_review, or unmatched.
 *
 * SAFETY: All YMove requests use includeVideos=false (browse mode).
 *   ✓ Does NOT consume monthly video allowance.
 *   ✓ Does NOT modify data/ymove-exercise-mapping.json.
 *   ✓ Does NOT activate any new video playback.
 *
 * Output: data/ymove-suggested-mappings.json  (human-review required)
 *
 * Usage:
 *   npx tsx scripts/ymove-run-pipeline.ts              # all unmapped exercises
 *   npx tsx scripts/ymove-run-pipeline.ts --limit 50   # first N unmapped
 *   npx tsx scripts/ymove-run-pipeline.ts --id 0007    # single exercise by ID
 *   npx tsx scripts/ymove-run-pipeline.ts --candidates 8   # more candidates
 *   npx tsx scripts/ymove-run-pipeline.ts --resume     # skip already-suggested
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'

// Load .env.local (dotenv is not a project dependency)
try {
  const envFile = readFileSync('.env.local', 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch { /* .env.local absent or unreadable */ }
import { join } from 'path'
import {
  buildSearchQuery,
  rankCandidates,
  type ExerciseMetadata,
  type YmoveCandidateRaw,
} from '../lib/ymove/search'
import {
  classifyScore,
  summarizeSuggestions,
  type MatchSuggestion,
  type SuggestionsFile,
  THRESHOLD_HIGH,
  THRESHOLD_NEEDS,
} from '../lib/ymove/pipeline'

// ── Config ────────────────────────────────────────────────────────────────────

const YMOVE_BASE    = 'https://exercise-api.ymove.app/api/v2'
const DELAY_MS      = 275   // polite inter-request delay
const MAX_RETRIES   = 3
const OUTPUT_PATH   = join(process.cwd(), 'data/ymove-suggested-mappings.json')

const apiKey = process.env.YMOVE_API_KEY
if (!apiKey) {
  console.error('Error: YMOVE_API_KEY is not set. Add it to .env.local and retry.')
  process.exit(1)
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawExercise {
  id:               string
  name:             string
  equipment:        string
  bodyPart:         string
  target:           string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleCase(name: string): string {
  return name
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Browse-mode search — includeVideos=false, never charges cap.
async function searchYmoveBrowse(
  query: string,
  limit: number,
  retries = 0,
): Promise<YmoveCandidateRaw[]> {
  const url = `${YMOVE_BASE}/exercises?search=${encodeURIComponent(query)}&pageSize=${limit}&includeVideos=false`
  let res: Response
  try {
    res = await fetch(url, { headers: { 'X-API-Key': apiKey! } })
  } catch (err) {
    if (retries < MAX_RETRIES) {
      await sleep(1000 * (retries + 1))
      return searchYmoveBrowse(query, limit, retries + 1)
    }
    console.warn(`  fetch error after ${MAX_RETRIES} retries: ${String(err)}`)
    return []
  }

  if (res.status === 429) {
    if (retries >= MAX_RETRIES) {
      console.warn('  rate limited; giving up after max retries')
      return []
    }
    let wait = 5000
    try {
      const body = await res.json() as { retryAfterMs?: number }
      if (body.retryAfterMs) wait = body.retryAfterMs + 500
    } catch { /* ignore */ }
    console.warn(`  rate limited — waiting ${Math.round(wait / 1000)}s…`)
    await sleep(wait)
    return searchYmoveBrowse(query, limit, retries + 1)
  }

  if (!res.ok) {
    console.warn(`  search failed (HTTP ${res.status}) for: ${query}`)
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
      ymoveId:   item.id          as string,
      name:      (item.name ?? item.title ?? '') as string,
      equipment: item.equipment   as string | undefined,
      muscles:   item.muscles     as string[] | undefined,
      category:  item.category    as string | undefined,
    }))
}

// Attempt to get total catalog size (informational; not critical).
async function fetchCatalogSize(): Promise<number | null> {
  try {
    const res = await fetch(
      `${YMOVE_BASE}/exercises?pageSize=1&includeVideos=false`,
      { headers: { 'X-API-Key': apiKey! } },
    )
    if (!res.ok) return null
    const body = await res.json()
    // API may return total/count/pagination.total in various shapes
    const total =
      body.total                    ??
      body.count                    ??
      body.pagination?.total        ??
      body.meta?.total              ??
      null
    return typeof total === 'number' ? total : null
  } catch {
    return null
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args          = process.argv.slice(2)
  const idIdx         = args.indexOf('--id')
  const limitIdx      = args.indexOf('--limit')
  const candidatesIdx = args.indexOf('--candidates')
  const resume        = args.includes('--resume')

  const singleId      = idIdx         >= 0 ? args[idIdx + 1]         : null
  const runLimit      = limitIdx      >= 0 ? Number(args[limitIdx + 1]) : Infinity
  const numCandidates = candidatesIdx >= 0 ? Number(args[candidatesIdx + 1]) : 5

  // Load exercises
  const exercises: RawExercise[] = JSON.parse(
    readFileSync(join(process.cwd(), 'data/exercises.json'), 'utf8')
  )

  // Load active mapping (skip already-mapped exercises)
  const activeMapping: Record<string, string | null> = JSON.parse(
    readFileSync(join(process.cwd(), 'data/ymove-exercise-mapping.json'), 'utf8')
  )

  // Load existing suggestions if resuming
  const existingSuggestions = new Map<string, MatchSuggestion>()
  if (resume && existsSync(OUTPUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as SuggestionsFile
      if (prev.version === 1) {
        for (const s of prev.suggestions) existingSuggestions.set(s.exerciseDbId, s)
      }
      console.log(`  Resume mode: ${existingSuggestions.size} existing suggestions loaded`)
    } catch { /* start fresh */ }
  }

  // Determine targets
  let targets = singleId
    ? exercises.filter(ex => ex.id === singleId)
    : exercises.filter(ex => {
        if (ex.id in activeMapping) return false // already mapped or marked no-match
        if (resume && existingSuggestions.has(ex.id)) return false // already suggested
        return true
      })

  if (isFinite(runLimit)) targets = targets.slice(0, runLimit)

  const catalogSize = await fetchCatalogSize()

  console.log('\nymove matching pipeline')
  console.log(`  YMove catalog size:      ${catalogSize !== null ? catalogSize.toLocaleString() : 'unknown'}`)
  console.log(`  ExerciseDB exercises:    ${exercises.length.toLocaleString()}`)
  console.log(`  Already mapped/checked:  ${Object.keys(activeMapping).length}`)
  console.log(`  To process:              ${targets.length}`)
  console.log(`  Candidates per exercise: ${numCandidates}`)
  console.log(`  includeVideos:           false (browse mode — no cap charge)`)
  console.log(`  Confidence thresholds:   high≥${THRESHOLD_HIGH}  review≥${THRESHOLD_NEEDS}`)
  console.log()

  const newSuggestions: MatchSuggestion[] = []
  let i = 0

  for (const ex of targets) {
    i++
    const displayName = titleCase(ex.name)
    const meta: ExerciseMetadata = {
      exerciseDbId: ex.id,
      displayName,
      equipment:    ex.equipment,
      bodyPart:     ex.bodyPart,
      target:       ex.target,
    }
    const searchQuery = buildSearchQuery(meta)

    process.stdout.write(`[${i}/${targets.length}] ${displayName}… `)

    const rawCandidates = await searchYmoveBrowse(searchQuery, numCandidates)
    const ranked        = rankCandidates(rawCandidates, meta)
    const topMatch      = ranked[0] ?? null
    const status        = topMatch ? classifyScore(topMatch.score) : 'unmatched'

    const suggestion: MatchSuggestion = {
      exerciseDbId:    ex.id,
      displayName,
      equipment:       ex.equipment,
      bodyPart:        ex.bodyPart,
      target:          ex.target,
      searchQuery,
      status,
      topMatch,
      otherCandidates: ranked.slice(1, 5),
      searchedAt:      new Date().toISOString(),
    }
    newSuggestions.push(suggestion)

    const label = topMatch
      ? `[${status}] score=${topMatch.score} "${topMatch.name}"`
      : '[unmatched] no candidates'
    console.log(label)

    if (i < targets.length) await sleep(DELAY_MS)
  }

  // Merge with existing if resuming
  const finalSuggestions = resume
    ? [...existingSuggestions.values(), ...newSuggestions]
    : newSuggestions

  const summary = summarizeSuggestions(finalSuggestions)
  const output: SuggestionsFile = {
    version:     1,
    generatedAt: new Date().toISOString(),
    summary,
    suggestions: finalSuggestions,
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8')

  console.log()
  console.log('── Results ──────────────────────────────────────────────')
  console.log(`  YMove catalog size:      ${catalogSize !== null ? catalogSize.toLocaleString() : 'unknown'}`)
  console.log(`  Exercises processed:     ${newSuggestions.length}`)
  console.log(`  High confidence (≥${THRESHOLD_HIGH}):  ${summary.highConfidence}`)
  console.log(`  Needs review   (≥${THRESHOLD_NEEDS}):  ${summary.needsReview}`)
  console.log(`  Unmatched      (<${THRESHOLD_NEEDS}):  ${summary.unmatched}`)
  console.log(`  Output:                  data/ymove-suggested-mappings.json`)
  console.log()
  console.log('Review suggestions at /admin/ymove-mapping (Suggestions tab).')
  console.log('Do not commit data/ymove-suggested-mappings.json until reviewed.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
