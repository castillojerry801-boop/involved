import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { assertTrainerClientAccess } from '@/lib/subscription/entitlements'
import type { TrainerClientTargetType } from '@prisma/client'

type Params = { params: Promise<{ clientId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  try {
    await assertTrainerClientAccess(user.id, clientId)
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const targets = await prisma.trainerClientTarget.findMany({
    where:   { trainerId: user.id, clientId },
    orderBy: { effectiveDate: 'desc' },
  })

  return Response.json({ targets })
}

interface SetTargetBody {
  targetType:   TrainerClientTargetType
  targetValue:  number
  unit:         string
  notes?:       string
  effectiveDate?: string // YYYY-MM-DD, defaults to today
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  try {
    await assertTrainerClientAccess(user.id, clientId)
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json() as SetTargetBody

  if (!body.targetType || body.targetValue === undefined || !body.unit) {
    return Response.json({ error: 'targetType, targetValue, and unit are required' }, { status: 400 })
  }

  const effectiveDate = body.effectiveDate
    ? new Date(body.effectiveDate)
    : new Date(new Date().toISOString().slice(0, 10))

  try {
    const target = await prisma.trainerClientTarget.create({
      data: {
        trainerId:    user.id,
        clientId,
        targetType:   body.targetType,
        targetValue:  body.targetValue,
        unit:         body.unit,
        notes:        body.notes ?? null,
        effectiveDate,
      },
    })
    return Response.json({ target }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to set target' }, { status: 500 })
  }
}
