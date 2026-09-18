import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { customToMeta } from '@/lib/training/custom-exercises'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await prisma.customExercise.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    })
    return Response.json({ exercises: rows.map(customToMeta) })
  } catch {
    return Response.json({ error: 'Failed to load custom exercises' }, { status: 500 })
  }
}

interface CreateBody {
  name: string
  bodyPart?: string
  targetMuscle?: string
  equipment?: string
  trackingType?: string
  instructions?: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as CreateBody
  if (!body.name?.trim()) return Response.json({ error: 'Name is required' }, { status: 400 })

  const validTracking = ['strength', 'bodyweight', 'assisted', 'cardio', 'carry', 'isometric', 'intervals']
  const trackingType = validTracking.includes(body.trackingType ?? '') ? body.trackingType! : 'strength'

  try {
    const row = await prisma.customExercise.create({
      data: {
        userId: user.id,
        name: body.name.trim(),
        bodyPart: body.bodyPart?.trim() || null,
        targetMuscle: body.targetMuscle?.trim() || null,
        equipment: body.equipment?.trim() || null,
        trackingType: trackingType as 'strength' | 'bodyweight' | 'assisted' | 'cardio' | 'carry' | 'isometric' | 'intervals',
        instructions: body.instructions?.trim() || null,
      },
    })
    return Response.json({ exercise: customToMeta(row) }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to create exercise' }, { status: 500 })
  }
}
