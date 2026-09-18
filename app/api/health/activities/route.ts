import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const provider  = searchParams.get('provider')
  const from      = searchParams.get('from')   // YYYY-MM-DD
  const to        = searchParams.get('to')     // YYYY-MM-DD
  const limit     = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100)
  const cursor    = searchParams.get('cursor') // last id for pagination

  try {
    const activities = await prisma.healthActivity.findMany({
      where: {
        userId: user.id,
        ...(provider ? { provider: provider as never } : {}),
        ...(from || to ? {
          startedAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    })

    const nextCursor = activities.length === limit ? activities[activities.length - 1].id : null

    return Response.json({ activities, nextCursor })
  } catch {
    return Response.json({ error: 'Failed to load activities' }, { status: 500 })
  }
}
