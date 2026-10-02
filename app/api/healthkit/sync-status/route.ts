import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [fullSyncCursor, workoutCursor] = await Promise.all([
    prisma.healthSyncCursor.findUnique({
      where: { userId_provider_dataType: { userId: user.id, provider: 'apple_health', dataType: 'native_full_sync' } },
    }),
    prisma.healthSyncCursor.findUnique({
      where: { userId_provider_dataType: { userId: user.id, provider: 'apple_health', dataType: 'workout' } },
    }),
  ])

  return Response.json({
    connected: workoutCursor !== null,
    lastFullSyncAt: fullSyncCursor?.lastSyncedAt?.toISOString() ?? null,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { syncedAt } = await req.json() as { syncedAt: string }

  await prisma.healthSyncCursor.upsert({
    where: { userId_provider_dataType: { userId: user.id, provider: 'apple_health', dataType: 'native_full_sync' } },
    create: { userId: user.id, provider: 'apple_health', dataType: 'native_full_sync', lastSyncedAt: new Date(syncedAt) },
    update: { lastSyncedAt: new Date(syncedAt) },
  })

  return Response.json({ ok: true })
}
