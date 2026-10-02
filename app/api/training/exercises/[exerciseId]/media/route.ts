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
  const ymoveId = getYmoveExerciseId(exerciseId)
  if (ymoveId) {
    try {
      const ymove = await getYmoveById(ymoveId, includeVideo)
      if (ymove) {
        return NextResponse.json({
          source: 'ymove',
          ymoveId: ymove.ymoveId,
          ...(includeVideo && ymove.videoUrl
            ? {
                videoUrl:          ymove.videoUrl,
                videoHlsUrl:       ymove.videoHlsUrl,
                videoDurationSecs: ymove.videoDurationSecs,
              }
            : {}),
          fallbackGifUrl,
        })
      }
    } catch (err) {
      console.error('[ymove] fetch failed for', exerciseId, '(ymoveId:', ymoveId, ')', err)
    }
  }

  return NextResponse.json({ source: 'exercisedb', fallbackGifUrl })
}
