import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const goals = await prisma.goal.findMany({
    where: { userId: user.id, status: { not: 'completed' } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ goals })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    type: string
    title: string
    description?: string
    targetDate?: string
  }

  if (!body.title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 })

  const validTypes = ['event', 'strength', 'endurance', 'body_comp', 'habit', 'custom']
  const type = validTypes.includes(body.type) ? body.type : 'custom'

  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      type: type as 'event' | 'strength' | 'endurance' | 'body_comp' | 'habit' | 'custom',
      title: body.title.trim(),
      description: body.description?.trim() || null,
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
      status: 'active',
    },
  })

  return NextResponse.json({ goal }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json() as { id: string }
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

  await prisma.goal.deleteMany({ where: { id, userId: user.id } })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, status } = await req.json() as { id: string; status: string }
  const validStatuses = ['active', 'completed', 'paused']
  if (!id || !validStatuses.includes(status)) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  const goal = await prisma.goal.updateMany({
    where: { id, userId: user.id },
    data: { status: status as 'active' | 'completed' | 'paused' },
  })

  return NextResponse.json({ goal })
}
