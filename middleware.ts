import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Build a mutable response that threads cookie mutations through the request chain.
  // This is the canonical @supabase/ssr pattern — without it, server-side token
  // refresh can't write new cookies back to the browser.
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write updated cookies into both the request (for downstream Server Components)
          // and the response (so the browser receives the refreshed token).
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the JWT against the Supabase server and refreshes an
  // expiring token when needed. Must be called before any routing decisions.
  const { data: { user } } = await supabase.auth.getUser()

  // If an authenticated user opens the app (or navigates to the root URL directly),
  // skip the public landing page and drop them straight into the app.
  if (user && request.nextUrl.pathname === '/') {
    const destination = request.nextUrl.clone()
    destination.pathname = '/today'
    const redirectResponse = NextResponse.redirect(destination)
    // Carry refreshed auth cookies through the redirect so the session stays live.
    supabaseResponse.cookies.getAll().forEach(cookie =>
      redirectResponse.cookies.set(cookie.name, cookie.value, { path: '/' })
    )
    return redirectResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
