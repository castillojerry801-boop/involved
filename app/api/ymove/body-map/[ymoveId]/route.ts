import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getBodyMap } from '@/lib/ymove/client'
import { sanitizeSvg } from '@/lib/ymove/sanitize-svg'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ymoveId: string }> },
) {
  const { ymoveId } = await params

  if (!ymoveId || typeof ymoveId !== 'string') {
    return NextResponse.json({ error: 'Invalid ymoveId' }, { status: 400 })
  }

  if (!process.env.YMOVE_API_KEY) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const raw = await getBodyMap(ymoveId)
  if (raw === null) {
    return new NextResponse(null, { status: 404 })
  }

  const safe = sanitizeSvg(raw)
  if (safe === null) {
    // SVG failed sanitization — treat as unavailable rather than surfacing untrusted markup
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(safe, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Body maps are exercise-static content — cache aggressively
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  })
}
