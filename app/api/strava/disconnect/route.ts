import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { revokeToken } from '@/lib/strava/client'
import { prisma } from '@/lib/prisma'

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await prisma.stravaToken.findUnique({ where: { userId: user.id } })
  if (token) {
    await revokeToken(token.accessToken)
    await prisma.stravaToken.delete({ where: { userId: user.id } })
  }

  // Clean up cursor (ignore if not found)
  await prisma.healthSyncCursor.deleteMany({
    where: { userId: user.id, provider: 'strava' },
  })

  return Response.json({ ok: true })
}
