import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: new Headers(request.headers),
    },
  })

  // Forward Vercel's IP-based timezone as a readable header so server
  // components always have it — even on the very first request before
  // the client-side TimezoneSync cookie is written.
  const vercelTz = request.headers.get('x-vercel-ip-timezone')
  const cookieTz = request.cookies.get('tz')?.value
  const tz = cookieTz ? decodeURIComponent(cookieTz) : vercelTz

  if (tz) {
    response.headers.set('x-tz', tz)
    // Also persist it as a cookie if not already set
    if (!cookieTz && vercelTz) {
      response.cookies.set('tz', encodeURIComponent(vercelTz), {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      })
    }
  }

  // Supabase auth session refresh
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.jpg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
