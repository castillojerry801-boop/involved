import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ent = await getUserEntitlement(user.id)
  if (!ent.isTrainer) return Response.json({ error: 'Trainer subscription required' }, { status: 403 })

  const clientId = req.nextUrl.searchParams.get('clientId')
  const status   = req.nextUrl.searchParams.get('status') ?? 'pending'

  const validStatuses = new Set(['pending', 'approved', 'dismissed'])
  const drafts = await prisma.vTrainerDraft.findMany({
    where: {
      trainerId: user.id,
      ...(clientId ? { clientId } : {}),
      ...(validStatuses.has(status) ? { status: status as 'pending' | 'approved' | 'dismissed' } : {}),
    },
    include: { client: { select: { displayName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return Response.json({ drafts })
}
