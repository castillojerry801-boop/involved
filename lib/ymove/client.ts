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

// In-memory slug → media cache. Thumbnails are permanent CDN URLs — safe to hold
// for the lifetime of a deployment. Video URLs expire in 48 h and are never cached.
const _thumbCache = new Map<string, YmoveMedia | null>()

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMedia(data: Record<string, any>): YmoveMedia {
  const t = (data.thumbnails ?? {}) as Record<string, string>
  const base = (data.thumbnailUrl ?? '') as string
  return {
    ymoveId: data.id as string,
    thumbnailUrl: base,
    thumbnails: {
      default:   t.default   ?? base,
      square:    t.square    ?? base,
      portrait:  t.portrait  ?? base,
      landscape: t.landscape ?? base,
    },
    videoUrl:         data.videoUrl         as string | undefined,
    videoHlsUrl:      data.videoHlsUrl      as string | undefined,
    videoDurationSecs: data.videoDurationSecs as number | undefined,
  }
}

async function fetchBySlug(slug: string, includeVideo: boolean): Promise<YmoveMedia | null> {
  const qs = includeVideo ? 'includeVideos=true' : 'excludeVideos=true'
  const res = await fetch(
    `${YMOVE_BASE}/exercises/${encodeURIComponent(slug)}?${qs}`,
    {
      headers: { 'X-API-Key': apiKey() },
      // Thumbnail responses can be cached by Next.js data cache; video responses must not.
      ...(includeVideo
        ? { cache: 'no-store' }
        : { next: { revalidate: 86400 } }),
    },
  )
  if (!res.ok) return null
  const data = await res.json()
  if (!data?.id) return null
  return parseMedia(data)
}

async function fetchBySearch(name: string): Promise<YmoveMedia | null> {
  const res = await fetch(
    `${YMOVE_BASE}/exercises?search=${encodeURIComponent(name)}&pageSize=1&excludeVideos=true`,
    { headers: { 'X-API-Key': apiKey() }, next: { revalidate: 86400 } },
  )
  if (!res.ok) return null
  const body = await res.json()
  // API may return { exercises: [...] }, { data: [...] }, or a bare array
  const list: Record<string, unknown>[] =
    Array.isArray(body)             ? body
    : Array.isArray(body.exercises) ? body.exercises
    : Array.isArray(body.data)      ? body.data
    : []
  const first = list[0]
  if (!first) return null
  return fetchBySlug((first.slug ?? first.id) as string, false)
}

/**
 * Resolve ymove media for an exercise by its canonical display name.
 *
 * Strategy:
 *   1. Derive a URL slug from the display name and try a direct slug lookup (zero
 *      extra round-trip when the slug matches).
 *   2. If that returns 404, fall back to a name-search call.
 *   3. If `includeVideo` is true, re-fetch the matched exercise with video URLs.
 *
 * Thumbnail results are kept in an in-memory cache for the life of the deployment.
 * Video URLs are never cached — they expire in 48 hours.
 */
export async function getYmoveMedia(
  displayName: string,
  includeVideo = false,
): Promise<YmoveMedia | null> {
  const slug = toSlug(displayName)

  if (!includeVideo && _thumbCache.has(slug)) {
    return _thumbCache.get(slug) ?? null
  }

  let media = await fetchBySlug(slug, includeVideo)

  if (!media) {
    const found = await fetchBySearch(displayName)
    if (found) {
      media = includeVideo
        ? (await fetchBySlug(found.ymoveId, true) ?? found)
        : found
    }
  }

  if (!includeVideo) {
    _thumbCache.set(slug, media)
  }

  return media
}
