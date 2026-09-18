import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assignProgramToClient } from '@/lib/trainer/programs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/trainer/programs/[id]/assign
 * Deep-copies a trainer program template into a new Program for the client.
 * The master template is never modified.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as {
    clientId:    string
    name?:       string
    description?: string
  }

  if (!body.clientId) {
    return Response.json({ error: 'clientId is required' }, { status: 400 })
  }

  try {
    const program = await assignProgramToClient(
      user.id,
      body.clientId,
      id,
      { name: body.name, description: body.description },
    )
    return Response.json({ program }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to assign program'
    const status = msg === 'Trainer program not found' ? 404
                 : msg === 'No active trainer-client relationship' ? 403
                 : 500
    return Response.json({ error: msg }, { status })
  }
}
