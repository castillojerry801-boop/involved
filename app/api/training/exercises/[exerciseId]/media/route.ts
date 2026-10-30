import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getExerciseById, getGifUrl } from '@/lib/exercises'
import { getYmoveExerciseId } from '@/lib/ymove/mapping'
import { getYmoveById } from '@/lib/ymove/client'

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
      // Thumbnail mode: ymoveId is all we need — the client fetches the thumbnail
      // via /api/ymove/thumbnail/:id (separate proxy, no cap charge).
      // Calling getYmoveById here would hit includeVideos=false which returns
      // incomplete data; skip it entirely to avoid a silent exercisedb fallback.
      return NextResponse.json({ source: 'ymove', ymoveId, fallbackGifUrl })
    }

    // Video mode: fetch the live playable URL (charges cap; only triggered by user play action).
    try {
      const ymove = await getYmoveById(ymoveId, true)
      if (ymove?.videoUrl) {
        return NextResponse.json({
          source:            'ymove',
          ymoveId:           ymove.ymoveId,
          videoUrl:          ymove.videoUrl,
          videoHlsUrl:       ymove.videoHlsUrl,
          videoDurationSecs: ymove.videoDurationSecs,
          fallbackGifUrl,
        })
      }
    } catch (err) {
      console.error('[ymove] video fetch failed for', exerciseId, '(ymoveId:', ymoveId, ')', err)
    }
    // Video unavailable but mapping is valid — return ymove source so thumbnail still works.
    return NextResponse.json({ source: 'ymove', ymoveId, fallbackGifUrl })
  }

  return NextResponse.json({ source: 'exercisedb', fallbackGifUrl })
}
