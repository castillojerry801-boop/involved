import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import type { FitnessLevel } from '@prisma/client'

const VALID_FITNESS_LEVELS = new Set<FitnessLevel>(['beginner', 'intermediate', 'advanced'])

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: {
      displayName:  true,
      username:     true,
      bio:          true,
      fitnessLevel: true,
      heightCm:     true,
      weightKg:     true,
      avatarUrl:    true,
    },
  })

  return Response.json({ profile, email: user.email })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    displayName?:  string
    username?:     string
    bio?:          string
    fitnessLevel?: string
    heightCm?:     number | null
    weightKg?:     number | null
  }

  const data: Record<string, unknown> = {}

  if (body.displayName !== undefined) {
    const name = body.displayName.trim()
    if (!name) return Response.json({ error: 'displayName cannot be empty' }, { status: 400 })
    data.displayName = name
  }

  if (body.username !== undefined) {
    const u = body.username.trim().toLowerCase()
    if (u && !/^[a-z0-9_]{3,30}$/.test(u)) {
      return Response.json({ error: 'Username must be 3–30 characters: letters, numbers, underscores only' }, { status: 400 })
    }
    data.username = u || null
  }

  if (body.bio !== undefined) data.bio = body.bio.trim() || null

  if (body.fitnessLevel !== undefined) {
    if (!VALID_FITNESS_LEVELS.has(body.fitnessLevel as FitnessLevel)) {
      return Response.json({ error: 'Invalid fitnessLevel' }, { status: 400 })
    }
    data.fitnessLevel = body.fitnessLevel
  }

  if (body.heightCm !== undefined) data.heightCm = body.heightCm
  if (body.weightKg !== undefined) data.weightKg = body.weightKg

  try {
    const profile = await prisma.profile.update({ where: { id: user.id }, data })
    return Response.json({ profile })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('Unique constraint') && msg.includes('username')) {
      return Response.json({ error: 'Username already taken' }, { status: 409 })
    }
    return Response.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
