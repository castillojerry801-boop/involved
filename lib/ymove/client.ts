import 'server-only'

const YMOVE_BASE = 'https://exercise-api.ymove.app/api/v2'

function apiKey(): string {
  const k = process.env.YMOVE_API_KEY
  if (!k) throw new Error('YMOVE_API_KEY is not configured')
  return k
}

export interface YmoveThumbnails {
  default: string
  square: string
  portrait: string
  landscape: string
}

export interface YmoveMedia {
  ymoveId: string
  thumbnailUrl: string
  thumbnails: YmoveThumbnails
  videoUrl?: string
  videoHlsUrl?: string
  videoDurationSecs?: number
}

export interface YmoveCandidate {
  ymoveId: string
  name: string
  thumbnailUrl: string
}

// In-memory cache: ymove UUID → thumbnail data.
// Thumbnails are permanent CDN URLs; safe to hold for the life of a deployment.
// Video URLs expire in 48 h and are never cached here.
const _uuidCache = new Map<string, YmoveMedia | null>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMedia(data: Record<string, any>): YmoveMedia {
  const t = (data.thumbnails ?? {}) as Record<string, string>
  const base = (data.thumbnailUrl ?? '') as string
  return {
    ymoveId:   data.id as string,
    thumbnailUrl: base,
    thumbnails: {
      default:   t.default   ?? base,
      square:    t.square    ?? base,
      portrait:  t.portrait  ?? base,
      landscape: t.landscape ?? base,
    },
    videoUrl:          data.videoUrl          as string | undefined,
    videoHlsUrl:       data.videoHlsUrl       as string | undefined,
    videoDurationSecs: data.videoDurationSecs  as number | undefined,
  }
}

async function fetchByUuid(uuid: string): Promise<YmoveMedia | null> {
  const res = await fetch(
    `${YMOVE_BASE}/exercises/${encodeURIComponent(uuid)}?includeVideos=true`,
    { headers: { 'X-API-Key': apiKey() }, cache: 'no-store' },
  )
  if (!res.ok) return null
  const data = await res.json()
  if (!data?.id) return null
  return parseMedia(data)
}

/**
 * Fetch ymove media by its exact exercise UUID.
 *
 * This is the only production-safe lookup path — no name matching,
 * no fuzzy search. The UUID must come from a verified entry in
 * data/ymove-exercise-mapping.json.
 */
export async function getYmoveById(
  ymoveId: string,
  includeVideo = false,
): Promise<YmoveMedia | null> {
  if (!includeVideo && _uuidCache.has(ymoveId)) {
    return _uuidCache.get(ymoveId) ?? null
  }

  const media = await fetchByUuid(ymoveId)

  if (!includeVideo) _uuidCache.set(ymoveId, media)
  return media
}

// ─── DEV-ONLY HELPERS ────────────────────────────────────────────────────────
// These functions exist to assist human admins in building the verified mapping.
// They MUST NOT be called in production code paths.

/**
 * DEV-ONLY: Search ymove by display name and return the top N candidates.
 *
 * Use this to suggest possible ymove UUIDs for admin review — never to
 * automatically determine what media a user sees.
 *
 * @throws if called in production (guard against accidental import)
 */
export async function searchYmoveCandidates(
  query: string,
  limit = 5,
): Promise<YmoveCandidate[]> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[ymove] searchYmoveCandidates must not be called in production')
  }

  const res = await fetch(
    `${YMOVE_BASE}/exercises?search=${encodeURIComponent(query)}&pageSize=${limit}&includeVideos=true`,
    { headers: { 'X-API-Key': apiKey() }, cache: 'no-store' },
  )
  if (!res.ok) return []

  const body = await res.json()
  const list: Record<string, unknown>[] =
    Array.isArray(body)             ? body
    : Array.isArray(body.exercises) ? body.exercises
    : Array.isArray(body.data)      ? body.data
    : []

  return list
    .filter(item => item?.id)
    .map(item => ({
      ymoveId:      item.id as string,
      name:         (item.name ?? item.title ?? '') as string,
      thumbnailUrl: (item.thumbnailUrl ?? '') as string,
    }))
}
