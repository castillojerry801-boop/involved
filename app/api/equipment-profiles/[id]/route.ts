import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getDistinctEquipment, getExerciseIdsForEquipment, type Exercise } from '@/lib/exercises'
import { filterExercises } from '@/lib/exercises'

type Params = { params: Promise<{ id: string }> }

// ─── GET: profile detail + compatible exercises summary ───────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const profile = await prisma.equipmentProfile.findFirst({
      where: { id, userId: user.id },
      include: { items: { select: { equipment: true }, orderBy: { equipment: 'asc' } } },
    })
    if (!profile) return Response.json({ error: 'Not found' }, { status: 404 })

    const equipmentList = profile.items.map(i => i.equipment)
    const allowedIds = getExerciseIdsForEquipment(equipmentList)
    const compatibleExercises = filterExercises({ allowedIds, limit: 200 })

    return Response.json({
      profile,
      stats: {
        totalCompatible: compatibleExercises.length,
        byBodyPart: groupByField(compatibleExercises, 'bodyPart'),
      },
    })
  } catch {
    return Response.json({ error: 'Failed to load profile' }, { status: 500 })
  }
}

function groupByField(exercises: Exercise[], field: keyof Exercise): Record<string, number> {
  const result: Record<string, number> = {}
  for (const ex of exercises) {
    const val = String(ex[field])
    result[val] = (result[val] ?? 0) + 1
  }
  return result
}

// ─── PATCH: update name / equipment list / isActive ──────────────────────────

interface PatchBody {
  name?: string
  equipment?: string[]
  isActive?: boolean
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as PatchBody

  try {
    const existing = await prisma.equipmentProfile.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    if (body.isActive) {
      await prisma.equipmentProfile.updateMany({ where: { userId: user.id }, data: { isActive: false } })
    }

    const validEquipment = new Set(getDistinctEquipment().map(e => e.value))

    const profile = await prisma.equipmentProfile.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.equipment !== undefined && {
          items: {
            deleteMany: {},
            create: body.equipment.filter(e => validEquipment.has(e)).map(e => ({ equipment: e })),
          },
        }),
      },
      include: { items: { select: { equipment: true }, orderBy: { equipment: 'asc' } } },
    })

    return Response.json({ profile })
  } catch {
    return Response.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const existing = await prisma.equipmentProfile.findFirst({ where: { id, userId: user.id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    await prisma.equipmentProfile.delete({ where: { id } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete profile' }, { status: 500 })
  }
}
