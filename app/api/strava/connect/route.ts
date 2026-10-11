import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.involvedfit.com'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', APP_URL))
  }

  const state = randomBytes(16).toString('hex')

  const authUrl = new URL('https://www.strava.com/oauth/authorize')
  authUrl.searchParams.set('client_id',       process.env.STRAVA_CLIENT_ID ?? '')
  authUrl.searchParams.set('redirect_uri',    `${APP_URL}/api/strava/callback`)
  authUrl.searchParams.set('response_type',   'code')
  authUrl.searchParams.set('approval_prompt', 'auto')
  authUrl.searchParams.set('scope',           'activity:read_all')
  authUrl.searchParams.set('state',           state)

  const cookieStore = await cookies()
  cookieStore.set('strava_oauth_state', state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   600,
    path:     '/api/strava/callback',
  })

  return NextResponse.redirect(authUrl)
}
