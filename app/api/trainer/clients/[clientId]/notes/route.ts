import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { assertTrainerClientAccess } from '@/lib/subscription/entitlements'

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

  const notes = await prisma.trainerNote.findMany({
    where:   { trainerId: user.id, clientId },
    orderBy: { createdAt: 'desc' },
    take:    50,
  })

  return Response.json({ notes })
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

  const body = await req.json() as { content?: string; isPrivate?: boolean }

  if (!body.content?.trim()) {
    return Response.json({ error: 'content is required' }, { status: 400 })
  }

  const note = await prisma.trainerNote.create({
    data: {
      trainerId: user.id,
      clientId,
      content:   body.content.trim(),
      isPrivate: body.isPrivate ?? true,
    },
  })

  return Response.json({ note }, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  try {
    await assertTrainerClientAccess(user.id, clientId)
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await req.json() as { id: string }
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })

  await prisma.trainerNote.deleteMany({ where: { id, trainerId: user.id, clientId } })
  return Response.json({ ok: true })
}
