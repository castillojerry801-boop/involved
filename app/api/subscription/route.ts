import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserEntitlement } from '@/lib/subscription/entitlements'

// ─── GET: current subscription entitlement ────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const entitlement = await getUserEntitlement(user.id)
  return Response.json(entitlement)
}

// ─── POST: start free trial ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { action?: string }
  if (body.action !== 'start_trial') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  // Free trial has been removed. New accounts start on the permanent Free tier
  // and subscribe directly via in-app purchase. Existing trial subscribers are
  // unaffected — their records remain valid and entitlements continue to resolve.
  return Response.json({ error: 'trial_unavailable' }, { status: 410 })
}
