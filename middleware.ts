import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
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
          // Write cookies back onto the request so downstream Server Components
          // see the refreshed token within the same render pass.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          // Recreate the response so we can attach Set-Cookie headers.
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Calling getUser() triggers a token refresh when the access token is near
  // expiry. The setAll callback above propagates any new tokens to both the
  // request (for this render) and the response (for the browser cookie jar).
  // Without this, Server Components cannot refresh tokens — their setAll calls
  // are silently dropped — causing getUser() to return null on expired tokens.
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|apple-icon\\.png|icon\\.jpg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
