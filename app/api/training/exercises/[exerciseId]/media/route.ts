import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getExerciseById, getGifUrl } from '@/lib/exercises'
import { getYmoveExerciseId } from '@/lib/ymove/mapping'
import { getYmoveById, isTrustedThumbnailUrl, type YmoveMedia } from '@/lib/ymove/client'

// Strict UUID v4 format used by YMove for media IDs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Extract the thumbnail media UUID from a YMove exercise's metadata.
 *
 * YMove thumbnail URLs have the form:
 *   https://exercise-api.ymove.app/api/v2/thumbnail/{mediaUUID}?crop=default
 *
 * The mediaUUID is different from the exercise UUID stored in the mapping.
 * The client always routes through our proxy (/api/ymove/thumbnail/:id) which
 * adds the API key — the media UUID alone is safe to return to the client.
 *
 * Returns null when the parent URL fails domain validation or has no UUID segment.
 */
function extractThumbnailMediaId(ymove: YmoveMedia | null): string | null {
  if (!ymove) return null
  const src = ymove.thumbnails.default || ymove.thumbnailUrl
  // Validate domain before trusting the URL structure
  if (!isTrustedThumbnailUrl(src)) return null
  try {
    const last = new URL(src).pathname.split('/').pop()
    return last && UUID_RE.test(last) ? last : null
  } catch {
    return null
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> },
) {
  const { exerciseId } = await params
  const includeVideo = request.nextUrl.searchParams.get('video') === 'true'

  const exercise = getExerciseById(exerciseId)
  if (!exercise) {
    return NextResponse.json({ error: 'Exercise not found' }, { status: 404 })
  }

  const fallbackGifUrl = getGifUrl(exerciseId)

  // Only show ymove media when a verified mapping exists.
  const ymoveId = await getYmoveExerciseId(exerciseId)
  if (ymoveId) {
    if (!includeVideo) {
      // Fetch YMove metadata to resolve the thumbnail media UUID.
      // getYmoveById(false) is in-memory cached — no video cap charge.
      const ymove = await getYmoveById(ymoveId, false)
      const thumbnailMediaId = extractThumbnailMediaId(ymove)
      return NextResponse.json({ source: 'ymove', ymoveId, thumbnailMediaId, fallbackGifUrl })
    }

    // Video mode: fetch live playable URL (charges cap; only triggered by user play action).
    try {
      const ymove = await getYmoveById(ymoveId, true)
      const thumbnailMediaId = extractThumbnailMediaId(ymove)
      if (ymove?.videoUrl) {
        return NextResponse.json({
          source:            'ymove',
          ymoveId:           ymove.ymoveId,
          thumbnailMediaId,
          videoUrl:          ymove.videoUrl,
          videoHlsUrl:       ymove.videoHlsUrl,
          videoDurationSecs: ymove.videoDurationSecs,
          fallbackGifUrl,
        })
      }
      // Video unavailable but mapping is valid — still return thumbnailMediaId.
      return NextResponse.json({ source: 'ymove', ymoveId, thumbnailMediaId, fallbackGifUrl })
    } catch (err) {
      console.error('[ymove] video fetch failed for', exerciseId, '(ymoveId:', ymoveId, ')', err)
    }
    // Video request threw — fall back to browse-mode metadata (in-memory cached, no cap charge).
    const ymoveMeta = await getYmoveById(ymoveId, false)
    const thumbnailMediaId = extractThumbnailMediaId(ymoveMeta)
    return NextResponse.json({ source: 'ymove', ymoveId, thumbnailMediaId, fallbackGifUrl })
  }

  return NextResponse.json({ source: 'exercisedb', fallbackGifUrl })
}
