import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getYmoveExerciseId } from '@/lib/ymove/mapping'
import { getBodyMap } from '@/lib/ymove/client'
import { sanitizeSvg } from '@/lib/ymove/sanitize-svg'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> },
) {
  const { exerciseId } = await params

  if (!exerciseId || typeof exerciseId !== 'string') {
    return NextResponse.json({ error: 'Invalid exerciseId' }, { status: 400 })
  }

  if (!process.env.YMOVE_API_KEY) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const ymoveId = await getYmoveExerciseId(exerciseId)
  if (!ymoveId) {
    // null = explicitly no match; undefined = not yet checked — both are 404 for this purpose
    return new NextResponse(null, { status: 404 })
  }

  const raw = await getBodyMap(ymoveId)
  if (raw === null) {
    return new NextResponse(null, { status: 404 })
  }

  const safe = sanitizeSvg(raw)
  if (safe === null) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(safe, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  })
}
