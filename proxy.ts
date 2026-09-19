import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PROTECTED_PATHS = ['/today', '/nutrition', '/training', '/progress', '/coach', '/profile']
const AUTH_PATHS = ['/login', '/signup']

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone()
  const pathname = url.pathname

  // Skip auth when Supabase is not yet configured
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Must use getUser() not getSession() — validates JWT server-side
  const { data: { user } } = await supabase.auth.getUser()

  const isProtected = PROTECTED_PATHS.some(p => pathname.startsWith(p))
  const isAuthPage = AUTH_PATHS.some(p => pathname.startsWith(p))

  if (isProtected && !user) {
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (isAuthPage && user) {
    url.pathname = '/today'
    return NextResponse.redirect(url)
  }

  // Forward timezone to server components as x-tz header.
  // Prefer the browser-set cookie (exact tz), fall back to Vercel's IP-based header.
  const cookieTz = request.cookies.get('tz')?.value
  const vercelTz = request.headers.get('x-vercel-ip-timezone')
  const tz = cookieTz ? decodeURIComponent(cookieTz) : vercelTz
  if (tz) {
    supabaseResponse.headers.set('x-tz', tz)
    if (!cookieTz && vercelTz) {
      supabaseResponse.cookies.set('tz', encodeURIComponent(vercelTz), {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      })
    }
  }

  // Forward weight unit preference to server components as x-weight-unit header.
  const weightUnit = request.cookies.get('weight_unit')?.value
  if (weightUnit === 'lbs' || weightUnit === 'kg') {
    supabaseResponse.headers.set('x-weight-unit', weightUnit)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
