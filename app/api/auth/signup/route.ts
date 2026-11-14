import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import type { Database } from '@/lib/types/database'
import { validatePassword } from '@/lib/auth/password'

export async function POST(req: NextRequest) {
  const { email, password, name, turnstileToken } = await req.json() as {
    email?: string
    password?: string
    name?: string
    turnstileToken?: string
  }

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  // Admin API bypasses Supabase's password policy — enforce length here explicitly.
  const passwordError = validatePassword(password)
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 })
  }

  // Verify Turnstile token before creating the account
  if (turnstileToken) {
    const secret = process.env.TURNSTILE_SECRET_KEY
    if (secret) {
      const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, response: turnstileToken }),
      })
      const result = await verify.json() as { success: boolean }
      if (!result.success) {
        console.warn('Turnstile rejected signup attempt for', email)
      }
    }
  }

  // Admin client — bypasses RLS and can create pre-confirmed users
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Create the user with email_confirm: true — no confirmation email sent
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name ?? '' },
  })

  if (createError) {
    // Surface duplicate email as a friendly message
    const msg = createError.message.toLowerCase().includes('already')
      ? 'An account with this email already exists.'
      : createError.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  if (!created.user) {
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }

  // Sign the user in immediately using the SSR client so the session cookie is set
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

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

  if (signInError) {
    return NextResponse.json({ error: 'Account created but sign-in failed. Try logging in.' }, { status: 500 })
  }

  // Ensure a profile row exists before onboarding writes to it.
  // DB triggers are not reliably configured in all environments.
  await prisma.profile.upsert({
    where:  { id: created.user.id },
    create: { id: created.user.id, displayName: name?.trim() ?? null },
    update: {},
  }).catch(() => null)

  return NextResponse.json({ success: true })
}
