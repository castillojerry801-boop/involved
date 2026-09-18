import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getDistinctEquipment } from '@/lib/exercises'
import { Prisma } from '@prisma/client'

// ─── GET: list all equipment profiles ────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const profiles = await prisma.equipmentProfile.findMany({
      where: { userId: user.id },
      include: { items: { select: { equipment: true, availableWeights: true }, orderBy: { equipment: 'asc' } } },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    })
    return Response.json({ profiles })
  } catch {
    return Response.json({ error: 'Failed to load profiles' }, { status: 500 })
  }
}

// ─── POST: create a profile ───────────────────────────────────────────────────

export interface EquipmentItemInput {
  equipment: string
  availableWeights?: {
    unit: 'lbs' | 'kg'
    type: 'fixed' | 'range'
    values?: number[]
    min?: number
    max?: number
    increment?: number
  } | null
}

interface CreateBody {
  name: string
  /** Simple string list (legacy) OR structured items with optional weights */
  equipment?: string[]
  equipmentItems?: EquipmentItemInput[]
  isActive?: boolean
}

function normalizeItems(body: CreateBody, validEquipment: Set<string>): EquipmentItemInput[] {
  if (body.equipmentItems) {
    return body.equipmentItems.filter(i => validEquipment.has(i.equipment))
  }
  return (body.equipment ?? [])
    .filter(e => validEquipment.has(e))
    .map(e => ({ equipment: e }))
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as CreateBody
  if (!body.name?.trim()) return Response.json({ error: 'Name is required' }, { status: 400 })

  const validEquipment = new Set(getDistinctEquipment().map(e => e.value))
  const items = normalizeItems(body, validEquipment)

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
          create: items.map(i => ({
            equipment: i.equipment,
            availableWeights: i.availableWeights ?? Prisma.DbNull,
          })),
        },
      },
      include: { items: { select: { equipment: true, availableWeights: true }, orderBy: { equipment: 'asc' } } },
    })

    return Response.json({ profile }, { status: 201 })
  } catch {
    return Response.json({ error: 'Failed to create profile' }, { status: 500 })
  }
}
