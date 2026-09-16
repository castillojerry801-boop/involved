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

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
