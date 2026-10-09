import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const permission = await prisma.healthPermission.findFirst({
    where: { userId: user.id, provider: 'health_connect', granted: true },
  })

  return Response.json({ connected: permission !== null })
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.healthPermission.upsert({
    where: {
      userId_provider_dataType: {
        userId: user.id,
        provider: 'health_connect',
        dataType: 'all',
      },
    },
    create: {
      userId: user.id,
      provider: 'health_connect',
      dataType: 'all',
      granted: true,
      grantedAt: new Date(),
    },
    update: {
      granted: true,
      grantedAt: new Date(),
      revokedAt: null,
    },
  })

  return Response.json({ connected: true })
}

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.healthPermission.updateMany({
    where: { userId: user.id, provider: 'health_connect' },
    data: { granted: false, revokedAt: new Date() },
  })

  return Response.json({ disconnected: true })
}
