import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { acceptInvitation } from '@/lib/trainer/relationships'

/**
 * POST /api/trainer/invite/accept
 * The authenticated user accepts a trainer invitation by token.
 * Token is extracted from the invite link (/invite/[token]) and
 * submitted here by the client UI after the user confirms.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { token } = await req.json() as { token?: string }
  if (!token) return Response.json({ error: 'token is required' }, { status: 400 })

  try {
    await acceptInvitation(token, user.id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to accept invitation'
    const status = msg === 'Invitation not found' ? 404
                 : msg === 'Invitation has expired' ? 410
                 : msg === 'Invitation is no longer valid' ? 409
                 : 500
    return Response.json({ error: msg }, { status })
  }
}
