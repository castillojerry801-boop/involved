import { createServerClient } from '@supabase/ssr'
import { type EmailOtpType } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/types/database'

// Handles the email confirmation link Supabase sends on signup.
// URL format: /auth/confirm?token_hash=xxx&type=signup&next=/onboarding
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type       = searchParams.get('type') as EmailOtpType | null
  const next       = searchParams.get('next') ?? '/onboarding'

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`)
  }

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

  // New users land on onboarding; existing users (email change, etc.) go to today
  return NextResponse.redirect(`${origin}${next}`)
}
