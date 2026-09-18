import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { createTrainerProgram } from '@/lib/trainer/programs'
import { getUserEntitlement } from '@/lib/subscription/entitlements'

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ent = await getUserEntitlement(user.id)
  if (!ent.isTrainer) return Response.json({ error: 'Trainer subscription required' }, { status: 403 })

  const programs = await prisma.trainerProgram.findMany({
    where:   { trainerId: user.id, isArchived: false },
    include: {
      days: {
        orderBy: { sortOrder: 'asc' },
        include: {
          exercises: {
            orderBy: { sortOrder: 'asc' },
            include: { sets: { orderBy: { setNumber: 'asc' } } },
          },
        },
      },
      _count: { select: { assignments: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return Response.json({ programs })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ent = await getUserEntitlement(user.id)
  if (!ent.isTrainer) return Response.json({ error: 'Trainer subscription required' }, { status: 403 })

  const body = await req.json()

  if (!body.name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  try {
    const program = await createTrainerProgram(user.id, body)
    return Response.json({ program }, { status: 201 })
  } catch (err) {
    console.error('trainer/programs POST:', err)
    return Response.json({ error: 'Failed to create program' }, { status: 500 })
  }
}
