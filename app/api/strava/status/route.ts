import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [token, cursor] = await Promise.all([
    prisma.stravaToken.findUnique({ where: { userId: user.id } }),
    prisma.healthSyncCursor.findUnique({
      where: {
        userId_provider_dataType: { userId: user.id, provider: 'strava', dataType: 'activities' },
      },
    }),
  ])

  return Response.json({
    connected:    token !== null,
    lastSyncedAt: cursor?.lastSyncedAt?.toISOString() ?? null,
    athleteId:    token?.athleteId ?? null,
  })
}
