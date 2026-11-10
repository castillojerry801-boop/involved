import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { reconcileSubscriberFromRC } from '@/lib/revenuecat/reconcile'

// POST /api/subscription/sync
// Fetches the authenticated user's current subscription state from the RC
// REST API and reconciles local UserSubscription rows.
//
// Delegates entirely to reconcileSubscriberFromRC — the same function used
// by the webhook handler — so the reconciliation logic stays in one place.
//
// Manual/promotional subscription rows are never modified by this route.
// Rows for billing sources absent from the RC response are left unchanged.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const rcSecretKey = process.env.REVENUECAT_SECRET_KEY
  if (!rcSecretKey) {
    return Response.json({ error: 'rc_not_configured' }, { status: 503 })
  }

  const result = await reconcileSubscriberFromRC({
    userId:        user.id,
    rcSecretKey,
    isProduction:  process.env.NODE_ENV === 'production',
    acceptSandbox: process.env.REVENUECAT_ACCEPT_SANDBOX === 'true',
  })

  if (result.status === 'rc_error') {
    return Response.json({ error: 'rc_api_error' }, { status: 502 })
  }

  if (result.status === 'no_rc_record') {
    // User has no RC subscriber record (never purchased).
    // Entitlement stays as-is from other sources (manual grants, etc.).
    const entitlement = await getUserEntitlement(user.id)
    return Response.json({ entitlement, source: 'no_rc_record' })
  }

  return Response.json({ entitlement: result.entitlement, source: 'rc_sync' })
}
