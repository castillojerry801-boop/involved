import 'server-only'

const TOKEN_URL      = 'https://www.strava.com/oauth/token'
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities'
const DEAUTH_URL     = 'https://www.strava.com/oauth/deauthorize'

export interface StravaActivity {
  id:                number
  name:              string
  sport_type:        string
  type:              string
  start_date:        string
  elapsed_time:      number
  moving_time:       number
  distance:          number
  average_heartrate?: number
  max_heartrate?:    number
  calories?:         number
  description?:      string | null
}

interface TokenResponse {
  access_token:  string
  refresh_token: string
  expires_at:    number
  athlete?: {
    id:        number
    firstname: string
    lastname:  string
  }
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken:  string
  refreshToken: string
  expiresAt:    Date
  athlete: { id: number; firstname: string; lastname: string }
}> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Strava token exchange failed: ${res.status} ${text}`)
  }
  const data = await res.json() as TokenResponse
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    new Date(data.expires_at * 1000),
    athlete: {
      id:        data.athlete?.id ?? 0,
      firstname: data.athlete?.firstname ?? '',
      lastname:  data.athlete?.lastname ?? '',
    },
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken:  string
  refreshToken: string
  expiresAt:    Date
}> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Strava token refresh failed: ${res.status} ${text}`)
  }
  const data = await res.json() as TokenResponse
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    new Date(data.expires_at * 1000),
  }
}

export async function revokeToken(accessToken: string): Promise<void> {
  try {
    await fetch(DEAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken }),
    })
  } catch {
    // Best-effort — do not throw
  }
}

export async function fetchActivities(
  accessToken: string,
  options: { after?: number; perPage?: number; page?: number } = {},
): Promise<StravaActivity[]> {
  const params = new URLSearchParams()
  if (options.after   != null) params.set('after',    String(options.after))
  if (options.perPage != null) params.set('per_page', String(options.perPage))
  if (options.page    != null) params.set('page',     String(options.page))

  const res = await fetch(`${ACTIVITIES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Strava activities fetch failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<StravaActivity[]>
}
