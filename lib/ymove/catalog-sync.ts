import 'server-only'
import { prisma } from '@/lib/prisma'
import { isTrustedThumbnailUrl } from '@/lib/ymove/client'

const YMOVE_BASE = 'https://exercise-api.ymove.app/api/v2'
const PAGE_SIZE = 50
// Safety cap: 50 × 50 = 2,500 — covers full catalog plus growth headroom.
const DEFAULT_MAX_PAGES = 50
const MAX_RETRIES = 3

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function apiKey(): string {
  const k = process.env.YMOVE_API_KEY
  if (!k) throw new Error('YMOVE_API_KEY is not configured')
  return k
}

// ── Concurrent sync guard ─────────────────────────────────────────────────────
// Vercel Fluid Compute reuses function instances across concurrent requests.
// An in-process flag prevents two admin-triggered syncs from running in the
// same instance simultaneously. (Different instances cannot share state, but
// overlapping upserts from two instances are safe due to idempotency.)
let _syncInFlight = false

export interface SyncResult {
  /** Total exercises reported by YMove pagination on page 1. 0 if page 1 failed. */
  total:       number
  /** Exercises received from the API (may include cross-page duplicates). */
  fetched:     number
  /** Unique exercise IDs among fetched (duplicates skipped before DB write). */
  unique:      number
  /** Exercises skipped: malformed UUID or cross-page duplicate. */
  skipped:     number
  /** Rows upserted to ymove_exercise_catalog (creates + updates). */
  written:     number
  /** Pages that failed all retry attempts. Their exercises were not written. */
  pageErrors:  number
  /** Pages successfully fetched and processed. */
  pages:       number
  /**
   * True iff the sync processed every page the API reported and no page errors
   * occurred. False for intentional maxPages runs or any failure.
   * Always check this — do not infer completeness from other fields alone.
   */
  isComplete:  boolean
  durationMs:  number
}

export interface SyncOptions {
  /** Maximum pages to fetch. Default: 50 (covers 2,500 exercises). */
  maxPages?: number
  /** Fetch pages without writing to the database. */
  dryRun?:  boolean
}

interface YmoveListExercise {
  id:               string
  title:            string
  slug:             string
  description?:     string
  muscleGroup?:     string
  muscleGroups?:    string[]
  secondaryMuscles?: string[]
  equipment?:       string
  category?:        string
  difficulty?:      string
  hasVideo?:        boolean
  exerciseType?:    string[]
  thumbnailUrl?:    string
  thumbnails?: {
    default?:   string
    [key: string]: string | undefined
  }
}

interface PageResponse {
  data: YmoveListExercise[]
  pagination: {
    page:       number
    pageSize:   number
    total:      number
    totalPages: number
  }
}

function extractMediaId(ex: YmoveListExercise): string | null {
  const src = ex.thumbnails?.default ?? ex.thumbnailUrl ?? ''
  if (!isTrustedThumbnailUrl(src)) return null
  try {
    const last = new URL(src).pathname.split('/').pop()
    return last && UUID_RE.test(last) ? last : null
  } catch {
    return null
  }
}

