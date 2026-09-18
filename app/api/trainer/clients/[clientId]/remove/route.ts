import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revokeClientRelationship } from '@/lib/trainer/relationships'

type Params = { params: Promise<{ clientId: string }> }

/**
 * POST /api/trainer/clients/[clientId]/remove
 *
 * Ends the trainer-client relationship. Immediate effects:
 * - Trainer loses access to client data (revokedAt set)
 * - Client's sponsored entitlement is revoked
 * - Client falls back to free (unless they independently have Plus)
 * - Client's workout and nutrition history is preserved untouched
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  try {
    await revokeClientRelationship(user.id, clientId)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to remove client'
    const status = msg === 'Relationship not found or already ended' ? 404 : 500
    return Response.json({ error: msg }, { status })
  }
}
