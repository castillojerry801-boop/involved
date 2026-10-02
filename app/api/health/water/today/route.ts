import 'server-only'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const agg = await prisma.healthMetric.aggregate({
    where: {
      userId: user.id,
      metricType: 'water_ml',
      recordedAt: { gte: todayStart },
    },
    _sum: { value: true },
  })

  const totalMl = agg._sum.value != null ? Number(agg._sum.value) : 0
  return NextResponse.json({ totalMl })
}
