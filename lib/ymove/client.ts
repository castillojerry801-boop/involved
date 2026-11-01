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
  thumbnailUrl?: string  // absent in browse mode on non-Scale plans; always load via proxy
}

// In-memory cache: ymove UUID → thumbnail data.
// Thumbnails are permanent CDN URLs; safe to hold for the life of a deployment.
// Video URLs expire in 48 h and are never cached here.
const _uuidCache = new Map<string, YmoveMedia | null>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMedia(data: Record<string, any>): YmoveMedia {
  const t = (data.thumbnails ?? {}) as Record<string, string>
  const base = (data.thumbnailUrl ?? '') as string

  // Video URLs may be at the top level (convenience alias) or inside videos[].
  // Use the top-level alias first; fall back to the primary (or first) video object.
  const videos = (data.videos ?? []) as Record<string, any>[]
  const primaryVideo = videos.find(v => v.isPrimary) ?? videos[0] ?? null

  return {
    ymoveId:   data.id as string,
    thumbnailUrl: base,
    thumbnails: {
      default:   t.default   ?? base,
      square:    t.square    ?? base,
      portrait:  t.portrait  ?? base,
      landscape: t.landscape ?? base,
    },
    videoUrl:          (data.videoUrl          as string | undefined) || (primaryVideo?.videoUrl          as string | undefined),
    videoHlsUrl:       (data.videoHlsUrl       as string | undefined) || (primaryVideo?.videoHlsUrl       as string | undefined),
    videoDurationSecs: (data.videoDurationSecs  as number | undefined) ?? (primaryVideo?.videoDurationSecs as number | undefined),
  }
}

// includeVideos is always sent explicitly — never rely on key-default behaviour.
// includeVideos=false → browse mode, does not charge the monthly exercise cap.
// includeVideos=true  → charges cap; only used when caller actually needs the video URL.
async function fetchByUuid(uuid: string, includeVideo = false): Promise<YmoveMedia | null> {
  const qs = includeVideo ? 'includeVideos=true' : 'includeVideos=false'
  const res = await fetch(
    `${YMOVE_BASE}/exercises/${encodeURIComponent(uuid)}?${qs}`,
    { headers: { 'X-API-Key': apiKey() }, cache: 'no-store' },
  )
  if (!res.ok) return null
  const body = await res.json()
  // The API wraps the exercise in a `data` key: { data: { id, ... }, _notice: {} }.
  // Fall back to the raw body for any future response shapes that omit the wrapper.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = ((body?.data ?? body) as Record<string, any>)
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

  const media = await fetchByUuid(ymoveId, includeVideo)

  if (!includeVideo) _uuidCache.set(ymoveId, media)
  return media
}

/**
 * Fetch the body-map SVG for a YMove exercise.
 *
 * Returns the raw SVG string or null if the exercise has no body-map.
 * Does NOT charge the monthly exercise video cap (browse-mode endpoint).
 * The caller must sanitize before injecting into the DOM — use sanitizeSvg().
 */
export async function getBodyMap(ymoveId: string): Promise<string | null> {
  const res = await fetch(
    `${YMOVE_BASE}/exercises/${encodeURIComponent(ymoveId)}/body-map`,
    { headers: { 'X-API-Key': apiKey() }, cache: 'no-store' },
  )
  if (!res.ok) return null
  const text = await res.text()
  return text.trim() || null
}

// Trusted CDN hostname patterns for YMove thumbnail URLs.
// Thumbnail CDN URLs are public (no API key needed); we still validate hostnames
// to prevent arbitrary server-side URLs from reaching client responses.
//
// IMPORTANT: Only list domains that are exclusively controlled by YMove.
// Shared CDN domains (cloudfront.net, fastly.net, imgix.net) are NOT listed because
// any third-party customer of those CDNs can serve content from those domains —
// an attacker who can influence the YMove API response could redirect to unrelated
// content on the same CDN. Add the specific YMove-controlled hostname discovered
// from a live API response if thumbnails are served via a custom-domain CNAME.
const TRUSTED_THUMBNAIL_PATTERNS: RegExp[] = [
  /^[a-z0-9.-]+\.ymove\.app$/i, // any subdomain of ymove.app — exclusively YMove-controlled
]

/**
 * Returns true when a YMove thumbnail URL is from a known trusted CDN.
 * Only HTTPS URLs with recognised CDN hostnames pass.
 * Empty strings, data URIs, and HTTP URLs all return false.
 */
export function isTrustedThumbnailUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return TRUSTED_THUMBNAIL_PATTERNS.some(re => re.test(parsed.hostname))
  } catch {
    return false
  }
}

// ─── DEV-ONLY HELPERS ────────────────────────────────────────────────────────
// These functions exist to assist human admins in building the verified mapping.
// They MUST NOT be called in production code paths.

/**
 * Search ymove by display name and return the top N candidates.
 *
 * Used by admin mapping tools only — never called from user-facing code paths.
 */
export async function searchYmoveCandidates(
  query: string,
  limit = 5,
): Promise<YmoveCandidate[]> {
  // Browse mode — includeVideos=false does not count against the monthly exercise cap.
  // Thumbnails are loaded on demand via the /api/ymove/thumbnail proxy, not from this response.
  const res = await fetch(
    `${YMOVE_BASE}/exercises?search=${encodeURIComponent(query)}&pageSize=${limit}&includeVideos=false`,
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
