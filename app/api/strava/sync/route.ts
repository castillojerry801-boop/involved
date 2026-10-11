import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { syncStravaActivities } from '@/lib/strava/sync'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { synced } = await syncStravaActivities(user.id)
    return Response.json({ ok: true, synced })
  } catch (err) {
    console.error('[strava/sync] error:', err)
    return Response.json({ error: 'Sync failed' }, { status: 500 })
  }
}
