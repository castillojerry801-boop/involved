import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { exchangeCodeForTokens } from '@/lib/strava/client'
import { syncStravaActivities } from '@/lib/strava/sync'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.involvedfit.com'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL('/health?strava=denied', APP_URL))
  }

  const cookieStore = await cookies()
  const savedState = cookieStore.get('strava_oauth_state')?.value
  if (!state || state !== savedState) {
    return NextResponse.redirect(new URL('/health?strava=error', APP_URL))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', APP_URL))
  }

  try {
    const tokens = await exchangeCodeForTokens(code ?? '')

    await prisma.stravaToken.upsert({
      where: { userId: user.id },
      create: {
        userId:       user.id,
        athleteId:    tokens.athlete.id,
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt:    tokens.expiresAt,
      },
      update: {
        athleteId:    tokens.athlete.id,
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt:    tokens.expiresAt,
      },
    })

    await syncStravaActivities(user.id, { initialSync: true })
  } catch (err) {
    cookieStore.delete('strava_oauth_state')
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.redirect(new URL('/health?strava=conflict', APP_URL))
    }
    console.error('[strava/callback] error:', err)
    return NextResponse.redirect(new URL('/health?strava=error', APP_URL))
  }

  cookieStore.delete('strava_oauth_state')
  return NextResponse.redirect(new URL('/health?strava=connected', APP_URL))
}
