import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getExerciseById, getGifUrl } from '@/lib/exercises'
import { getInvolvedDisplayName } from '@/lib/exercises/canonical'
import { getYmoveMedia } from '@/lib/ymove/client'

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

  const displayName = getInvolvedDisplayName(exerciseId, exercise.name)
  const fallbackGifUrl = getGifUrl(exerciseId)

  try {
    const ymove = await getYmoveMedia(displayName, includeVideo)
    if (ymove) {
      return NextResponse.json({
        source: 'ymove',
        thumbnailUrl: ymove.thumbnailUrl,
        thumbnails: ymove.thumbnails,
        ...(includeVideo && ymove.videoUrl
          ? {
              videoUrl: ymove.videoUrl,
              videoHlsUrl: ymove.videoHlsUrl,
              videoDurationSecs: ymove.videoDurationSecs,
            }
          : {}),
        fallbackGifUrl,
      })
    }
  } catch (err) {
    console.error('[ymove] media fetch failed for', exerciseId, err)
  }

  return NextResponse.json({ source: 'exercisedb', fallbackGifUrl })
}
