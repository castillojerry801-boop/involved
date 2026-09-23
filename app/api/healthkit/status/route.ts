import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [cursor, activityCount] = await Promise.all([
    prisma.healthSyncCursor.findUnique({
      where: {
        userId_provider_dataType: {
          userId: user.id,
          provider: 'apple_health',
          dataType: 'workout',
        },
      },
    }),
    prisma.healthActivity.count({
      where: { userId: user.id, provider: 'apple_health' },
    }),
  ])

  return Response.json({
    connected: cursor !== null,
    lastSyncedAt: cursor?.lastSyncedAt ?? null,
    activityCount,
  })
}

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.$transaction([
    prisma.healthSyncCursor.deleteMany({
      where: { userId: user.id, provider: 'apple_health' },
    }),
    prisma.healthPermission.deleteMany({
      where: { userId: user.id, provider: 'apple_health' },
    }),
  ])

  return Response.json({ disconnected: true })
}