async function fetchPage(page: number): Promise<PageResponse | null> {
  const url = `${YMOVE_BASE}/exercises?page=${page}&pageSize=${PAGE_SIZE}&includeVideos=false`
  let lastErr: unknown

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential back-off: 1s, 2s
      await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    }
    try {
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey() },
        cache: 'no-store',
      })

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After')
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5_000
        console.warn(`[ymove-catalog] rate limited on page ${page}, waiting ${delay}ms`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }

      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} on page ${page}`)
        continue
      }

      return (await res.json()) as PageResponse
    } catch (e) {
      lastErr = e
    }
  }

  console.error(`[ymove-catalog] page ${page} failed after ${MAX_RETRIES} attempts:`, lastErr)
  return null
}

interface UpsertResult { written: number; skipped: number }

async function upsertPage(
  exercises: YmoveListExercise[],
  seenIds:   Set<string>,
): Promise<UpsertResult> {
  const now = new Date()
  let written = 0, skipped = 0

  for (const ex of exercises) {
    // Reject malformed IDs — never write garbage to the catalog.
    if (!ex.id || !UUID_RE.test(ex.id)) {
      console.warn('[ymove-catalog] skipping exercise with malformed id:', ex.id)
      skipped++
      continue
    }

    // Reject cross-page duplicates (API should never return these, but be safe).
    if (seenIds.has(ex.id)) {
      console.warn('[ymove-catalog] skipping cross-page duplicate id:', ex.id)
      skipped++
      continue
    }
    seenIds.add(ex.id)

    const thumbnailMediaId = extractMediaId(ex)

    await prisma.ymoveExerciseCatalog.upsert({
      where:  { ymoveId: ex.id },
      create: {
        ymoveId:             ex.id,
        name:                ex.title ?? '',
        slug:                ex.slug ?? '',
        description:         ex.description ?? null,
        primaryMuscleGroup:  ex.muscleGroup ?? null,
        muscleGroupsJson:    ex.muscleGroups     ?? [],
        secondaryMusclesJson: ex.secondaryMuscles ?? [],
        equipment:           ex.equipment  ?? null,
        category:            ex.category   ?? null,
        difficulty:          ex.difficulty ?? null,
        hasVideo:            ex.hasVideo   ?? false,
        exerciseTypesJson:   ex.exerciseType ?? [],
        thumbnailMediaId,
        syncedAt:            now,
      },
      update: {
        name:                ex.title ?? '',
        slug:                ex.slug ?? '',
        description:         ex.description ?? null,
        primaryMuscleGroup:  ex.muscleGroup ?? null,
        muscleGroupsJson:    ex.muscleGroups     ?? [],
        secondaryMusclesJson: ex.secondaryMuscles ?? [],
        equipment:           ex.equipment  ?? null,
        category:            ex.category   ?? null,
        difficulty:          ex.difficulty ?? null,
        hasVideo:            ex.hasVideo   ?? false,
        exerciseTypesJson:   ex.exerciseType ?? [],
        thumbnailMediaId,
        syncedAt:            now,
      },
    })
    written++
  }

  return { written, skipped }
}

/**
 * Sync the full YMove exercise catalog into ymove_exercise_catalog.
 *
 * Fetches all pages with includeVideos=false (no video cap charge).
 * Upserts on ymove_id — safe to run repeatedly; existing mappings,
 * workouts, PRs, templates, programs, and V Coach data are untouched.
 *
 * Returns a full diagnostic including isComplete so callers can detect
 * partial runs without guessing from counts.
 *
 * The admin trigger is at POST /api/admin/ymove-catalog/sync.
 * Do not call from user-facing code paths.
 */
export async function syncYmoveCatalog(opts: SyncOptions = {}): Promise<SyncResult> {
  // Fail fast — a missing API key would otherwise loop through all pages,
  // each failing all retries with backoff delays.
  apiKey()

  // Concurrent sync guard — reject overlapping calls in the same process.
  if (_syncInFlight) {
    throw new Error('A catalog sync is already in progress. Wait for it to complete before retrying.')
  }
  _syncInFlight = true

  const { maxPages = DEFAULT_MAX_PAGES, dryRun = false } = opts
  const start = Date.now()

  let total = 0, fetched = 0, written = 0, skipped = 0, pageErrors = 0, pages = 0
  let totalApiPages: number | null = null
  const seenIds = new Set<string>()

  try {
    for (let page = 1; ; page++) {
      // Stop when we've reached the API's reported total or our cap.
      if (totalApiPages !== null && page > totalApiPages) break
      if (page > maxPages) break

      const data = await fetchPage(page)

      if (!data) {
        pageErrors++
        // If page 1 fails we don't know the catalog size — abort rather than
        // loop blindly through up to maxPages more failing requests.
        if (page === 1) {
          console.error('[ymove-catalog] page 1 failed — aborting sync, catalog size unknown')
          break
        }
        continue
      }

      if (page === 1) {
        total         = data.pagination.total
        totalApiPages = data.pagination.totalPages
      }

      fetched += data.data.length
      pages++

      if (!dryRun && data.data.length > 0) {
        const r = await upsertPage(data.data, seenIds)
        written += r.written
        skipped += r.skipped
      } else if (dryRun) {
        // In dry-run mode still track unique / skipped for accurate diagnostics.
        for (const ex of data.data) {
          if (!ex.id || !UUID_RE.test(ex.id) || seenIds.has(ex.id)) {
            skipped++
          } else {
            seenIds.add(ex.id)
          }
        }
      }
    }
  } finally {
    _syncInFlight = false
  }

  const unique = seenIds.size
  const ranAllApiPages = totalApiPages !== null && pages >= totalApiPages
  const hitMaxPagesCap = totalApiPages !== null && maxPages < totalApiPages
  const isComplete = pageErrors === 0 && ranAllApiPages && !hitMaxPagesCap

  if (dryRun) {
    console.log(`[ymove-catalog] dry run: ${fetched} fetched, ${unique} unique, ${skipped} skipped, ${pages} pages (${pageErrors} errors)`)
  } else {
    console.log(`[ymove-catalog] sync ${isComplete ? 'COMPLETE' : 'PARTIAL'}: ${written}/${unique} written, ${skipped} skipped, ${pageErrors} page errors, ${Date.now() - start}ms`)
  }

  return { total, fetched, unique, skipped, written, pageErrors, pages, isComplete, durationMs: Date.now() - start }
}
