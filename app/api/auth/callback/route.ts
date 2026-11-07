import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import type { Database } from '@/lib/types/database'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')
  const next  = searchParams.get('next') ?? '/today'

  // OAuth provider sent back an error (e.g. user canceled)
  if (error) {
    const msg = error === 'access_denied' ? 'oauth_canceled' : 'oauth_failed'
    return NextResponse.redirect(`${origin}/login?error=${msg}`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
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

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  // Ensure a profile row exists for OAuth users (safe no-op if already created
  // by a DB trigger; prevents onboarding from failing if no trigger is configured)
  if (data.user) {
    const { user } = data
    const name: string | undefined =
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      user.user_metadata?.display_name ??
      undefined

    await prisma.profile.upsert({
      where:  { id: user.id },
      create: { id: user.id, displayName: name ?? null },
      update: {},
    }).catch(() => {
      // Non-fatal: profile may already exist via DB trigger
    })
  }

  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/today'
  return NextResponse.redirect(`${origin}${safeNext}`)
}
