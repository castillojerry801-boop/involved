import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ dayId: string }> }

// GET: resolve programId from a programDayId (scoped to the authenticated user).
// Used by the workout/new page to bridge ?programDayId → start API.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { dayId } = await params

  try {
    const day = await prisma.programDay.findFirst({
      where: { id: dayId, program: { userId: user.id } },
      select: { id: true, programId: true, name: true },
    })
    if (!day) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ programId: day.programId, dayName: day.name })
  } catch {
    return Response.json({ error: 'Failed to resolve program day' }, { status: 500 })
  }
}
