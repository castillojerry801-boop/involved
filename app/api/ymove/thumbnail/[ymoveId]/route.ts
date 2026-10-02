import 'server-only'
import { NextRequest, NextResponse } from 'next/server'

const YMOVE_BASE = 'https://exercise-api.ymove.app/api/v2'
const VALID_CROPS = new Set(['default', 'square', 'portrait', 'landscape', 'original'])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ymoveId: string }> },
) {
  const { ymoveId } = await params
  const crop = request.nextUrl.searchParams.get('crop') ?? 'default'

  if (!VALID_CROPS.has(crop)) {
    return NextResponse.json({ error: 'Invalid crop' }, { status: 400 })
  }

  const apiKey = process.env.YMOVE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const upstream = await fetch(
    `${YMOVE_BASE}/thumbnail/${encodeURIComponent(ymoveId)}?crop=${crop}`,
    { headers: { 'X-API-Key': apiKey } },
  )

  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status })
  }

  const image = await upstream.arrayBuffer()
  return new NextResponse(image, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/jpeg',
      // Thumbnails are permanent on ymove's side — cache aggressively.
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  })
}
