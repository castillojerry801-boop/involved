import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

const FL_OZ_TO_ML = 29.5735

// POST — log a water entry
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { oz?: number }
  const oz = Number(body.oz ?? 0)
  if (!oz || oz <= 0 || oz > 200) {
    return NextResponse.json({ error: 'Invalid oz value' }, { status: 400 })
  }

  const ml = Math.round(oz * FL_OZ_TO_ML * 10) / 10
  const entry = await prisma.healthMetric.create({
    data: {
      userId: user.id,
      provider: 'manual',
      metricType: 'water_ml',
      value: ml,
      unit: 'ml',
      recordedAt: new Date(),
    },
  })

  return NextResponse.json({ id: entry.id, ml })
}

// DELETE — remove the last manually-logged water entry for today
export async function DELETE() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const last = await prisma.healthMetric.findFirst({
    where: {
      userId: user.id,
      provider: 'manual',
      metricType: 'water_ml',
      recordedAt: { gte: todayStart },
    },
    orderBy: { recordedAt: 'desc' },
  })

  if (!last) return NextResponse.json({ removed: false })

  await prisma.healthMetric.delete({ where: { id: last.id } })
  return NextResponse.json({ removed: true, id: last.id })
}
