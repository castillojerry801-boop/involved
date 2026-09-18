import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getDistinctEquipment } from '@/lib/exercises'

// ─── GET: list all equipment profiles ────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const profiles = await prisma.equipmentProfile.findMany({
      where: { userId: user.id },
      include: { items: { select: { equipment: true }, orderBy: { equipment: 'asc' } } },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    })
    return Response.json({ profiles })
  } catch {
    return Response.json({ error: 'Failed to load profiles' }, { status: 500 })
  }
}

// ─── POST: create a profile ───────────────────────────────────────────────────

interface CreateBody {
  name: string
  equipment?: string[]
  isActive?: boolean
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as CreateBody
  if (!body.name?.trim()) return Response.json({ error: 'Name is required' }, { status: 400 })

  // Validate equipment values against actual dataset
  const validEquipment = new Set(getDistinctEquipment().map(e => e.value))
  const equipment = (body.equipment ?? []).filter(e => validEquipment.has(e))

  try {
    if (body.isActive) {
      await prisma.equipmentProfile.updateMany({ where: { userId: user.id }, data: { isActive: false } })
    }

    const profile = await prisma.equipmentProfile.create({
      data: {
        userId: user.id,
        name: body.name.trim(),
        isActive: body.isActive ?? false,
        items: {
          create: equipment.map(e => ({ equipment: e })),
        },
      },
      include: { items: { select: { equipment: true }, orderBy: { equipment: 'asc' } } },
    })

    return Response.json({ profile }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to create profile' }, { status: 500 })
  }
}
