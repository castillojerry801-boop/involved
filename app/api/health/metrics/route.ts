import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const metricType = searchParams.get('type')   // required
  const from       = searchParams.get('from')   // YYYY-MM-DD
  const to         = searchParams.get('to')     // YYYY-MM-DD
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '90'), 365)

  if (!metricType) {
    return Response.json({ error: 'type is required' }, { status: 400 })
  }

  try {
    const metrics = await prisma.healthMetric.findMany({
      where: {
        userId:     user.id,
        metricType: metricType as never,
        ...(from || to ? {
          recordedAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take:    limit,
    })

    return Response.json({ metrics })
  } catch {
    return Response.json({ error: 'Failed to load metrics' }, { status: 500 })
  }
}
