import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { customToMeta } from '@/lib/training/custom-exercises'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const row = await prisma.customExercise.findFirst({ where: { id, userId: user.id } })
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ exercise: customToMeta(row) })
}

interface PatchBody {
  name?: string
  bodyPart?: string
  targetMuscle?: string
  equipment?: string
  trackingType?: string
  instructions?: string
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.customExercise.findFirst({ where: { id, userId: user.id } })
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as PatchBody
  const validTracking = ['strength', 'bodyweight', 'assisted', 'cardio', 'carry', 'isometric', 'intervals']

  try {
    const updated = await prisma.customExercise.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.bodyPart !== undefined && { bodyPart: body.bodyPart.trim() || null }),
        ...(body.targetMuscle !== undefined && { targetMuscle: body.targetMuscle.trim() || null }),
        ...(body.equipment !== undefined && { equipment: body.equipment.trim() || null }),
        ...(body.trackingType !== undefined && validTracking.includes(body.trackingType) && {
          trackingType: body.trackingType as 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals',
        }),
        ...(body.instructions !== undefined && { instructions: body.instructions.trim() || null }),
      },
    })
    return Response.json({ exercise: customToMeta(updated) })
  } catch {
    return Response.json({ error: 'Failed to update exercise' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.customExercise.findFirst({ where: { id, userId: user.id } })
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

  try {
    await prisma.customExercise.delete({ where: { id } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete exercise' }, { status: 500 })
  }
}
