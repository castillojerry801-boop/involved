import { createServerClient } from '@supabase/ssr'
import { type EmailOtpType } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/types/database'

// Handles email confirmation links — signup, password recovery, and email change.
// URL format: /auth/confirm?token_hash=xxx&type=<type>&next=<destination>
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type       = searchParams.get('type') as EmailOtpType | null
  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`)
  }

  // Validate the next param the same way the OAuth callback does — must be a
  // relative path that doesn't start with // (open-redirect guard).
  const rawNext    = searchParams.get('next')
  const safeRawNext = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
    ? rawNext
    : null

  // Recovery tokens must land on the reset-password page, not onboarding.
  const next = safeRawNext ?? (type === 'recovery' ? '/reset-password' : '/onboarding')

  const cookieStore = await cookies()

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { error } = await supabase.auth.verifyOtp({ token_hash, type })

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=confirmation_failed`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
